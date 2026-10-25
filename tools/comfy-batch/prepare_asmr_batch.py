#!/usr/bin/env python3
"""Build a portable H3 ASMR experiment from the user's UI workflow, offline.

This deliberately supports the supplied MiniMax H3 graph, not arbitrary ComfyUI
UI workflows. Unknown active nodes or ambiguous widget values are errors.
"""
from __future__ import annotations

import argparse
import copy
import hashlib
import json
import math
from pathlib import Path
import re
import shutil
import sys


HERE = Path(__file__).resolve().parent
FRAME_EXPRESSION = "max(5, round(a * 24)) + (5 - (max(5, round(a * 24)) % 17)) % 17"
PROMPT_FIELDS = ("integrated_multimodal_description", "overall_soundscape", "non_diegetic_music")
SOURCE_CLASSES = {
    "2": "VAELoader", "3": "VAELoader", "4": "VAEDecodeAudio", "5": "VAEDecode",
    "6": "KSamplerSelect", "7": "BasicScheduler", "8": "SamplerCustomAdvanced",
    "9": "BasicGuider", "10": "RandomNoise", "11": "CreateVideo",
    "12": "MiniMaxH3FusedModulation", "13": "MiniMaxH3ChunkFeedForward",
    "14": "MiniMaxH3MemoryEfficientSolAttentionPatch", "15": "EasyCache",
    "16": "CLIPLoader", "17": "UNETLoader", "18": "ComfyMathExpression",
    "21": "ResolutionSelector", "22": "MiniMaxH3ReferenceToVideo",
    "24": "SaveVideo", "25": "PrimitiveFloat", "26": "PrimitiveStringMultiline",
}
PRUNED = {"18", "25", "26"}
EXPECTED_WIDGETS = {
    "2": {"vae_name"}, "3": {"vae_name"}, "6": {"sampler_name"},
    "7": {"scheduler", "steps", "denoise"}, "10": {"noise_seed"},
    "11": {"fps", "bit_depth", "color_space", "codec"}, "12": {"enabled"},
    "13": {"enabled", "chunks", "min_tokens"},
    "14": {"enabled", "tau", "min_tokens", "strict", "thresh_type", "int8_qk", "int8_pv", "sink_conditioning", "dense_blocks"},
    "15": {"reuse_threshold", "start_percent", "end_percent", "verbose"},
    "16": {"clip_name", "type", "device"}, "17": {"unet_name", "weight_dtype"},
    "18": {"expression"}, "21": {"aspect_ratio", "megapixels", "multiple"},
    "22": {"prompt", "width", "height", "length", "ref_image_size"},
    "24": {"filename_prefix", "format", "format.codec", "codec"},
    "25": {"value"}, "26": {"value"},
}
# Input names are authoritative: dynamic input expansion can leave stale numeric
# target slots in a saved UI workflow. Every source slot and target node is checked.
EXPECTED_LINKS = {
    ("4", "samples"): ("8", 0), ("4", "vae"): ("3", 0),
    ("5", "samples"): ("8", 0), ("5", "vae"): ("2", 0),
    ("7", "model"): ("15", 0), ("8", "noise"): ("10", 0),
    ("8", "guider"): ("9", 0), ("8", "sampler"): ("6", 0),
    ("8", "sigmas"): ("7", 0), ("8", "latent_image"): ("22", 1),
    ("9", "model"): ("15", 0), ("9", "conditioning"): ("22", 0),
    ("11", "images"): ("5", 0), ("11", "audio"): ("4", 0),
    ("12", "model"): ("14", 0), ("13", "model"): ("12", 0),
    ("14", "model"): ("17", 0), ("15", "model"): ("13", 0),
    ("18", "values.a"): ("25", 0), ("22", "clip"): ("16", 0),
    ("22", "vae"): ("2", 0), ("22", "audio_vae"): ("3", 0),
    ("22", "prompt"): ("26", 0), ("22", "width"): ("21", 0),
    ("22", "height"): ("21", 1), ("22", "length"): ("18", 1),
    ("24", "video"): ("11", 0),
}


