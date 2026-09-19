"""Compare local-window convolution against independent full convolutions."""

import unittest

import numpy as np
from scipy.signal import fftconvolve

from motion_convolution import render_moving


def full_reference(audio, times, filters, sample_rate):
    length = len(audio) + max(h.shape[1] for h in filters) - 1
    result = np.zeros((length, 2))
    axis = np.arange(length) / sample_rate
    for index, h in enumerate(filters):
        one_hot = np.zeros(len(times))
        one_hot[index] = 1
        weights = np.interp(axis, times, one_hot)
        for ear in range(2):
            wet = fftconvolve(audio, h[ear])
            result[:len(wet), ear] += wet * weights[:len(wet)]
    return result


class MovingConvolutionTests(unittest.TestCase):
    def test_random_nonuniform_keyframes_and_mixed_ir_lengths_match_full_reference(self):
        rng = np.random.default_rng(5103)
        for length, times, lengths in (
            (1007, [-0.15, 0.0137, 0.083, 0.7, 1.4], [61, 1, 477, 92, 201]),
            (700, [0.0, 0.2, 0.35, 0.65], [2, 1023, 51, 77]),
            (100, [-4.0, -3.0, -2.0], [201, 7, 41]),
            (100, [2.0, 3.0, 4.0], [7, 201, 41]),
            (512, [-0.1, 0.00001, 0.00002, 0.00003, 0.9], [91, 3, 45, 277, 201]),
        ):
            audio = rng.normal(size=length)
            filters = [rng.normal(size=(2, n)) for n in lengths]
            expected = full_reference(audio, times, filters, 1000)
            actual = render_moving(audio, times, filters, 1000)
            self.assertEqual(actual.shape, expected.shape)
            np.testing.assert_allclose(actual, expected, atol=1e-10, rtol=0)

    def test_static_filters_match_one_complete_convolution_including_tail(self):
        rng = np.random.default_rng(101)
        audio = rng.normal(size=6553)
        h = rng.normal(size=(2, 3109))
        expected = np.column_stack([fftconvolve(audio, ear) for ear in h])
        for times in ([0], [-0.1, 0.003, 0.08, 0.28, 0.71], [0.05, 0.15, 0.9]):
            actual = render_moving(audio, times, [h] * len(times), 10000)
            np.testing.assert_allclose(actual, expected, atol=1e-10, rtol=0)

    def test_late_reflections_keep_required_input_history_across_keyframes(self):
        audio = np.zeros(2400)
        audio[[5, 503, 1903, 2399]] = [0.1, -0.5, 0.7, 1.0]
        filters = []
        for gain, delay in ((1.0, 701), (0.3, 1403), (0.9, 3029), (0.2, 509)):
            h = np.zeros((2, delay + 1))
            h[:, 0] = [gain, gain / 2]
            h[:, -1] = [gain / 3, -gain / 4]
            filters.append(h)
        times = [-0.3, 0.1, 0.25, 0.48]
        expected = full_reference(audio, times, filters, 10000)
        actual = render_moving(audio, times, (h for h in filters), 10000)
        np.testing.assert_allclose(actual, expected, atol=1e-12, rtol=0)
        self.assertGreater(np.max(np.abs(actual[len(audio):])), 0.01)

    def test_one_pass_generator_is_consumed_once_and_inputs_are_unchanged(self):
        audio = np.linspace(-0.7, 0.5, 131)
        h = np.array([[0.3, 0.8, -0.2], [0.1, 0.2, 0.1]])
        original_audio, original_h = audio.copy(), h.copy()
        seen = []

        def generate():
            for index in range(4):
                seen.append(index)
                yield h

        actual = render_moving(audio, [0, 0.03, 0.071, 0.09], generate(), 1000)
        expected = np.column_stack([np.convolve(audio, ear) for ear in h])
        np.testing.assert_allclose(actual, expected, atol=1e-12, rtol=0)
        self.assertEqual(seen, [0, 1, 2, 3])
        np.testing.assert_array_equal(audio, original_audio)
        np.testing.assert_array_equal(h, original_h)

    def test_generator_output_growth_keeps_existing_samples(self):
        rng = np.random.default_rng(45)
        audio = rng.normal(size=251)
        filters = [rng.normal(size=(2, n)) for n in (1, 107, 1009, 2077)]
        times = [-0.1, 0.01, 0.9, 1.7]
        expected = full_reference(audio, times, filters, 100)
        actual = render_moving(audio, times, iter(filters), 100)
        np.testing.assert_allclose(actual, expected, atol=1e-10, rtol=0)

    def test_sample_exact_boundaries_and_one_sample_audio(self):
        audio = np.array([0.7])
        filters = [np.array([[0.5, 0.1], [0.2, 0.3]]), np.array([[0.2], [0.9]]), np.ones((2, 7))]
        for times in ([0, 0.01, 0.02], [-0.02, -0.01, 0], [0.03, 0.04, 0.05]):
            np.testing.assert_allclose(render_moving(audio, times, filters, 100), full_reference(audio, times, filters, 100), atol=1e-12, rtol=0)

    def test_invalid_inputs_fail_without_silent_partial_render(self):
        h = np.ones((2, 3))
        with self.assertRaises(ValueError):
            render_moving(np.ones(3), [0, 1], [h])
        with self.assertRaises(ValueError):
            render_moving(np.ones(3), [0], [h, h])
        for times in ([], [0, 0], [1, 0], [0, np.nan], [np.inf]):
            with self.assertRaises(ValueError):
                render_moving(np.ones(3), times, [h] * len(times))
        for audio in (np.ones((3, 2)), np.array([]), np.array([np.nan])):
            with self.assertRaises(ValueError):
                render_moving(audio, [0], [h])
        for bad_h in (np.ones((1, 3)), np.ones((2, 0)), np.full((2, 1), np.nan)):
            with self.assertRaises(ValueError):
                render_moving(np.ones(3), [0], [bad_h])


if __name__ == "__main__":
    unittest.main()
