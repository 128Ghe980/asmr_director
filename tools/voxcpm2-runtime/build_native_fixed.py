"""Isolated ResidualLM capacity fix. Never modifies cached native sources/builds.

--prepare writes only small source/patch receipts. --build compiles one C++
translation unit and relinks cached dependencies, then runs --help (no models).
"""
import argparse
import ctypes
import datetime
import difflib
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time

SCRIPT_ROOT = Path(__file__).resolve().parent
ROOT = SCRIPT_ROOT
PIN = Path('I:/AI/voxcpm2-evaluation/src/llama.cpp-omni-pinned')
SOURCE = PIN / 'tools/omni/voxcpm2'
BUILD = Path('I:/AI/voxcpm2-evaluation/src/build-cuda-vs2017')
FALLBACK = Path('I:/AI/asmr-director-whole-script-compare/2026-10-11-tea/decoder-fallback')
MSVC = Path('C:/Program Files (x86)/Microsoft Visual Studio/2017/Community/VC/Tools/MSVC/14.16.27023/bin/Hostx64/x64')
VCVARS = Path('C:/Program Files (x86)/Microsoft Visual Studio/2017/Community/VC/Auxiliary/Build/vcvars64.bat')
SDK = Path('C:/Program Files (x86)/Windows Kits/10/bin/10.0.17763.0/x64')
CL_TLOG = BUILD / 'tools/omni/voxcpm2_runtime.dir/Release/voxcpm2_runtime.tlog/CL.command.1.tlog'
EXE = ROOT / 'voxcpm2-cli-reliability.exe'
OBJ = ROOT / 'voxcpm2_runtime_fixed.obj'
LIB = ROOT / 'voxcpm2_runtime_fixed.lib'
RECEIPT = ROOT / 'build-receipt.json'


def sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def identity(path):
    path = Path(path)
    return {'path': str(path), 'bytes': path.stat().st_size, 'sha256': sha(path)}


def save(record):
    temporary = ROOT / 'build-receipt.pending.json'
    temporary.write_text(json.dumps(record, ensure_ascii=False, indent=2), encoding='utf-8')
    os.replace(temporary, RECEIPT)


def replace_once(text, before, after):
    if text.count(before) != 1:
        raise RuntimeError('Patch anchor is not unique: ' + before[:120])
    return text.replace(before, after, 1)


def write_exact(path, content):
    data = content.encode('utf-8')
    if path.exists() and path.read_bytes() != data:
        raise RuntimeError('Refusing to overwrite a different isolated input: ' + str(path))
    if not path.exists():
        path.write_bytes(data)


