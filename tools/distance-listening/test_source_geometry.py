"""Independent geometry, timing, interpolation and radiation invariants.

Run with the audio runtime Python:
python -m unittest discover -s tools/distance-listening -p test_source_geometry.py -v
The tests use a symmetric synthetic measured profile so genuine left/right
differences in the Viking ear anatomy are not mistaken for algorithm errors.
"""

from types import SimpleNamespace
import unittest

import numpy as np

from source_geometry import GeometryProfile, directivity_fir, directivity_magnitude


def symmetric_profile():
    positions, irs = [], []
    for elevation in (-60.0, 0.0, 60.0, 90.0):
        for azimuth in ([0.0] if elevation == 90 else np.arange(0, 360, 30)):
            az, el = np.deg2rad([azimuth, elevation])
            lateral = float(np.round(np.sin(az) * np.cos(el), 12))
            h = np.zeros((2, 96))
            for ear, sign in enumerate((1, -1)):
                onset = int(round(30 - sign * 10 * lateral))
                h[ear, onset] = 0.9 + 0.15 * sign * lateral
                h[ear, onset + 1] = 0.1 + 0.08 * np.cos(az) * np.cos(el)
                h[ear, onset + 4] = 0.05 + 0.04 * sign * lateral
            positions.append([azimuth, elevation, 1.0])
            irs.append(h)
    return SimpleNamespace(positions=np.array(positions), ir=np.array(irs), receivers=np.array([[0.0, 0.076, 0.0], [0.0, -0.076, 0.0]]), reference_distance=1.0, calibration=0.8)


class ParallaxGeometryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.profile = symmetric_profile()
        cls.geometry = GeometryProfile(cls.profile)

    def test_reference_sphere_recovers_original_measured_hrir(self):
        for point in (0, 3, 6, 12, 17, 25, 36):
            az, el, r = self.profile.positions[point]
            actual = self.geometry.hrir(az, el, r)
            expected = np.zeros_like(actual)
            guard = self.geometry.latency_samples
            expected[:, guard:guard + self.profile.ir.shape[2]] = self.profile.ir[point] * self.profile.calibration
            np.testing.assert_allclose(actual, expected, atol=2e-14)

    def test_projected_points_are_on_sphere_and_collinear_with_each_ear_ray(self):
        for az, el, distance in ((45, 0, 0.14), (30, 20, 0.2), (-50, -20, 0.3), (15, 30, 2.5)):
            radians = np.deg2rad([az, el])
            source = distance * np.array([np.cos(radians[0]) * np.cos(radians[1]), np.sin(radians[0]) * np.cos(radians[1]), np.sin(radians[1])])
            lookup = self.geometry.parallax_angles(az, el, distance)
            for ear in range(2):
                a, e = np.deg2rad(lookup[ear])
                point = np.array([np.cos(a) * np.cos(e), np.sin(a) * np.cos(e), np.sin(e)])
                ray_a, ray_b = source - self.geometry.receivers[ear], point - self.geometry.receivers[ear]
                self.assertAlmostEqual(np.linalg.norm(point), 1.0, places=13)
                self.assertLess(np.linalg.norm(np.cross(ray_a, ray_b)), 1e-13)
                self.assertGreater(np.dot(ray_a, ray_b), 0)

    def test_side_axis_is_unchanged_but_oblique_source_has_ear_specific_mapping(self):
        np.testing.assert_allclose(self.geometry.parallax_angles(90, 0, 0.14), [[90, 0], [90, 0]], atol=1e-12)
        np.testing.assert_allclose(self.geometry.hrir(90, 0, 0.14), self.geometry.hrir(90, 0, 1.0), atol=1e-12)
        lookup = self.geometry.parallax_angles(45, 0, 0.14)
        self.assertLess(lookup[0, 0], 25)
        self.assertGreater(lookup[1, 0], 55)
        self.assertGreater(np.linalg.norm(self.geometry.hrir(45, 0, 0.14) - self.geometry.hrir(45, 0, 1.0)), 0.01)

    def test_left_right_mirror_symmetry(self):
        for az, el, distance in ((15, 0, 0.14), (45, 20, 0.2), (120, -20, 0.35), (70, 60, 1.0)):
            a = self.geometry.hrir(az, el, distance)
            b = self.geometry.hrir(-az, el, distance)
            np.testing.assert_allclose(a, b[::-1], atol=1e-12)

    def test_parallax_changes_spectrum_without_replacing_center_direction_itd(self):
        for az in (30, 45, 60):
            delays = self.geometry.onset_delays_samples(az, 0)
            expected_itd = delays[1] - delays[0]
            for distance in (0.14, 0.2, 0.6, 1.0, 2.5):
                h = self.geometry.hrir(az, 0, distance)
                peak_indices = np.argmax(abs(h), axis=1)
                self.assertLess(abs((peak_indices[1] - peak_indices[0]) - expected_itd), 1.01)
                self.assertEqual(h.shape, (2, self.geometry.output_length))
                self.assertTrue(np.isfinite(h).all())

    def test_alignment_avoids_comb_filter_when_interpolating_different_delays(self):
        ir = np.zeros((2, 2, 64))
        ir[0, 0, 10] = ir[1, 0, 30] = 1.0
        ir[0, 1, 40] = ir[1, 1, 20] = 1.0
        p = SimpleNamespace(positions=np.array([[0.0, 0, 1], [180.0, 0, 1]]), ir=ir, receivers=self.profile.receivers, reference_distance=1.0, calibration=1.0)
        geometry = GeometryProfile(p)
        h = geometry.hrir(90, 0, 1.0)
        magnitude = abs(np.fft.rfft(h, 8192))
        np.testing.assert_allclose(magnitude, 1.0, atol=1e-12)
        np.testing.assert_array_equal(np.argmax(abs(h), axis=1) - geometry.latency_samples, [20, 30])

    def test_weights_are_continuous_across_azimuth_wrap_and_measured_boundaries(self):
        for az, el in ((0, 0), (30, 0), (90, 20), (180, 60)):
            lower = self.geometry.hrir(az - 1e-5, el, 0.14)
            upper = self.geometry.hrir(az + 1e-5, el, 0.14)
            self.assertLess(np.max(np.abs(lower - upper)), 2e-5)
        np.testing.assert_allclose(self.geometry.hrir(-0.001, 0, 0.14), self.geometry.hrir(359.999, 0, 0.14), atol=1e-12)
        indices, weights = self.geometry.interpolation_weights(40, -90)
        self.assertAlmostEqual(weights.sum(), 1.0, places=13)
        self.assertTrue(np.all(weights >= 0))
        self.assertTrue(np.all(self.profile.positions[indices[weights > 0], 1] == -60))

    def test_profile_data_and_cached_results_cannot_be_corrupted_by_callers(self):
        original = self.profile.ir.copy()
        h = self.geometry.hrir(45, 20, 0.14)
        h[:] = 0
        np.testing.assert_array_equal(self.profile.ir, original)
        self.assertGreater(abs(self.geometry.hrir(45, 20, 0.14)).max(), 0.1)


