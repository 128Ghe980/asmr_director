# Isolated VoxCPM2 native cache fix

This directory contains a minimal source diff and a reproducible build script. It does not contain upstream source files, models, objects, static libraries or executables. The script uses existing local tools and cached build inputs, installs nothing, and preserves original sources, old builds and the production CLI.

`residual-context-capacity.patch` makes the ResidualLM F32 K/V capacity follow the actual BaseLM context. Existing `--low-vram` uses 4096: its cache falls from 512MiB to 64MiB, saving 448MiB. Normal mode remains 32768. Model weights, reference WAV/transcript, CFG, steps, seed, sampling and audio processing remain unchanged.

Both Runtime and ResidualLM check prefill/decode capacity before building a graph. Token counts are compared as `size_t` before conversion to `int`; negative positions, nonpositive sequence lengths and out-of-range requests return errors. The one-shot paths check the error before decoding a WAV, and the CLI returns 1. Text is not truncated and partial WAV output is not silently accepted in those paths. Prefill plus generated positions must fit 4096. The six baseline cases used 156–337 prefill tokens; even allowing 800 generated steps gives at most 1137. This does not guarantee arbitrary reference or text lengths will fit.

## Reproduce on the current machine

Requirements are Windows, Python 3's standard library and these existing external assets. No large library is downloaded or copied:

- Native sources: `I:/AI/voxcpm2-evaluation/src/llama.cpp-omni-pinned`
- Cached build: `I:/AI/voxcpm2-evaluation/src/build-cuda-vs2017`
- COPY fallback assets: `I:/AI/asmr_director/qa/whole-script-compare/2026-10-11-tea/decoder-fallback`
- VS2017 Community MSVC `14.16.27023`, `vcvars64.bat`, Windows SDK `10.0.17763.0` `rc.exe`, and CUDA `11.6` libraries.

Wait for model jobs to finish, then use a fresh external output directory. Existing completed builds are never overwritten:

```powershell
py -3 -B tools/voxcpm2-runtime/build_native_fixed.py --output I:/AI/asmr_director/qa/generation-reliability/2026-10-19/native-fixed-reproduce --prepare
py -3 -B tools/voxcpm2-runtime/build_native_fixed.py --output I:/AI/asmr_director/qa/generation-reliability/2026-10-19/native-fixed-reproduce --build
```

`--prepare` writes only small source copies, the diff and a receipt. `--build` compiles one C++ runtime object, creates a small runtime library, links cached objects/libraries and the verified COPY fallback directly into `voxcpm2-cli-reliability.exe`, then invokes only `--help`. The original CLI returns 1 for help; the script accepts that established behavior and verifies the Usage text. It performs no inference or production replacement.

Outputs use about 191MiB plus tool temporary space. The first build on 2026-10-19 took approximately 1.89/0.11/3.30 seconds for compile/library/link. Sampled root-process peak working sets were approximately 109/3.4/526MiB; these exclude descendant tools and are not inference budgets. Tool temporary files stay under the chosen output directory's `work` subdirectory.

`build-receipt.json` records original/patched source SHA, reused inputs' before/after SHA, exact compiler/link arguments, exit status, sampled resources and output SHA. Changed original source identity or a mismatched diff fails closed. `--verify-existing` checks an existing completed compile/link, help logs and hashes without recompiling or loading models. Repeated verification compares OBJ/LIB/EXE identities with the original receipt; changed artifacts are rejected and the receipt is preserved instead of establishing a new verified baseline.

## Verification scope

The first isolated artifact on 2026-10-19 is:

- Original build output: `I:/AI/asmr_director/qa/generation-reliability/2026-10-19/native-fixed/voxcpm2-cli-reliability.exe`; after real comparisons it was moved to the stable runtime path `I:/AI/asmr_director/runtime/engines/voxcpm2/reliability-20261019/voxcpm2-cli.exe`. The experiment root's `runtime-location.json` records that move. The build receipt retains its original paths; do not run `--verify-existing` against the moved-away original output.
- SHA256: `feba01044885d494bb428ec61d9db9626f728a482dc8fc51a84b6dbf5fec4c80`
- This builder ran zero model inferences. Real multi-text comparisons are orchestrated separately and serially.

The build reuses Aug30 cached objects and COPY fallback. Comparison with the Aug25 production CLI includes more than this cache change. To isolate numerical compatibility of this patch, compare with the old COPY fallback using identical inputs and parameters. A smaller fixed cache does not prove historical cuBLAS initialization errors or commit-memory pressure are fully resolved; actual generation and resource receipts determine that outcome. The patch does not move reference VAE work to CPU or introduce reference chunking, audio trimming or retries.

The error-propagation claim covers one-shot generation. The existing CLI `--stream` branch ignores the streaming function's failure return and can save previously accumulated chunks after an exceptional failure; that branch is unchanged. Production does not use it, and the existing argument parser rejects `--low-vram --stream`. This work does not claim streaming error handling is fixed.

Upstream sources and dependencies retain their own licenses. This directory distributes only the authored build script and a diff against the existing local sources.