def prepare():
    if ROOT == SCRIPT_ROOT or SCRIPT_ROOT in ROOT.parents:
        raise RuntimeError('Build outputs must be outside the source/tool directory.')
    for protected_root in (PIN, BUILD, FALLBACK):
        if ROOT == protected_root or protected_root in ROOT.parents:
            raise RuntimeError('Build outputs cannot be inside an existing native source/build/fallback tree.')
    ROOT.mkdir(parents=True, exist_ok=True)
    expected_sources = {'voxcpm2_runtime.h': 'f7546d2b420d8842934880961bc3d7643eab02f66868b9fc89f48f22efb18b9d', 'voxcpm2_runtime.cpp': '4a6da229d91ce9932203a67beace7361b64ae6a984402174699e3b2031c6a147'}
    for name, expected in expected_sources.items():
        if sha(SOURCE / name) != expected:
            raise RuntimeError('Original native source identity changed: ' + name)
    original_h = (SOURCE / 'voxcpm2_runtime.h').read_text(encoding='utf-8')
    original_cpp = (SOURCE / 'voxcpm2_runtime.cpp').read_text(encoding='utf-8')
    header = replace_once(original_h,
        'bool               init_from_gguf(const std::string & path, ggml_backend_t backend);',
        'bool               init_from_gguf(const std::string & path, ggml_backend_t backend, int context_capacity = 32768);')
    cpp = replace_once(original_cpp,
        'bool VoxCPM2ResidualLM::init_from_gguf(const std::string & path, ggml_backend_t backend_in) {',
        'bool VoxCPM2ResidualLM::init_from_gguf(const std::string & path, ggml_backend_t backend_in, int context_capacity) {')
    cpp = replace_once(cpp,
        '    config.max_length     = 32768;\n',
        '    // Match the actual BaseLM context; keep F32 values and attention math unchanged.\n'
        '    config.max_length     = std::max(context_capacity, 512);\n')
    cpp = replace_once(cpp,
        '    if (!residual_lm.init_from_gguf(acoustic_path, backend)) {',
        '    if (!residual_lm.init_from_gguf(acoustic_path, backend, std::max(base_lm_context_size, 512))) {')
    cpp = replace_once(cpp,
        'std::vector<float> VoxCPM2ResidualLM::prefill_kv(const std::vector<float> & input, int seq_len) {\n',
        'std::vector<float> VoxCPM2ResidualLM::prefill_kv(const std::vector<float> & input, int seq_len) {\n'
        '    if (seq_len <= 0 || seq_len > config.max_length || seq_len > kv_cache.max_length) {\n'
        '        LOG_ERR("VoxCPM2ResidualLM::prefill_kv: context capacity exceeded (tokens=%d capacity=%d)\\n", seq_len, config.max_length);\n'
        '        return {};\n'
        '    }\n')
    cpp = replace_once(cpp,
        'std::vector<float> VoxCPM2ResidualLM::forward_step(const std::vector<float> & input_1d, int position) {\n',
        'std::vector<float> VoxCPM2ResidualLM::forward_step(const std::vector<float> & input_1d, int position) {\n'
        '    if (position < 0 || position >= config.max_length || position >= kv_cache.max_length) {\n'
        '        LOG_ERR("VoxCPM2ResidualLM::forward_step: context capacity exceeded (position=%d capacity=%d)\\n", position, config.max_length);\n'
        '        return {};\n'
        '    }\n')
    cpp = replace_once(cpp,
        '    const int seq_len     = static_cast<int>(inputs.token_ids.size());\n',
        '    if (inputs.token_ids.size() > static_cast<size_t>(residual_lm.config.max_length)) {\n'
        '        return fail("prefill context capacity exceeded: tokens=" + std::to_string(inputs.token_ids.size())\n'
        '                    + " capacity=" + std::to_string(residual_lm.config.max_length));\n'
        '    }\n'
        '    const int seq_len     = static_cast<int>(inputs.token_ids.size());\n')
    cpp = replace_once(cpp,
        '    if (!run_decode_front_half(noise, params, result)) {\n',
        '    if (current_position < 0 || current_position >= residual_lm.config.max_length) {\n'
        '        fail("decode context capacity exceeded: position=" + std::to_string(current_position)\n'
        '             + " capacity=" + std::to_string(residual_lm.config.max_length));\n'
        '        return result;\n'
        '    }\n'
        '    if (!run_decode_front_half(noise, params, result)) {\n')
    write_exact(ROOT / 'voxcpm2_runtime.h', header)
    write_exact(ROOT / 'voxcpm2_runtime.cpp', cpp)
    patch = ''.join(difflib.unified_diff(original_h.splitlines(True), header.splitlines(True),
        fromfile='original/voxcpm2_runtime.h', tofile='isolated/voxcpm2_runtime.h'))
    patch += ''.join(difflib.unified_diff(original_cpp.splitlines(True), cpp.splitlines(True),
        fromfile='original/voxcpm2_runtime.cpp', tofile='isolated/voxcpm2_runtime.cpp'))
    bundled_patch = SCRIPT_ROOT / 'residual-context-capacity.patch'
    if not bundled_patch.is_file() or bundled_patch.read_bytes() != patch.encode('utf-8'):
        raise RuntimeError('Generated source patch does not match the reviewed bundled patch.')
    write_exact(ROOT / 'residual-context-capacity.patch', patch)
    record = {
        'version': 1, 'prepared_at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'purpose': 'Isolated F32 ResidualLM KV capacity matches actual BaseLM context, with explicit bounds.',
        'status': 'prepared_not_compiled', 'model_runs': 0,
        'expected_low_vram_capacity': 4096, 'unchanged_normal_capacity': 32768,
        'kv_bytes_before': 536870912, 'kv_bytes_after': 67108864, 'kv_bytes_saved': 469762048,
        'component_baseline': 'Existing Aug30 cached static components plus previously verified COPY fallback; not bitexact-equivalent to Aug25 product by construction.',
        'source_originals': [identity(SOURCE / 'voxcpm2_runtime.h'), identity(SOURCE / 'voxcpm2_runtime.cpp')],
        'patched_sources': [identity(ROOT / 'voxcpm2_runtime.h'), identity(ROOT / 'voxcpm2_runtime.cpp')],
        'patch': identity(ROOT / 'residual-context-capacity.patch'), 'steps': [],
    }
    if RECEIPT.exists():
        existing = json.loads(RECEIPT.read_text(encoding='utf-8'))
        if existing.get('status') != 'prepared_not_compiled':
            raise RuntimeError('Existing build receipt must be preserved; use a fresh build directory.')
        record['prepared_at'] = existing.get('prepared_at', record['prepared_at'])
    save(record)
    return record


