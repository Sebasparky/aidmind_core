

## Update EyeActivation: Real Spiral Eye + Horizontal Layout

### Changes to `src/components/brand/EyeActivation.tsx`

**A) Replace SVG with spiral eye mark**

The current SVG has 3 simple elements (almond outline, arc, circle). Replace with a multi-layered spiral eye matching the uploaded reference image. The SVG will have ~5 paths:

1. **Outer eye outline** — the almond/leaf shape (outermost contour)
2. **Second band** — inner almond contour (slightly smaller)
3. **Iris ring** — large circle/oval inside the eye
4. **Spiral tail** — the characteristic spiral curl connecting iris to inner band
5. **Pupil/center dot** — small filled or stroked circle at center

All paths use `stroke="currentColor"`, `fill="none"`, `strokeWidth="~4-5"` (scaled to a ~200×120 viewBox for more detail).

**B) Animation classes (5 layers, staggered draw)**

```
.eye-layer-1  stroke-dashoffset animation  0.0s → 0.45s   (outer outline)
.eye-layer-2  stroke-dashoffset animation  0.2s → 0.55s   (second band)
.eye-layer-3  stroke-dashoffset animation  0.4s → 0.75s   (iris ring)
.eye-layer-4  stroke-dashoffset animation  0.55s → 0.85s  (spiral tail)
.eye-layer-5  opacity fade-in              0.85s → 1.0s   (center dot, optional subtle pulse)
```

Each layer uses the same `draw` keyframe (`stroke-dashoffset: 0`). `dasharray` values will be set per-path based on approximate path length.

**C) Layout change: horizontal (eye left, text right)**

Change container from `flex-col` to `flex-row` with `items-center gap-3`.

SVG sized at roughly `w-12 h-12` (48px) to sit beside the text naturally.

**D) Wordmark: no caret**

Remove `border-right` and `blink-caret` animation entirely. Keep only the `typing` width animation (`0ch → 7ch`, `steps(7)`, delay `0.95s`).

**E) No changes to Login.tsx** — the component swap is already done.

### Summary of edits

- **1 file**: `src/components/brand/EyeActivation.tsx` — full rewrite of SVG paths, animation CSS, and layout.

