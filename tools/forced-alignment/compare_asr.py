"""Read-only independent Whisper comparison for isolated original-PCM windows."""
from __future__ import annotations

import argparse
import ctypes
import difflib
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import sys
import threading
import time
import wave


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + '.tmp')
    temporary.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    temporary.replace(path)


def read_window(job):
    path = Path(job['source']).resolve(strict=True)
    digest = hashlib.sha256(path.read_bytes()).hexdigest()
    if job.get('sourceSha256') != digest:
        raise ValueError('Comparison WAV hash differs from the frozen job')
    with wave.open(str(path), 'rb') as stream:
        if (stream.getnchannels(), stream.getsampwidth(), stream.getframerate(), stream.getcomptype()) != (1, 2, 48000, 'NONE'):
            raise ValueError('Comparison expects original mono PCM16 / 48 kHz')
        frames = stream.getnframes()
        if not 0 < frames <= 35 * 48000:
            raise ValueError('Comparison window must be greater than zero and at most 35 seconds')
        pcm = stream.readframes(frames)
    expected = job['expected']
    if not isinstance(expected, str) or not expected.strip() or len(expected) > 600:
        raise ValueError('Invalid expected text')
    return pcm, {'source': str(path), 'source_sha256': digest,
                 'pcm_sha256': hashlib.sha256(pcm).hexdigest(), 'frames': frames,
                 'duration_seconds': frames / 48000, 'expected': expected}


def literal_comparison(expected, transcript, normalizer):
    """Measure all outcomes, including missing/extra speech, without accepting them."""
    target, actual = normalizer(expected), normalizer(transcript)
    if not target:
        raise ValueError('Expected text has no content after normalization')
    matcher = difflib.SequenceMatcher(None, target, actual, autojunk=False)
    coverage = sum(block.size for block in matcher.get_matching_blocks()) / len(target)
    row = list(range(len(actual) + 1))
    for index, left in enumerate(target, 1):
        updated = [index]
        for column, right in enumerate(actual, 1):
            updated.append(min(updated[-1] + 1, row[column] + 1,
                               row[column - 1] + (left != right)))
        row = updated
    distance = row[-1]
    return {'literal_score': coverage, 'literal_score_method': 'ordered matching coverage of normalized expected characters',
            'edit_distance': distance, 'edit_similarity': 1 - distance / max(len(target), len(actual)),
            'normalized_expected': target, 'normalized_recognized': actual,
            'literal_exact_match': target == actual,
            'text_acceptance': 'not_inferred_from_coverage_or_edit_similarity'}


def run(args):
    import psutil

    available = psutil.virtual_memory().available
    commit_available = available
    if os.name == 'nt':
        class Status(ctypes.Structure):
            _fields_ = [('length', ctypes.c_ulong), ('load', ctypes.c_ulong)] + [
                (name, ctypes.c_ulonglong) for name in
                ('total_phys', 'avail_phys', 'total_page', 'avail_page', 'total_virtual', 'avail_virtual', 'extended')]
        status = Status()
        status.length = ctypes.sizeof(status)
        if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(status)):
            raise RuntimeError('Cannot inspect experiment commit budget')
        commit_available = status.avail_page
    if available < 3 * 1024 ** 3 or commit_available < 4_820_000_000:
        raise RuntimeError(f'Insufficient experiment memory: physical={available}, commit_available={commit_available}')
    model_path = Path(args.model).resolve(strict=True)
    helper_path = Path(args.analysis_helper).resolve(strict=True)
    jobs = json.loads(Path(args.jobs).read_text(encoding='utf-8'))['jobs']
    if not isinstance(jobs, list) or not 0 < len(jobs) <= 12:
        raise ValueError('Comparison needs 1..12 frozen jobs')
    prepared = [(job, *read_window(job)) for job in jobs]
    output = Path(args.output).resolve()
    protected = {Path(facts['source']).resolve() for _, _, facts in prepared} | {helper_path, Path(args.jobs).resolve()}
    if output in protected or output.is_relative_to(model_path):
        raise ValueError('Comparison output cannot overwrite an input, helper or model file')
    if sum(facts['duration_seconds'] for _, _, facts in prepared) > 180:
        raise ValueError('Comparison exceeds the 180-second audio budget')
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ['TRANSFORMERS_OFFLINE'] = '1'
    import numpy as np

    spec = importlib.util.spec_from_file_location('alignment_experiment_voice_analysis', helper_path)
    helper = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = helper
    spec.loader.exec_module(helper)
    process = psutil.Process()
    resource = {'startup_available_bytes': available, 'startup_commit_available_bytes': commit_available,
                'peak_rss_bytes': process.memory_info().rss,
                'minimum_available_bytes': available}
    stop = threading.Event()

    def monitor():
        while not stop.wait(.2):
            resource['peak_rss_bytes'] = max(resource['peak_rss_bytes'], process.memory_info().rss)
            resource['minimum_available_bytes'] = min(resource['minimum_available_bytes'], psutil.virtual_memory().available)

    thread = threading.Thread(target=monitor, daemon=True)
    thread.start()
    report = {'method': 'existing faster-whisper large-v3 CPU int8, independent recognition',
              'model_path': str(model_path), 'analysis_helper_sha256': hashlib.sha256(helper_path.read_bytes()).hexdigest(),
              'production_modified': False, 'recognition_calls': 0, 'resources': resource, 'jobs': []}
    cache = {}
    try:
        started = time.monotonic()
        model = helper.load_model(str(model_path))
        report['model_load_seconds'] = round(time.monotonic() - started, 3)
        atomic_json(args.output, report)
        for job, pcm, facts in prepared:
            key = (facts['pcm_sha256'], facts['expected'])
            result = {'id': job['id'], 'provenance': job.get('provenance'), **facts,
                      'acceptance': 'experiment_only_no_production_confirmation'}
            if key in cache:
                result.update(cache[key])
                result['cache_hit'] = True
            else:
                print(f"Recognizing {job['id']} ({facts['duration_seconds']:.3f}s)", flush=True)
                started = time.monotonic()
                audio = np.frombuffer(pcm, dtype='<i2').astype(np.float32) / 32768
                report['recognition_calls'] += 1
                report['active_job'] = job['id']
                atomic_json(args.output, report)
                transcript, words = helper.transcribe(model, audio)
                value = {'transcript': transcript, 'words': words,
                         'seconds': round(time.monotonic() - started, 3), 'cache_hit': False}
                # Persist actual recognition before computing any diagnostic.
                result.update(value)
                report['jobs'].append(result)
                report.pop('active_job', None)
                atomic_json(args.output, report)
                value.update(literal_comparison(facts['expected'], transcript, helper.normalize))
                try:
                    helper.content_score(facts['expected'], transcript)
                    value['existing_strict_content_check'] = 'passed'
                except helper.UnsafeGroup as error:
                    value['existing_strict_content_check'] = str(error)
                cache[key] = value
                result.update(value)
            if result not in report['jobs']:
                report['jobs'].append(result)
            atomic_json(args.output, report)
            print(json.dumps({'id': result['id'], 'transcript': result['transcript'],
                              'literal_score': result['literal_score'], 'cache_hit': result['cache_hit']}, ensure_ascii=False), flush=True)
    finally:
        stop.set()
        thread.join(timeout=2)
        atomic_json(args.output, report)
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--jobs', required=True)
    parser.add_argument('--model', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--analysis-helper', default=str(Path(__file__).resolve().parents[2] / 'apps/web/scripts/analyze-voice-group.py'))
    run(parser.parse_args())