class PreparationError(ValueError):
    """A workflow cannot be converted without guessing its execution semantics."""


def read_json(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8-sig"))
    except (OSError, ValueError) as error:
        raise PreparationError(f"Cannot read JSON {path}: {error}") from error


def write_json(path, value):
    Path(path).write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def duration_frames(duration):
    """Apply the source's 24 fps / 17n+5 expression without numeric overflow."""
    if (type(duration) not in (int, float) or duration <= 0
            or (type(duration) is float and not math.isfinite(duration))):
        raise PreparationError("Duration must be a finite positive number (not a boolean).")
    # Check the bound before multiplication or float conversion: a JSON integer
    # can be arbitrarily large, and a finite float can overflow after * 24.
    if duration > 3600 / 24:
        raise PreparationError("Duration exceeds the H3 3600-frame limit.")
    frames = max(5, round(duration * 24))
    frames += (5 - frames % 17) % 17
    if frames > 3600:
        raise PreparationError("Aligned duration exceeds the H3 3600-frame limit.")
    return frames


def convert_ui_workflow(workflow):
    """Return an API graph and conversion evidence without modifying workflow."""
    if not isinstance(workflow, dict) or not isinstance(workflow.get("nodes"), list) or not isinstance(workflow.get("links"), list):
        raise PreparationError("Expected a ComfyUI UI workflow with nodes and links arrays.")
    nodes, inputs, links, target_slot_repairs = {}, {}, {}, []
    for node in workflow["nodes"]:
        if not isinstance(node, dict) or type(node.get("id")) is not int:
            raise PreparationError("Every UI node requires an integer id.")
        node_id = str(node["id"])
        if node_id in nodes:
            raise PreparationError(f"Duplicate node id {node_id}.")
        nodes[node_id] = node
        if node.get("type") == "MarkdownNote":
            continue
        if SOURCE_CLASSES.get(node_id) != node.get("type") or node.get("mode", 0) != 0:
            raise PreparationError(f"Unsupported active/bypassed node {node_id}: {node.get('type')} (mode={node.get('mode', 0)}).")
        node_inputs = node.get("inputs", [])
        if not isinstance(node_inputs, list) or any(not isinstance(item, dict) or not isinstance(item.get("name"), str) for item in node_inputs):
            raise PreparationError(f"Node {node_id} has invalid inputs.")
        inputs[node_id] = {item["name"]: item for item in node_inputs}
        if len(inputs[node_id]) != len(node_inputs):
            raise PreparationError(f"Node {node_id} has duplicate input names.")
        missing = EXPECTED_WIDGETS.get(node_id, set()) - inputs[node_id].keys()
        if missing:
            raise PreparationError(f"Node {node_id} is missing widget inputs: {sorted(missing)}.")
    for node_id, class_type in SOURCE_CLASSES.items():
        if nodes.get(node_id, {}).get("type") != class_type:
            raise PreparationError(f"Required source node {node_id} ({class_type}) is missing.")
    for link in workflow["links"]:
        if not isinstance(link, list) or len(link) != 6 or any(type(value) is not int for value in link[:5]):
            raise PreparationError("Each UI link requires six fields and integer endpoint ids/slots.")
        link_id, source, source_slot, target, target_slot, _ = link
        if link_id in links:
            raise PreparationError(f"Duplicate link id {link_id}.")
        outputs = nodes.get(str(source), {}).get("outputs", [])
        if str(source) not in inputs or str(target) not in inputs or not 0 <= source_slot < len(outputs):
            raise PreparationError(f"Link {link_id} has a missing or unsupported source/target/output slot.")
        links[link_id] = link
    bindings = {}
    for node_id, by_name in inputs.items():
        for slot, (name, item) in enumerate(by_name.items()):
            link_id = item.get("link")
            if link_id is None:
                continue
            if type(link_id) is not int or link_id not in links:
                raise PreparationError(f"Node {node_id}.{name} references a missing link {link_id}.")
            link = links[link_id]
            if str(link[3]) != node_id or link_id in bindings:
                raise PreparationError(f"Link {link_id} has a wrong or ambiguous target binding.")
            bindings[link_id] = (node_id, name)
            if link[4] != slot:
                target_slot_repairs.append({"linkId": link_id, "nodeId": node_id, "input": name, "savedSlot": link[4], "actualSlot": slot})
            if EXPECTED_LINKS.get((node_id, name)) != (str(link[1]), link[2]):
                raise PreparationError(f"Unsupported graph connection at {node_id}.{name}.")
    if set(bindings) != set(links):
        raise PreparationError("Workflow contains unbound or orphan links.")
    for endpoint in EXPECTED_LINKS:
        if inputs.get(endpoint[0], {}).get(endpoint[1], {}).get("link") is None:
            raise PreparationError(f"Required connection {endpoint[0]}.{endpoint[1]} is missing.")

    def widget(node_id, name):
        named = nodes[node_id].get("widgets_values_named")
        if not isinstance(named, dict) or name not in named:
            raise PreparationError(f"Node {node_id} is missing named widget value {name}; positional guessing is unsupported.")
        return copy.deepcopy(named[name])

    expression = widget("18", "expression")
    if not isinstance(expression, str) or "".join(expression.split()) != "".join(FRAME_EXPRESSION.split()):
        raise PreparationError("Unsupported duration expression; refusing to evaluate arbitrary workflow code.")
    duration, fps = widget("25", "value"), widget("11", "fps")
    if fps != 24:
        raise PreparationError("The source frame rate must be 24 fps.")
    frames = duration_frames(duration)
    source_prompt = widget("26", "value")
    if not isinstance(source_prompt, str):
        raise PreparationError("Prompt primitive 26 must contain text.")
    graph = {}
    for node_id, node in nodes.items():
        if node.get("type") == "MarkdownNote" or node_id in PRUNED:
            continue
        named = node.get("widgets_values_named", {})
        if not isinstance(named, dict):
            raise PreparationError(f"Node {node_id} named widgets must be an object.")
        unknown = set(named) - inputs[node_id].keys() - {"control_after_generate"}
        if unknown:
            raise PreparationError(f"Node {node_id} has unsupported widget values with no actual input: {sorted(unknown)}.")
        api_inputs = {}
        for name, item in inputs[node_id].items():
            if item.get("type") == "RESOLUTION_PREVIEW":
                continue
            link_id = item.get("link")
            if link_id is not None:
                link = links[link_id]
                source_id = str(link[1])
                if source_id == "26":
                    api_inputs[name] = source_prompt
                elif source_id == "18":
                    api_inputs[name] = frames
                else:
                    api_inputs[name] = ["26" if source_id == "24" else source_id, link[2]]
            elif "widget" in item:
                if item["widget"].get("name") != name:
                    raise PreparationError(f"Node {node_id}.{name} has an ambiguous widget name.")
                api_inputs[name] = widget(node_id, name)
            elif item.get("shape") != 7:
                raise PreparationError(f"Node {node_id}.{name} is an unconnected required input.")
        graph["26" if node_id == "24" else node_id] = {"class_type": node["type"], "inputs": api_inputs}
    return graph, {
        "durationSeconds": duration, "fps": fps, "generationFrames": frames,
        "nativeDurationSeconds": frames / fps,
        "saveVideoNodeRemap": {"24": "26"},
        "flattenedNodes": ["18", "25", "26"],
        "targetSlotBindingsResolvedByName": target_slot_repairs,
    }


def format_prompt(value):
    if isinstance(value, str) and value.strip():
        return value.strip()
    if isinstance(value, dict) and set(value) == set(PROMPT_FIELDS) and all(isinstance(value[key], str) and value[key].strip() for key in PROMPT_FIELDS):
        return "\n\n".join(f"{key}: {value[key].strip()}" for key in PROMPT_FIELDS)
    raise PreparationError("Each trigger prompt needs text or the three official non-empty prompt fields.")


def prepare_shots(pack, duration_seconds=None):
    if not isinstance(pack, dict) or not isinstance(pack.get("triggers"), list) or not pack["triggers"]:
        raise PreparationError("Trigger pack requires a non-empty triggers list.")
    default_duration = pack.get("durationSeconds", 5)
    duration_frames(default_duration)
    if duration_seconds is not None:
        duration_frames(duration_seconds)
    shots, ids, orders = [], set(), set()
    for trigger in pack["triggers"]:
        if not isinstance(trigger, dict):
            raise PreparationError("Each trigger must be an object.")
        trigger_id, order = trigger.get("id"), trigger.get("order")
        if not isinstance(trigger_id, str) or re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}", trigger_id) is None or trigger_id in ids:
            raise PreparationError("Trigger ids must be unique portable ASCII names (1-64 characters).")
        if type(order) is not int or order <= 0 or order in orders:
            raise PreparationError("Trigger orders must be unique positive integers.")
        for key in ("title", "listeningFocus"):
            if not isinstance(trigger.get(key), str) or not trigger[key].strip():
                raise PreparationError(f"Trigger {trigger_id} requires {key}.")
        duration = trigger.get("durationSeconds", default_duration)
        duration_frames(duration)
        if duration_seconds is not None:
            duration = duration_seconds
        shot = {"id": trigger_id, "order": order, "title": trigger["title"],
                "listeningFocus": trigger["listeningFocus"], "kind": "ambient",
                "referenceMode": "new", "durationSeconds": duration,
                "prompt": format_prompt(trigger.get("prompt"))}
        if "category" in trigger:
            shot["category"] = trigger["category"]
        shots.append(shot)
        ids.add(trigger_id)
        orders.add(order)
    return sorted(shots, key=lambda shot: shot["order"])


