"""Explicit, persistent voice post-processing; never synthesize or recognize speech.

The room and time-varying convolution are the unchanged original D modules.
This separate entry point does not import spatial_d.render or spatial-studio.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import math
from pathlib import Path
import sys

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy.signal import resample_poly

if __package__:
    from .spatial_d.core import FS, Profile, room_ir
    from .spatial_d.motion_convolution import render_moving
else:
    from spatial_d.core import FS, Profile, room_ir
    from spatial_d.motion_convolution import render_moving

RENDERER_VERSION = "processed-voice-v1"
DISTANCES = {"very_close": .18, "close": .35, "near": .5, "mid": .8, "far": 1.75}
BASIC_GAINS = {"very_close": 1.12, "close": 1., "near": .82, "mid": .62, "far": .35}
MOVEMENTS = {"static", "approach", "recede", "left_to_right", "right_to_left", "orbit", "orbit_approach"}
MAX_SECONDS = 600
MAX_SOURCE_BYTES = 128 * 1024 * 1024
TAIL_SECONDS = .65


def number(value, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or not low <= value <= high:
        raise ValueError("invalid numeric setting")
    return float(value)


def anchor(value):
    if not isinstance(value, dict) or set(value) != {"pan", "distance"} or value["distance"] not in DISTANCES:
        raise ValueError("invalid sound anchor")
    return {"pan": number(value["pan"], -1, 1), "distance": value["distance"]}


def settings(request):
    start, end = anchor(request["start"]), anchor(request["end"])
    movement = request["movement"]
    if movement not in MOVEMENTS or type(request["binaural"]) is not bool:
        raise ValueError("invalid sound movement")
    if movement == "static" and start != end:
        raise ValueError("static sound requires identical anchors")
    return {"start": start, "end": end, "movement": movement,
            "volumeDb": number(request["volumeDb"], -80, 12),
            "fadeInSeconds": number(request["fadeInSeconds"], 0, MAX_SECONDS),
            "fadeOutSeconds": number(request["fadeOutSeconds"], 0, MAX_SECONDS),
            "binaural": request["binaural"]}


def trajectory(start, end, movement, times, duration):
    """All clips use their explicit endpoints; no implicit jump to far/left.

    A positive orbit traverses a full circle and, when needed, continues to the
    requested ending angle. Identical angular anchors give exactly one circle.
    """
    start, end = anchor(start), anchor(end)
    if movement not in MOVEMENTS:
        raise ValueError("invalid movement")
    duration = number(duration, 1 / FS, MAX_SECONDS)
    t = np.asarray(times, dtype=np.float64)
    if t.ndim != 1 or not np.isfinite(t).all():
        raise ValueError("invalid trajectory times")
    p = np.clip(t / duration, 0, 1)
    phase = p * p * (3 - 2 * p)
    first, last = -90 * start["pan"], -90 * end["pan"]
    a, b = DISTANCES[start["distance"]], DISTANCES[end["distance"]]
    if movement == "static":
        if start != end:
            raise ValueError("static sound requires identical anchors")
        return np.full_like(t, first), np.full_like(t, a)
    turn = 360 + ((last - first) % 360) if movement in {"orbit", "orbit_approach"} else last - first
    return first + turn * phase, np.exp(np.log(a) * (1 - phase) + np.log(b) * phase)


def key_times(start, end, movement, duration):
    if movement == "static":
        return np.array([0.])
    angular = abs(-90 * end["pan"] + 90 * start["pan"])
    if movement in {"orbit", "orbit_approach"}:
        angular = 360 + ((-90 * end["pan"] + 90 * start["pan"]) % 360)
    # At most ~5 degrees between samples, including rapid short movements.
    count = max(2, math.ceil(duration / .1), math.ceil(angular * 1.5 / 5))
    return np.linspace(0, duration, count + 1)


def read_source(path):
    path = Path(path)
    if not path.is_file() or not 44 <= path.stat().st_size <= MAX_SOURCE_BYTES:
        raise ValueError("invalid source file")
    raw = path.read_bytes()
    if not 44 <= len(raw) <= MAX_SOURCE_BYTES:
        raise ValueError("invalid source size")
    info = sf.info(io.BytesIO(raw))
    if info.channels not in (1, 2) or info.samplerate not in (32000, 44100, 48000) or not 0 < info.frames / info.samplerate <= MAX_SECONDS:
        raise ValueError("unsupported source WAV")
    if info.format != "WAV" or info.subtype not in {"PCM_16", "PCM_24", "PCM_32", "FLOAT"}:
        raise ValueError("unsupported source encoding")
    audio, rate = sf.read(io.BytesIO(raw), dtype="float64", always_2d=True)
    if not len(audio) or not np.isfinite(audio).all():
        raise ValueError("invalid source samples")
    if rate != FS:
        common = math.gcd(rate, FS)
        audio = resample_poly(audio, FS // common, rate // common, axis=0)
    return audio, hashlib.sha256(raw).hexdigest(), info


def prepare_audio(audio, options, normalize=False):
    audio = np.asarray(audio, dtype=np.float64).copy()
    if audio.ndim != 2 or audio.shape[1] not in (1, 2) or not len(audio) or not np.isfinite(audio).all():
        raise ValueError("invalid source samples")
    if normalize:
        edge = min(round(.012 * FS), len(audio) // 4)
        if edge:
            ramp = np.sin(np.linspace(0, np.pi / 2, edge)) ** 2
            audio[:edge] *= ramp[:, None]
            audio[-edge:] *= ramp[::-1, None]
        measured = np.pad(audio[:, 0], (0, max(0, round(.4 * FS) - len(audio))))
        level = float(pyln.Meter(FS).integrated_loudness(measured))
        if math.isfinite(level):
            audio *= 10 ** ((-27 - level) / 20)
    axis = np.arange(len(audio), dtype=np.float64)
    for fade, envelope in ((options["fadeInSeconds"], axis), (options["fadeOutSeconds"], len(audio) - axis - 1)):
        count = round(fade * FS)
        if count:
            audio *= np.clip(envelope / count, 0, 1)[:, None]
    return audio


def true_peak(audio):
    peak = 0.
    block, guard = FS, 64
    for first in range(0, len(audio), block):
        last = min(len(audio), first + block)
        left, right = max(0, first - guard), min(len(audio), last + guard)
        enlarged = resample_poly(audio[left:right], 4, 1, axis=0)
        peak = max(peak, float(np.max(np.abs(enlarged[4 * (first-left):4 * (last-left)]))))
    return peak


def render_audio(audio, options, profile=None):
    spatialized = options["binaural"] and audio.shape[1] == 1
    prepared = prepare_audio(audio, options, normalize=spatialized)
    duration = len(prepared) / FS
    times = key_times(options["start"], options["end"], options["movement"], duration)
    azimuths, radii = trajectory(options["start"], options["end"], options["movement"], times, duration)
    if spatialized:
        if profile is None:
            raise ValueError("HRTF profile required")
        if np.any(prepared):
            filters = (room_ir(profile, float(az % 360), float(radius)) for az, radius in zip(azimuths, radii))
            output = render_moving(prepared[:, 0], times, filters, FS)
            output = np.pad(output, ((0, 1), (0, 0)))
        else:
            output = np.zeros((len(prepared) + round(TAIL_SECONDS * FS), 2))
        output[-720:] *= np.linspace(1, 0, 720)[:, None]
    elif prepared.shape[1] == 2:
        output = prepared  # Preserve any existing stereo/binaural cues.
    else:
        sample_times = np.arange(len(prepared)) / FS
        azimuth, radius = trajectory(options["start"], options["end"], options["movement"], sample_times, duration)
        pan = -np.sin(np.deg2rad(azimuth))
        angle = (np.clip(pan, -1, 1) + 1) * np.pi / 4
        ordered = sorted(DISTANCES, key=DISTANCES.get)
        distance_gain = np.interp(np.log(radius), np.log([DISTANCES[key] for key in ordered]), [BASIC_GAINS[key] for key in ordered])
        signal = prepared[:, 0] * distance_gain
        output = np.column_stack((signal * np.cos(angle), signal * np.sin(angle)))
    output *= 10 ** (options["volumeDb"] / 20)  # Exactly once, including stereo.
    peak = true_peak(output)
    headroom = min(1., 10 ** (-2.1 / 20) / max(peak, 1e-30))
    output *= headroom
    return output, {"spatialized": spatialized, "tailSeconds": TAIL_SECONDS if spatialized else 0,
                    "headroomGain": headroom, "timesSeconds": times.tolist(),
                    "azimuthDegrees": azimuths.tolist(), "distanceMeters": radii.tolist()}


def render_request(request_path):
    request_path = Path(request_path).resolve(strict=True)
    if request_path.stat().st_size > 65536:
        raise ValueError("request too large")
    request = json.loads(request_path.read_text(encoding="utf-8-sig"))
    required = {"version", "inputWav", "outputWav", "outputJson", "sourceSha256", "start", "end", "movement", "volumeDb", "fadeInSeconds", "fadeOutSeconds", "binaural"}
    if not isinstance(request, dict) or set(request) - required - {"hrtfPath"} or not required <= set(request) or type(request["version"]) is not int or request["version"] != 1:
        raise ValueError("invalid processed voice request")
    options = settings(request)
    paths = {key: Path(request[key]).resolve() for key in ("inputWav", "outputWav", "outputJson")}
    protected = {request_path, paths["inputWav"]}
    if "hrtfPath" in request:
        protected.add(Path(request["hrtfPath"]).resolve())
    if len({*paths.values(), request_path}) != 4 or any(paths[key] in protected or paths[key].parent != request_path.parent or paths[key].exists() for key in ("outputWav", "outputJson")):
        raise ValueError("output files must be distinct and new beside request")
    audio, source_sha, source_info = read_source(paths["inputWav"])
    if request["sourceSha256"] != source_sha:
        raise ValueError("source snapshot changed")
    profile = Profile(request["hrtfPath"]) if options["binaural"] and source_info.channels == 1 and "hrtfPath" in request else None
    output, route = render_audio(audio, options, profile)
    sf.write(paths["outputWav"], output, FS, subtype="PCM_24")
    decoded, rate = sf.read(paths["outputWav"], dtype="float64", always_2d=True)
    if rate != FS or decoded.shape != output.shape or not np.isfinite(decoded).all() or true_peak(decoded) > 10 ** (-2.08 / 20):
        raise ValueError("invalid rendered audio")
    report = {"version": 1, "rendererVersion": RENDERER_VERSION, "sourceSha256": source_sha,
              "outputSha256": hashlib.sha256(paths["outputWav"].read_bytes()).hexdigest(),
              "sampleRate": FS, "channels": 2, "sourceFrames": len(audio), "outputFrames": len(decoded),
              "sourceDurationSeconds": len(audio) / FS, "outputDurationSeconds": len(decoded) / FS,
              "settings": options, **route}
    paths["outputJson"].write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True, type=Path)
    args = parser.parse_args()
    try:
        report = render_request(args.request)
        print(json.dumps({key: report[key] for key in ("rendererVersion", "outputDurationSeconds", "outputSha256")}), flush=True)
        return 0
    except Exception:
        print("Processed voice rendering failed.", file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
