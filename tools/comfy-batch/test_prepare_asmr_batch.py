"""Offline fidelity/portability tests for the supplied H3 workflow adapter."""
import copy
import contextlib
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock


HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("prepare_asmr_batch", HERE / "prepare_asmr_batch.py")
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)


def source_workflow():
    """Compact fixture with the source graph's real classes/widgets/connections.

    Stale destination slots deliberately reproduce its dynamic H3 inputs.
    Node 22's saved width/height disagree with the live selector on purpose.
    """
    definitions = [
        (2, "VAELoader", {"vae_name": "minimax_h3_video_vae_fp16.safetensors"}, [], 1),
        (3, "VAELoader", {"vae_name": "minimax_h3_audio_vae_fp32.safetensors"}, [], 1),
        (4, "VAEDecodeAudio", {}, ["samples", "vae"], 1),
        (5, "VAEDecode", {}, ["samples", "vae"], 1),
        (6, "KSamplerSelect", {"sampler_name": "res_multistep"}, [], 1),
        (7, "BasicScheduler", {"scheduler": "simple", "steps": 20, "denoise": 1}, ["model"], 1),
        (8, "SamplerCustomAdvanced", {}, ["noise", "guider", "sampler", "sigmas", "latent_image"], 2),
        (9, "BasicGuider", {}, ["model", "conditioning"], 1),
        (10, "RandomNoise", {"noise_seed": 614755119635694, "control_after_generate": "randomize"}, [], 1),
        (11, "CreateVideo", {"fps": 24, "bit_depth": 8, "color_space": "sRGB", "codec": "none"}, ["images", "audio"], 1),
        (12, "MiniMaxH3FusedModulation", {"enabled": True}, ["model"], 1),
        (13, "MiniMaxH3ChunkFeedForward", {"enabled": True, "chunks": 4, "min_tokens": 8192}, ["model"], 1),
        (14, "MiniMaxH3MemoryEfficientSolAttentionPatch", {"enabled": True, "tau": 1, "min_tokens": 4096, "strict": True, "thresh_type": "diag", "int8_qk": False, "int8_pv": False, "sink_conditioning": "exact_kv", "dense_blocks": ""}, ["model"], 1),
        (15, "EasyCache", {"reuse_threshold": 0.1, "start_percent": 0.15, "end_percent": 0.85, "verbose": False}, ["model"], 1),
        (16, "CLIPLoader", {"clip_name": "qwen3vl_text_encoder.safetensors", "type": "minimax", "device": "default"}, [], 1),
        (17, "UNETLoader", {"unet_name": "minimax_h3_ref2va_dit_16g.safetensors", "weight_dtype": "default"}, [], 1),
        (18, "ComfyMathExpression", {"expression": "max(5, round(a * 24)) + (5 - (max(5, round(a * 24)) % 17)) % 17"}, ["values.a"], 3),
        (21, "ResolutionSelector", {"aspect_ratio": "9:16 (Portrait Widescreen)", "megapixels": 1, "multiple": 32}, [], 2),
        (22, "MiniMaxH3ReferenceToVideo", {"prompt": "", "width": 1344, "height": 768, "length": 124, "ref_image_size": "match"}, ["clip", "vae", "audio_vae", "ref_images.ref_image_0", "ref_videos.ref_video_0", "ref_video_audios.ref_video_audio_0", "ref_audios.ref_audio_0"], 2),
        (24, "SaveVideo", {"filename_prefix": "MiniMax-H3-16GB-HiFi/Ref2VA-Fast", "format": "auto", "format.codec": "auto", "codec": "auto"}, ["video"], 1),
        (25, "PrimitiveFloat", {"value": 5}, [], 1),
        (26, "PrimitiveStringMultiline", {"value": "原始提示词，保存在原工作流中。"}, [], 1),
    ]
    nodes = []
    for node_id, kind, widgets, socket_names, outputs in definitions:
        inputs = [{"name": name, "link": None} for name in socket_names]
        for item in inputs:
            if item["name"].startswith("ref_"):
                item["shape"] = 7
        inputs += [{"name": name, "widget": {"name": name}, "link": None} for name in widgets if name != "control_after_generate"]
        nodes.append({"id": node_id, "type": kind, "mode": 0, "pos": [node_id * 10, 0],
                      "inputs": inputs, "outputs": [{"links": []} for _ in range(outputs)],
                      "widgets_values": list(widgets.values()), "widgets_values_named": widgets})
    nodes.append({"id": 1, "type": "MarkdownNote", "widgets_values": ["# models"]})
    by_id = {node["id"]: node for node in nodes}
    by_id[21]["inputs"].append({"name": "preview", "type": "RESOLUTION_PREVIEW", "shape": 7, "widget": {"name": "preview"}, "link": None})
    connections = [
        (8, 0, 4, "samples"), (3, 0, 4, "vae"), (8, 0, 5, "samples"), (2, 0, 5, "vae"),
        (15, 0, 7, "model"), (10, 0, 8, "noise"), (9, 0, 8, "guider"), (6, 0, 8, "sampler"),
        (7, 0, 8, "sigmas"), (22, 1, 8, "latent_image"), (15, 0, 9, "model"), (22, 0, 9, "conditioning"),
        (5, 0, 11, "images"), (4, 0, 11, "audio"), (14, 0, 12, "model"), (12, 0, 13, "model"),
        (17, 0, 14, "model"), (13, 0, 15, "model"), (25, 0, 18, "values.a"), (16, 0, 22, "clip"),
        (2, 0, 22, "vae"), (3, 0, 22, "audio_vae"), (11, 0, 24, "video"), (21, 0, 22, "width"),
        (21, 1, 22, "height"), (18, 1, 22, "length"), (26, 0, 22, "prompt"),
    ]
    links = []
    for link_id, (source, source_slot, target, name) in enumerate(connections, 1):
        target_slot = next(index for index, item in enumerate(by_id[target]["inputs"]) if item["name"] == name)
        by_id[target]["inputs"][target_slot]["link"] = link_id
        by_id[source]["outputs"][source_slot]["links"].append(link_id)
        if target == 22 and name in ("prompt", "width", "height", "length"):
            target_slot += 1
        links.append([link_id, source, source_slot, target, target_slot, "*"])
    return {"nodes": nodes, "links": links, "groups": [{"title": "User Inputs"}], "version": 0.4}


