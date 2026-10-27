"""Prepare seven single-pair parameter requests and an eight-row catalog.

Reads completed evidence; never starts models or edits runtime configuration.
"""
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
import wave


QA = Path("I:/AI/asmr_director/qa/reference-tests/japanese-crosslingual-2026-10-26/followup-2026-10-27")
PREVIOUS = QA / "reference-refinement"
OUT = QA / "parameter-sweep"


def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8-sig"))


def sha(path):
    h = hashlib.sha256()
    with Path(path).open("rb") as f:
        for block in iter(lambda: f.read(1024*1024), b""):
            h.update(block)
    return h.hexdigest()


def identity(path):
    path = Path(path).resolve(strict=True)
    return {"path": str(path), "bytes": path.stat().st_size, "sha256": sha(path)}


def verify_recorded(value):
    actual = identity(value["path"])
    if actual["sha256"] != value["sha256"] or actual["bytes"] != value["bytes"]:
        raise ValueError(f"Recorded identity changed: {value['path']}")
    return actual


def wav_info(path):
    with wave.open(str(path), "rb") as f:
        return {"frames": f.getnframes(), "sample_rate": f.getframerate(),
                "channels": f.getnchannels(), "sample_width_bytes": f.getsampwidth(),
                "duration_seconds": f.getnframes()/f.getframerate()}


def write_new(path, data):
    with path.open("x", encoding="utf-8", newline="\n") as f:
        json.dump(data, f, ensure_ascii=False, indent=2, allow_nan=False)
        f.write("\n")


