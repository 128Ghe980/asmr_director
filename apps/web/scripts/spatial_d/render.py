"""File-based product entry point for the user-selected original D spatial sound.

Run ``python -B apps/web/scripts/spatial_d/render.py --request request.json``.
Only mono dry inputs are accepted. This processor owns distance, binaural
position and room effects; the caller must not pan or spatialize its stereo
result again. Clip volume belongs to the mixer, not this process.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path
import sys
import time

import numpy as np
import pyloudnorm as pyln
import soundfile as sf
from scipy.signal import resample_poly

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from spatial_d.core import FS, Profile, room_ir
from spatial_d.motion_convolution import render_moving

DISTANCES = {"very_close": .18, "close": .35, "near": .5, "mid": .8, "far": 1.75}
MOVEMENTS = {"static", "approach", "recede", "left_to_right", "right_to_left", "orbit", "orbit_approach"}
TAIL_SECONDS = .65
MAX_SECONDS = 600
METER = pyln.Meter(FS)


def digest(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as file:
        for block in iter(lambda: file.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def finite_number(value, name, low, high):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not np.isfinite(value) or not low <= value <= high:
        raise ValueError(f"{name} must be finite and between {low} and {high}")
    return float(value)


def trajectory(position, times, duration):
    """Original >=12s orbit timing; proportionally shortened holds below 12s.

    Coordinates are x front/y left/z up. Product pan -1 means left (+90deg).
    approach/recede vary between the far anchor and selected distance.
    orbit_approach retains the approved fixed 1.75m -> .18m path.
    """
    if not isinstance(position, dict) or set(position) != {"pan", "distance", "movement"}:
        raise ValueError("position requires only pan, distance and movement")
    pan = finite_number(position["pan"], "pan", -1, 1)
    if position["distance"] not in DISTANCES or position["movement"] not in MOVEMENTS:
        raise ValueError("unsupported distance or movement")
    finite_number(duration, "duration", 1 / FS, MAX_SECONDS)
    t = np.asarray(times, dtype=np.float64)
    if t.ndim != 1 or not np.isfinite(t).all():
        raise ValueError("trajectory times must be a finite vector")
    scale = min(1., duration / 12.)
    first, last = 1.5 * scale, duration - 2.5 * scale
    u = np.clip((t - first) / (last - first), 0, 1)
    ramp = .1
    left = .5 * (u - ramp / np.pi * np.sin(np.pi * u / ramp))
    remaining = 1 - u
    right = 1 - ramp - .5 * (remaining - ramp / np.pi * np.sin(np.pi * remaining / ramp))
    phase = np.clip(np.where(u < ramp, left, np.where(u > 1-ramp, right, u-ramp/2)) / (1-ramp), 0, 1)
    radius = DISTANCES[position["distance"]]
    azimuth = np.full_like(t, -90 * pan)
    radii = np.full_like(t, radius)
    movement = position["movement"]
    if movement in ("orbit", "orbit_approach"):
        azimuth = 90 + 360 * phase
    elif movement == "left_to_right":
        azimuth = 90 - 180 * phase
    elif movement == "right_to_left":
        azimuth = -90 + 180 * phase
    if movement in ("approach", "recede", "orbit_approach"):
        p = np.clip((t - 2 * scale) / (duration * .78 - 2 * scale), 0, 1)
        smooth = p * p * (3 - 2 * p)
        target = .18 if movement == "orbit_approach" else radius
        start, end = (target, 1.75) if movement == "recede" else (1.75, target)
        radii = np.clip(np.exp(np.log(start) * (1-smooth) + np.log(end) * smooth), min(start, end), max(start, end))
    return azimuth, radii


def key_times(duration, movement):
    if movement == "static":
        return np.array([0.])
    scale = min(1., duration / 12.)
    start, end = 1.5 * scale, duration - 2.5 * scale
    ramp = (end-start) * .1
    # Preserve original 100ms keys for longer clips. For short clips preserve
    # angular sampling as well, rather than jumping across an entire circle.
    step = min(.1, duration / 120.)
    return np.unique(np.r_[np.arange(0, duration, step), duration,
                           start, start+ramp, end-ramp, end, 2*scale, duration*.78])


def true_peak(audio):
    """The original 4x resample_poly estimate, using bounded temporary memory."""
    maximum = 0.
    block, guard = FS, 64
    for first in range(0, len(audio), block):
        last = min(len(audio), first + block)
        left, right = max(0, first-guard), min(len(audio), last+guard)
        enlarged = resample_poly(audio[left:right], 4, 1, axis=0)
        maximum = max(maximum, float(np.max(np.abs(enlarged[4*(first-left):4*(last-left)]))))
    return maximum


def prepare_audio(path, mode="listening", duration_seconds=None, fade_in=0., fade_out=0.):
    info = sf.info(path)
    if info.channels != 1:
        raise ValueError("spatial D requires mono input; already-stereo assets must be preserved by the caller")
    if info.samplerate not in (32000, 44100, 48000):
        raise ValueError("supported mono sample rates are 32000, 44100 and 48000")
    if not 0 < info.duration <= MAX_SECONDS:
        raise ValueError("source duration must be positive and at most 600 seconds")
    if mode not in ("listening", "none"):
        raise ValueError("preprocess must be listening or none")
    frames = info.frames
    if duration_seconds is not None:
        finite_number(duration_seconds, "durationSeconds", 1 / FS, MAX_SECONDS)
        frames = min(frames, max(1, math.ceil(duration_seconds * info.samplerate)))
    audio, rate = sf.read(path, frames=frames, dtype="float64")
    if audio.ndim != 1 or not len(audio) or not np.isfinite(audio).all():
        raise ValueError("source must contain finite nonempty mono samples")
    if rate != FS:
        common = math.gcd(rate, FS)
        audio = resample_poly(audio, FS // common, rate // common)
    if duration_seconds is not None:
        audio = audio[:max(1, round(duration_seconds * FS))]
    prep_gain_db = 0.
    measured_lufs = None
    if mode == "listening":
        edge = min(round(.012 * FS), len(audio) // 4)
        if edge:
            fade = np.sin(np.linspace(0, np.pi / 2, edge)) ** 2
            audio[:edge] *= fade
            audio[-edge:] *= fade[::-1]
        # BS.1770 requires a 400ms block. Zero padding is measurement-only;
        # short clips retain their true duration and silence never becomes NaN.
        measured = np.pad(audio, (0, max(0, round(.4 * FS) - len(audio))))
        measured_lufs = float(METER.integrated_loudness(measured))
        if np.isfinite(measured_lufs):
            prep_gain_db = -27 - measured_lufs
            audio *= 10 ** (prep_gain_db / 20)
        else:
            measured_lufs = None
    fade_in = finite_number(fade_in, "fadeInSeconds", 0, MAX_SECONDS)
    fade_out = finite_number(fade_out, "fadeOutSeconds", 0, MAX_SECONDS)
    # Same linear sample envelope as the product mixer, applied before the
    # room so neither user fade can erase the ensuing acoustic tail.
    axis = np.arange(len(audio))
    if round(fade_in * FS):
        audio *= np.minimum(1., axis / round(fade_in * FS))
    if round(fade_out * FS):
        audio *= np.minimum(1., (len(audio)-axis-1) / round(fade_out * FS))
    return audio, dict(original_sample_rate=rate, original_frames=info.frames,
                       effective_frames=len(audio), effective_duration=len(audio)/FS,
                       preprocess=mode, source_lufs_before_gain=measured_lufs,
                       preparation_gain_db=prep_gain_db, preparation_edge_fade_seconds=.012 if mode == "listening" else 0,
                       fade_in_seconds=fade_in, fade_out_seconds=fade_out)


def render_audio(audio, profile, position):
    duration = len(audio) / FS
    times = key_times(duration, position.get("movement"))
    azimuths, radii = trajectory(position, times, duration)
    if np.any(audio):
        filters = (room_ir(profile, float(az % 360), float(r)) for az, r in zip(azimuths, radii))
        result = render_moving(audio, times, filters, FS)
        result = np.pad(result, ((0, 1), (0, 0)))
    else:
        result = np.zeros((len(audio) + round(TAIL_SECONDS * FS), 2))
    result[-720:] *= np.linspace(1, 0, 720)[:, None]
    return result, dict(times_s=times.tolist(), azimuth_unwrapped_deg=azimuths.tolist(), distance_m=radii.tolist())


def render_request(request_path):
    request_path = Path(request_path).resolve(strict=True)
    if request_path.stat().st_size > 65536:
        raise ValueError("request is too large")
    request = json.loads(request_path.read_text(encoding="utf-8-sig"))
    required = {"version", "inputWav", "outputWav", "outputJson", "hrtfPath", "position"}
    optional = {"preprocess", "durationSeconds", "fadeInSeconds", "fadeOutSeconds"}
    if not isinstance(request, dict) or set(request) - required - optional or not required <= set(request) or request["version"] != 1:
        raise ValueError("invalid spatial D request")
    paths = {key: Path(request[key]).resolve() for key in ("inputWav", "outputWav", "outputJson", "hrtfPath")}
    if len(set(paths.values()) | {request_path}) != 5:
        raise ValueError("input, output, HRTF and request files must be distinct")
    if any(paths[key].parent != request_path.parent for key in ("outputWav", "outputJson")):
        raise ValueError("output files must be beside their request file")
    if any(paths[key].exists() for key in ("outputWav", "outputJson")):
        raise ValueError("spatial output files must be new")
    start = time.perf_counter()
    profile = Profile(paths["hrtfPath"])
    audio, source = prepare_audio(paths["inputWav"], request.get("preprocess", "listening"), request.get("durationSeconds"), request.get("fadeInSeconds", 0.), request.get("fadeOutSeconds", 0.))
    result, route = render_audio(audio, profile, request["position"])
    peak_before = true_peak(result)
    headroom_gain = min(1., 10 ** (-2.1 / 20) / max(peak_before, 1e-30))
    result *= headroom_gain
    # PCM24 preserves the frozen experiment within one 24-bit quantization step.
    sf.write(paths["outputWav"], result, FS, subtype="PCM_24")
    decoded, rate = sf.read(paths["outputWav"], dtype="float64", always_2d=True)
    peak = true_peak(decoded)
    if rate != FS or decoded.shape[1] != 2 or not np.isfinite(decoded).all() or peak > 10 ** (-2.08 / 20):
        raise ValueError("spatial output validation failed")
    report = dict(version=1, status="complete", path=str(paths["outputWav"]), sha256=digest(paths["outputWav"]),
                  duration=len(decoded)/FS, frames=len(decoded), sample_rate=FS, channels=2, bits_per_sample=24,
                  spatialized=True, sampleRate=FS, sourceDurationSeconds=len(audio)/FS,
                  outputDurationSeconds=len(decoded)/FS, tailSeconds=TAIL_SECONDS,
                  true_peak=peak, true_peak_dbtp=20*np.log10(max(peak, 1e-15)),
                  any_headroom_gain=headroom_gain, headroom_gain_db=20*np.log10(headroom_gain),
                  clipped_samples=int(np.count_nonzero(np.abs(decoded) >= 1)), tail_seconds=TAIL_SECONDS,
                  position=request["position"], trajectory=route,
                  source=dict(path=str(paths["inputWav"]), sha256=digest(paths["inputWav"]), **source),
                  provenance=dict(recipe="original-d-v1", hrtf_path=str(paths["hrtfPath"]), hrtf_sha256=digest(paths["hrtfPath"]),
                                  reference_distance_m=profile.reference_distance, head_radius_m=profile.head_radius,
                                  hrtf_calibration=profile.calibration,
                                  code_sha256={name: digest(Path(__file__).with_name(name)) for name in ("render.py", "core.py", "near_field.py", "motion_convolution.py")}),
                  wall_seconds=round(time.perf_counter()-start, 3))
    paths["outputJson"].write_text(json.dumps(report, ensure_ascii=False, indent=2, allow_nan=False), encoding="utf-8")
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--request", required=True, type=Path)
    args = parser.parse_args()
    try:
        report = render_request(args.request)
        print(json.dumps({key: report[key] for key in ("status", "duration", "sample_rate", "channels", "sha256")}), flush=True)
        return 0
    except Exception as error:
        print(json.dumps(dict(status="failed", error=str(error)), ensure_ascii=False), file=sys.stderr, flush=True)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