def trigger_pack():
    return {"title": "12 ASMR triggers", "durationSeconds": 5, "sources": [{"url": "https://example.com/official-guide"}],
            "triggers": [{"id": f"trigger-{i:02d}", "order": i, "title": f"触发音 {i}", "listeningFocus": "听近距离细节",
                          "prompt": {"integrated_multimodal_description": f"[Shot 1] Close-up of tapping {i}.",
                                     "overall_soundscape": "Close dry taps in a silent room.", "non_diegetic_music": "N/A"}}
                         for i in range(1, 13)]}


class ConverterTests(unittest.TestCase):
    def setUp(self):
        self.workflow = source_workflow()

    def node(self, node_id):
        return next(node for node in self.workflow["nodes"] if node["id"] == node_id)

    def test_source_execution_settings_and_audio_path_are_preserved(self):
        before = copy.deepcopy(self.workflow)
        graph, evidence = builder.convert_ui_workflow(self.workflow)
        self.assertEqual(self.workflow, before)
        self.assertEqual(graph["17"]["inputs"]["unet_name"], "minimax_h3_ref2va_dit_16g.safetensors")
        for node_id in (2, 3, 6, 7, 11, 12, 13, 14, 15, 16, 17, 21):
            for key, value in self.node(node_id)["widgets_values_named"].items():
                self.assertEqual(graph[str(node_id)]["inputs"][key], value)
        self.assertEqual(graph["11"]["inputs"]["audio"], ["4", 0])
        self.assertEqual(graph["11"]["inputs"]["images"], ["5", 0])
        self.assertEqual(graph["22"]["inputs"]["width"], ["21", 0])
        self.assertEqual(graph["22"]["inputs"]["height"], ["21", 1])
        self.assertEqual(graph["22"]["inputs"]["length"], 124)
        self.assertEqual(graph["22"]["inputs"]["prompt"], "原始提示词，保存在原工作流中。")
        self.assertEqual(graph["26"]["class_type"], "SaveVideo")
        self.assertEqual(graph["26"]["inputs"]["format.codec"], "auto")
        self.assertEqual(evidence["nativeDurationSeconds"], 124 / 24)
        self.assertEqual(len(evidence["targetSlotBindingsResolvedByName"]), 4)
        self.assertFalse({"1", "18", "24", "25"} & graph.keys())
        self.assertNotIn("control_after_generate", graph["10"]["inputs"])
        self.assertNotIn("preview", graph["21"]["inputs"])
        self.assertFalse(any(key.startswith("ref_") and key != "ref_image_size" for key in graph["22"]["inputs"]))
        self.assertFalse(any(node["class_type"].startswith("Load") for node in graph.values()))

    def test_missing_named_widget_is_not_guessed_from_position(self):
        del self.node(14)["widgets_values_named"]["tau"]
        with self.assertRaisesRegex(builder.PreparationError, "missing named widget value tau"):
            builder.convert_ui_workflow(self.workflow)

    def test_unknown_widget_with_no_actual_input_is_rejected(self):
        self.node(14)["widgets_values_named"]["future_parameter"] = True
        with self.assertRaisesRegex(builder.PreparationError, "no actual input"):
            builder.convert_ui_workflow(self.workflow)

    def test_unsupported_active_node_and_bypass_fail_explicitly(self):
        self.workflow["nodes"].append({"id": 99, "type": "UnknownCustomOutput", "mode": 0})
        with self.assertRaisesRegex(builder.PreparationError, "Unsupported active"):
            builder.convert_ui_workflow(self.workflow)
        self.workflow["nodes"].pop()
        self.node(14)["mode"] = 4
        with self.assertRaisesRegex(builder.PreparationError, "Unsupported active/bypassed"):
            builder.convert_ui_workflow(self.workflow)

    def test_wrong_source_endpoint_or_missing_link_fails(self):
        self.workflow["links"][0][1] = 99
        with self.assertRaisesRegex(builder.PreparationError, "source/target/output"):
            builder.convert_ui_workflow(self.workflow)
        self.workflow = source_workflow()
        self.workflow["links"].pop()
        with self.assertRaisesRegex(builder.PreparationError, "missing link"):
            builder.convert_ui_workflow(self.workflow)

    def test_changed_math_expression_is_never_evaluated(self):
        self.node(18)["widgets_values_named"]["expression"] = "__import__('os').system('do-not-run')"
        with self.assertRaisesRegex(builder.PreparationError, "Unsupported duration expression"):
            builder.convert_ui_workflow(self.workflow)

    def test_missing_required_link_fails(self):
        self.node(11)["inputs"][1]["link"] = None
        with self.assertRaisesRegex(builder.PreparationError, "orphan|required"):
            builder.convert_ui_workflow(self.workflow)

    def test_source_duration_validation_is_finite_positive_and_bounded(self):
        for duration in (0, -1, True, False, None, "5", float("nan"), float("inf"), 1e308, 10 ** 1000, 150):
            with self.subTest(duration=duration):
                self.node(25)["widgets_values_named"]["value"] = duration
                with self.assertRaisesRegex(builder.PreparationError, "Duration|duration"):
                    builder.convert_ui_workflow(self.workflow)

    def test_frame_alignment_uses_original_rounding_expression(self):
        for duration, frames in ((5, 124), (8, 192), (10.5, 260), (12, 294), (149.66, 3592), (0.01, 5)):
            with self.subTest(duration=duration):
                self.assertEqual(builder.duration_frames(duration), frames)