def windows_args(command):
    shell32 = ctypes.WinDLL('shell32', use_last_error=True)
    shell32.CommandLineToArgvW.argtypes = [ctypes.c_wchar_p, ctypes.POINTER(ctypes.c_int)]
    shell32.CommandLineToArgvW.restype = ctypes.POINTER(ctypes.c_wchar_p)
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel32.LocalFree.argtypes = [ctypes.c_void_p]
    argc = ctypes.c_int()
    result = shell32.CommandLineToArgvW('unused.exe ' + command, ctypes.byref(argc))
    if not result:
        raise ctypes.WinError(ctypes.get_last_error())
    try:
        return [result[i] for i in range(1, argc.value)]
    finally:
        kernel32.LocalFree(result)


def build_environment():
    cmd = os.environ.get('COMSPEC', 'C:/Windows/System32/cmd.exe')
    command = '"' + cmd + '" /d /s /c "call "' + str(VCVARS) + '" >nul && set"'
    result = subprocess.run(command, capture_output=True, text=True, timeout=30,
                            creationflags=subprocess.CREATE_NO_WINDOW)
    if result.returncode:
        raise RuntimeError('vcvars setup failed: ' + result.stderr[:1000])
    env = {k.upper(): v for k, v in os.environ.items()}
    for line in result.stdout.splitlines():
        if '=' in line and not line.startswith('='):
            key, value = line.split('=', 1)
            env[key.upper()] = value
    work = ROOT / 'work'
    work.mkdir(exist_ok=True)
    env['PATH'] = str(SDK) + os.pathsep + env.get('PATH', '')
    env['TEMP'] = env['TMP'] = str(work)
    return env


def process_memory(pid):
    class Counters(ctypes.Structure):
        _fields_ = [('cb', ctypes.c_ulong), ('PageFaultCount', ctypes.c_ulong)] + [
            (name, ctypes.c_size_t) for name in ('PeakWorkingSetSize', 'WorkingSetSize',
            'QuotaPeakPagedPoolUsage', 'QuotaPagedPoolUsage', 'QuotaPeakNonPagedPoolUsage',
            'QuotaNonPagedPoolUsage', 'PagefileUsage', 'PeakPagefileUsage', 'PrivateUsage')]
    kernel = ctypes.WinDLL('kernel32', use_last_error=True)
    kernel.OpenProcess.argtypes = [ctypes.c_ulong, ctypes.c_int, ctypes.c_ulong]
    kernel.OpenProcess.restype = ctypes.c_void_p
    kernel.CloseHandle.argtypes = [ctypes.c_void_p]
    psapi = ctypes.WinDLL('psapi', use_last_error=True)
    psapi.GetProcessMemoryInfo.argtypes = [ctypes.c_void_p, ctypes.POINTER(Counters), ctypes.c_ulong]
    handle = kernel.OpenProcess(0x1000 | 0x10, False, pid)
    if not handle:
        return {}
    try:
        result = Counters()
        result.cb = ctypes.sizeof(result)
        if not psapi.GetProcessMemoryInfo(handle, ctypes.byref(result), result.cb):
            return {}
        return {'peak_working_set_bytes': result.PeakWorkingSetSize,
                'sample_private_bytes': result.PrivateUsage,
                'peak_pagefile_bytes': result.PeakPagefileUsage}
    finally:
        kernel.CloseHandle(handle)


