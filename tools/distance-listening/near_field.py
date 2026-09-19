"""Rigid-sphere distance variation filters for an offline listening experiment.

The underlying pressure solution is Duda & Martens (1998), Eqs. 7--8:
https://www.ece.ucdavis.edu/cipic/wp-content/uploads/sites/12/2015/04/cipic_JASA_Nov_1998.pdf
DOI: 10.1121/1.423886.  The distance-variation approach is also described by
Kan, Jin & van Schaik (2009), DOI: 10.1121/1.3081395.

This is an independent implementation of the mathematical solution, not a copy
of a rendering library. It computes the ratio of two sphere responses, smooths
and limits that ratio, then constructs a minimum-phase FIR. The sphere pressure
is normalized to free-field pressure at the head center: the FIR DOES NOT add
the general 1/r distance gain or a propagation delay. Apply it to an existing
far-field HRIR of the SAME direction, whose measured radius is the reference.

Coordinates: x front, y left, z up; azimuth increases toward the left. Ears lie
at +y and -y on the sphere. Returned channel order is LEFT, RIGHT.

The sphere has no pinnae, torso, mouth directivity, or ear canal. This is a
regularized model-based near-field approximation, not a measured near-field
HRTF or a guaranteed perceptual distance. Existing HRIR onset/ITD is preserved;
the minimum-phase correction still has frequency-dependent phase/group delay.
"""

from __future__ import annotations

from functools import lru_cache

import numpy as np

SPEED_OF_SOUND_M_S = 343.0
DEFAULT_TAPS = 512
MAX_CORRECTION_DB = 12.0
SMOOTHING_OCTAVES_FWHM = 1.0 / 6.0
_SERIES_TOLERANCE = 1e-13


def _validate_geometry(distance_m: float, head_radius_m: float) -> None:
    if not np.isfinite(head_radius_m) or head_radius_m <= 0:
        raise ValueError("head_radius_m must be finite and positive")
    if not np.isfinite(distance_m) or distance_m < 0.14:
        raise ValueError("distance_m is a head-center distance and must be >= 0.14 m")
    if distance_m < 1.15 * head_radius_m:
        raise ValueError("source must be at least 1.15 head radii from the center")


