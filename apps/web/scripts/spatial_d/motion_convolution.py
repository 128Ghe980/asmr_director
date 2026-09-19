"""Efficient output-domain crossfades of complete time-varying stereo IRs.

render_moving implements the same operator as render.render_filters: at each
output sample, linearly interpolate between the complete convolutions for the
neighboring keyframes. It does not reset audio history at a keyframe or replace
the operation with an input-domain fade. Each local convolution includes all
input samples that can contribute through that keyframe's full IR.

Only output regions with nonzero interpolation weights are evaluated. For a
keyframe active over [a,b) with an M-tap IR, input history starts at a-(M-1).
One input FFT is shared by the two ear filters. Compared with convolving a
60--90 second source for every keyframe, FFT size now depends mainly on IR
length and local keyframe spacing.

filters may be a one-pass iterator; only the current IR and local FFT buffers
are retained. The final stereo output is still held in memory. Boundary
behavior follows numpy.interp: the first filter extends before the first
keyframe, the last filter after the last keyframe. Output length is always
len(audio) + max_IR_length - 1, including unused zero-valued tail regions.
"""

from __future__ import annotations

from collections.abc import Iterable

import numpy as np
from scipy.fft import irfft, next_fast_len, rfft


def _active_region(index: int, times: np.ndarray, wet_length: int, sample_rate: int) -> tuple[int, int]:
    # A boundary sample with exactly zero weight may be included; this permits
    # robust rounding for non-grid-aligned keyframe times without missing a
    # sample. The envelope itself supplies the exact numpy.interp weight.
    first = 0 if index == 0 else max(0, int(np.floor(times[index - 1] * sample_rate)))
    last = wet_length if index == len(times) - 1 else min(wet_length, int(np.ceil(times[index + 1] * sample_rate)) + 1)
    return min(first, wet_length), max(0, last)


def _weights(index: int, times: np.ndarray, first: int, last: int, sample_rate: int) -> np.ndarray:
    axis = np.arange(first, last, dtype=np.float64) / sample_rate
    if len(times) == 1:
        return np.ones(last - first, dtype=np.float64)
    if index == 0:
        return np.interp(axis, times[:2], [1.0, 0.0])
    if index == len(times) - 1:
        return np.interp(axis, times[-2:], [0.0, 1.0])
    return np.interp(axis, times[index - 1:index + 2], [0.0, 1.0, 0.0])


def render_moving(
    audio: np.ndarray,
    times: Iterable[float],
    filters: Iterable[np.ndarray],
    sample_rate: int = 48000,
) -> np.ndarray:
    """Render mono audio using stereo keyframe IRs; return float64 (N,2).

    times must be finite, strictly increasing seconds, one value per filter.
    Negative times and keyframes beyond the source are allowed. Each filter
    must have shape (2,M), M>=1; different lengths are allowed. Filters are
    consumed once, so an IR generator can limit memory use. This function does
    not normalize audio, alter IR coefficients, or add a latency of its own.

    Like the original crossfade operator, this is an interpolation of complete
    convolution outputs, not a physical moving-source propagation solver. Any
    Doppler/geometry/distance behavior must already be present in the IRs.
    """
    if not isinstance(sample_rate, (int, np.integer)) or sample_rate <= 0:
        raise ValueError("sample_rate must be a positive integer")
    source = np.asarray(audio, dtype=np.float64)
    key_times = np.asarray(list(times), dtype=np.float64)
    if source.ndim != 1 or len(source) == 0 or not np.isfinite(source).all():
        raise ValueError("audio must be a nonempty finite mono vector")
    if key_times.ndim != 1 or len(key_times) == 0 or not np.isfinite(key_times).all():
        raise ValueError("times must be a nonempty finite vector")
    if np.any(np.diff(key_times) <= 0):
        raise ValueError("keyframe times must be strictly increasing")
    with np.errstate(over="ignore"):
        if not np.isfinite(key_times * sample_rate).all():
            raise ValueError("keyframe sample positions are out of range")
    iterator = iter(filters)
    result = None
    output_length = len(source)
    for index in range(len(key_times)):
        try:
            h = np.asarray(next(iterator), dtype=np.float64)
        except StopIteration as error:
            raise ValueError("fewer filters than keyframe times") from error
        if h.ndim != 2 or h.shape[0] != 2 or h.shape[1] == 0 or not np.isfinite(h).all():
            raise ValueError("each filter must be finite with shape (2,M), M>=1")
        wet_length = len(source) + h.shape[1] - 1
        output_length = max(output_length, wet_length)
        # Reserve one second of IR tail, so slightly differing IR lengths do
        # not repeatedly copy a long output array. Grow only when necessary.
        if result is None:
            result = np.zeros((len(source) + max(sample_rate, h.shape[1]) - 1, 2), dtype=np.float64)
        elif output_length > len(result):
            grown = np.zeros((max(output_length, len(result) + sample_rate), 2), dtype=np.float64)
            grown[:len(result)] = result
            result = grown
        first, last = _active_region(index, key_times, wet_length, sample_rate)
        if first >= last:
            continue
        envelope = _weights(index, key_times, first, last, sample_rate)
        nonzero = np.flatnonzero(envelope != 0)
        if not len(nonzero):
            continue
        # Trim the at-most-a-few extra boundary samples without changing the
        # envelope's floating-point values or time coordinate system.
        trim_first, trim_last = int(nonzero[0]), int(nonzero[-1]) + 1
        envelope = envelope[trim_first:trim_last]
        first, last = first + trim_first, first + trim_last
        input_first = max(0, first - (h.shape[1] - 1))
        input_last = min(len(source), last)
        if input_first >= input_last:
            continue
        history = source[input_first:input_last]
        fft_length = next_fast_len(len(history) + h.shape[1] - 1, real=True)
        input_spectrum = rfft(history, n=fft_length)
        filter_spectra = rfft(h, n=fft_length, axis=1)
        convolution = irfft(filter_spectra * input_spectrum[None, :], n=fft_length, axis=1)
        local_first, local_last = first - input_first, last - input_first
        result[first:last] += convolution[:, local_first:local_last].T * envelope[:, None]
    sentinel = object()
    if next(iterator, sentinel) is not sentinel:
        raise ValueError("more filters than keyframe times")
    return result[:output_length]
