# Servo Design System — Color Schema

The single source of truth for Servo's colors is `src/app/globals.css`
(`:root` = light, `.dark` = dark, exposed as Tailwind utilities through
`@theme inline`). This document explains the system so every future feature
uses it consistently — and stays accessible in **both** modes.

Every pairing listed here is verified by `node scripts/color-audit.mjs`
(oklch → sRGB → WCAG 2.1 contrast). **Run it whenever you touch a token**;
the audit must report zero FAILs. Current status: ✅ 0 fails (light, dark,
banner).

## Palette at a glance

| Role | Light | Dark | Rule |
|---|---|---|---|
| `background` / `card` | green-tinted paper `oklch(0.988 0.004 160)` / white | neutral green-grey charcoal `oklch(0.15 0.006 170)` / `0.2` — greys harmonize with the green sidebar | Page vs elevated surface |
| `foreground` | dark green-gray `0.35` | near-white `0.95` | Body text (≥ 10:1) |
| `muted` / `muted-foreground` | cool gray `0.9` / `0.47` | `0.3` / `0.68` | Secondary text ≥ 4.5:1 even **on** `muted` |
| **`primary`** | **Servo green `oklch(0.64 0.165 154)`** | same | **Fills only**: buttons, active bars, count badges. ≥ 3:1 vs page in light |
| `primary-foreground` | dark green ink `0.16` | dark `0.15` | Text **on** green (Spotify-style dark-on-green, ~6.5:1). Never white-on-green |
| `primary-strong` | deep green `0.46` | light green `0.75` | Green used **as text** (links, hovers, icons on surfaces) ≥ 4.5:1 |
| `accent` | pale green `0.93` | deep green `0.32` | Hover washes (menus, rows) |
| `destructive` | red `0.55` | red `0.64` | Errors/Reject; passes as text on card in both modes |
| `sidebar-*` | forest green panel `oklch(0.26 0.055 158)` | deeper `oklch(0.2 0.042 162)` | The Servo brand panel — same hue family as `primary`, tuned per mode; light foregrounds ≥ 12:1 |
| `chart-1..5` | green / indigo / cyan / ochre / purple (darkened for light mode) | brighter steps | Series colors, fixed order, ≥ 3:1 vs card. Use through shadcn `ChartConfig` only |
| `tone-good/warn/serious/critical/violet` (+ `-soft`) | dark text on pastel chip | light text on deep tinted chip | Status badges & highlights via `@/components/legacy/Badge` + `@/lib/labels`. All ≥ 4.5:1 |

## Usage rules

1. **Two greens, two jobs.** `bg-primary` + `text-primary-foreground` for
   filled controls; `text-primary-strong` for green text/icons on light or
   dark surfaces. Never use `text-primary` for copy — it fails contrast on
   light backgrounds by design (it's a fill color).
2. **Status = tones, never raw colors.** Badges and status highlights go
   through the `BadgeTone` maps in `src/lib/labels.ts` (`STATUS_TONE`,
   `PRIORITY_TONE`, `RISK_TONE`) so light/dark variants come free.
3. **Charts speak `--chart-N`.** Series colors only via `ChartConfig`
   (`color: "var(--chart-1)"`); identity keeps a fixed slot (green = the
   "positive/done" series). Text in charts uses ink tokens, never series
   colors.
4. **No raw hex in components.** If a value isn't a token, add a token first
   (light **and** dark) and re-run the audit.
5. **The sidebar is brand-fixed.** It stays deep green in both modes; use
   `sidebar-*` tokens inside it (foreground opacities down to `/50` are
   audited safe; don't go lower for text).
6. **Alpha washes** (`bg-warn-soft/40`-style) are fine for large surfaces,
   but text sitting on them must still be a `tone-*` text token.

## Brand assets

`docs/assets/logo.svg` (wordmark only — no icon, per the brand decision),
`banner.svg` (deep green `#0B1512 → #10231B`, wordmark + tagline, all text
≥ 4.5:1). The wordmark is "Servo" + green period; the green period always
uses the primary green.

## Verifying

```bash
node scripts/color-audit.mjs
```

Add a row to the script's `pair(...)` checks whenever you introduce a new
foreground/background combination.
