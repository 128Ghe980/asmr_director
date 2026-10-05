# 2026-10-04 — Real SFX acquisition and personal-care audition

## Superseding status — 2026-10-05 / 最新状态

用户反馈 **“相当烂，没法用，先这样吧，记录一下推一版”**，指的是分开的模型实验中
三条远端 AudioLDM2 8 秒刷耳输出：全部拒绝、不可用，本机 0 / 远端 3，没有采用。
后续模型测试暂停；Stable Audio Open 仅完成适配器/监督器准备，从未执行真实推理，
5070 Ti 主机问题不再是下一步待答事项。此处的 **13 条 CC0 录音试听库是独立来源，
仍待听感确认**，不能把模型样本拒绝结论套用于录音库。已授权记录与推送，本条不宣称
提交或推送完成。下面取得与验证数据属于 2026-10-04 历史记录。

All three remote model-generated brush takes were rejected as unusable; future
model tests are paused. This recorded CC0 library remains separate and pending.
See the [model experiment status](2026-10-04-audio-quality-v1-sfx-model-test.md).

The user asked to start expanding ASMR effects, inventory the current sounds and identify acquisition routes, then selected **贴耳护理：掏耳、刷耳、按摩、喷雾**.

This remains an acquisition/listening slice of the existing Audio Quality V1 stage. Production SFX library selection/adoption is not completed.

## Historical result — 2026-10-04

- Production code remains unchanged: the five demo names still use procedural audio, with only tapping/rustling branches and one rain algorithm.
- Recovered and verified six already-downloaded CC0 recordings in the old runtime licensed library: blanket, clothing, wood taps, desk taps and two rain backgrounds. All are HQ MP3 preview sources converted to WAV.
- Downloaded **seven new CC0 HQ MP3 previews**: cotton-swab ear cleaning, ear rubbing/tapping, two hand-friction massage actions, spray bottle, short brushing and fabric-mat brushing. The latter two are generic alternatives, not verified ear-brushing recordings. No genuine binaural provenance is inferred from stereo output.
- Saved seven source-page HTML snapshots, source MP3s and per-item SHA/provenance records. Existing library source files and manifest remain unchanged.
- Prepared **13 pending audition entries / eight descriptive categories**, with new personal-care candidates first. Each has a dry WAV and a separate volume-adjusted audition WAV, all 48 kHz stereo PCM16. The output catalog is independent of project JSON and VoxCPM2 candidates.
- Added the reproducible [preparation helper](../../tools/sfx-library/prepare_listening.py) and [source definitions](../../tools/sfx-library/sources.json). Acquisition/source limitations are documented in [English](../audio-quality/FREE_ASSET_ACQUISITION.md) / [中文](../audio-quality/FREE_ASSET_ACQUISITION.zh.md).

## Quality and scope

No user listening acceptance is claimed. Some new previews are extremely quiet: slow hands around -79 dBFS RMS and short brushing around -63 dBFS RMS. Audition copies adjust gain only toward -30 dBFS RMS with a -6 dBFS peak ceiling; original dry files remain available through card details. Amplification can expose noise/quantization artifacts and is not a quality fix. Actual ear brushing remains a sourcing gap.

During this acquisition slice, no local SFX model, model-term acceptance, generation, paid service, account login, project adoption or voice-candidate mutation occurred. The dirty old round-one worktree was only read for context. The complete Owlish Media pack transfer was canceled; a 5 MiB incomplete `.part` is preserved outside the listening directory and is not counted as acquired audio. All large output is on I: because D: remained low on free space at that checkpoint.

## Historical verification — 2026-10-04

- Helper input validation, `--help`, Python 3.11 syntax compilation and actual execution/reuse pass. I: lacks hard-link support, so immutable publication uses Windows rename with no destination replacement. Old Anaconda Python is below the helper's supported Python 3.9+ requirement; the actual run uses Python 3.11.
- **26 WAV files** pass SHA-256, PCM format and frame checks. Every audition retains its dry source's frame count and stays within the peak ceiling; no dry source clips. Seven new MP3 SHA values and seven source-page/provenance records are retained.
- **13 existing files** (six original MP3s, six existing WAVs, manifest) match the before-run hashes and sizes.
- Real headless Edge playback decodes all 13 audition WAVs, advances time, stops the previous player and pauses hidden audio. Search, category and empty states pass; 1280/390/320 px have no horizontal overflow, final browser console/page errors are empty. Screenshot was visually inspected. This is technical playback verification, not subjective hearing approval.
- No web product files changed, so no production build or application suite rerun is claimed. No commit/push in this slice.

Evidence: `I:/AI/asmr-director-sfx-expansion/2026-10-04/{asset-verification.json,browser-verification.json,existing-assets-before.json,listening-preview.png}`. Output: `.../listening/{catalog.json,index.html,assets}`.

Preview: [http://127.0.0.1:8768/](http://127.0.0.1:8768/), read-only listening server PID **6852** at verification. Restart with the command in the acquisition notes; do not confuse this server with the main production port 3001.

Remaining acquisition work within the same stage: evaluate these recorded sounds, find a real ear-brushing recording, then integrate an explicit library preview/adoption/undo/provenance workflow. These are recorded-library follow-ups, not instructions to resume paused model tests. Existing candidate format accepts only VoxCPM2 voice; non-voice spatial processing also remains unfinished.
