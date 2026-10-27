"""Prepare five text-only changes to the accepted Yui02 reference setup.

The master manifest is an orchestration index, not a model-runner input.
Only each one-reference/one-text guarded manifest is executable.
"""
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
import unicodedata
import wave


FOLLOWUP = Path("I:/AI/asmr_director/qa/reference-tests/japanese-crosslingual-2026-10-26/followup-2026-10-27")
BASE = FOLLOWUP / "yui-reference-02"
ROOT = FOLLOWUP / "yui-reference-02-sentences"
TEMPLATE = BASE / "guarded-yui-reference-02.json"
PREVIOUS_REQUEST = BASE / "generation/audio/yui-reference-02/japanese-paragraph/take-001/request.json"
PREVIOUS_PREPARATION = BASE / "preparation.json"
DESIGN = ROOT / "design.json"
MASTER = ROOT / "manifest.json"
RECEIPT = ROOT / "preparation.json"
TEXTS = [
    {"id": "greeting", "label": "打招呼", "text": "あ、来てくれたんだ。待ってたよ。隣、座ってもいい？", "translation": "啊，你来了。我一直在等你。我可以坐你旁边吗？"},
    {"id": "invitation", "label": "邀约", "text": "ねえ、帰りに少し寄り道しない？駅前のお店に、新しいケーキがあるんだって。", "translation": "回去时要不要顺路逛一下？听说车站前的店出了新蛋糕。"},
    {"id": "concern", "label": "关心", "text": "今日、ちょっと元気ないね。無理して笑わなくてもいいんだよ。話したくなったら、私でよければ聞くから。", "translation": "你今天有点没精神。不用勉强笑，想说的时候，我可以听你聊。"},
    {"id": "shy", "label": "害羞", "text": "そんなふうに言われると、ちょっと照れるよ。でも、ちゃんと伝えてくれて嬉しい。", "translation": "被你这么说有点害羞，不过你愿意告诉我，我很开心。"},
    {"id": "comfort", "label": "安慰", "text": "今日はもう、ゆっくり休もうよ。明日のことは、明日考えればいいって。眠くなるまで、もう少しだけ一緒にいよう。", "translation": "今天就好好休息吧，明天的事明天再想。睡意来之前，再一起待一会儿。"},
]


