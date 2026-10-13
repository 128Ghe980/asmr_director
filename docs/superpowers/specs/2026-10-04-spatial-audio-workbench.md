# Independent spatial audio workbench

2026-10-04. The user requested a separate post-processing webpage with a head model, drawn sound paths and adjustable distance. This belongs to the existing Audio Quality V1 phase; no new roadmap phase is introduced.

`/spatial-studio` accepts browser-decodable audio uploads (80 MiB / 600 seconds), existing local WAVs, or a generated 12-second demo. Dry stereo remains available for comparison; the spatial source explicitly averages all channels to mono. The dependency-free Canvas renderer provides a shaded head, orbit/zoom, top/front views, drawing and draggable handles. Diagram radii are compressed for legibility, while displayed metres remain actual processing parameters. Paths lie in the horizontal ear-level plane.

Orbit/sweep/approach/recede presets support whole-route radial scaling and per-point direction/distance/arrival time. New drawings assign normalized time by path length; position edits preserve explicit timing. Head-centre distances are 0.18–1.75 m. The separate `asmr:spatial-studio:v1` draft persists points/fades, with portable JSON export/import; audio must be reimported after reload.

Rendering uses the existing local original-D HRTF, near-field DVF and room reflections. Users can cancel processing, compare dry/processed playback and export stereo 48 kHz PCM24 WAV. Edits invalidate old output. The 650 ms acoustic tail is retained, with visual motion holding its final position after the source ends.

Shared `{id,t,azimuth,distance}` nodes require 2–128 unique IDs, strictly ascending normalized times and exact 0/1 endpoints. Coordinates are x-front/y-left, with +90° left. Unwrapped azimuth preserves ±180° crossings and complete revolutions. TS and Python share piecewise linear interpolation of angle and radius.

`POST /api/spatial-studio/render` accepts multipart `audio` (mono PCM WAV) or `assetId`, plus `trajectory`, `fadeIn`, `fadeOut`. The established queue, cancellation/timeout and source/code/HRTF/parameter cache identity are reused. Uploads remain in controlled temporary directories and never enter the asset library. Complete WAV and custom trajectory report validation precede cache publication; existing D presets retain their prior behavior.

`GET /api/spatial-studio/assets` lists the latest 40 valid local WAVs without mutation. Rendering advertises a native download URL; `GET /api/spatial-studio/render?key=...` only reads a 64-hex filename within the configured cache and supports repeatable UTF-8 attachments. `GET /api/spatial-studio/trajectory?data=...` validates the strict JSON contract before attachment export. HTTP downloads avoid the in-app browser's Blob-download limitation.

Evidence is in [the development record](../../records/2026-10-04-spatial-audio-workbench.md). Technical validation does not establish user listening acceptance. Vertical motion, multitrack mixing and new SFX generation models are outside this slice.
