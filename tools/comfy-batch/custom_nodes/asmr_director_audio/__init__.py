"""Portable ComfyUI adapters for the product's explicit D audio processor.

The exporter supplies engine/ and the configured SOFA; no downloads or
subprocesses occur inside these nodes. Torch is supplied by ComfyUI.
"""
from __future__ import annotations

import math
from functools import lru_cache
from pathlib import Path

import numpy as np
from scipy.signal import resample_poly

from .engine import processed_voice as engine

RATE = 48000
DISTANCES = ["far", "mid", "near", "close", "very_close"]
MOVEMENTS = ["static", "approach", "recede", "left_to_right", "right_to_left", "orbit", "orbit_approach"]


def _samples(value, rate):
    if type(rate) is not int or not 8000 <= rate <= 192000:
        raise ValueError("Unsupported ASMR sample rate")
    samples = np.asarray(value, dtype=np.float64)
    if samples.ndim != 2 or samples.shape[0] not in (1, 2) or not 0 < samples.shape[1] <= rate * 601 or not np.isfinite(samples).all():
        raise ValueError("ASMR audio must be finite mono/stereo channels x samples")
    samples = samples.T.copy()
    if rate != RATE:
        common = math.gcd(rate, RATE)
        samples = resample_poly(samples, RATE // common, rate // common, axis=0)
    return samples


@lru_cache(maxsize=1)
def _profile():
    return engine.Profile(Path(__file__).parent / "data" / "subj_A.sofa")


def spatial_samples(samples, sample_rate, duration_seconds, start_pan, start_distance,
                    end_pan, end_distance, movement, gain_db, profile=None):
    duration = engine.number(duration_seconds, 1 / RATE, 600)
    gain = engine.number(gain_db, -36, 6)
    start = {"pan": start_pan, "distance": start_distance}
    end = start if movement == "static" else {"pan": end_pan, "distance": end_distance}
    options = engine.settings({"start": start, "end": end, "movement": movement,
                               "volumeDb": gain, "fadeInSeconds": 0., "fadeOutSeconds": 0., "binaural": True})
    source = _samples(samples, sample_rate)
    count = max(1, round(duration * RATE))
    # Generated stereo is deliberately treated as one object source; the raw
    # H3 video remains untouched. D creates the selected listener-relative cues.
    mono = source.mean(axis=1, keepdims=True)[:count]
    mono = np.pad(mono, ((0, max(0, count - len(mono))), (0, 0)))
    rendered, _ = engine.render_audio(mono, options, profile if profile is not None else _profile())
    result = rendered[:count].copy()
    result = np.pad(result, ((0, max(0, count - len(result))), (0, 0)))
    # The shared renderer keeps room tails; a sidecar must end within its shot.
    edge = min(round(.012 * RATE), count // 4)
    if edge:
        result[-edge:] *= (np.sin(np.linspace(np.pi / 2, 0, edge)) ** 2)[:, None]
    return result.T.astype(np.float32)


def mix_samples(base, base_rate, overlay, overlay_rate):
    original, effect = _samples(base, base_rate), _samples(overlay, overlay_rate)
    if original.shape[1] == 1:
        original = np.repeat(original, 2, axis=1)
    if effect.shape[1] == 1:
        effect = np.repeat(effect, 2, axis=1)
    count = min(len(original), len(effect))
    original[:count] += effect[:count]
    peak = engine.true_peak(original)
    original *= min(1., .98 / max(peak, 1e-30))
    return original.T.astype(np.float32)


def _unpack(audio):
    value = audio["waveform"].detach().cpu().numpy()
    if value.ndim != 3 or value.shape[0] != 1:
        raise ValueError("Process one ASMR shot at a time")
    return value[0], audio["sample_rate"]


def _audio(samples):
    import torch
    return {"waveform": torch.from_numpy(np.ascontiguousarray(samples))[None], "sample_rate": RATE}


class AsmrDirectorSpatialAudio:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {
            "audio": ("AUDIO",),
            "duration_seconds": ("FLOAT", {"default": 5., "min": 1 / RATE, "max": 600., "step": .001}),
            "start_pan": ("FLOAT", {"default": 0., "min": -1., "max": 1.}),
            "start_distance": (DISTANCES,),
            "end_pan": ("FLOAT", {"default": 0., "min": -1., "max": 1.}),
            "end_distance": (DISTANCES,),
            "movement": (MOVEMENTS,),
            "gain_db": ("FLOAT", {"default": -12., "min": -36., "max": 6.}),
        }}

    RETURN_TYPES = ("AUDIO",)
    FUNCTION = "process"
    CATEGORY = "ASMR Director/audio"

    def process(self, audio, duration_seconds, start_pan, start_distance, end_pan, end_distance, movement, gain_db):
        samples, rate = _unpack(audio)
        result = spatial_samples(samples, rate, duration_seconds, start_pan, start_distance,
                                 end_pan, end_distance, movement, gain_db)
        return (_audio(result),)


class AsmrDirectorMixAudio:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"audio1": ("AUDIO",), "audio2": ("AUDIO",)}}

    RETURN_TYPES = ("AUDIO",)
    FUNCTION = "mix"
    CATEGORY = "ASMR Director/audio"

    def mix(self, audio1, audio2):
        base, base_rate = _unpack(audio1)
        overlay, overlay_rate = _unpack(audio2)
        return (_audio(mix_samples(base, base_rate, overlay, overlay_rate)),)


NODE_CLASS_MAPPINGS = {"AsmrDirectorSpatialAudio": AsmrDirectorSpatialAudio, "AsmrDirectorMixAudio": AsmrDirectorMixAudio}
NODE_DISPLAY_NAME_MAPPINGS = {"AsmrDirectorSpatialAudio": "ASMR Director · D spatial audio", "AsmrDirectorMixAudio": "ASMR Director · mix aligned audio"}
