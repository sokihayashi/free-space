# RISO PRESS

A high-fidelity, browser-based **risograph print simulator** — no install, no server, no plugins.

**Live:** https://sokihayashi.github.io/free-space/

---

## What is Risograph?

Risograph (Riso Kagaku) is a digital duplicator that prints using soy-based inks through a stencil drum, one ink color per pass. Its characteristic look comes from:

- **Halftone dot screening** — tonal variation via dot-size modulation
- **Semi-transparent inks** — colors multiply on impact, overlaps create new hues
- **Plate misregistration** — each color pass shifts slightly, producing colored halos
- **Uncoated paper grain** — visible fiber texture throughout all ink areas

RISO PRESS physically simulates all four of these properties in the browser using the Canvas 2D API.

---

## Features

- **AM halftone engine** — amplitude-modulation dot grid with authentic Riso screen angles
  - Black 45° · Cyan-family 15° · Magenta-family 75° · Yellow 0°
  - Dot radius = √(density/255) × cell_half — preserves tonal area exactly
- **16 authentic Riso Kagaku ink colors** — Fluorescent Pink, Medium Blue, Teal, Burgundy, Gold…
- **Multiply-blend compositing** — transparent ink layering on cream paper (#F5F0E8), matching the physical Riso overprint
- **Per-plate misregistration** — randomized XY offset per ink, scalable from 0–20 px, Y-axis weighted (feed direction)
- **Ink bleed** — Gaussian blur on each halftone layer simulates dot gain / paper absorption
- **Paper grain** — pronounced uncoated-paper noise texture (190–254 value range + 1.5% fiber marks), intensity controllable
- **Paper margin frame** — cream border around output simulates real print margins; included in PNG export
- **Scan bar animation** — per-ink color sweep during rendering, with progress indicator
- **Color separation modes**: Shadows/Highlights · Warm/Cool · RGB Channels
- **6 presets**: TOKYO NIGHT · SUMMER ZINE · LATE NIGHT · BOTANICAL · SUNSET · RISOTTO
- **2 or 3 ink plates** — add or remove ink layers
- Drag & drop · file upload · clipboard paste (⌘V / Ctrl+V)
- One-click **Save PNG** export (with paper margin)

---

## How It Works

```
Source photo
  ↓
Luminance map (per-pixel, 0–255)
  ↓
Color separation → N density plates
  Shadows/Highlights: plate_i = pow((1-t), 0.75) × 255  (gamma curve)
  ↓
Per-plate AM halftone (angled dot grid)
  For each cell in rotated screen grid:
    density = box-average of plate pixels in cell
    dot_radius = sqrt(density / 255) × half_cell
  ↓
Ink bleed: Gaussian blur(blurPx) on each plate canvas
  ↓
Multiply composite on paper background
  ctx.globalCompositeOperation = 'multiply'
  Each layer drawn with misregistration offset: dir × misreg_px
  ↓
Paper grain overlay (grainAmount × multiply)
  ↓
Output PNG
```

---

## Controls

| Control | Range | Effect |
|---------|-------|--------|
| Cell Size | 4–24 px | Halftone screen frequency — smaller = finer detail |
| Misregistration | 0–20 px | Plate offset distance (randomize button rerolls directions) |
| Ink Bleed | 0–3 px | Gaussian blur radius on halftone dots |
| Paper Grain | 0–100% | Multiply intensity of uncoated-paper texture |
| Color Split | 3 modes | How the source image is separated into ink plates |

---

## Tech Stack

Pure HTML + Canvas 2D — zero dependencies, zero build step.

---

## Also in this repo

**[STATION MAP](./station/)** — 文字を地図そのものに変換するカバー画像ジェネレータ（p5.js）。
街区の再帰分割による都市生成と、字形の骨格抽出による路線図生成。
