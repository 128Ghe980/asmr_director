"""Synthetic explicit-post-processing tests. No model or measured HRTF is loaded."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

import numpy as np
import soundfile as sf

sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("processed_voice", Path(__file__).with_name("render-processed-voice.py"))
R = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(R)


def options(**updates):
    result = dict(start=dict(pan=-1, distance="far"), end=dict(pan=1, distance="close"), movement="left_to_right",
                  volumeDb=0, fadeInSeconds=0, fadeOutSeconds=0, binaural=False)
    result.update(updates)
    return result


class TrajectoryTests(unittest.TestCase):
    def test_every_nonstatic_route_respects_explicit_endpoints(self):
        for movement in R.MOVEMENTS - {"static"}:
            with self.subTest(movement=movement):
                a, d = R.trajectory(dict(pan=-.4, distance="near"), dict(pan=.7, distance="very_close"), movement, [0, 2], 2)
                self.assertAlmostEqual(a[0] % 360, 36)
                self.assertAlmostEqual(a[-1] % 360, (-63) % 360)
                np.testing.assert_allclose(d, [.5, .18])

    def test_approach_does_not_restart_at_far_and_recede_does_not_force_far_end(self):
        for movement in ("approach", "recede"):
            _, d = R.trajectory(dict(pan=0, distance="close"), dict(pan=0, distance="mid"), movement, [0, .5, 1], 1)
            np.testing.assert_allclose(d[[0, -1]], [.35, .8])

    def test_orbit_starts_at_selected_phase_and_turns_at_least_once_before_end(self):
        a, _ = R.trajectory(dict(pan=1, distance="near"), dict(pan=-1, distance="near"), "orbit", [0, 1], 1)
        np.testing.assert_allclose(a, [-90, 450])
        a, _ = R.trajectory(dict(pan=.2, distance="near"), dict(pan=.2, distance="near"), "orbit", [0, 1], 1)
        self.assertAlmostEqual(a[-1] - a[0], 360)

    def test_static_is_constant_and_requires_one_location(self):
        point = dict(pan=.2, distance="near")
        a, d = R.trajectory(point, point, "static", [0, .1, 1], 1)
        np.testing.assert_allclose(a, -18)
        np.testing.assert_allclose(d, .5)
        with self.assertRaises(ValueError):
            R.settings(options(movement="static"))

    def test_adjacent_clips_meet_without_resetting_to_canned_start(self):
        left, shared, right = dict(pan=-.6, distance="mid"), dict(pan=.2, distance="close"), dict(pan=.7, distance="near")
        a, d = R.trajectory(left, shared, "approach", [0, 1], 1)
        b, e = R.trajectory(shared, right, "right_to_left", [0, 2], 2)
        self.assertEqual(a[-1], b[0])
        self.assertAlmostEqual(d[-1], e[0])

    def test_short_orbits_have_dense_keys_and_bounded_real_duration(self):
        o = options(movement="orbit")
        times = R.key_times(o["start"], o["end"], o["movement"], .02)
        self.assertEqual(times[0], 0)
        self.assertEqual(times[-1], .02)
        a, _ = R.trajectory(o["start"], o["end"], o["movement"], times, .02)
        self.assertLessEqual(np.max(np.diff(a)), 5.01)

    def test_invalid_geometry_and_nonfinite_values_are_rejected(self):
        for values in (dict(pan=True, distance="near"), dict(pan=2, distance="near"), dict(pan=0, distance="moon"), {}):
            with self.subTest(values=values), self.assertRaises((ValueError, KeyError)):
                R.anchor(values)
        for change in (dict(volumeDb=float("nan")), dict(binaural=1), dict(fadeInSeconds=-1), dict(movement="teleport")):
            with self.subTest(change=change), self.assertRaises(ValueError):
                R.settings(options(**change))


class SignalTests(unittest.TestCase):
    def test_basic_mono_changes_pan_and_distance_without_calling_D(self):
        source = np.full((4800, 1), .02)
        with patch.object(R, "room_ir", side_effect=AssertionError("No D when binaural is off")):
            output, report = R.render_audio(source, options())
        self.assertEqual(output.shape, (4800, 2))
        self.assertFalse(report["spatialized"])
        self.assertEqual(report["tailSeconds"], 0)
        self.assertGreater(abs(output[0, 0]), 1e8 * abs(output[0, 1]))
        self.assertGreater(abs(output[-1, 1]), 1e5 * abs(output[-1, 0]))
        self.assertGreater(np.max(np.abs(output[-1])), np.max(np.abs(output[0])))
        np.testing.assert_allclose(source, .02)

    def test_stereo_is_not_spatialized_again_and_volume_is_applied_once(self):
        source = np.column_stack((np.full(4800, .02), np.full(4800, -.01)))
        for binaural in (True, False):
            with self.subTest(binaural=binaural), patch.object(R, "room_ir", side_effect=AssertionError("Stereo must stay stereo")):
                output, report = R.render_audio(source, options(binaural=binaural, volumeDb=-6))
            np.testing.assert_allclose(output, source * 10 ** (-6 / 20))
            self.assertFalse(report["spatialized"])
            self.assertEqual(report["tailSeconds"], 0)

    def test_fades_are_once_and_source_samples_are_never_mutated(self):
        source = np.full((4800, 2), .02)
        output, _ = R.render_audio(source, options(volumeDb=-6, fadeInSeconds=.05, fadeOutSeconds=.05))
        self.assertEqual(output[0, 0], 0)
        self.assertEqual(output[-1, 0], 0)
        self.assertAlmostEqual(output[1200, 0], .02 * .5 * 10 ** (-6 / 20))
        np.testing.assert_allclose(source, .02)

    def test_synthetic_D_uses_motion_convolution_and_preserves_full_tail(self):
        source = np.sin(np.arange(4800) * 2 * np.pi * 200 / R.FS)[:, None] * .02
        impulse = np.zeros((2, round(.65 * R.FS)))
        impulse[:, 0] = [.3, .2]
        anchor = dict(pan=0, distance="near")
        config = options(start=anchor, end=anchor, movement="static", binaural=True)
        with patch.object(R, "room_ir", return_value=impulse):
            full, report = R.render_audio(source, config, object())
            quiet, _ = R.render_audio(source, {**config, "volumeDb": -6}, object())
        self.assertEqual(len(full), len(source) + round(.65 * R.FS))
        self.assertEqual(report["tailSeconds"], .65)
        self.assertTrue(report["spatialized"])
        np.testing.assert_allclose(quiet, full * 10 ** (-6 / 20), atol=1e-12)

    def test_silence_is_finite_and_D_tail_does_not_require_convolving(self):
        point = dict(pan=0, distance="mid")
        with patch.object(R, "room_ir", side_effect=AssertionError("Silent input")):
            output, _ = R.render_audio(np.zeros((480, 1)), options(start=point, end=point, movement="static", binaural=True), object())
        self.assertTrue(np.isfinite(output).all())
        self.assertFalse(np.any(output))
        self.assertEqual(len(output), 480 + round(.65 * R.FS))


class RequestTests(unittest.TestCase):
    def setUp(self):
        base = Path(os.environ.get("ASMR_POST_PROCESSING_TEST_ROOT", tempfile.gettempdir()))
        base.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix="processed-python-", dir=base)
        self.root = Path(self.temp.name)
        self.source, self.output, self.report, self.request_path = (self.root / name for name in ("input.wav", "output.wav", "output.json", "request.json"))
        sf.write(self.source, np.full(4800, .02), R.FS, subtype="PCM_16")
        self.request = dict(version=1, inputWav=str(self.source), outputWav=str(self.output), outputJson=str(self.report),
                            sourceSha256=hashlib.sha256(self.source.read_bytes()).hexdigest(), **options())

    def tearDown(self):
        self.temp.cleanup()

    def run_request(self):
        self.request_path.write_text(json.dumps(self.request), encoding="utf-8")
        return R.render_request(self.request_path)

    def test_actual_basic_WAV_output_binds_original_source_and_output_SHA(self):
        original = self.source.read_bytes()
        report = self.run_request()
        self.assertEqual(report["sourceSha256"], hashlib.sha256(original).hexdigest())
        self.assertEqual(report["outputSha256"], hashlib.sha256(self.output.read_bytes()).hexdigest())
        self.assertEqual(report["outputFrames"], 4800)
        self.assertEqual(report["channels"], 2)
        self.assertEqual(report["rendererVersion"], R.RENDERER_VERSION)
        self.assertEqual(self.source.read_bytes(), original)

    def test_stereo_binaural_request_does_not_need_HRTF(self):
        sf.write(self.source, np.full((4800, 2), .02), R.FS, subtype="PCM_16")
        self.request.update(binaural=True, sourceSha256=hashlib.sha256(self.source.read_bytes()).hexdigest())
        self.assertFalse(self.run_request()["spatialized"])

    def test_source_digest_mismatch_never_renders(self):
        self.request["sourceSha256"] = "0" * 64
        with patch.object(R, "render_audio", side_effect=AssertionError("Binding first")), self.assertRaisesRegex(ValueError, "snapshot"):
            self.run_request()
        self.assertFalse(self.output.exists())

    def test_existing_output_and_input_or_request_aliases_are_rejected(self):
        for destination in (self.source, self.request_path, self.root.parent / "escaped.wav"):
            with self.subTest(destination=destination):
                self.request["outputWav"] = str(destination)
                with self.assertRaises(ValueError):
                    self.run_request()
        self.request["outputWav"] = str(self.output)
        self.output.write_bytes(b"preserve")
        with self.assertRaises(ValueError):
            self.run_request()
        self.assertEqual(self.output.read_bytes(), b"preserve")

    def test_unknown_keys_and_boolean_protocol_versions_are_rejected(self):
        for change in (dict(unknown=True), dict(version=True)):
            with self.subTest(change=change):
                request = dict(self.request)
                self.request.update(change)
                with self.assertRaises(ValueError):
                    self.run_request()
                self.request = request

    def test_44100_source_resamples_to_real_whole_sample_duration(self):
        sf.write(self.source, np.full(441, .02), 44100, subtype="PCM_16")
        self.request["sourceSha256"] = hashlib.sha256(self.source.read_bytes()).hexdigest()
        report = self.run_request()
        self.assertEqual(report["sourceFrames"], 480)
        self.assertEqual(report["outputFrames"], 480)

    def test_no_unrelated_dirty_renderer_is_imported(self):
        self.assertNotIn("spatial_d.render", sys.modules)


if __name__ == "__main__":
    unittest.main()