def run_step(record, name, argv, cwd, env, timeout=300, accepted_exit_codes=(0,)):
    step = {'name': name, 'argv': [str(v) for v in argv], 'cwd': str(cwd),
            'timeout_seconds': timeout, 'accepted_exit_codes': list(accepted_exit_codes),
            'started_at': datetime.datetime.now(datetime.timezone.utc).isoformat()}
    record['steps'].append(step)
    save(record)
    started = time.monotonic()
    with (ROOT / (name + '.stdout.log')).open('xb') as out, (ROOT / (name + '.stderr.log')).open('xb') as err:
        child = subprocess.Popen(step['argv'], cwd=str(cwd), env=env, stdout=out, stderr=err,
                                 creationflags=subprocess.CREATE_NO_WINDOW)
        step['pid'] = child.pid
        try:
            while child.poll() is None:
                for key, value in process_memory(child.pid).items():
                    step[key] = max(step.get(key, 0), value)
                if time.monotonic() - started > timeout:
                    step['timeout'] = True
                    child.kill()
                    break
                time.sleep(0.05)
        finally:
            step['exit_code'] = child.wait(timeout=30)
            step['wall_seconds'] = round(time.monotonic() - started, 3)
            save(record)
    print(name, 'exit', step['exit_code'], 'wall', step['wall_seconds'], flush=True)
    if step.get('timeout') or step['exit_code'] not in accepted_exit_codes:
        raise RuntimeError(name + ' failed; inspect isolated logs.')


