import unittest

import numpy as np

from render import FS, render_filters


class RenderChecks(unittest.TestCase):
    def test_constant_filter_crossfade_preserves_samples_and_complete_tail(self):
        rng = np.random.default_rng(4)
        audio = rng.normal(size=FS//5)
        fir = np.array([[.2, .6, .2], [.0, .8, -.2]])
        output = render_filters(audio, [0, .05, .1, .2], [fir]*4)
        expected = np.column_stack([np.convolve(audio, row) for row in fir])
        np.testing.assert_allclose(output, expected, atol=1e-12)

    def test_long_delayed_reflection_survives_source_end(self):
        audio = np.zeros(FS//10)
        audio[-1] = 1
        fir = np.zeros((2, FS//2))
        fir[:, -1] = .3
        output = render_filters(audio, [0], [fir])
        self.assertEqual(len(output), len(audio)+fir.shape[1]-1)
        np.testing.assert_allclose(output[-1], [.3, .3], atol=1e-12)
        self.assertLess(np.max(np.abs(output[:-1])), 1e-12)

    def test_time_varying_gain_has_no_block_discontinuities(self):
        audio = np.ones(FS)
        filters = [np.full((2, 1), gain) for gain in [1., .1, .8]]
        output = render_filters(audio, [0, .5, 1], filters)
        self.assertLess(np.max(np.abs(np.diff(output[:, 0]))), .00005)
        np.testing.assert_allclose(output[:, 0], output[:, 1])


if __name__ == '__main__':
    unittest.main()
