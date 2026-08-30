# Hero image

The hero currently uses an inline SVG illustration in `index.html`
(inside `<div class="hero-visual">`).

To use a real photo instead:

1. Drop the file in this folder as `hero.jpg`.
2. In `index.html`, replace the whole `<svg …>…</svg>` inside `.hero-visual` with:

   ```html
   <img src="/hero.jpg" alt="" style="width:100%;height:100%;object-fit:cover;">
   ```

Aim for a landscape photo around 1600×1100, warm and light so the cream
background of the page carries through. Keep the subject roughly centred —
the image is cropped from the sides on wide screens.
