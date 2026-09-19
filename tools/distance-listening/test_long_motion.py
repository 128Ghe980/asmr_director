import unittest

import numpy as np

from long_motion import METHODS, key_times, source_presentation, trajectory


class LongMotionPaths(unittest.TestCase):
    def test_new_source_metadata_cannot_claim_reused_or_incomplete_voice(self):
        record = dict(ordered_clause_coverage=dict(total_count=23,covered_count=23,all_covered_in_order=True))
        count,description,note = source_presentation(record,{'new_generation':True},46.2)
        self.assertEqual(count,23)
        self.assertIn('重新生成',description)
        self.assertIn('23/23',note)
        self.assertNotIn('没有重新生成',note)
        record['ordered_clause_coverage']['covered_count']=22
        with self.assertRaises(ValueError): source_presentation(record,{},46.2)

    def test_one_continuous_revolution_same_direction_in_all_versions(self):
        t = np.linspace(0,34.75,5001)
        reference,_ = trajectory('orbit_near',t,34.75)
        self.assertEqual(reference[0],90)
        self.assertEqual(reference[-1],450)
        self.assertTrue(np.all(np.diff(reference)>=-1e-12))
        self.assertLess(float(max(np.diff(reference)/np.diff(t))),14)
        for method in METHODS:
            az,r = trajectory(method['id'],t,34.75)
            np.testing.assert_array_equal(az,reference)
            positions = np.column_stack([2+r*np.cos(np.deg2rad(az)),2+r*np.sin(np.deg2rad(az))])
            self.assertGreaterEqual(float(positions.min()),.25-1e-12)
            self.assertLess(float(positions.max()),6)

    def test_radius_holds_and_approach_has_flat_endpoints(self):
        t = np.linspace(0,34.75,5001)
        for method in METHODS[:3]:
            _,r = trajectory(method['id'],t,34.75)
            np.testing.assert_array_equal(r,np.full_like(t,method['radius_m']))
        _,r = trajectory('spiral',t,34.75)
        self.assertTrue(np.all(np.diff(r)<=1e-12))
        np.testing.assert_allclose(r[t<=2],1.75)
        np.testing.assert_allclose(r[t>=34.75*.78],.18)
        self.assertGreater(34.75*(1-.78),7.5)

    def test_keyframe_spacing_and_angular_holds(self):
        t = key_times(34.75)
        self.assertEqual(t[0],0)
        self.assertEqual(t[-1],34.75)
        self.assertTrue(np.all(np.diff(t)>0))
        self.assertLessEqual(float(max(np.diff(t))),.10000001)
        a,_ = trajectory('orbit_far',t,34.75)
        np.testing.assert_allclose(a[t<=1.5],90)
        np.testing.assert_allclose(a[t>=32.25],450)


if __name__=='__main__':
    unittest.main()
