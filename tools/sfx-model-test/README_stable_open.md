# Stable Audio Open 1.0 local comparison

**Latest status, 2026-10-05:** the user said **“相当烂，没法用，先这样吧，记录一下推一版”**.
All three remote AudioLDM2 8-second brush outputs were rejected as unusable;
counts remain local **0** / remote **3**, with no adoption. Future model tests
are paused. The earlier 5070 Ti host question is no longer the next action.
This Open adapter and its supervisor are prepared tools only: no Open model
inference was executed. The separate recorded CC0 audition library remains
pending. Recording/push is authorized; publication is not claimed here.
See the [current record](../../docs/records/2026-10-04-audio-quality-v1-stable-open-resume.md).

See [中文](README_stable_open.zh.md). This adapter was prepared for a proposed
CUDA comparison. Its implementation has not generated audio or established
RTX 5070 Ti performance. Model installation, gated license acceptance and weight
acquisition remain separate operations; this script does none of them.

The [official model card](https://huggingface.co/stabilityai/stable-audio-open-1.0)
describes native stereo at 44.1 kHz, with up to 47 seconds per generation, under
the [Stability AI Community License](https://huggingface.co/stabilityai/stable-audio-open-1.0/blob/main/LICENSE.md).
Retain the license and model card from the pinned snapshot. Product adoption and
commercial eligibility are separate from this isolated listening experiment.

Use an existing complete **Diffusers** snapshot of
`stabilityai/stable-audio-open-1.0`, with `model_index.json`, scheduler, tokenizer,
text encoder, projection model, transformer and VAE subdirectories and their
safetensors weights. A top-level stable-audio-tools checkpoint alone is
insufficient. `--revision` requires its full 40-character upstream commit SHA.
For a Hugging Face `snapshots/<SHA>` path, the SHA must match the directory name.
For a copied directory, the supplied revision is provenance recorded by the
caller; the adapter cannot establish upstream identity offline. Preserve the
download receipt and weight checksums externally.

The runtime needs CUDA PyTorch, Diffusers with
[StableAudioPipeline](https://huggingface.co/docs/diffusers/api/pipelines/stable_audio),
Transformers, Accelerate, NumPy, SciPy and Safetensors, plus the tokenizer's
requirements. RTX 5070 Ti uses Blackwell; a suitable CUDA stack is necessary.
[PyTorch 2.7](https://pytorch.org/blog/pytorch-2-7/) introduced Blackwell support
with CUDA 12.8 builds. This does not establish that an arbitrary older environment
or wheel works on that GPU. No packages are installed by the adapter.

The default uses FP16 and direct `pipe.to("cuda")`, intended for the proposed
16 GB host. `--cpu-offload` (alias `--enable-model-cpu-offload`) explicitly selects
`enable_model_cpu_offload()`. There is no automatic fallback. Default generation
is 24 seconds, 50 steps, guidance 7, one waveform at a time, one CPU thread. Seeds
and categories default to the existing `prompts.json`; pass explicit selections
for a single first case.

Every pending generation must be launched through **`run_bounded.py`** with at
most **300 seconds for the entire child invocation**, including imports and model
load. Start with one category and one seed. The wrapper writes a log and receipt,
supports Ctrl-C and a cancel file, and terminates its owned process tree on a
deadline or cancellation. The adapter requires the wrapper's environment launch
contract before expensive imports; that contract is not an authentication
mechanism. Do not manually set the contract variables to bypass the supervisor.

Only if the user explicitly resumes model testing, and after the host, local
snapshot and runtime have been confirmed, from the
repository root, substitute actual paths and the actual downloaded commit. Keep
weights, environments, logs and audio outside Git. The examples contain
placeholders and have not been executed.

PowerShell:

```powershell
$taskPython = 'X:/existing-runtime/python.exe'
$taskModel = 'X:/models/stable-audio-open-1.0/snapshots/ACTUAL_COMMIT_SHA'
$taskRevision = 'ACTUAL_40_CHARACTER_COMMIT_SHA'
$taskOutput = 'X:/experiments/stable-open/brush-24s-first'
& $taskPython tools/sfx-model-test/run_bounded.py --timeout-seconds 300 --log-path "$taskOutput/run.log" --receipt-path "$taskOutput/run-receipt.json" --cancel-file "$taskOutput/cancel" -- $taskPython tools/sfx-model-test/generate_stable_open.py --model-path $taskModel --revision $taskRevision --artifact-root $taskOutput --categories ear_brushing --seeds 104729 --duration 24 --steps 50
```

Linux / WSL, with the snapshot and runtime accessible on that host:

```sh
task_python=/path/to/existing-venv/bin/python
task_model=/path/to/stable-audio-open-1.0/snapshots/ACTUAL_COMMIT_SHA
task_revision=ACTUAL_40_CHARACTER_COMMIT_SHA
task_output=/path/to/experiments/stable-open/brush-24s-first
"$task_python" tools/sfx-model-test/run_bounded.py --timeout-seconds 300 --log-path "$task_output/run.log" --receipt-path "$task_output/run-receipt.json" --cancel-file "$task_output/cancel" -- "$task_python" tools/sfx-model-test/generate_stable_open.py --model-path "$task_model" --revision "$task_revision" --artifact-root "$task_output" --categories ear_brushing --seeds 104729 --duration 24 --steps 50
```

Create the specified cancel file from another terminal to cancel. An existing
cancel file prevents launch. Supervisor deadline/cancellation/native crashes may
leave a run marked `running` or the manifest marked `loading`; the supervisor
receipt is the authoritative termination record. Preserve that root and stop.
Inspect a failed first case before explicitly launching a new root; no automatic
retry or continuation is performed. Do not combine multiple attempts in a shell
loop that ignores exit codes.

Success preserves both output channels in a float32 WAV without gain changes,
clipping, mixing, loops, stitching, denoising, fades or spatial processing. Each
take starts from its own seeded noise. Exact frame count, finite values and
nonzero audio are checked; invalid but correctly shaped waveforms remain as raw
WAVs with failed status. Unexpected output layouts are retained as diagnostic
NPY files and fail immediately. All successful takes remain in the manifest;
listening acceptance starts as pending. Native stereo does not establish binaural
provenance or ASMR quality.

`generation-manifest.json` is compatible with `analyze_and_listen.py`. It records
raw SHA256, prompts, seeds, duration, steps, host, Python/package versions,
CUDA/GPU details, VRAM capacity/free bytes before load, placement, scheduler,
process GPU peaks and inference timing. Peaks measure this PyTorch process;
inference timing excludes model loading and file writes. SHA256 of the model
index is recorded, but does not replace a weight download receipt.

```powershell
& $taskPython tools/sfx-model-test/analyze_and_listen.py --manifest "$taskOutput/generation-manifest.json" --artifact-root $taskOutput
```

Reinvoking a successful selection verifies its unchanged request, prompt and raw
SHA256 and preserves it without loading the model. Additional categories/seeds
can share a completed root only with identical common settings and unchanged
prompts. A changed duration, steps, placement, CPU threads, model path/revision or
prompt file requires a new root. Any failed or interrupted experiment blocks
further generation in that root. Existing raw outputs are never overwritten.

Preparation checks cover standard-library parsing, negative arguments, path and
manifest preservation rules. Supervisor tests use synthetic processes only.
These checks do not run inference, generate model audio or verify listening quality.
