"""CPU-only, independent gain and high-shelf variants of the full 25.10 s Yuki reference."""
from datetime import datetime, timezone
import hashlib
import json
import math
from pathlib import Path
import struct
import subprocess
import sys

import numpy as np

from prepare_yukino_length_references import FF, identity, metrics


FOLLOWUP = Path("I:/AI/asmr_director/qa/reference-tests/japanese-crosslingual-2026-10-26/followup-2026-10-27")
ROOT = FOLLOWUP / "reference-refinement"
BASE = FOLLOWUP / "yukino-length"
NAME = "yukinoshita-160-25p10s.wav"
RECEIPT = ROOT / "reference-variants.json"
VARIANTS = [
    {"id": "yukino25-gain-minus6", "filter": "volume=-6dB:precision=double",
     "change": "constant gain -6 dB", "gain_db": -6.0},
    {"id": "yukino25-highshelf-minus3", "filter": "treble=g=-3:f=4000:t=q:w=0.707:r=f64:n=0",
     "change": "high-shelf -3 dB at 4000 Hz, Q 0.707; no gain compensation",
     "shelf_gain_db": -3.0, "frequency_hz": 4000, "width_type": "q", "width": 0.707},
]
COMMANDS = []


def run(args, data=None, help_query=False):
    command = [str(FF), "-nostdin", "-hide_banner", "-threads", "1", "-filter_threads", "1"]
    if not help_query:
        command += ["-loglevel", "error"]
    command += args
    if any(flag in command for flag in ("-ss", "-t", "-to")):
        raise ValueError("Variants must preserve the entire source")
    result = subprocess.run(command, input=data, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                            timeout=60, creationflags=subprocess.CREATE_NO_WINDOW)
    COMMANDS.append({"command": command, "exit_code": result.returncode,
                     "stdin_bytes": None if data is None else len(data),
                     "stdin_sha256": None if data is None else hashlib.sha256(data).hexdigest(),
                     "stdout_bytes": len(result.stdout),
                     "stdout_sha256": hashlib.sha256(result.stdout).hexdigest(),
                     "stderr": result.stderr.decode("utf-8", "replace")})
    if result.returncode:
        raise RuntimeError(COMMANDS[-1]["stderr"])
    return result.stdout


def wav_format(path):
    with Path(path).open("rb") as f:
        header = f.read(12)
        if header[:4] != b"RIFF" or header[8:] != b"WAVE":
            raise ValueError("Expected RIFF WAVE")
        fmt, size = None, None
        while True:
            header = f.read(8)
            if not header:
                break
            kind, count = struct.unpack("<4sI", header)
            if kind == b"fmt ":
                data = f.read(count)
                tag, ch, rate, byte_rate, align, bits = struct.unpack_from("<HHIIHH", data)
                fmt = {"format_tag": tag, "channels": ch, "sample_rate": rate,
                       "block_align": align, "bits_per_sample": bits}
            elif kind == b"data":
                size = count
                f.seek(count, 1)
            else:
                f.seek(count, 1)
            if count % 2:
                f.seek(1, 1)
        if not fmt or size is None or size % fmt["block_align"]:
            raise ValueError("Incomplete WAV metadata/data")
        fmt["frames"] = size // fmt["block_align"]
        return fmt


def read_float(path, channels, filter_expression=None):
    args = ["-i", str(path), "-map", "0:a:0", "-vn", "-sn", "-dn"]
    if filter_expression:
        args += ["-af", filter_expression]
    raw = run(args + ["-c:a", "pcm_f32le", "-f", "f32le", "pipe:1"])
    if len(raw) % (4 * channels):
        raise ValueError("Incomplete float frame")
    values = np.frombuffer(raw, dtype="<f4").reshape(-1, channels)
    if not len(values) or not np.isfinite(values).all():
        raise ValueError("Invalid float audio")
    return values


