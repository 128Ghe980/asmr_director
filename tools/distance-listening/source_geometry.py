"""Ear parallax and an explicitly simplified voice radiation model.

Parallax follows the geometric/processing approach in Cuevas-Rodriguez et al.,
3D Tune-In Toolkit (2019), sections "HRIR selection and interpolation" and
"ITD simulation": https://pmc.ncbi.nlm.nih.gov/articles/PMC6411112/ . Each
ear-to-source ray intersects the sphere on which the input HRTF was measured.
Spectral HRIRs come from those two intersections, whereas restored onset delays
come from the actual head-center direction. The caller separately applies DVF
at that actual direction. This is an independently written approximation, not
a copy of the toolkit code and not an individually measured near-field HRTF.

This implementation interpolates along the measured elevation rings, with
circular azimuth interpolation inside each ring. HRIRs are aligned by their
15%-of-peak onset before interpolation; a windowed-sinc fractional delay then
restores the center-direction onset. Delay separation reduces comb filtering
from mixing delayed HRIRs; it cannot remove every phase mismatch between ears
or directions. Viking's missing elevations below -45 degrees are clamped to
the measured boundary, never represented as new measurements.

Coordinates: x front, y left, z up; azimuth increases leftward. Ear order must
be LEFT, RIGHT. GeometryProfile.hrir adds one FIXED latency_samples guard to
every output and has one FIXED output length. Pad comparison/reflection paths
by this guard as well. It does not add propagation delay, 1/r, DVF, or room.

The separate directivity_fir is a deliberately simple, frequency-dependent
voice-radiation approximation, NOT a measured mouth/whisper pattern. Apply it
using the source's emission angle for each direct or reflected outgoing path.
Brushes and other non-voice sources should not receive the voice model.
"""

from __future__ import annotations

from functools import lru_cache

import numpy as np


ONSET_THRESHOLD = 0.15
FRACTIONAL_DELAY_HALF_TAPS = 24
DIRECTIVITY_CORNER_HZ = 1000.0
DIRECTIVITY_REAR_HIGH_FREQUENCY_GAIN = 0.2


def _unit_direction(azimuth_deg: float, elevation_deg: float) -> np.ndarray:
    if not np.isfinite(azimuth_deg) or not np.isfinite(elevation_deg) or abs(elevation_deg) > 90:
        raise ValueError("finite azimuth and elevation in [-90, 90] required")
    azimuth, elevation = np.deg2rad([azimuth_deg, elevation_deg])
    return np.array([np.cos(azimuth) * np.cos(elevation), np.sin(azimuth) * np.cos(elevation), np.sin(elevation)])


def _angles(direction: np.ndarray) -> tuple[float, float]:
    return float(np.rad2deg(np.arctan2(direction[1], direction[0]))), float(np.rad2deg(np.arctan2(direction[2], np.hypot(direction[0], direction[1]))))


def _fractional_delay(fraction: float) -> np.ndarray:
    """Kaiser-windowed sinc with a fixed half-length guard; DC gain is one."""
    half = FRACTIONAL_DELAY_HALF_TAPS
    if abs(fraction) < 1e-12:
        result = np.zeros(2 * half + 1)
        result[half] = 1.0
        return result
    coefficients = np.sinc(np.arange(-half, half + 1) - fraction) * np.kaiser(2 * half + 1, 8.6)
    return coefficients / coefficients.sum()


