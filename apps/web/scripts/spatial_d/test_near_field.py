"""Numerical/physical checks; these do not replace a headphone listening test.

Run: python -m unittest discover -s tools/distance-listening -p test_near_field.py -v
SciPy is used only as an independent reference for the analytical sphere sum.
"""

import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import numpy as np
from scipy.special import eval_legendre, spherical_jn, spherical_yn

from spatial_d.near_field import (
    MAX_CORRECTION_DB,
    _rigid_sphere_response,
    near_field_firs,
    near_field_magnitude,
)


class RigidSphereTests(unittest.TestCase):
    def test_matches_independent_spherical_bessel_evaluation(self):
        # Direct Duda & Martens Eqs. 7--8; no production recurrence is reused.
        frequencies = np.array([20.0, 100.0, 500.0, 1000.0, 3000.0, 12000.0, 24000.0])
        incidences = np.array([-1.0, -0.7, 0.0, 0.4, 1.0])
        orders = np.arange(80)[:, None]
        for radius in (0.076, 0.0875):
            wave_number = 2 * np.pi * frequencies / 343.0
            sphere_argument = wave_number * radius
            derivative = spherical_jn(orders, sphere_argument, derivative=True) + 1j * spherical_yn(orders, sphere_argument, derivative=True)
            for distance in (0.14, 0.35, 1.0, 4.0):
                source_argument = wave_number * distance
                hankel = spherical_jn(orders, source_argument) + 1j * spherical_yn(orders, source_argument)
                expected = np.stack([
                    -distance / (wave_number * radius**2) * np.exp(-1j * source_argument)
                    * np.sum((2 * orders + 1) * eval_legendre(orders, x) * hankel / derivative, axis=0)
                    for x in incidences
                ])
                actual = _rigid_sphere_response(frequencies, incidences, distance, radius)
                np.testing.assert_allclose(actual, expected, rtol=2e-10, atol=2e-11)

    def test_zero_frequency_matches_closed_form_static_limit(self):
        # At the facing/away poles, summing the Legendre series gives these
        # closed forms; this detects loss of the crucial low-frequency ILD.
        for radius, distance in ((0.076, 0.14), (0.0875, 0.14), (0.12, 0.14), (0.076, 1.0)):
            q = radius / distance
            expected = np.array([2 / (1 - q) + np.log1p(-q) / q, 2 / (1 + q) - np.log1p(q) / q])
            actual = _rigid_sphere_response(np.array([0.0, 0.0001]), np.array([1.0, -1.0]), distance, radius)
            np.testing.assert_allclose(actual[:, 0].real, expected, rtol=1e-11)
            np.testing.assert_allclose(np.abs(actual[:, 1]), expected, rtol=1e-10)

    def test_free_field_normalization_excludes_inverse_distance_gain(self):
        actual = _rigid_sphere_response(np.array([0.0]), np.array([1.0, 0.0, -1.0]), 1e6, 0.076)
        np.testing.assert_allclose(actual, 1.0, atol=2e-7)


class DistanceFilterTests(unittest.TestCase):
    def test_reference_distance_is_exact_identity_and_cache_is_not_mutable(self):
        first = near_field_firs(65, 20, 1.0, 1.0, 48000, 0.076)
        expected = np.zeros((2, 512))
        expected[:, 0] = 1.0
        np.testing.assert_array_equal(first, expected)
        first[:] = -999.0
        np.testing.assert_array_equal(near_field_firs(65, 20, 1.0, 1.0, 48000, 0.076), expected)

    def test_left_right_reflection_swaps_ears(self):
        for azimuth, elevation in ((15, 0), (60, 25), (90, -30), (160, 40)):
            left = near_field_firs(azimuth, elevation, 0.14, 1.0, 48000, 0.076)
            right = near_field_firs(-azimuth, elevation, 0.14, 1.0, 48000, 0.076)
            np.testing.assert_allclose(left, right[::-1], atol=2e-12)
        for azimuth, elevation in ((0, 0), (180, 0), (80, 90)):
            front = near_field_firs(azimuth, elevation, 0.14, 1.0, 48000, 0.076)
            np.testing.assert_allclose(front[0], front[1], atol=2e-12)

    def test_low_frequency_lateral_ild_grows_when_source_approaches(self):
        ilds = []
        for distance in (1.0, 0.7, 0.3, 0.14):
            firs = near_field_firs(90, 0, distance, 1.0, 48000, 0.076)
            at_125_hz = np.abs(firs @ np.exp(-2j * np.pi * 125 / 48000 * np.arange(firs.shape[1])))
            ilds.append(20 * np.log10(at_125_hz[0] / at_125_hz[1]))
        self.assertTrue(np.all(np.diff(ilds) > 0), ilds)
        self.assertGreater(ilds[-1], 12.0)
        self.assertLess(ilds[-1], 16.0)
        self.assertAlmostEqual(ilds[0], 0.0, places=12)

    def test_default_firs_reproduce_design_without_extra_onset_delay(self):
        fft_size = 32768
        fft_frequencies = np.fft.rfftfreq(fft_size, 1 / 48000)
        for azimuth, distance in ((0, 0.14), (30, 0.14), (60, 0.14), (90, 0.14), (70, 0.6), (65, 3.0)):
            firs = near_field_firs(azimuth, 0, distance, 1.0, 48000, 0.076)
            frequencies, target = near_field_magnitude(azimuth, 0, distance, 1.0, 48000, 0.076)
            actual = np.abs(np.fft.rfft(firs, fft_size))
            target_at_fft = np.stack([np.exp(np.interp(fft_frequencies, frequencies, np.log(row))) for row in target])
            error_db = 20 * np.log10(actual / target_at_fft)
            self.assertLess(float(np.max(np.abs(error_db))), 0.02)
            np.testing.assert_array_equal(np.argmax(np.abs(firs), axis=1), [0, 0])

    def test_parameter_sweep_is_finite_bounded_and_has_no_narrow_spikes(self):
        for rate in (8000, 44100, 48000, 96000, 192000):
            for azimuth in (0, 45, 75, 90):
                for radius in (0.076, 0.0875, 0.12):
                    firs = near_field_firs(azimuth, 0, 0.14, 1.0, rate, radius)
                    self.assertTrue(np.all(np.isfinite(firs)))
                    response_db = 20 * np.log10(np.maximum(np.abs(np.fft.rfft(firs, 32768)), 1e-12))
                    # FIR truncation may depart slightly from the +/-12 dB
                    # design constraint, especially at the highest rates.
                    self.assertLess(float(np.max(np.abs(response_db))), MAX_CORRECTION_DB + 0.2)
                    self.assertLess(float(np.max(np.abs(np.diff(response_db, axis=1)))), 0.25)

    def test_approaching_reference_radius_converges_to_identity(self):
        firs = near_field_firs(75, 15, 1.000001, 1.0, 48000, 0.076)
        response = np.abs(np.fft.rfft(firs, 8192))
        self.assertLess(float(np.max(np.abs(response - 1.0))), 2e-6)

    def test_rejects_inside_head_or_nonfinite_inputs(self):
        for kwargs in ({"distance_m": 0.13}, {"distance_m": float("nan")}, {"head_radius_m": 0.14}, {"sample_rate": 47999.5}, {"elevation_deg": 91}, {"azimuth_deg": float("inf")}, {"taps": 0}):
            args = dict(azimuth_deg=90, elevation_deg=0, distance_m=0.14, reference_distance_m=1.0, sample_rate=48000, head_radius_m=0.076)
            args.update(kwargs)
            with self.assertRaises(ValueError):
                near_field_firs(**args)


if __name__ == "__main__":
    unittest.main()
