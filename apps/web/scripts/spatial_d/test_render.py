"""Contract, edge-case and physical regressions for original-D product DSP."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import h5py
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from spatial_d import render as R
from spatial_d.core import Profile, room_ir


def sofa(path, reverse=False):
    """Small fixture with deliberately different ear responses, valid coordinates."""
    with h5py.File(path, 'w') as f:
        positions = f.create_dataset('SourcePosition', data=[[0, 0, 1.], [90, 0, 1.], [270, 0, 1.]])
        positions.attrs['Type'] = 'spherical'
        positions.attrs['Units'] = 'degree, degree, metre'
        ir = np.zeros((3, 2, 16))
        ir[0, :, 1] = [.8, .8]
        ir[1, 0, 1] = 1
        ir[1, 1, 8] = .3
        ir[2] = ir[1, ::-1]
        f.create_dataset('Data.IR', data=ir)
        f.create_dataset('Data.SamplingRate', data=[48000.])
        f.create_dataset('Data.Delay', data=[[0., 0.]])
        ears = np.array([[[0], [.076], [0]], [[0], [-.076], [0]]])
        f.create_dataset('ReceiverPosition', data=ears[::-1] if reverse else ears)
        f.create_dataset('ListenerView', data=[[1, 0, 0]])
        f.create_dataset('ListenerUp', data=[[0, 0, 1]])


class TrajectoryTests(unittest.TestCase):
    def test_short_orbits_are_continuous_and_complete_with_scaled_holds(self):
        for duration in (.001, .02, .1, .4, 1., 4., 11.99, 12., 34.54):
            times = R.key_times(duration, 'orbit')
            a, d = R.trajectory(dict(pan=0, distance='very_close', movement='orbit'), times, duration)
            self.assertEqual(times[0], 0)
            self.assertEqual(times[-1], duration)
            self.assertTrue(np.all(np.diff(times) > 0))
            self.assertLessEqual(np.max(np.diff(times)), .100000001)
            self.assertEqual(a[0], 90)
            self.assertEqual(a[-1], 450)
            self.assertTrue(np.all(np.diff(a) >= -1e-10))
            self.assertLess(np.max(np.diff(a)), 6)
            np.testing.assert_array_equal(d, np.full_like(d, .18))

    def test_pan_directions_and_distance_movements_have_correct_endpoints(self):
        for pan, az in ((-1, 90), (0, 0), (1, -90)):
            a, d = R.trajectory(dict(pan=pan, distance='close', movement='static'), [0, 1], 1)
            np.testing.assert_array_equal(a, [az, az])
        endpoints = {'approach': [1.75, .35], 'recede': [.35, 1.75], 'orbit_approach': [1.75, .18]}
        for movement, expected in endpoints.items():
            a, d = R.trajectory(dict(pan=-.4, distance='close', movement=movement), [0, 1], 1)
            np.testing.assert_allclose(d, expected, atol=1e-15)
        for movement, expected in (('left_to_right', [90, -90]), ('right_to_left', [-90, 90])):
            a, _ = R.trajectory(dict(pan=.7, distance='far', movement=movement), [0, 1], 1)
            np.testing.assert_array_equal(a, expected)

    def test_invalid_position_fails_explicitly(self):
        for position in ({}, dict(pan=True, distance='mid', movement='static'), dict(pan=2, distance='mid', movement='static'), dict(pan=0, distance='moon', movement='orbit'), dict(pan=0, distance='mid', movement='rotate')):
            with self.assertRaises(ValueError):
                R.trajectory(position, [0, 1], 1)


class AudioTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.path = self.root / 'input.wav'
        self.hrtf = self.root / 'test.sofa'
        sofa(self.hrtf)

    def tearDown(self):
        self.temp.cleanup()

    def test_source_crop_resample_and_fades_do_not_pad_or_change_stereo(self):
        for rate in (32000, 44100, 48000):
            sf.write(self.path, np.full(rate, .01), rate, subtype='PCM_24')
            audio, info = R.prepare_audio(self.path, 'none', .12345, .02, .04)
            self.assertEqual(len(audio), round(.12345*48000))
            self.assertEqual(audio[0], 0)
            self.assertEqual(audio[-1], 0)
            full, _ = R.prepare_audio(self.path, 'none', 2)
            self.assertEqual(len(full), 48000)
        sf.write(self.path, np.ones((1000, 2))*.01, 48000)
        with self.assertRaisesRegex(ValueError, 'mono'):
            R.prepare_audio(self.path)

    def test_short_sources_and_silence_remain_finite_without_measurement_padding(self):
        for n in (1, 17, 300, 4800, 19199):
            for amplitude in (0., .02):
                sf.write(self.path, np.ones(n)*amplitude, 48000, subtype='PCM_24')
                audio, _ = R.prepare_audio(self.path)
                self.assertEqual(len(audio), n)
                self.assertTrue(np.isfinite(audio).all())
                if not amplitude:
                    np.testing.assert_array_equal(audio, np.zeros(n))

    def test_streamed_true_peak_matches_full_resample_at_block_boundaries(self):
        rng = np.random.default_rng(81)
        audio = rng.normal(size=(R.FS*2+67, 2))*.03
        audio[[R.FS-1, R.FS, R.FS+1], 0] = [.9, -.8, .85]
        self.assertAlmostEqual(R.true_peak(audio), np.max(np.abs(resample_poly(audio, 4, 1, axis=0))), places=14)

    def test_hrtf_channel_order_is_checked_and_left_is_louder_at_left(self):
        profile = Profile(self.hrtf)
        self.assertGreater(np.sum(profile.hrir(90, 0)[0]**2), np.sum(profile.hrir(90, 0)[1]**2))
        reversed_path = self.root / 'reversed.sofa'
        sofa(reversed_path, reverse=True)
        with self.assertRaisesRegex(ValueError, 'left-then-right'):
            Profile(reversed_path)

    def test_static_render_matches_full_convolution_and_retains_late_room_energy(self):
        from scipy.signal import fftconvolve
        profile = Profile(self.hrtf)
        audio = np.zeros(600)
        audio[-2] = .05
        position = dict(pan=-1, distance='far', movement='static')
        actual, _ = R.render_audio(audio, profile, position)
        h = room_ir(profile, 90, 1.75)
        expected = np.pad(np.column_stack([fftconvolve(audio, ear) for ear in h]), ((0, 1), (0, 0)))
        expected[-720:] *= np.linspace(1, 0, 720)[:, None]
        np.testing.assert_allclose(actual, expected, atol=1e-14, rtol=0)
        self.assertEqual(len(actual), len(audio)+31200)
        self.assertGreater(np.max(np.abs(actual[len(audio)+1000:])), 1e-6)

    def test_cli_request_writes_verifiable_pcm24_metadata_and_protects_inputs(self):
        sf.write(self.path, np.sin(np.arange(4410)*.02)*.005, 44100, subtype='PCM_24')
        request = dict(version=1, inputWav=str(self.path), outputWav=str(self.root/'output.wav'), outputJson=str(self.root/'output.json'), hrtfPath=str(self.hrtf), position=dict(pan=-1, distance='close', movement='orbit_approach'), durationSeconds=.08, fadeInSeconds=.01, fadeOutSeconds=.02)
        request_path = self.root/'request.json'
        request_path.write_text(json.dumps(request), encoding='utf-8')
        before = R.digest(self.path)
        result = R.render_request(request_path)
        self.assertEqual(result['status'], 'complete')
        self.assertEqual(result['frames'], 3840+31200)
        self.assertEqual(result['sourceDurationSeconds'], .08)
        self.assertEqual(result['sha256'], R.digest(request['outputWav']))
        self.assertEqual(result['source']['sha256'], before)
        self.assertEqual(result['bits_per_sample'], 24)
        self.assertEqual(sf.info(request['outputWav']).subtype, 'PCM_24')
        self.assertEqual(result['tailSeconds'], .65)
        self.assertLessEqual(result['true_peak_dbtp'], -2.08)
        self.assertEqual(R.digest(self.path), before)
        with self.assertRaisesRegex(ValueError, 'must be new'):
            R.render_request(request_path)


if __name__ == '__main__':
    unittest.main()
