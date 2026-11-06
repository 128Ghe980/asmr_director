"""Portable ComfyUI adapters for the product's explicit D audio processor.

The exporter supplies engine/ and the configured SOFA; no downloads or
subprocesses occur inside these nodes. Torch is supplied by ComfyUI.
"""
from __future__ import annotations

import math
from functools import lru_cache
from pathlib import Path

import numpy as np
import pyloudnorm as pyln
from scipy.signal import resample_poly

from .engine import processed_voice as engine

RATE = 48000
DISTANCES = ["far", "mid", "near", "close", "very_close"]
MOVEMENTS = ["static", "approach", "recede", "left_to_right", "right_to_left", "orbit", "orbit_approach"]
BALANCED_PEAK = 10 ** (-2.1 / 20)


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


def _mix_gain(original, effect):
    """Find one effect gain that leaves every sample of the voice at its original gain."""
    count = min(len(original), len(effect))

    def peak_at(gain):
        combined = original.copy()
        combined[:count] += gain * effect[:count]
        return engine.true_peak(combined)

    if peak_at(1.) <= .98:
        return 1.
    # Previously mastered voices can already exceed the mix headroom.
    ceiling = max(.98, engine.true_peak(original))
    low, high = 0., 1.
    for _ in range(12):
        mid = (low + high) / 2
        if peak_at(mid) <= ceiling:
            low = mid
        else:
            high = mid
    return low


def mix_samples(base, base_rate, overlay, overlay_rate, preserve_base=False):
    original, effect = _samples(base, base_rate), _samples(overlay, overlay_rate)
    if original.shape[1] == 1:
        original = np.repeat(original, 2, axis=1)
    if effect.shape[1] == 1:
        effect = np.repeat(effect, 2, axis=1)
    count = min(len(original), len(effect))
    if preserve_base:
        original[:count] += _mix_gain(original, effect) * effect[:count]
    else:
        original[:count] += effect[:count]
        peak = engine.true_peak(original)
        original *= min(1., .98 / max(peak, 1e-30))
    return original.T.astype(np.float32)


def _loudness(samples):
    """Gated integrated loudness, with silence left unmeasurable rather than raised."""
    measured = np.asarray(samples, dtype=np.float64)
    if not np.any(measured):
        return None
    if len(measured) < round(.4 * RATE):
        measured = np.pad(measured, ((0, round(.4 * RATE) - len(measured)), (0, 0)))
    level = float(pyln.Meter(RATE).integrated_loudness(measured))
    return level if math.isfinite(level) else None


def _edge_activity(samples, tail):
    """Representative audible contact energy in the first or last three seconds."""
    width = round(.05 * RATE)
    n = len(samples) // width
    frames = samples[:n * width].reshape(n, width, samples.shape[1])
    power = np.einsum("bfc,bfc->b", frames, frames) / width
    remainder = samples[n * width:]
    if len(remainder):
        power = np.append(power, np.einsum("fc,fc->", remainder, remainder) / width)
    edge_count = 3 * RATE // width
    edge = power[-edge_count:] if tail else power[:edge_count]
    # If the edge contains only a room floor below the clip's contacts, defer
    # to the normal voice/trigger balance. Otherwise measure the active blocks.
    gate = max(10 ** (-60 / 10), float(power.max()) * 10 ** (-20 / 10),
               float(edge.max()) * 10 ** (-14 / 10))
    active = edge[edge >= gate]
    return 10 * math.log10(float(np.percentile(active, 75))) if len(active) else None