def write_pcm(path, values, rate, codec):
    run(["-f", "f32le", "-ar", str(rate), "-ac", str(values.shape[1]), "-i", "pipe:0",
         "-c:a", codec, "-n", str(path)], values.astype("<f4").tobytes())


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    outputs = [ROOT / folder / (v["id"] + ".wav") for v in VARIANTS for folder in ("references", "source-previews")]
    if RECEIPT.exists() or any(path.exists() for path in outputs):
        raise FileExistsError("Variant evidence/output exists; refusing overwrite")
    help_output = run(["-h", "filter=treble"], help_query=True).decode("utf-8", "replace")
    for required in ("Q-Factor", "normalize coefficients", "floating-point double"):
        if required not in help_output:
            raise ValueError("Installed FFmpeg treble options not verified")
    sources = {
        "model": BASE / "references" / NAME,
        "source_preview": BASE / "source-previews" / NAME,
    }
    before = {key: identity(path) for key, path in sources.items()}
    formats = {key: wav_format(path) for key, path in sources.items()}
    expected = {"model": (16000, 1, 16), "source_preview": (44100, 2, 24)}
    original = {}
    for key, path in sources.items():
        fmt = formats[key]
        if (fmt["sample_rate"], fmt["channels"], fmt["bits_per_sample"]) != expected[key]:
            raise ValueError("Unexpected source format")
        if fmt["frames"] != round(25.1 * fmt["sample_rate"]):
            raise ValueError("Expected complete 25.10 second source")
        original[key] = read_float(path, fmt["channels"])
        if len(original[key]) != fmt["frames"]:
            raise ValueError("Source decode frame count changed")
    for folder in ("references", "source-previews"):
        (ROOT / folder).mkdir(parents=True, exist_ok=True)
    references = []
    for variant in VARIANTS:
        row = {**variant, "sources": before, "independent_from_original": True,
               "gain_compensation": False, "denoise": False, "trim": False,
               "speed_or_pitch_change": False, "additional_filters": False}
        for key, source in sources.items():
            fmt = formats[key]
            filtered = read_float(source, fmt["channels"], variant["filter"])
            filtered_metrics = metrics(filtered, fmt["sample_rate"])
            if filtered.shape != original[key].shape:
                raise ValueError("Filter changed sample count or channels")
            if filtered_metrics["samples_at_or_above_full_scale"]:
                raise ValueError("Filter output would clip; do not add unauthorized gain compensation")
            folder = "references" if key == "model" else "source-previews"
            path = ROOT / folder / (variant["id"] + ".wav")
            codec = "pcm_s16le" if key == "model" else "pcm_s24le"
            write_pcm(path, filtered, fmt["sample_rate"], codec)
            actual_format = wav_format(path)
            actual = read_float(path, fmt["channels"])
            actual_metrics = metrics(actual, fmt["sample_rate"])
            if actual_format != fmt or actual.shape != original[key].shape:
                raise ValueError("Output format/frame count changed")
            if actual_metrics["samples_at_or_above_full_scale"]:
                raise ValueError("PCM output clips")
            scale = 2 ** (fmt["bits_per_sample"] - 1)
            quantization_error = float(np.max(np.abs(actual.astype(np.float64)-filtered.astype(np.float64))))
            if quantization_error > 1.1 / scale:
                raise ValueError("Unexpected changes after filter output quantization")
            row[key] = {**identity(path), "codec": codec, "format": actual_format,
                        "metrics": actual_metrics, "filtered_before_pcm_metrics": filtered_metrics,
                        "frames_preserved": True, "max_abs_pcm_quantization_error": quantization_error}
            if "gain_db" in variant:
                gain = 10 ** (variant["gain_db"] / 20)
                gain_error = float(np.max(np.abs(actual.astype(np.float64)-original[key].astype(np.float64)*gain)))
                if gain_error > 1.1 / scale:
                    raise ValueError("Gain-only output is not a static -6 dB transformation")
                row[key]["static_gain_linear"] = gain
                row[key]["max_abs_error_against_static_gain"] = gain_error
        references.append(row)
    after = {key: identity(path) for key, path in sources.items()}
    if after != before:
        raise ValueError("Original source identity changed")
    report = {"version": 1, "status": "prepared", "prepared_at": datetime.now(timezone.utc).isoformat(),
              "sources": before, "sources_after": after, "sources_unchanged": True,
              "source_formats": formats,
              "source_metrics": {k: metrics(v, formats[k]["sample_rate"]) for k,v in original.items()},
              "references": references, "all_frames_preserved": True, "all_outputs_unclipped": True,
              "gain_compensation": False, "variants_independent_not_stacked": True,
              "ffmpeg_treble_help": help_output, "script": identity(Path(__file__)), "ffmpeg": identity(FF),
              "numpy_version": np.__version__, "commands": COMMANDS,
              "tts_runs": 0, "asr_runs": 0, "gpu_runs": 0,
              "notes": ["Both variants start from the same unmodified full 25.10 second source pair.",
                        "Treble q=0.707 is Q-factor width; coefficient normalization is explicitly off.",
                        "No gain compensation, limiter, normalization, denoise, trimming or tempo/pitch changes.",
                        "Gain attenuation does not improve SNR; higher high-frequency energy is not proof of noise.",
                        "No subjective similarity improvement is claimed before listening."]}
    with RECEIPT.open("x", encoding="utf-8", newline="\n") as f:
        json.dump(report, f, ensure_ascii=False, indent=2, allow_nan=False)
        f.write("\n")
    print(json.dumps({"status": "prepared", "receipt": str(RECEIPT),
                      "references": [{"id": r["id"], "model": r["model"]["path"],
                                      "source_preview": r["source_preview"]["path"],
                                      "model_peak_dbfs": r["model"]["metrics"]["peak_dbfs"]} for r in references],
                      "all_frames_preserved": True, "sources_unchanged": True}, ensure_ascii=False))


if __name__ == "__main__":
    main()