def _rigid_sphere_response(
    frequencies_hz: np.ndarray,
    cos_incidence: np.ndarray,
    distance_m: float,
    head_radius_m: float,
) -> np.ndarray:
    """Free-field-normalized complex pressure, shape (incidences, frequencies).

    The usual spherical Hankel values overflow at low frequency/high order.
    Instead recurse u_n(z) = h_n(z)/h_0(z), scaling all four running radial
    quantities together at every order. This preserves their ratios. Using
    h'_n(z) = h_(n-1)(z) - (n+1)h_n(z)/z in Duda & Martens Eq. 8 gives

        H = -exp(-i*mu)/mu * sum (2n+1)P_n(x)
                            * u_n(mu*rho)/(u_(n-1)(mu)-(n+1)u_n(mu)/mu).

    Here mu=ka and rho=r/a. The n=0 derivative is -h_1. The exact zero-frequency
    limit is sum [(2n+1)/(n+1)] * (a/r)^n * P_n(x), evaluated separately.
    """
    _validate_geometry(distance_m, head_radius_m)
    frequencies = np.asarray(frequencies_hz, dtype=np.float64)
    incidence = np.atleast_1d(np.asarray(cos_incidence, dtype=np.float64))
    if frequencies.ndim != 1 or not np.all(np.isfinite(frequencies)) or np.any(frequencies < 0):
        raise ValueError("frequencies_hz must be a finite, nonnegative vector")
    if incidence.ndim != 1 or not np.all(np.isfinite(incidence)) or np.any(np.abs(incidence) > 1):
        raise ValueError("cos_incidence must be a finite vector in [-1, 1]")
    result = np.zeros((len(incidence), len(frequencies)), dtype=np.complex128)
    if not len(frequencies):
        return result
    positive = frequencies > 0
    mu = 2.0 * np.pi * frequencies[positive] * head_radius_m / SPEED_OF_SOUND_M_S
    rho = distance_m / head_radius_m
    geometric_orders = int(np.ceil(np.log(_SERIES_TOLERANCE) / np.log(1.0 / rho)))
    max_mu = float(np.max(mu)) if len(mu) else 0.0
    # The geometric tail controls a nearby source; ka and its transition region
    # control the wave-expansion tail. Add both conservative margins.
    orders = int(np.ceil(max_mu + 6.0 * np.cbrt(max_mu) + 12.0)) + geometric_orders
    p_previous = np.ones_like(incidence)
    p_current = incidence.copy()
    dc = p_previous + 1.5 / rho * p_current
    if len(mu):
        a_previous = np.ones_like(mu, dtype=np.complex128)
        r_previous = np.ones_like(mu, dtype=np.complex128)
        a_current = 1.0 / mu - 1j
        r_current = 1.0 / (mu * rho) - 1j
        total = -p_previous[:, None] / a_current
        total += 3.0 * p_current[:, None] * r_current / (a_previous - 2.0 / mu * a_current)
    for n in range(2, orders + 1):
        p_next = ((2 * n - 1) * incidence * p_current - (n - 1) * p_previous) / n
        dc += (2 * n + 1) / (n + 1) * rho ** (-n) * p_next
        if len(mu):
            a_next = (2 * n - 1) / mu * a_current - a_previous
            r_next = (2 * n - 1) / (mu * rho) * r_current - r_previous
            # Normalize before the derivative. This also keeps the next
            # recurrence finite even for very small positive frequencies.
            scale = np.maximum.reduce((np.abs(a_next), np.abs(a_current), np.abs(r_next), np.abs(r_current)))
            a_next /= scale
            r_next /= scale
            a_current /= scale
            r_current /= scale
            ratio = r_next / (a_current - (n + 1) / mu * a_next)
            total += (2 * n + 1) * p_next[:, None] * ratio
            a_previous, a_current = a_current, a_next
            r_previous, r_current = r_current, r_next
        p_previous, p_current = p_current, p_next
    if len(mu):
        result[:, positive] = -np.exp(-1j * mu) / mu * total
    result[:, ~positive] = dc[:, None]
    if not np.all(np.isfinite(result)):
        raise ArithmeticError("rigid-sphere series produced a nonfinite response")
    return result


def _smooth_log_magnitude(db: np.ndarray, points_per_octave: float) -> np.ndarray:
    """Gaussian average in log frequency; stated width is the full half maximum."""
    sigma = points_per_octave * SMOOTHING_OCTAVES_FWHM / np.sqrt(8.0 * np.log(2.0))
    radius = int(np.ceil(4.0 * sigma))
    offsets = np.arange(-radius, radius + 1)
    weights = np.exp(-0.5 * (offsets / sigma) ** 2)
    weights /= weights.sum()
    return np.stack([np.convolve(np.pad(row, (radius, radius), mode="edge"), weights, mode="valid") for row in db])


def near_field_magnitude(
    azimuth_deg: float,
    elevation_deg: float,
    distance_m: float,
    reference_distance_m: float,
    sample_rate: int,
    head_radius_m: float = 0.0875,
) -> tuple[np.ndarray, np.ndarray]:
    """Return the design frequencies and regularized LEFT/RIGHT magnitude ratio.

    At the reference radius the ratio is exactly one. Distances on either side
    of the reference are supported; all are measured from the head center.
    The 1/6-octave smoothing and +/-12 dB bounds are explicit experimental
    regularization choices, not claims made by the rigid-sphere paper.
    """
    _validate_geometry(distance_m, head_radius_m)
    _validate_geometry(reference_distance_m, head_radius_m)
    if not np.isfinite(azimuth_deg) or not np.isfinite(elevation_deg) or abs(elevation_deg) > 90:
        raise ValueError("angles must be finite; elevation_deg must be in [-90, 90]")
    if not np.isfinite(sample_rate) or sample_rate != int(sample_rate) or not 8000 <= sample_rate <= 192000:
        raise ValueError("sample_rate must be an integer from 8000 to 192000")
    octaves = np.log2((sample_rate / 2) / 20.0)
    count = int(np.ceil(96.0 * octaves)) + 1
    frequencies = np.r_[0.0, np.geomspace(20.0, sample_rate / 2, count)]
    if distance_m == reference_distance_m:
        return frequencies, np.ones((2, len(frequencies)))
    lateral = np.sin(np.deg2rad(azimuth_deg)) * np.cos(np.deg2rad(elevation_deg))
    incidences = np.clip(np.array([lateral, -lateral]), -1.0, 1.0)
    target = np.abs(_rigid_sphere_response(frequencies, incidences, distance_m, head_radius_m))
    reference = np.abs(_rigid_sphere_response(frequencies, incidences, reference_distance_m, head_radius_m))
    db = 20.0 * np.log10(np.maximum(target, 1e-10) / np.maximum(reference, 1e-10))
    db[:, 1:] = _smooth_log_magnitude(db[:, 1:], (count - 1) / octaves)
    db = np.clip(db, -MAX_CORRECTION_DB, MAX_CORRECTION_DB)
    return frequencies, 10.0 ** (db / 20.0)