def identity(path):
    path = Path(path)
    h = hashlib.sha256()
    with path.open("rb") as f:
        for block in iter(lambda: f.read(1024 * 1024), b""):
            h.update(block)
    return {"path": str(path), "bytes": path.stat().st_size, "sha256": h.hexdigest()}


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def save_json(path, value):
    with path.open("x", encoding="utf-8", newline="\n") as f:
        json.dump(value, f, ensure_ascii=False, indent=2, allow_nan=False)
        f.write("\n")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    products = [MASTER, DESIGN, RECEIPT, *[ROOT / ("guarded-" + t["id"] + ".json") for t in TEXTS]]
    if any(path.exists() for path in products):
        raise FileExistsError("Sentence preparation products exist; refusing overwrite")
    if len(TEXTS) != 5 or len({t["id"] for t in TEXTS}) != 5 or len({t["text"] for t in TEXTS}) != 5:
        raise ValueError("Expected five distinct target ids and Japanese texts")
    for row in TEXTS:
        target = row["text"]
        if target != target.encode("utf-8").decode("utf-8") or "\ufffd" in target:
            raise ValueError("Invalid target Unicode")
        if any(unicodedata.category(c).startswith("C") for c in target):
            raise ValueError("Target contains unexpected control characters")
        if not any("\u3040" <= c <= "\u30ff" for c in target) or any(c in target for c in "[]<>"):
            raise ValueError("Expected plain Japanese target without style tags")
    template = read_json(TEMPLATE)
    previous = read_json(PREVIOUS_REQUEST)["request"]
    preparation = read_json(PREVIOUS_PREPARATION)
    if (template["seed"], template["cfg"], template["timesteps"]) != (42, 2.5, 10):
        raise ValueError("Baseline manifest parameters changed")
    if len(template["references"]) != 1 or len(template["texts"]) != 1:
        raise ValueError("Expected single-reference/single-text template")
    ref = template["references"][0]
    if ref["id"] != "yui-reference-02" or ref["mode"] != "combined" or ref["promptText"] != previous["reference"]["promptText"]:
        raise ValueError("Exact Yui02 reference/prompt/mode changed")
    if ref["name"] != previous["reference"]["name"] or Path(ref["path"]) != Path(previous["reference"]["file"]["path"]):
        raise ValueError("Reference name/path changed")
    fixed_parameters = {"steps": 600, "timesteps": 10, "cfg": 2.5, "temperature": 1, "n_gpu_layers": 0, "low_vram": True}
    if previous["parameters"] != fixed_parameters or previous["seed"] != 42 or previous["mode"] != "combined":
        raise ValueError("Previous successful generation parameters changed")
    if preparation["model_static_gain"] != 1.0 or not preparation["full_input_used"]:
        raise ValueError("Expected full original-level Yui02 preparation")
    observed = {
        "source": identity(preparation["source"]["path"]),
        "input": identity(ref["path"]),
        "preview": identity(preparation["source_preview"]["path"]),
        "profile": identity(previous["profile"]["path"]),
        "template": identity(TEMPLATE),
        "previous_request": identity(PREVIOUS_REQUEST),
        "source_asr": identity(BASE / "source-asr.json"),
    }
    expected_shas = {"source": preparation["source"]["sha256"], "input": previous["reference"]["file"]["sha256"],
                     "preview": preparation["source_preview"]["sha256"], "profile": previous["profile"]["sha256"]}
    for role, digest in expected_shas.items():
        if observed[role]["sha256"] != digest:
            raise ValueError(f"Previously verified {role} identity changed")
    with wave.open(ref["path"], "rb") as f:
        fmt = {"sample_rate": f.getframerate(), "channels": f.getnchannels(), "sample_width_bytes": f.getsampwidth(), "frames": f.getnframes()}
    if fmt != {"sample_rate": 16000, "channels": 1, "sample_width_bytes": 2, "frames": 323501}:
        raise ValueError("Unexpected full Yui02 input format")

    ROOT.mkdir(parents=True, exist_ok=True)
    sentences = []
    for row in TEXTS:
        manifest = deepcopy(template)
        manifest["texts"] = [{"id": row["id"], "text": row["text"]}]
        restored = deepcopy(manifest)
        restored["texts"] = template["texts"]
        if restored != template:
            raise ValueError("A manifest changed more than target text")
        manifest_path = ROOT / ("guarded-" + row["id"] + ".json")
        save_json(manifest_path, manifest)
        if read_json(manifest_path) != manifest:
            raise ValueError("Manifest Unicode JSON readback changed")
        take_dir = ROOT / "generation/audio" / ref["id"] / row["id"] / "take-001"
        sentences.append({**row, "manifest": identity(manifest_path), "reference_id": ref["id"],
                          "expected_take_directory": str(take_dir), "expected_generated_wav": str(take_dir / "generated.wav"),
                          "text_utf8_sha256": hashlib.sha256(row["text"].encode("utf-8")).hexdigest(),
                          "status": "prepared_not_generated", "labels_describe_text_only": True})
    master = {"version": 1, "kind": "orchestration_index", "executable": False,
              "execution": "Only one listed guarded manifest is executable at a time. Do not pass this master index to the model runner.",
              "model_calls_prepared": 5, "reference_id": ref["id"], "jobs": sentences}
    save_json(MASTER, master)
    after = {role: identity(item["path"]) for role, item in observed.items()}
    if after != observed:
        raise ValueError("Source/input/profile or prior evidence changed")
    design = {"version": 1, "experiment_date_local": "2026-10-28", "status": "prepared_not_generated",
              "user_feedback": "New Yui02 reference sounds slightly more similar; try several different sentences.",
              "master_is_executable": False, "execution": master["execution"], "master": identity(MASTER),
              "fixed": {"seed": 42, "cfg": 2.5, "timesteps": 10, "mode": "combined", "parameters": fixed_parameters,
                        "reference": deepcopy(ref), "reference_gain_db": 0, "input": observed["input"],
                        "input_format": fmt, "profile": observed["profile"]},
              "reference": deepcopy(ref), "sentences": sentences, "changed": "Target text only; reference identity, name, prompt and all generation settings remain unchanged.",
              "text_labels_are_categories_not_emotion_controls": True, "style_tags_added": False,
              "source_transcript_reused": True, "source_asr_rerun": False,
              "prior_successful_request": observed["previous_request"], "source_preparation": identity(PREVIOUS_PREPARATION),
              "subjective_assessment": "awaiting generation and user listening"}
    save_json(DESIGN, design)
    report = {"version": 1, "status": "prepared_not_generated", "experiment_date_local": "2026-10-28",
              "prepared_at": datetime.now(timezone.utc).isoformat(), "sources_before": observed, "sources_after": after,
              "all_source_input_profile_sha_preserved": True, "all_targets_distinct": True,
              "all_targets_valid_utf8_plain_japanese": True, "all_manifests_changed_text_only": True,
              "all_reference_name_path_prompt_mode_preserved": True, "all_parameters_preserved": True,
              "manifest_count": len(sentences), "manifests": [s["manifest"] for s in sentences],
              "master": identity(MASTER), "design": identity(DESIGN), "script": identity(Path(__file__)),
              "tts_runs": 0, "asr_runs": 0, "audio_conversions": 0, "source_asr_rerun": False,
              "notes": ["No audio is generated or modified by this script.",
                        "Only individual guarded manifests contain the runner's references/texts schema.",
                        "Target labels describe sentence content and do not assert controllable generated emotion."]}
    save_json(RECEIPT, report)
    print(json.dumps({"status": "prepared", "receipt": str(RECEIPT), "design": str(DESIGN), "master": str(MASTER),
                      "reference_sha256": observed["input"]["sha256"], "profile_sha256": observed["profile"]["sha256"],
                      "targets": [{"id": s["id"], "manifest": s["manifest"]["path"], "expected_generated_wav": s["expected_generated_wav"]} for s in sentences],
                      "source_input_profile_preserved": True}, ensure_ascii=False))


if __name__ == "__main__":
    main()
