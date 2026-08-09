# ButlerBuddy five-state motion assets

This directory keeps the reproducible source and visual QA evidence for the
second-generation ButlerBuddy pet assets used by the application.

## Generation mode

- Generator: built-in OpenAI ImageGen, reference-image editing mode.
- References: the existing five ButlerBuddy state posters.
- Source storyboard: `motion-storyboard-source.png`.
- Alpha storyboard after chroma-key removal: `motion-storyboard-alpha.png`.
- Final browser playback contact sheet: `browser-motion-contact-sheet-v2.png`.

## Final generation prompt

> Create a clean motion storyboard for a tiny 108 x 108 desktop companion using
> the exact same glossy green 3D ButlerBuddy character shown in the five
> references. Use a 5-row by 4-column grid with four sequential animation poses
> per row. Row 1: idle, subtle breathing and a gentle blink. Row 2: working,
> focused rhythmic screen activity. Row 3: celebrating, an energetic happy jump
> that settles back to the start. Row 4: comforting, a calm empathetic sway and
> reassuring expression. Row 5: sleeping, slow peaceful breathing. Keep the
> character identity, proportions, materials, camera, lighting, scale, center
> alignment, and ground anchor consistent in every cell. Use a flat solid
> #ff00ff chroma-key background. No labels, text, borders, props, cast shadows,
> particles, gradients, or background decoration. Make every pose readable at
> very small size and suitable for a seamless looping transparent WebP.

## Rebuild

The alpha storyboard is split, aligned to a shared 512 x 512 canvas, and encoded
as seven-frame animated WebP files by:

```bash
python3 scripts/build_butlerbuddy_motion_assets.py \
  --storyboard artifacts/butlerbuddy-states/motion-storyboard-alpha.png \
  --output public/butlerbuddy/states/v2
```

The script requires Pillow and `img2webp`. It also writes one static 512 x 512
PNG poster per state for `prefers-reduced-motion` users.

## Output contract

| State | Loop duration | Intent |
| --- | ---: | --- |
| `idle` | 3.20 s | Low-frequency breathing and blink |
| `working` | 1.14 s | Responsive, focused activity |
| `celebrating` | 4.00 s | Clear success beat with a held peak |
| `comforting` | 4.00 s | Calm, reassuring sway |
| `sleeping` | 3.85 s | Slow, low-stimulation breathing |

All animated files are transparent, loop indefinitely, contain seven frames,
stay under 500 KB each, and keep the complete set under 3 MB.
