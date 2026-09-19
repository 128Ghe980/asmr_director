import unittest

import numpy as np

from refine_room import FDN_DELAYS, FS, LISTENER, ROOM, fdn_tail, image_paths


class RefinedRoomTests(unittest.TestCase):
    def test_images_are_unique_and_have_expected_orders(self):
        source = LISTENER + np.array([.7, .4, .2])
        paths = list(image_paths(source))
        self.assertEqual(sum(p['order'] == 1 for p in paths), 6)
        self.assertEqual(sum(p['order'] == 2 for p in paths), 18)
        self.assertEqual(len({tuple(p['path']) for p in paths}), 24)
        for p in paths:
            self.assertEqual(len(p['walls']), p['order'])
            self.assertGreater(p['length'], np.linalg.norm(source-LISTENER))

    def test_first_order_geometry_and_emission_match_specular_bounce(self):
        source = LISTENER + np.array([.7, .4, .2])
        for p in image_paths(source, 1):
            axis, side = divmod(p['walls'][0], 2)
            wall = side*ROOM[axis]
            image = LISTENER + p['path']
            expected = source.copy()
            expected[axis] = 2*wall-source[axis]
            np.testing.assert_allclose(image, expected)
            u = (wall-LISTENER[axis])/p['path'][axis]
            bounce = LISTENER+u*p['path']
            ray = bounce-source
            np.testing.assert_allclose(p['emission'], ray/np.linalg.norm(ray), atol=1e-14)

    def test_fdn_is_finite_decays_and_has_different_ear_responses(self):
        h = fdn_tail()
        self.assertTrue(np.isfinite(h).all())
        self.assertAlmostEqual(float(np.sum(h*h)), 1.)
        first = np.sum(h[:, :int(.12*FS)]**2)
        last = np.sum(h[:, int(.30*FS):]**2)
        self.assertLess(last/first, 1e-5)
        self.assertLess(abs(np.corrcoef(h)[0, 1]), .7)
        self.assertTrue(np.all(10**(-3*FDN_DELAYS/(FS*.24)) < 1))


if __name__ == '__main__':
    unittest.main()