class TriggerDurationTests(unittest.TestCase):
    def test_precedence_global_then_trigger_then_pack_and_missing_default(self):
        pack = trigger_pack()
        pack["durationSeconds"] = 8
        pack["triggers"][0]["durationSeconds"] = 12
        self.assertEqual([shot["durationSeconds"] for shot in builder.prepare_shots(pack)][:2], [12, 8])
        self.assertEqual({shot["durationSeconds"] for shot in builder.prepare_shots(pack, duration_seconds=10.5)}, {10.5})
        del pack["durationSeconds"]
        self.assertEqual([shot["durationSeconds"] for shot in builder.prepare_shots(pack)][:2], [12, 5])

    def test_invalid_pack_trigger_and_override_durations_are_rejected(self):
        invalid = (0, -1, True, False, None, "8", float("nan"), float("inf"), float("-inf"), 1e308, 10 ** 1000, 150)
        for duration in invalid:
            with self.subTest(duration=duration):
                pack = trigger_pack()
                pack["durationSeconds"] = duration
                with self.assertRaises(builder.PreparationError):
                    builder.prepare_shots(pack)
                pack = trigger_pack()
                pack["triggers"][0]["durationSeconds"] = duration
                with self.assertRaises(builder.PreparationError):
                    builder.prepare_shots(pack)
                if duration is not None:  # None means no optional global override.
                    with self.assertRaises(builder.PreparationError):
                        builder.prepare_shots(trigger_pack(), duration_seconds=duration)