def _balanced_target(result, rendered_level, previous_trigger, voice_level, role, trim, previous_gain_db):
    if role == "ambience":
        return -48. + trim
    target = -32. + trim
    if voice_level is not None:
        # A symmetric window permits the trigger on either side of the voice.
        anchor = float(np.clip(voice_level, -42., -22.))
        target = float(np.clip(target, anchor - 4., anchor + 4.))
    if previous_trigger is not None and rendered_level is not None:
        last = _edge_activity(previous_trigger, tail=True)
        first = _edge_activity(result, tail=False)
        if last is not None and first is not None:
            previous_trim = float(np.clip(engine.number(previous_gain_db, -36, 6) + 12., -6., 6.))
            target = rendered_level + last - first + trim - previous_trim
            if voice_level is not None:
                # Sparse contact patterns can have different integrated LUFS at
                # identical tap levels. Allow at most 2 dB of voice correction.
                nearby = np.clip(target, anchor - 4., anchor + 4.)
                target += float(np.clip(nearby - target, -2., 2.))
    return target


def balance_samples(spatial, source, reference, role, mix_mode, gain_db, *,
                    version=1, previous_trigger=None, previous_gain_db=-12., use_voice_reference=False):
    """One gain for the whole clip/ears: preserve its attacks, pauses and D motion.

    Inputs are frames x channels at RATE, already validated/resampled by the node.
    New role-labelled clips use model gain as a bounded creative trim around the
    role's neutral value. Legacy spatial_samples never calls this function.
    """
    if role not in ("trigger", "ambience") or mix_mode not in ("overlay", "replace"):
        raise ValueError("Unsupported ASMR balancing role or mix mode")
    gain = engine.number(gain_db, -36, 6)
    result = np.asarray(spatial, dtype=np.float64).copy()
    inputs = (result, source, reference) if previous_trigger is None else (result, source, reference, previous_trigger)
    for samples in inputs:
        if (samples.ndim != 2 or samples.shape[1] not in (1, 2) or not len(samples)
                or not np.isfinite(samples).all()):
            raise ValueError("Invalid ASMR balancing samples")
    if version == 2:
        # The mix duplicates a mono voice to both ears. Meter the signal in its
        # delivered channel layout so mono and equivalent stereo agree.
        reference = np.broadcast_to(reference, (len(reference), 2))
    source_level, rendered_level = _loudness(source), _loudness(result)
    reference_level = _loudness(reference) if mix_mode == "overlay" or use_voice_reference else None
    neutral = -12. if role == "trigger" else -30.
    trim = float(np.clip(gain - neutral, -6., 6. if role == "trigger" else 3.))
    if version == 2:
        target = _balanced_target(result, rendered_level, previous_trigger, reference_level, role, trim, previous_gain_db)
    else:
        target = (-27. if mix_mode == "replace" else -34.) if role == "trigger" else -48.
        if reference_level is not None:
            target = min(target, reference_level - (10. if role == "trigger" else 18.))
        target += trim
    if source_level is not None and rendered_level is not None:
        # Bound total elevation relative to the real generated source, not the
        # intermediate D signal (whose legacy renderer normalizes its input).
        max_lift = 12. if role == "trigger" and source_level >= -60. else 0.
        target = min(target, source_level + max_lift)
        factor = 10 ** ((target - rendered_level) / 20)
    else:
        # Below the loudness gate, never turn a near-silent bed into a trigger.
        source_rms = float(np.sqrt(np.mean(np.square(source))))
        rendered_rms = float(np.sqrt(np.mean(np.square(result))))
        factor = min(1., source_rms / max(rendered_rms, 1e-30))
    peak = engine.true_peak(result)
    factor = min(factor, BALANCED_PEAK / max(peak, 1e-30))
    result *= factor
    if version == 2 and mix_mode == "overlay":
        # Give the video model the same effect level that will fit in the final mix.
        result *= _mix_gain(reference, result)
    return result