class DirectivityTests(unittest.TestCase):
    def test_front_is_exact_identity_and_coefficients_prove_full_band_no_boost(self):
        for rate in (8000, 44100, 48000, 96000, 192000):
            front = directivity_fir(1, rate)
            expected = np.zeros_like(front)
            expected[0] = 1
            np.testing.assert_array_equal(front, expected)
            for cosine in (0.8, 0.4, 0.0, -0.5, -1.0):
                h = directivity_fir(cosine, rate)
                self.assertTrue(np.isfinite(h).all())
                self.assertTrue(np.all(h >= 0))
                self.assertAlmostEqual(np.sum(h), 1.0, places=13)
                self.assertEqual(len(h), len(front))
                self.assertLessEqual(float(abs(np.fft.rfft(h, 65536)).max()), 1.0 + 1e-13)

    def test_frequency_dependent_angular_attenuation_and_analytic_response(self):
        frequencies = np.array([0.0, 125.0, 1000.0, 4000.0, 8000.0, 24000.0])
        previous = np.ones(len(frequencies))
        for cosine in (1.0, 0.5, 0.0, -0.5, -1.0):
            h = directivity_fir(cosine, 48000)
            actual = abs(np.exp(-2j * np.pi * frequencies[:, None] / 48000 * np.arange(len(h))) @ h)
            expected = directivity_magnitude(cosine, frequencies, 48000)
            np.testing.assert_allclose(actual, expected, atol=2e-12)
            self.assertTrue(np.all(actual <= previous + 1e-13))
            self.assertGreater(actual[1], 0.99)
            previous = actual
        self.assertLess(previous[-2], 0.3)

    def test_cache_and_invalid_inputs(self):
        first = directivity_fir(0.0, 48000)
        first[:] = 999
        self.assertLess(directivity_fir(0.0, 48000).max(), 1)
        for cosine, rate in ((float("nan"), 48000), (1.1, 48000), (-1.1, 48000), (0, 4000), (0, 48000.5)):
            with self.assertRaises(ValueError):
                directivity_fir(cosine, rate)


if __name__ == "__main__":
    unittest.main()