def main():
    sys.stdout.reconfigure(encoding="utf-8")
    catalog_path = PREVIOUS / "manifest.json"
    prior = read(catalog_path)
    lookup = {row["id"]: row for row in prior["references"]}
    sources = {"yukino": lookup["yukino25-gain-minus6"],
               "yui": lookup["yuigahama-25s-full-combined"]}
    package_path = PREVIOUS / "package-receipt.json"
    package = read(package_path)
    reused = next(row for row in package["generated"] if row["id"] == "yuigahama-25s-full-combined")
    reused_files = {key: verify_recorded(reused[key])
                    for key in ("generation_receipt", "source", "raw", "listen")}
    reused_receipt = read(reused_files["generation_receipt"]["path"])
    request = reused_receipt["request"]
    expected_params = {"steps": 600, "timesteps": 10, "cfg": 2,
                       "temperature": 1, "n_gpu_layers": 0, "low_vram": True}
    if (reused_receipt["status"] != "complete" or reused_receipt["exit_code"] != 0
            or request["seed"] != 42 or request["parameters"] != expected_params
            or request["mode"] != "combined" or request["text"] != prior["texts"][0]
            or request["reference"]["promptText"] != sources["yui"]["promptText"]):
        raise ValueError("The previous full-Yui result does not match the reusable baseline")
    if reused_files["source"]["sha256"] != reused_files["raw"]["sha256"]:
        raise ValueError("Delivered raw file differs from the native baseline")
    reused_metrics = {key: wav_info(reused_files[key]["path"]) for key in ("source", "raw", "listen")}
    if any(value["frames"] != 460800 or value["sample_rate"] != 48000
           or value["duration_seconds"] != 9.6 for value in reused_metrics.values()):
        raise ValueError("Expected the complete 9.60-second full-Yui output")
    fixed_sources = {}
    for role, row in sources.items():
        model = identity(row["path"])
        preview = identity(row["sourcePreviewPath"])
        metrics = wav_info(model["path"])
        expected_frames = 401600 if role == "yukino" else 381179
        if metrics["frames"] != expected_frames or metrics["sample_rate"] != 16000:
            raise ValueError("Reference duration changed")
        fixed_sources[role] = {"model": model, "source_preview": preview, "model_metrics": metrics,
                               "promptText": row["promptText"], "seed": 43 if role == "yukino" else 42}
    if fixed_sources["yui"]["model"]["sha256"] != request["reference"]["file"]["sha256"]:
        raise ValueError("Reusable Yui baseline used a different reference")
    plans = [(2, 10, "cfg2-step10", "基准 · CFG 2 / 10 步"),
             (1.5, 10, "cfg1p5-step10", "CFG 1.5 / 10 步"),
             (2.5, 10, "cfg2p5-step10", "CFG 2.5 / 10 步"),
             (2, 20, "cfg2-step20", "CFG 2 / 20 步")]
    rows, pending = [], []
    for role, display in (("yukino", "雪之下"), ("yui", "由比滨")):
        source = sources[role]
        seed = fixed_sources[role]["seed"]
        for cfg, steps, suffix, label in plans:
            identifier = role + "-" + suffix
            reuse = role == "yui" and cfg == 2 and steps == 10
            row = {"id": identifier, "name": display + " · " + label,
                   "role": "yukinoshita" if role == "yukino" else "yuigahama",
                   "label": label + (" · 复用已完成结果" if reuse else ""),
                   "seed": seed, "cfg": cfg, "timesteps": steps,
                   "path": fixed_sources[role]["model"]["path"],
                   "promptText": source["promptText"], "mode": "combined",
                   "sourcePreviewPath": fixed_sources[role]["source_preview"]["path"],
                   "isBaseline": cfg == 2 and steps == 10,
                   "reuseExisting": reuse, "execution": "reuse_existing" if reuse else "new_generation"}
            if reuse:
                row.update(existingReceiptPath=reused_files["generation_receipt"]["path"],
                           existingRawPath=reused_files["raw"]["path"],
                           existingListenPath=reused_files["listen"]["path"],
                           existingReferenceId="yuigahama-25s-full-combined",
                           existingDurationSeconds=9.6)
            else:
                path = OUT / ("guarded-" + identifier + ".json")
                row["manifestPath"] = str(path)
                executable_reference = {key: row[key] for key in ("id", "name", "path", "mode", "promptText")}
                data = {"version": 1, "seed": seed, "cfg": cfg, "timesteps": steps,
                        "references": [executable_reference], "texts": prior["texts"]}
                pending.append({"id": identifier, "manifest": path, "data": data})
            rows.append(row)
    if len(rows) != 8 or len(pending) != 7:
        raise AssertionError("Expected eight catalog rows and seven new runs")
    targets = [x["manifest"] for x in pending] + [OUT / "manifest.json", OUT / "experiment-design.json"]
    if any(path.exists() for path in targets):
        raise FileExistsError("A planned manifest/design already exists; refusing overwrite")
    OUT.mkdir(parents=True, exist_ok=True)
    for item in pending:
        write_new(item["manifest"], item["data"])
    catalog = {"version": 1, "purpose": "Packaging catalog only. Execute the seven single-pair manifests in experiment-design.json; honor per-row seed/cfg/timesteps and Yui baseline reuse.",
               "seed": 42, "cfg": 2, "timesteps": 10, "texts": prior["texts"], "references": rows}
    write_new(OUT / "manifest.json", catalog)
    design = {"version": 1, "prepared_at": datetime.now(timezone.utc).isoformat(),
              "status": "prepared_not_generated", "script": identity(Path(__file__)),
              "source_catalog": identity(catalog_path), "source_package_receipt": identity(package_path),
              "user_feedback": {"yuigahama": "新完整约23.82秒参考生成质量提高，但音色还不算很像。",
                                "yukinoshita": "原25.1秒参考 seed43 的重音较好；参考降低6dB时噪感明显改善。"},
              "design": "Within each role, change one parameter relative to CFG2/timesteps10: CFG1.5, CFG2.5, or timesteps20. No simultaneous CFG+step change.",
              "fixed_references": fixed_sources, "target_text": prior["texts"][0],
              "fixed_parameters": {k: v for k, v in expected_params.items() if k not in ("cfg", "timesteps")},
              "runtime_profile_and_models_recorded_by_reused_baseline": {"files": request["files"], "profile": request["profile"]},
              "sweep": [{"cfg": cfg, "timesteps": steps, "baseline": cfg == 2 and steps == 10} for cfg, steps, _, _ in plans],
              "generation_root": str(OUT / "generation"), "new_run_count": 7, "catalog_row_count": 8,
              "execution_order": [{"order": i+1, "id": x["id"], "manifestPath": str(x["manifest"]),
                                   "manifest_identity": identity(x["manifest"]), "seed": x["data"]["seed"],
                                   "cfg": x["data"]["cfg"], "timesteps": x["data"]["timesteps"]}
                                  for i, x in enumerate(pending)],
              "reused_yui_baseline": {"catalogId": "yui-cfg2-step10", "reason": "Same full reference, prompt, Japanese target, seed42, CFG2 and 10 timesteps; previous run complete.",
                                      "identities": reused_files, "wav_metrics": reused_metrics},
              "new_yukino_baseline_required": "The combination reference -6dB plus seed43 has not been used as this baseline; generate all four Yukino rows anew.",
              "validation": {"all_referenced_files_exist": True, "reuse_hashes_verified": True,
                             "reused_yui_native_and_delivered_raw_identical": True,
                             "reused_yui_source_raw_and_listen_duration_seconds": 9.6,
                             "single_pair_manifests": 7, "unique_catalog_ids": len({x['id'] for x in rows}),
                             "no_models_started": True, "no_audio_modified": True,
                             "runner_timesteps_support_is_external_to_this_preparation": True},
              "notes": ["The catalog's top-level defaults are not execution parameters for every row.",
                        "Yui baseline is explicitly reused, not a newly generated result.",
                        "Increasing flow timesteps is not a promised identity, accent or noise improvement.",
                        "No changes to references, runner, tests, packaging, docs or production profile are made here."]}
    write_new(OUT / "experiment-design.json", design)
    print(json.dumps({"event": "parameter_sweep_prepared", "catalog": str(OUT/"manifest.json"),
                      "design": str(OUT/"experiment-design.json"), "new_runs": design["execution_order"],
                      "reused_yui_baseline": "yui-cfg2-step10"}, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