def balanced_spatial_samples(samples, sample_rate, reference, reference_rate,
                             duration_seconds, start_pan, start_distance,
                             end_pan, end_distance, movement, gain_db, role, mix_mode,
                             profile=None, *, version=1, previous_trigger=None, previous_gain_db=-12., use_voice_reference=False):
    if role not in ("trigger", "ambience") or mix_mode not in ("overlay", "replace"):
        raise ValueError("Unsupported ASMR balancing role or mix mode")
    engine.number(gain_db, -36, 6)
    duration = engine.number(duration_seconds, 1 / RATE, 600)
    count = max(1, round(duration * RATE))
    raw = _samples(samples, sample_rate).mean(axis=1, keepdims=True)[:count]
    raw = np.pad(raw, ((0, max(0, count - len(raw))), (0, 0)))
    original = _samples(reference, reference_rate)
    # D positioning is rendered at unity trim, then the final spatial sound is
    # measured. Do not first attenuate by -18 dB and then attempt to recover it.
    spatial = spatial_samples(samples, sample_rate, duration, start_pan, start_distance,
                              end_pan, end_distance, movement, 0., profile).T
    result = balance_samples(spatial, raw, original, role, mix_mode, gain_db, version=version,
                             previous_trigger=previous_trigger, previous_gain_db=previous_gain_db,
                             use_voice_reference=use_voice_reference)
    return result.T.astype(np.float32)


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
        return {"required": {"audio1": ("AUDIO",), "audio2": ("AUDIO",)},
                "optional": {"preserve_base": ("BOOLEAN", {"default": False})}}

    RETURN_TYPES = ("AUDIO",)
    FUNCTION = "mix"
    CATEGORY = "ASMR Director/audio"

    def mix(self, audio1, audio2, preserve_base=False):
        base, base_rate = _unpack(audio1)
        overlay, overlay_rate = _unpack(audio2)
        return (_audio(mix_samples(base, base_rate, overlay, overlay_rate, preserve_base=preserve_base)),)


class AsmrDirectorBalancedSpatialAudio(AsmrDirectorSpatialAudio):
    balance_version = 1
    @classmethod
    def INPUT_TYPES(cls):
        inputs = super().INPUT_TYPES()
        inputs["required"].update({"reference_audio": ("AUDIO",),
                                   "role": (["trigger", "ambience"],),
                                   "mix_mode": (["overlay", "replace"],)})
        return inputs

    def process(self, audio, reference_audio, duration_seconds, start_pan, start_distance,
                end_pan, end_distance, movement, gain_db, role, mix_mode, previous_trigger_audio=None,
                previous_gain_db=-12., use_voice_reference=False):
        samples, rate = _unpack(audio)
        reference, reference_rate = _unpack(reference_audio)
        previous = _samples(*_unpack(previous_trigger_audio)) if previous_trigger_audio is not None else None
        result = balanced_spatial_samples(samples, rate, reference, reference_rate, duration_seconds,
            start_pan, start_distance, end_pan, end_distance, movement, gain_db, role, mix_mode,
            version=self.balance_version, previous_trigger=previous, previous_gain_db=previous_gain_db,
            use_voice_reference=use_voice_reference)
        return (_audio(result),)


class AsmrDirectorBalancedSpatialAudioV2(AsmrDirectorBalancedSpatialAudio):
    balance_version = 2

    @classmethod
    def INPUT_TYPES(cls):
        inputs = super().INPUT_TYPES()
        inputs["optional"] = {"previous_trigger_audio": ("AUDIO",),
                              "previous_gain_db": ("FLOAT", {"default": -12., "min": -36., "max": 6.}),
                              "use_voice_reference": ("BOOLEAN", {"default": False})}
        return inputs


NODE_CLASS_MAPPINGS = {"AsmrDirectorSpatialAudio": AsmrDirectorSpatialAudio, "AsmrDirectorMixAudio": AsmrDirectorMixAudio,
                       "AsmrDirectorBalancedSpatialAudio": AsmrDirectorBalancedSpatialAudio,
                       "AsmrDirectorBalancedSpatialAudioV2": AsmrDirectorBalancedSpatialAudioV2}
NODE_DISPLAY_NAME_MAPPINGS = {"AsmrDirectorSpatialAudio": "ASMR Director · D spatial audio", "AsmrDirectorMixAudio": "ASMR Director · mix aligned audio",
                              "AsmrDirectorBalancedSpatialAudio": "ASMR Director · balanced ASMR spatial audio",
                              "AsmrDirectorBalancedSpatialAudioV2": "ASMR Director · matched ASMR spatial audio"}