def set_ui_widget(node, name, value):
    """Update both representations while preserving all other UI metadata."""
    named = node["widgets_values_named"]
    if not isinstance(named, dict) or name not in named:
        raise PreparationError(f"Node {node['id']} is missing the named UI widget {name}.")
    # Named insertion order matches widgets_values in this explicitly supported
    # source format, including RandomNoise's frontend-only seed control.
    keys = list(named)
    values = node.get("widgets_values")
    if not isinstance(values, list) or len(values) != len(keys) or any(values[index] != named[key] for index, key in enumerate(keys)):
        raise PreparationError(f"Node {node['id']} positional/named widgets disagree; cannot prepare a manual UI workflow safely.")
    values[keys.index(name)] = copy.deepcopy(value)
    named[name] = copy.deepcopy(value)


def build_package(workflow_path, output, trigger_path=None, assets_dir=None, duration_seconds=None):
    workflow_path, output = Path(workflow_path).resolve(), Path(output).resolve()
    assets = Path(assets_dir).resolve() if assets_dir is not None else HERE
    trigger_path = Path(trigger_path).resolve() if trigger_path is not None else assets / "asmr_triggers.json"
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        raise PreparationError(f"Output already exists and is not an empty directory: {output}")
    if output == workflow_path.parent or output == assets:
        raise PreparationError("Output must be a separate package directory.")
    try:
        original = workflow_path.read_bytes()
        workflow = json.loads(original.decode("utf-8-sig"))
    except (OSError, ValueError) as error:
        raise PreparationError(f"Cannot read source workflow: {error}") from error
    graph, conversion = convert_ui_workflow(workflow)
    pack = read_json(trigger_path)
    shots = prepare_shots(pack, duration_seconds=duration_seconds)
    required_assets = ("runner.py", "run.bat", "README.zh.md")
    for name in required_assets:
        if not (assets / name).is_file():
            raise PreparationError(f"Required portable runner asset is missing: {name}")
    source_sha = hashlib.sha256(original).hexdigest()
    pack_bytes = trigger_path.read_bytes()
    pack_sha = hashlib.sha256(pack_bytes).hexdigest()
    identity_bytes = original + pack_bytes
    if duration_seconds is not None:
        identity_bytes += b"\0duration-seconds:" + str(duration_seconds).encode("ascii")
    project_id = "minimax-h3-asmr-" + hashlib.sha256(identity_bytes).hexdigest()[:12]
    manifest = {
        "format": "asmr-video-package", "version": 1, "projectId": project_id,
        "title": pack.get("title", "MiniMax H3 ASMR trigger test"),
        "generationMode": "text-to-video", "workflow": "workflow_api.json",
        "provenance": {"sourceWorkflow": "source_workflow.json", "sourceFileName": workflow_path.name,
                       "sourceWorkflowSha256": source_sha, "triggerPack": "asmr_triggers.json",
                       "triggerPackSha256": pack_sha, "promptSources": pack.get("sources", []),
                       "conversion": conversion},
        "shots": shots,
    }
    if duration_seconds is not None:
        manifest["provenance"]["durationSecondsOverride"] = duration_seconds
    # Precompute every file that needs interpretation before creating output.
    manual_workflows = []
    for shot in shots:
        manual = copy.deepcopy(workflow)
        by_id = {str(node["id"]): node for node in manual["nodes"]}
        manual_links = {link[0]: link for link in manual["links"]}
        for repair in conversion["targetSlotBindingsResolvedByName"]:
            manual_links[repair["linkId"]][4] = repair["actualSlot"]
        set_ui_widget(by_id["26"], "value", shot["prompt"])
        set_ui_widget(by_id["25"], "value", shot["durationSeconds"])
        # Match the existing runner's default --seed 1 plus shot order.
        seed = (1 + shot["order"]) % (2 ** 64)
        set_ui_widget(by_id["10"], "noise_seed", seed)
        set_ui_widget(by_id["10"], "control_after_generate", "fixed")
        set_ui_widget(by_id["24"], "filename_prefix", f"asmr-h3-triggers/{shot['order']:02d}_{shot['id']}")
        manual_workflows.append((f"{shot['order']:02d}_{shot['id']}.json", manual))
    graph["22"]["inputs"]["prompt"] = shots[0]["prompt"]
    graph["22"]["inputs"]["length"] = duration_frames(shots[0]["durationSeconds"])
    graph["26"]["inputs"]["filename_prefix"] = "asmr-h3-triggers/batch"
    output.mkdir(parents=True, exist_ok=True)
    (output / "source_workflow.json").write_bytes(original)
    (output / "asmr_triggers.json").write_bytes(pack_bytes)
    write_json(output / "project.json", manifest)
    write_json(output / "workflow_api.json", graph)
    for name in required_assets:
        shutil.copyfile(assets / name, output / name)
    for name in ("ASMR_PROMPTS.zh.md", "ASMR_BATCH.zh.md"):
        if (assets / name).is_file():
            shutil.copyfile(assets / name, output / name)
    (output / "workflows").mkdir()
    for name, manual in manual_workflows:
        write_json(output / "workflows" / name, manual)
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workflow", type=Path, help="Source ComfyUI UI workflow JSON")
    parser.add_argument("--output", required=True, type=Path, help="New or empty portable package directory")
    parser.add_argument("--triggers", type=Path, help="Override the bundled ASMR trigger pack")
    parser.add_argument("--duration-seconds", type=float, help="Override every trigger duration in seconds (otherwise use each trigger or pack default)")
    args = parser.parse_args(argv)
    try:
        manifest = build_package(args.workflow, args.output, trigger_path=args.triggers, duration_seconds=args.duration_seconds)
    except (PreparationError, OSError, TypeError, KeyError) as error:
        print(f"Preparation failed: {error}", file=sys.stderr)
        return 1
    print(f"Prepared {len(manifest['shots'])} ASMR triggers in {args.output.resolve()}")
    print("Offline only: no model, network request, download or installation was performed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