class PackageTests(unittest.TestCase):
    def setUp(self):
        test_root = Path("I:/AI/asmr_director/qa/h3-asmr/tests") if Path("I:/").is_dir() else Path(__file__).resolve().parents[2] / ".local/tmp/h3-asmr/tests"
        test_root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=test_root)
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / "source.json"
        self.original = ("\ufeff" + json.dumps(source_workflow(), ensure_ascii=False, separators=(",", ":"))).encode("utf-8")
        self.source.write_bytes(self.original)
        self.assets = self.root / "assets"
        self.assets.mkdir()
        for name in ("runner.py", "run.bat", "README.zh.md", "ASMR_BATCH.zh.md", "ASMR_PROMPTS.zh.md"):
            (self.assets / name).write_text(f"portable content for {name}\n", encoding="utf-8")
        builder.write_json(self.assets / "asmr_triggers.json", trigger_pack())
        self.output = self.root / "package"

    def build(self, **kwargs):
        return builder.build_package(self.source, self.output, assets_dir=self.assets, **kwargs)

    def test_package_is_portable_and_source_is_byte_exact(self):
        manifest = self.build()
        self.assertEqual(self.source.read_bytes(), self.original)
        self.assertEqual((self.output / "source_workflow.json").read_bytes(), self.original)
        self.assertEqual(manifest["provenance"]["sourceWorkflowSha256"], hashlib.sha256(self.original).hexdigest())
        self.assertEqual(manifest["generationMode"], "text-to-video")
        self.assertEqual(len(manifest["shots"]), 12)
        self.assertNotIn("characterReference", manifest)
        for shot in manifest["shots"]:
            self.assertEqual((shot["kind"], shot["referenceMode"], shot["durationSeconds"]), ("ambient", "new", 5))
            self.assertNotIn("audio", shot)
            self.assertTrue(shot["prompt"].startswith("integrated_multimodal_description: [Shot 1]"))
            self.assertIn("\n\noverall_soundscape: ", shot["prompt"])
            self.assertTrue(shot["prompt"].endswith("non_diegetic_music: N/A"))
        text = (self.output / "project.json").read_text(encoding="utf-8")
        self.assertNotIn(str(self.root).replace("\\", "\\\\"), text)
        moved = self.root / "moved-package"
        self.output.rename(moved)
        self.source.unlink()
        for key in ("sourceWorkflow", "triggerPack"):
            self.assertTrue((moved / manifest["provenance"][key]).is_file())
        self.assertTrue((moved / manifest["workflow"]).is_file())
        for name in ("runner.py", "run.bat", "README.zh.md", "ASMR_BATCH.zh.md", "ASMR_PROMPTS.zh.md"):
            self.assertEqual((moved / name).read_bytes(), (self.assets / name).read_bytes())

    def test_individual_ui_workflows_change_prompt_seed_prefix_and_repair_slots(self):
        self.build()
        manuals = sorted((self.output / "workflows").glob("*.json"))
        self.assertEqual(len(manuals), 12)
        seen_seeds, seen_prefixes = set(), set()
        for path in manuals:
            manual = builder.read_json(path)
            original = source_workflow()
            original_nodes = {node["id"]: node for node in original["nodes"]}
            nodes = {node["id"]: node for node in manual["nodes"]}
            for link in original["links"]:
                link[4] = next(index for index, item in enumerate(original_nodes[link[3]]["inputs"]) if item["link"] == link[0])
            for node_id, fields in ((26, ["value"]), (10, ["noise_seed", "control_after_generate"]), (24, ["filename_prefix"])):
                for field in fields:
                    builder.set_ui_widget(original_nodes[node_id], field, nodes[node_id]["widgets_values_named"][field])
            self.assertEqual(manual, original)
            seen_seeds.add(nodes[10]["widgets_values_named"]["noise_seed"])
            seen_prefixes.add(nodes[24]["widgets_values_named"]["filename_prefix"])
            self.assertEqual(nodes[10]["widgets_values_named"]["control_after_generate"], "fixed")
            for link in manual["links"]:
                self.assertEqual(nodes[link[3]]["inputs"][link[4]]["link"], link[0])
        self.assertEqual(len(seen_seeds), 12)
        self.assertEqual(seen_seeds, set(range(2, 14)))
        self.assertEqual(len(seen_prefixes), 12)

    def test_original_prompt_is_only_in_provenance_backup(self):
        self.build()
        original_prompt = "原始提示词，保存在原工作流中。"
        for path in [self.output / "project.json", self.output / "workflow_api.json", *list((self.output / "workflows").glob("*.json"))]:
            self.assertNotIn(original_prompt, path.read_text(encoding="utf-8"))
        self.assertIn(original_prompt, (self.output / "source_workflow.json").read_text(encoding="utf-8-sig"))

    def test_nonempty_output_cannot_be_overwritten(self):
        self.output.mkdir()
        marker = self.output / "user-data.txt"
        marker.write_text("keep me")
        with self.assertRaisesRegex(builder.PreparationError, "not an empty directory"):
            self.build()
        self.assertEqual(marker.read_text(), "keep me")
        self.assertEqual(list(self.output.iterdir()), [marker])

    def test_inconsistent_ui_widgets_fail_before_output_is_created(self):
        workflow = source_workflow()
        next(node for node in workflow["nodes"] if node["id"] == 10)["widgets_values"][0] = -1
        builder.write_json(self.source, workflow)
        with self.assertRaisesRegex(builder.PreparationError, "positional/named widgets disagree"):
            self.build()
        self.assertFalse(self.output.exists())

    def test_invalid_prompt_pack_fails_before_output_is_created(self):
        pack = trigger_pack()
        pack["triggers"][1]["id"] = "../escape"
        builder.write_json(self.assets / "asmr_triggers.json", pack)
        with self.assertRaisesRegex(builder.PreparationError, "portable ASCII"):
            self.build()
        self.assertFalse(self.output.exists())

    def test_non_five_second_source_is_preserved_with_its_own_provenance(self):
        workflow = source_workflow()
        node = next(node for node in workflow["nodes"] if node["id"] == 25)
        builder.set_ui_widget(node, "value", 8)
        original = ("\ufeff" + json.dumps(workflow, ensure_ascii=False)).encode("utf-8")
        self.source.write_bytes(original)
        manifest = self.build()
        conversion = manifest["provenance"]["conversion"]
        self.assertEqual((conversion["durationSeconds"], conversion["generationFrames"], conversion["nativeDurationSeconds"]), (8, 192, 8))
        self.assertEqual(manifest["provenance"]["sourceWorkflowSha256"], hashlib.sha256(original).hexdigest())
        self.assertEqual((self.output / "source_workflow.json").read_bytes(), original)
        self.assertEqual(self.source.read_bytes(), original)
        self.assertEqual({shot["durationSeconds"] for shot in manifest["shots"]}, {5})
        self.assertEqual(builder.read_json(self.output / "workflow_api.json")["22"]["inputs"]["length"], 124)

    def test_global_fractional_duration_updates_all_manuals_and_template(self):
        pack = trigger_pack()
        pack["triggers"][0]["durationSeconds"] = 12
        builder.write_json(self.assets / "asmr_triggers.json", pack)
        manifest = self.build(duration_seconds=10.5)
        self.assertEqual({shot["durationSeconds"] for shot in manifest["shots"]}, {10.5})
        self.assertEqual(manifest["provenance"]["durationSecondsOverride"], 10.5)
        self.assertEqual(manifest["provenance"]["conversion"]["durationSeconds"], 5)
        self.assertEqual(builder.read_json(self.output / "workflow_api.json")["22"]["inputs"]["length"], 260)
        for path in (self.output / "workflows").glob("*.json"):
            manual = builder.read_json(path)
            duration_node = next(node for node in manual["nodes"] if node["id"] == 25)
            self.assertEqual(duration_node["widgets_values_named"]["value"], 10.5)
            self.assertEqual(duration_node["widgets_values"], [10.5])
            graph, evidence = builder.convert_ui_workflow(manual)
            self.assertEqual(graph["22"]["inputs"]["length"], 260)
            self.assertEqual(evidence["durationSeconds"], 10.5)
        self.assertEqual(self.source.read_bytes(), self.original)
        self.assertEqual((self.output / "source_workflow.json").read_bytes(), self.original)
        default_identity = "minimax-h3-asmr-" + hashlib.sha256(self.original + (self.assets / "asmr_triggers.json").read_bytes()).hexdigest()[:12]
        self.assertNotEqual(manifest["projectId"], default_identity)

    def test_mixed_trigger_durations_flow_into_manual_graphs(self):
        pack = trigger_pack()
        pack["triggers"] = pack["triggers"][:3]
        pack["triggers"][1]["durationSeconds"] = 8
        pack["triggers"][2]["durationSeconds"] = 12
        builder.write_json(self.assets / "asmr_triggers.json", pack)
        manifest = self.build()
        self.assertEqual([shot["durationSeconds"] for shot in manifest["shots"]], [5, 8, 12])
        for path, duration, frames in zip(sorted((self.output / "workflows").glob("*.json")), (5, 8, 12), (124, 192, 294)):
            manual = builder.read_json(path)
            graph, evidence = builder.convert_ui_workflow(manual)
            self.assertEqual((evidence["durationSeconds"], graph["22"]["inputs"]["length"]), (duration, frames))

    def test_invalid_override_does_not_create_output(self):
        for duration in (0, -1, True, float("nan"), float("inf"), 1e308, 10 ** 1000, 150):
            with self.subTest(duration=duration):
                with self.assertRaises(builder.PreparationError):
                    self.build(duration_seconds=duration)
                self.assertFalse(self.output.exists())

    def test_cli_accepts_duration_override(self):
        with mock.patch.object(builder, "HERE", self.assets), contextlib.redirect_stdout(io.StringIO()):
            result = builder.main([str(self.source), "--output", str(self.output), "--duration-seconds", "10.5"])
        self.assertEqual(result, 0)
        self.assertEqual({shot["durationSeconds"] for shot in builder.read_json(self.output / "project.json")["shots"]}, {10.5})


if __name__ == "__main__":
    unittest.main()