class GeometryProfile:
    """Continuous, onset-aligned parallax wrapper around render.Profile.

    Attributes needed from profile: positions (M,3) spherical degrees/metres,
    ir (M,2,N), receivers (2,3) or (2,3,1) cartesian metres,
    reference_distance (metres), and calibration (one shared scalar).

    Public diagnostic methods return the ear-specific lookup angles and the
    head-center onset delays. onset_delays_samples intentionally has NO distance
    argument: parallax must not accidentally substitute the proxy directions'
    ITD. Spectral phase may still move a broadband peak after interpolation;
    these are estimated onset delays, not a claim of invariant group delay at
    every frequency.
    """

    def __init__(self, profile):
        self.profile = profile
        self.reference_distance = float(profile.reference_distance)
        positions = np.asarray(profile.positions, dtype=float)
        ir = np.asarray(profile.ir, dtype=float) * float(profile.calibration)
        self.receivers = np.asarray(profile.receivers, dtype=float).reshape(2, 3)
        if positions.ndim != 2 or positions.shape[1] != 3 or ir.ndim != 3 or ir.shape[:2] != (len(positions), 2):
            raise ValueError("expected spherical (M,3) positions and (M,2,N) HRIRs")
        if not np.isfinite(ir).all() or not np.isfinite(positions).all() or not np.isfinite(self.receivers).all():
            raise ValueError("nonfinite profile values")
        if not np.isfinite(self.reference_distance) or self.reference_distance <= 0:
            raise ValueError("a positive measured reference distance is required")
        if not np.allclose(positions[:, 2], self.reference_distance):
            raise ValueError("multiple measurement radii are not supported")
        if self.receivers[0, 1] <= 0 or self.receivers[1, 1] >= 0:
            raise ValueError("profile channels must be left (+y), right (-y)")
        if np.any(np.linalg.norm(self.receivers, axis=1) >= self.reference_distance):
            raise ValueError("receiver must be inside the measurement sphere")
        peaks = np.max(np.abs(ir), axis=2)
        if np.any(peaks <= 0):
            raise ValueError("empty HRIR cannot provide an onset")
        self._onsets = np.argmax(np.abs(ir) >= ONSET_THRESHOLD * peaks[:, :, None], axis=2).astype(int)
        self._anchor = int(self._onsets.max())
        self.latency_samples = self._anchor + FRACTIONAL_DELAY_HALF_TAPS
        self._aligned = np.zeros((len(positions), 2, ir.shape[2] + self._anchor))
        for point in range(len(positions)):
            for ear in range(2):
                start = self._anchor - self._onsets[point, ear]
                self._aligned[point, ear, start:start + ir.shape[2]] = ir[point, ear]
        self.output_length = ir.shape[2] + 2 * self._anchor + 2 * FRACTIONAL_DELAY_HALF_TAPS + 2
        self.elevation_limits_deg = (float(positions[:, 1].min()), float(positions[:, 1].max()))
        self._elevations = np.unique(positions[:, 1])
        self._rings = []
        for elevation in self._elevations:
            indices = np.flatnonzero(np.isclose(positions[:, 1], elevation, atol=1e-9, rtol=0))
            azimuths = np.mod(positions[indices, 0], 360.0)
            order = np.argsort(azimuths)
            if len(np.unique(np.round(azimuths, 9))) != len(azimuths):
                raise ValueError("duplicate azimuth within an elevation ring")
            self._rings.append((azimuths[order], indices[order]))

    def _ring_weights(self, ring: int, azimuth: float) -> tuple[np.ndarray, np.ndarray]:
        azimuths, indices = self._rings[ring]
        if len(indices) == 1:
            return indices, np.array([1.0])
        azimuth = azimuth % 360.0
        upper = int(np.searchsorted(azimuths, azimuth, side="right")) % len(azimuths)
        lower = (upper - 1) % len(azimuths)
        span = (azimuths[upper] - azimuths[lower]) % 360.0
        fraction = ((azimuth - azimuths[lower]) % 360.0) / span
        return indices[[lower, upper]], np.array([1.0 - fraction, fraction])

    def interpolation_weights(self, azimuth_deg: float, elevation_deg: float) -> tuple[np.ndarray, np.ndarray]:
        """Continuous convex weights; clamp elevation outside measured coverage."""
        _unit_direction(azimuth_deg, elevation_deg)
        elevation = float(np.clip(elevation_deg, *self.elevation_limits_deg))
        upper = int(np.searchsorted(self._elevations, elevation, side="right"))
        if upper == 0 or upper == len(self._elevations):
            return self._ring_weights(min(upper, len(self._elevations) - 1), azimuth_deg)
        lower = upper - 1
        fraction = (elevation - self._elevations[lower]) / (self._elevations[upper] - self._elevations[lower])
        a_indices, a_weights = self._ring_weights(lower, azimuth_deg)
        b_indices, b_weights = self._ring_weights(upper, azimuth_deg)
        return np.r_[a_indices, b_indices], np.r_[(1 - fraction) * a_weights, fraction * b_weights]

    def parallax_angles(self, azimuth_deg: float, elevation_deg: float, distance_m: float) -> np.ndarray:
        """Return (2,2) [azimuth,elevation] at ear-ray/measurement-sphere hits."""
        if not np.isfinite(distance_m) or distance_m < 0.14:
            raise ValueError("distance_m must be a finite head-center radius >= 0.14 m")
        if distance_m <= np.linalg.norm(self.receivers, axis=1).max():
            raise ValueError("source must remain outside the head")
        source = distance_m * _unit_direction(azimuth_deg, elevation_deg)
        directions = source - self.receivers
        directions /= np.linalg.norm(directions, axis=1)[:, None]
        projection = np.sum(self.receivers * directions, axis=1)
        lengths = -projection + np.sqrt(projection**2 + self.reference_distance**2 - np.sum(self.receivers**2, axis=1))
        intersections = self.receivers + lengths[:, None] * directions
        return np.array([_angles(point) for point in intersections])

    def onset_delays_samples(self, azimuth_deg: float, elevation_deg: float) -> np.ndarray:
        """Interpolated measured center-direction onset, excluding fixed guard."""
        indices, weights = self.interpolation_weights(azimuth_deg, elevation_deg)
        return weights @ self._onsets[indices]

    def hrir(self, azimuth_deg: float, elevation_deg: float, distance_m: float) -> np.ndarray:
        lookup = self.parallax_angles(azimuth_deg, elevation_deg, distance_m)
        restored_onsets = self.onset_delays_samples(azimuth_deg, elevation_deg)
        result = np.zeros((2, self.output_length))
        for ear in range(2):
            indices, weights = self.interpolation_weights(*lookup[ear])
            aligned = weights @ self._aligned[indices, ear]
            delay = restored_onsets[ear]
            integer = int(np.floor(delay + 1e-12))
            fractional = max(0.0, delay - integer)
            shifted = np.convolve(aligned, _fractional_delay(fractional))
            result[ear, integer:integer + len(shifted)] = shifted
        return result


