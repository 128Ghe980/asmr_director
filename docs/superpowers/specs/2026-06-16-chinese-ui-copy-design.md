# Chinese UI Copy Design

## Goal

Make the Studio Console read as a Chinese product interface while keeping essential technical abbreviations readable.

## Copy Principle

Use Chinese for visible interface copy. Keep domain abbreviations that are clearer than forced translations: `ASMR`, `JSON`, `dB`, `LUFS`, `seed`.

Button names must be short and direct:

- `导出 JSON`
- `载入`
- `重置`
- `更柔`
- `更近`
- `左耳`
- `右耳`
- `停顿`
- `降低`
- `开始 -0.5秒`
- `开始 +0.5秒`
- `时长 -0.5秒`
- `时长 +0.5秒`

## Scope

Localize visible labels, panel titles, status badges, helper text, placeholders, button labels, track labels, position labels, and validation messages.

Do not rename schema fields, enum values, exported JSON keys, route paths, component names, or test descriptions. Data remains in the Timeline DSL format; only presentation copy changes.

## Components

- Add a small `ui-copy` helper for shared labels and validation-message translation.
- Use the helper in status badges, project header, storyboard, timeline, inspector, validation panel, persistence errors, and position display.
- Keep the existing layout and interaction behavior unchanged.

## Verification

- Unit tests cover the shared copy helpers and updated validation messages.
- Full test, lint, and build must pass.
- Browser check confirms key visible actions are Chinese, no obvious leftover English control labels remain, and desktop/mobile widths do not overflow.