def verify_existing():
    record = json.loads(RECEIPT.read_text(encoding='utf-8'))
    if not EXE.is_file() or [s.get('exit_code') for s in record.get('steps', [])[:3]] != [0, 0, 0]:
        raise RuntimeError('No completed isolated compile/library/link sequence to verify.')
    step = next((s for s in record['steps'] if s['name'] == '04_help_no_models'), None)
    help_text = (ROOT / '04_help_no_models.stdout.log').read_text(encoding='utf-8', errors='replace')
    help_text += (ROOT / '04_help_no_models.stderr.log').read_text(encoding='utf-8', errors='replace')
    if not step or step.get('exit_code') not in (0, 1) or 'Usage:' not in help_text or '--low-vram' not in help_text:
        raise RuntimeError('CLI help did not produce the expected no-model usage response.')
    protected_after = [identity(item['path']) for item in record['protected_inputs_before']]
    if protected_after != record['protected_inputs_before']:
        raise RuntimeError('A protected native input changed during the build.')
    for item in record['patched_sources']:
        if identity(item['path']) != item:
            raise RuntimeError('A compiled isolated source changed after compilation.')
    current_outputs = [identity(OBJ), identity(LIB), identity(EXE)]
    # A second verification must validate the original artifact identities,
    # never bless replacement bytes using an earlier binary's --help log.
    if 'outputs' in record:
        if record['outputs'] != current_outputs:
            raise RuntimeError('An isolated build artifact changed after compilation; preserving the recorded output identities.')
    elif record.get('status') == 'compiled_help_verified_no_model_runs':
        raise RuntimeError('Completed build receipt has no recorded output identities; refusing to establish a new baseline.')
    if record.get('status') == 'failed':
        original_receipt = ROOT / 'first-build-receipt.json'
        if not original_receipt.exists():
            original_receipt.write_bytes(RECEIPT.read_bytes())
        record['verification_note'] = 'Original CLI returns 1 for --help; compile/link succeeded. First verification treated 1 as failure; original receipt/log retained. No rebuild or model call.'
    step['accepted_exit_codes'] = [0, 1]
    record['protected_inputs_after'] = protected_after
    record['outputs'] = current_outputs
    record['status'] = 'compiled_help_verified_no_model_runs'
    record['model_runs'] = 0
    record.pop('error', None)
    record['finished_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    record['final_build_script'] = identity(Path(__file__))
    save(record)
    print(json.dumps({'exe': str(EXE), 'sha256': sha(EXE), 'model_runs': 0}), flush=True)


def build():
    record = prepare()
    for target in [OBJ, LIB, EXE]:
        if target.exists():
            raise RuntimeError('Refusing to overwrite isolated build artifact: ' + str(target))
    env = build_environment()
    commands = [line for line in CL_TLOG.read_text(encoding='utf-16').splitlines() if line and not line.startswith('^')]
    if len(commands) != 1:
        raise RuntimeError('Unexpected compile tlog command count.')
    flags = windows_args(commands[0])
    compile_flags = []
    for arg in flags:
        low = arg.lower()
        if low.startswith('/fo'):
            compile_flags.append('/Fo' + str(OBJ))
        elif low.startswith('/fd'):
            compile_flags.append('/Fd' + str(ROOT / 'voxcpm2_runtime_fixed.pdb'))
        elif low.replace('\\', '/').endswith('/voxcpm2_runtime.cpp'):
            compile_flags.append(str(ROOT / 'voxcpm2_runtime.cpp'))
        else:
            compile_flags.append(arg)
    baseline = json.loads((FALLBACK / 'build-receipt.json').read_text(encoding='utf-8'))
    previous = next(step for step in baseline['steps'] if step['name'] == '04_link_cli_retry')
    link_cwd = Path(previous['cwd'])
    link_flags = []
    for arg in previous['argv'][1:]:
        normalized = arg.upper().replace('/', '\\')
        if normalized.startswith('\\OUT:'):
            link_flags.append('/OUT:' + str(EXE))
        elif normalized.startswith('\\PDB:'):
            link_flags.append('/PDB:' + str(ROOT / 'voxcpm2-cli-reliability.pdb'))
        elif normalized.startswith('\\IMPLIB:'):
            link_flags.append('/IMPLIB:' + str(ROOT / 'voxcpm2-cli-reliability.lib'))
        elif normalized == 'RELEASE\\VOXCPM2_RUNTIME.LIB':
            link_flags.append(str(LIB))
        else:
            link_flags.append(arg)
    reused = [SOURCE / 'voxcpm2_runtime.h', SOURCE / 'voxcpm2_runtime.cpp',
              BUILD / 'bin/Release/voxcpm2-cli.exe', FALLBACK / 'voxcpm2-cli-copy-fallback.exe',
              BUILD / 'tools/omni/Release/voxcpm2_runtime.lib', CL_TLOG]
    for arg in previous['argv'][1:]:
        path = Path(arg)
        if path.suffix.lower() in {'.lib', '.obj'}:
            path = path if path.is_absolute() else link_cwd / path
            if path.is_file():
                reused.append(path.resolve())
    unique = {str(p.resolve()).casefold(): p.resolve() for p in reused}
    record['protected_inputs_before'] = [identity(p) for p in unique.values()]
    record['baseline_build_receipt'] = identity(FALLBACK / 'build-receipt.json')
    record['build_script'] = identity(Path(__file__))
    record['status'] = 'building'
    record['memory_scope'] = '50ms compiler/linker root-process samples; excludes descendant tools and other processes.'
    save(record)
    try:
        run_step(record, '01_compile_runtime', [MSVC / 'cl.exe', *compile_flags], ROOT, env)
        run_step(record, '02_runtime_library', [MSVC / 'lib.exe', '/NOLOGO', '/MACHINE:X64', '/OUT:' + str(LIB), OBJ], ROOT, env)
        run_step(record, '03_link_cli', [MSVC / 'link.exe', *link_flags], link_cwd, env)
        run_step(record, '04_help_no_models', [EXE, '--help'], ROOT, env, timeout=30, accepted_exit_codes=(0, 1))
        help_text = (ROOT / '04_help_no_models.stdout.log').read_text(encoding='utf-8', errors='replace')
        help_text += (ROOT / '04_help_no_models.stderr.log').read_text(encoding='utf-8', errors='replace')
        if 'Usage:' not in help_text or '--low-vram' not in help_text:
            raise RuntimeError('CLI help did not print the expected no-model usage response.')
        record['protected_inputs_after'] = [identity(p) for p in unique.values()]
        if record['protected_inputs_after'] != record['protected_inputs_before']:
            raise RuntimeError('A protected native input changed during the build.')
        record['outputs'] = [identity(OBJ), identity(LIB), identity(EXE)]
        record['status'] = 'compiled_help_verified_no_model_runs'
        record['finished_at'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    except Exception as error:
        record['status'] = 'failed'
        record['error'] = repr(error)
        raise
    finally:
        save(record)
    print(json.dumps({'exe': str(EXE), 'sha256': sha(EXE), 'model_runs': 0}), flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True, help='Fresh build directory outside this repository/tool and all existing native trees.')
    parser.add_argument('--prepare', action='store_true')
    parser.add_argument('--build', action='store_true')
    parser.add_argument('--verify-existing', action='store_true')
    args = parser.parse_args()
    ROOT = args.output.resolve()
    EXE = ROOT / 'voxcpm2-cli-reliability.exe'
    OBJ = ROOT / 'voxcpm2_runtime_fixed.obj'
    LIB = ROOT / 'voxcpm2_runtime_fixed.lib'
    RECEIPT = ROOT / 'build-receipt.json'
    if sum((args.prepare, args.build, args.verify_existing)) != 1:
        parser.error('Choose exactly one of --prepare, --build or --verify-existing.')
    if args.prepare:
        prepare()
        print('Prepared isolated sources only; no compiler or model was started.')
    elif args.verify_existing:
        verify_existing()
    else:
        build()