@lru_cache(maxsize=1024)
def _cached_firs(
    azimuth_deg: float,
    elevation_deg: float,
    distance_m: float,
    reference_distance_m: float,
    sample_rate: int,
    head_radius_m: float,
    taps: int,
) -> np.ndarray:
    frequencies, magnitudes = near_field_magnitude(azimuth_deg, elevation_deg, distance_m, reference_distance_m, sample_rate, head_radius_m)
    if distance_m == reference_distance_m:
        firs = np.zeros((2, taps))
        firs[:, 0] = 1.0
        return firs
    fft_size = 1 << int(np.ceil(np.log2(max(8192, taps * 16))))
    fft_frequencies = np.fft.rfftfreq(fft_size, 1.0 / sample_rate)
    firs = np.empty((2, taps))
    # Truncation taper affects only the final quarter, preserving the causal
    # onset. No linear-phase delay or Woodworth ITD is added here.
    taper = np.ones(taps)
    tail = max(16, taps // 4)
    taper[-tail:] = 0.5 * (1.0 + np.cos(np.linspace(0, np.pi, tail)))
    for ear in range(2):
        log_magnitude = np.interp(fft_frequencies, frequencies, np.log(magnitudes[ear]))
        cepstrum = np.fft.irfft(log_magnitude, n=fft_size)
        causal_cepstrum = np.zeros(fft_size)
        causal_cepstrum[0] = cepstrum[0]
        causal_cepstrum[1:fft_size // 2] = 2.0 * cepstrum[1:fft_size // 2]
        causal_cepstrum[fft_size // 2] = cepstrum[fft_size // 2]
        minimum_phase_spectrum = np.exp(np.fft.rfft(causal_cepstrum))
        firs[ear] = np.fft.irfft(minimum_phase_spectrum, n=fft_size)[:taps] * taper
        # Retain the model's exact DC ratio after finite-length truncation.
        firs[ear] *= magnitudes[ear, 0] / np.sum(firs[ear])
    if not np.all(np.isfinite(firs)):
        raise ArithmeticError("minimum-phase reconstruction produced nonfinite coefficients")
    return firs


def near_field_firs(
    azimuth_deg: float,
    elevation_deg: float,
    distance_m: float,
    reference_distance_m: float,
    sample_rate: int,
    head_radius_m: float = 0.0875,
    *,
    taps: int = DEFAULT_TAPS,
) -> np.ndarray:
    """Return (2, taps) minimum-phase distance corrections, left then right.

    Default: 512 taps. Convolve each ear with its existing HRIR and this FIR;
    the main renderer owns overall distance gain, room energy, and movement
    interpolation. Do not reset a convolution at every movement block: use
    overlap-add and crossfade adjacent filters. Cached results are copied so
    callers may safely mutate the returned array.
    """
    if not isinstance(taps, (int, np.integer)) or not 128 <= taps <= 4096:
        raise ValueError("taps must be an integer from 128 to 4096")
    return _cached_firs(float(azimuth_deg), float(elevation_deg), float(distance_m), float(reference_distance_m), sample_rate, float(head_radius_m), int(taps)).copy()
