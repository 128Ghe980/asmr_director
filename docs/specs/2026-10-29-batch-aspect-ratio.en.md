# Batch runner portrait and landscape selection

Date: 2026-10-29. Scope: the existing ComfyUI runner within Audio Quality V1.

The GUI exposes portrait 9:16, landscape 16:9, and project/original settings. Starting a real batch remembers the choice per project; dry-run does not save preferences. CLI `--aspect-ratio portrait|landscape|workflow` overrides the optional package `aspectRatio`; an omitted option uses the package default, while explicit `workflow` restores the legacy behavior.

When MiniMax width and height directly connect to outputs 0/1 of one `ResolutionSelector`, explicit presets change its `aspect_ratio` and preserve `megapixels` and `multiple`. The standard reference template has no selector and uses 672×1216 or 1216×672, approximate ratios aligned to multiples of 32. Source workflow files remain unchanged.

Old packages retain default dimensions and task fingerprints. Explicit presets cannot be combined with `--width/--height`; custom dimensions require `--aspect-ratio workflow`. Main videos and ASMR trigger videos receive the same effective dimensions. Fingerprints distinguish changed dimensions/node settings; switching back restores compatible historical candidates and both preview variants. Unknown remote jobs are reconciled before submission.

No new model/node dependencies or changes to audio processing, script, candidate count, or default seed. A new package may declare `"aspectRatio": "portrait"`. The web exporter dynamically bundles current runner files without a web service restart.