def directivity_magnitude(emission_cosine: float, frequencies_hz: np.ndarray, sample_rate: int) -> np.ndarray:
    """Magnitude of the untruncated approximate voice radiation transfer.

    D(z,c)=g(c)+(1-g(c))*b*(1+z^-1)/(1-p*z^-1),
    g(c)=0.6+0.4*c, p=(1-t)/(1+t), t=tan(pi*1000/fs), b=(1-p)/2.

    This interpolates between omnidirectional low frequencies and a smooth
    axial cosine pattern at higher frequencies. Front is identity, side and
    rear are progressively darker. Constants are creative design choices, not
    measured speech directivity data. The bilinear lowpass has unit DC gain,
    a 1 kHz corner, and zero Nyquist gain. The response is minimum phase: its
    pole p and its zero [g*p-(1-g)*b]/[g+(1-g)*b] are inside the unit circle.
    """
    _validate_directivity(emission_cosine, sample_rate)
    frequencies = np.asarray(frequencies_hz, dtype=float)
    if not np.isfinite(frequencies).all() or np.any(frequencies < 0) or np.any(frequencies > sample_rate / 2):
        raise ValueError("frequencies must be finite and within [0, Nyquist]")
    gain = 0.6 + 0.4 * emission_cosine
    tangent = np.tan(np.pi * DIRECTIVITY_CORNER_HZ / sample_rate)
    pole = (1 - tangent) / (1 + tangent)
    z_inverse = np.exp(-2j * np.pi * frequencies / sample_rate)
    lowpass = (1 - pole) / 2 * (1 + z_inverse) / (1 - pole * z_inverse)
    return np.abs(gain + (1 - gain) * lowpass)


def _validate_directivity(emission_cosine: float, sample_rate: int) -> None:
    if not np.isfinite(emission_cosine) or not -1 <= emission_cosine <= 1:
        raise ValueError("emission_cosine must be finite and within [-1, 1]")
    if not isinstance(sample_rate, (int, np.integer)) or not 8000 <= sample_rate <= 192000:
        raise ValueError("sample_rate must be an integer within [8000, 192000]")


@lru_cache(maxsize=2048)
def _directivity_fir_cached(emission_cosine: float, sample_rate: int) -> np.ndarray:
    _validate_directivity(emission_cosine, sample_rate)
    tangent = np.tan(np.pi * DIRECTIVITY_CORNER_HZ / sample_rate)
    pole = (1 - tangent) / (1 + tangent)
    taps = max(128, int(np.ceil(np.log(1e-12) / np.log(pole))))
    gain = 0.6 + 0.4 * emission_cosine
    lowpass = (1 - pole**2) / 2 * pole ** np.maximum(np.arange(taps) - 1, 0)
    lowpass[0] = (1 - pole) / 2
    lowpass /= lowpass.sum()
    result = (1 - gain) * lowpass
    result[0] += gain
    # All coefficients are nonnegative and sum to one. By the triangle
    # inequality |sum h[n] exp(-i*w*n)| <= sum h[n] = 1 at EVERY frequency,
    # not just on a sampled FFT grid. No normalization by individual ears.
    return result


def directivity_fir(emission_cosine: float, sample_rate: int) -> np.ndarray:
    """Causal 1D voice-orientation FIR, copied from cache for safe caller edits.

    emission_cosine = dot(source_forward, outgoing_ray_direction), both unit
    vectors; 1 means facing the listener/wall path, 0 sideways, -1 facing away.
    Length is fixed for a given sample rate. The underlying stable minimum-
    phase response is truncated after its tail falls below 1e-12. Every FIR
    coefficient is nonnegative, the DC gain is one, and full-band gain cannot
    exceed one. This adds no independent propagation or interaural delay.
    """
    return _directivity_fir_cached(float(emission_cosine), sample_rate).copy()
