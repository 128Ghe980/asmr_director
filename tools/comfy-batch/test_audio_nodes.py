"""CPU verification of the portable nodes against the existing D renderer."""
import importlib.util
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

try:
    import numpy as np
    import scipy
    import h5py
    import soundfile
    import pyloudnorm
except ImportError as error:
    raise unittest.SkipTest("D audio node tests need the existing spatial Python runtime") from error

ROOT = Path(__file__).resolve().parents[2]
BASE = Path("I:/AI/asmr_director/qa/native-video/audio-nodes") if os.name == "nt" else Path(tempfile.gettempdir())


class AudioNodeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        BASE.mkdir(parents=True, exist_ok=True)
        cls.temp = tempfile.TemporaryDirectory(prefix="node-", dir=BASE)
        cls.folder = Path(cls.temp.name) / "asmr_director_audio"
        shutil.copytree(ROOT / "tools/comfy-batch/custom_nodes/asmr_director_audio", cls.folder)
        engine = cls.folder / "engine"
        engine.mkdir()
        (engine / "__init__.py").write_text("", encoding="utf-8")
        shutil.copy2(ROOT / "apps/web/scripts/render-processed-voice.py", engine / "processed_voice.py")
        (engine / "spatial_d").mkdir()
        for name in ["__init__.py", "core.py", "near_field.py", "motion_convolution.py"]:
            shutil.copy2(ROOT / "apps/web/scripts/spatial_d" / name, engine / "spatial_d" / name)
        spec = importlib.util.spec_from_file_location("tested_asmr_audio", cls.folder / "__init__.py", submodule_search_locations=[str(cls.folder)])
        cls.node = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = cls.node
        spec.loader.exec_module(cls.node)

    @classmethod
    def tearDownClass(cls):
        if Path(cls.temp.name).resolve().parent != BASE.resolve():
            raise RuntimeError("Unsafe test cleanup")
        cls.temp.cleanup()
        for key in list(sys.modules):
            if key == "tested_asmr_audio" or key.startswith("tested_asmr_audio."):
                sys.modules.pop(key)

    def test_silence_has_exact_duration_and_stereo_shape(self):
        raw = np.zeros((2, 4410))
        result = self.node.spatial_samples(raw, 44100, .153, -.4, "near", -.4, "near", "static", -12, profile=object())
        self.assertEqual(result.shape, (2, 7344))
        self.assertEqual(result.dtype, np.float32)
        self.assertFalse(np.any(result))
        self.assertFalse(np.any(raw))

    def test_only_overlay_is_trimmed_and_mix_preserves_sample_alignment(self):
        base = np.zeros((2, 4800))
        base[0, 100] = .05
        overlay = np.zeros((1, 7000))
        overlay[0, 3000] = .1
        overlay[0, 5000] = .2
        result = self.node.mix_samples(base, 48000, overlay, 48000)
        self.assertEqual(result.shape, (2, 4800))
        self.assertAlmostEqual(float(result[0, 100]), .05, places=6)
        self.assertAlmostEqual(float(result[1, 3000]), .1, places=6)
        self.assertEqual(np.count_nonzero(result), 3)
        self.assertEqual(np.count_nonzero(base), 1)
        self.assertEqual(np.count_nonzero(overlay), 2)

    def test_mixing_uses_shared_peak_attenuation(self):
        axis = np.arange(4800) / 48000
        source = np.stack([np.sin(2 * np.pi * 880 * axis) * .8, np.sin(2 * np.pi * 880 * axis) * .4])
        mixed = self.node.mix_samples(source, 48000, source, 48000)
        self.assertLessEqual(self.node.engine.true_peak(mixed.T), .980001)
        np.testing.assert_allclose(mixed[0], mixed[1] * 2)

    def test_mixing_resamples_without_changing_base_duration(self):
        result = self.node.mix_samples(np.zeros((1, 4410)), 44100, np.ones((2, 320)) * .01, 32000)
        self.assertEqual(result.shape, (2, 4800))
        self.assertTrue(np.any(result[:, :480]))
        self.assertFalse(np.any(result[:, 480:]))

    def test_invalid_source_and_settings_fail_before_processing(self):
        for source in [np.zeros((3, 100)), np.zeros((2, 0)), np.array([[np.nan]])]:
            with self.assertRaises(ValueError):
                self.node.spatial_samples(source, 48000, .1, 0, "near", 0, "near", "static", -12, profile=object())
        for change in [{"duration_seconds": float("inf")}, {"gain_db": -40}, {"start_pan": 2}, {"movement": "teleport"}]:
            settings = dict(duration_seconds=.1, start_pan=0, start_distance="near", end_pan=0, end_distance="near", movement="static", gain_db=-12)
            settings.update(change)
            with self.assertRaises(ValueError):
                self.node.spatial_samples(np.zeros((1, 4800)), 48000, profile=object(), **settings)

    def test_comfy_contract_has_expected_audio_links(self):
        self.assertEqual(set(self.node.NODE_CLASS_MAPPINGS), {"AsmrDirectorSpatialAudio", "AsmrDirectorMixAudio", "AsmrDirectorBalancedSpatialAudio"})
        self.assertEqual(self.node.AsmrDirectorMixAudio.INPUT_TYPES()["required"], {"audio1": ("AUDIO",), "audio2": ("AUDIO",)})
        self.assertEqual(self.node.AsmrDirectorSpatialAudio.RETURN_TYPES, ("AUDIO",))
        balanced = self.node.AsmrDirectorBalancedSpatialAudio.INPUT_TYPES()["required"]
        self.assertEqual(balanced["reference_audio"], ("AUDIO",))
        self.assertEqual(balanced["role"], (["trigger", "ambience"],))
        self.assertNotIn("role", self.node.AsmrDirectorSpatialAudio.INPUT_TYPES()["required"])

    def tone(self, amplitude=.1, seconds=1):
        axis = np.arange(round(seconds * 48000)) / 48000
        return (amplitude * np.sin(2 * np.pi * 620 * axis))[:, None]

    def test_balancing_equalizes_different_source_levels_without_changing_stereo_ratio(self):
        results = []
        for scale in (1., 4.):
            source = self.tone(.03 * scale)
            spatial = np.column_stack((source[:, 0] * 1.2, source[:, 0] * .6))
            before = spatial.copy()
            result = self.node.balance_samples(spatial, source, np.zeros_like(spatial), "trigger", "replace", -12)
            results.append(result)
            self.assertAlmostEqual(self.node._loudness(result), -27., places=5)
            np.testing.assert_allclose(result[:, 0], result[:, 1] * 2, atol=1e-12)
            np.testing.assert_array_equal(spatial, before)
        np.testing.assert_allclose(results[0], results[1], atol=1e-10)

    def test_balancing_uses_gain_as_bounded_role_relative_trim(self):
        source = self.tone()
        stereo = np.repeat(source, 2, axis=1)
        neutral = self.node.balance_samples(stereo, source, stereo, "trigger", "replace", -12)
        quiet = self.node.balance_samples(stereo, source, stereo, "trigger", "replace", -18)
        extreme = self.node.balance_samples(stereo, source, stereo, "trigger", "replace", -36)
        self.assertAlmostEqual(self.node._loudness(neutral) - self.node._loudness(quiet), 6., places=6)
        np.testing.assert_allclose(quiet, extreme)

    def test_balanced_ambience_and_near_silence_are_never_lifted(self):
        rng = np.random.default_rng(702)
        for amplitude in (0., 1e-5, .0007, .01):
            source = rng.normal(0., amplitude, size=(48000, 1))
            spatial = np.repeat(source * 100, 2, axis=1)
            output = self.node.balance_samples(spatial, source, np.zeros_like(spatial), "ambience", "replace", -24)
            source_level, output_level = self.node._loudness(source), self.node._loudness(output)
            if source_level is None or output_level is None:
                self.assertLessEqual(float(np.sqrt(np.mean(output ** 2))), float(np.sqrt(np.mean(source ** 2))) + 1e-12)
            else:
                self.assertLessEqual(output_level, source_level + 1e-6)
                self.assertLessEqual(output_level, -45. + 1e-6)
        self.assertFalse(np.any(self.node.balance_samples(np.zeros((480, 2)), np.zeros((480, 1)), np.zeros((480, 2)), "trigger", "replace", -12)))

    def test_balancing_does_not_promote_near_silent_trigger_noise(self):
        source = self.tone(.0001)
        spatial = np.repeat(source * 100, 2, axis=1)
        output = self.node.balance_samples(spatial, source, spatial, "trigger", "replace", -12)
        self.assertLessEqual(float(np.sqrt(np.mean(output ** 2))), float(np.sqrt(np.mean(source ** 2))) + 1e-12)

    def test_balanced_overlay_tracks_the_reference_level(self):
        source = self.tone(.05)
        spatial = np.repeat(source, 2, axis=1)
        levels = []
        for amplitude in (.1, .01):
            reference = self.tone(amplitude)
            output = self.node.balance_samples(spatial, source, reference, "trigger", "overlay", -12)
            level = self.node._loudness(output)
            self.assertLessEqual(level, self.node._loudness(reference) - 10 + 1e-6)
            self.assertLessEqual(level, -34 + 1e-6)
            levels.append(level)
        self.assertGreater(levels[0] - levels[1], 10)

    def test_balancing_preserves_sparse_attacks_pauses_and_peak_headroom(self):
        source = self.tone(.4, 2)
        source[:4000] = 0
        source[5000:30000] = 0
        source[31000:] = 0
        spatial = np.repeat(source, 2, axis=1)
        output = self.node.balance_samples(spatial, source, spatial, "trigger", "replace", -6)
        self.assertLessEqual(self.node.engine.true_peak(output), self.node.BALANCED_PEAK + 1e-7)
        active = np.abs(spatial) > 1e-8
        ratios = output[active] / spatial[active]
        self.assertLess(float(np.ptp(ratios)), 1e-10)
        self.assertFalse(np.any(output[spatial == 0]))

    def test_balancing_total_boost_is_limited_relative_to_raw_source(self):
        source = self.tone(.003)
        spatial = np.repeat(source * 20, 2, axis=1)
        output = self.node.balance_samples(spatial, source, spatial, "trigger", "replace", -6)
        self.assertLessEqual(self.node._loudness(output) - self.node._loudness(source), 12 + 1e-6)

    def test_balanced_silence_and_invalid_roles(self):
        raw = np.zeros((1, 4800))
        result = self.node.balanced_spatial_samples(raw, 48000, raw, 48000, .1,
            0, "near", 0, "near", "static", -12, "trigger", "replace", profile=object())
        self.assertEqual(result.shape, (2, 4800))
        self.assertFalse(np.any(result))
        for role, mode in (("other", "replace"), ("trigger", "discard")):
            with self.assertRaises(ValueError):
                self.node.balanced_spatial_samples(raw, 48000, raw, 48000, .1,
                    0, "near", 0, "near", "static", -12, role, mode, profile=object())

    def test_real_hrtf_matches_product_d_and_keeps_source_intact(self):
        sofa = Path(os.environ.get("ASMR_SPATIAL_HRTF", "D:/CodexWorkplace/asmr_director_runtime/audio-quality-v1/hrtf/viking/subj_A.sofa"))
        if not sofa.is_file():
            self.skipTest("Existing product SOFA is not available")
        profile = self.node.engine.Profile(sofa)
        axis = np.arange(14400) / 48000
        raw = np.stack([.1 * np.sin(2 * np.pi * 620 * axis), .06 * np.sin(2 * np.pi * 920 * axis)])
        unchanged = raw.copy()
        output = self.node.spatial_samples(raw, 48000, .3, -1., "near", 1., "close", "left_to_right", -9., profile)
        options = self.node.engine.settings({"start": {"pan": -1., "distance": "near"}, "end": {"pan": 1., "distance": "close"},
            "movement": "left_to_right", "volumeDb": -9., "fadeInSeconds": 0., "fadeOutSeconds": 0., "binaural": True})
        expected, route = self.node.engine.render_audio(raw.mean(axis=0)[:, None], options, profile)
        np.testing.assert_allclose(output[:, :-576].T, expected[:14400 - 576], atol=1e-8)
        self.assertEqual(output.shape, (2, 14400))
        np.testing.assert_array_equal(raw, unchanged)
        self.assertTrue(route["spatialized"])
        self.assertEqual(route["azimuthDegrees"][0], 90.)
        self.assertEqual(route["azimuthDegrees"][-1], -90.)
        self.assertTrue(np.all(np.isfinite(output)))
        self.assertEqual(float(abs(output[:, -1]).max()), 0.)

    def test_balanced_real_hrtf_preserves_motion_with_one_final_gain(self):
        sofa = Path(os.environ.get("ASMR_SPATIAL_HRTF", "D:/CodexWorkplace/asmr_director_runtime/audio-quality-v1/hrtf/viking/subj_A.sofa"))
        if not sofa.is_file():
            self.skipTest("Existing product SOFA is not available")
        profile = self.node.engine.Profile(sofa)
        # Both inputs are within the allowed 12 dB elevation budget at -27 LUFS.
        raw = self.tone(.12, 1).T
        silent = np.zeros((2, 48000))
        spatial = self.node.spatial_samples(raw, 48000, 1., -1., "near", 1., "close", "left_to_right", 0., profile)
        balanced = self.node.balanced_spatial_samples(raw, 48000, silent, 48000, 1.,
            -1., "near", 1., "close", "left_to_right", -12., "trigger", "replace", profile)
        quieter = self.node.balanced_spatial_samples(raw / 4, 48000, silent, 48000, 1.,
            -1., "near", 1., "close", "left_to_right", -12., "trigger", "replace", profile)
        scalar = float(np.sum(balanced * spatial) / np.sum(spatial * spatial))
        np.testing.assert_allclose(balanced, spatial * scalar, atol=1e-8)
        np.testing.assert_allclose(balanced, quieter, atol=1e-8)
        self.assertAlmostEqual(self.node._loudness(balanced.T), -27., places=4)
        self.assertLessEqual(self.node.engine.true_peak(balanced.T), self.node.BALANCED_PEAK + 1e-6)
        self.assertEqual(float(abs(balanced[:, -1]).max()), 0.)


if __name__ == "__main__":
    unittest.main()
