

## Animated Eye Logo for Login Screen

### What Changes

Replace the static `AidMindBrand` logo on the login page with a custom inline SVG eye animation + CSS typing wordmark. The animation runs once on page load (~1.4s), then becomes fully static.

### New Component

**`src/components/brand/EyeActivation.tsx`**

A self-contained React component with inline SVG and scoped CSS keyframes:

1. **SVG Structure** — three elements drawn with `stroke-dasharray`/`stroke-dashoffset`:
   - Outer eye outline (almond shape)
   - Inner arc (upper lid detail)
   - Center ring (the "awareness" circle)

2. **Draw Animation Timing**:
   - `0–0.5s`: Outer eye outline draws via dashoffset → 0
   - `0.45–0.8s`: Inner arc draws (slight overlap for fluidity)
   - `0.85–1.05s`: Center ring fades in (opacity 0→1)
   - `1.05–3s`: Center ring does one very subtle scale pulse (1→1.12→1), then stops

3. **Wordmark Typing** (`<span>`):
   - Starts at `0.9s` delay
   - CSS `steps(7)` animation on `width: 0ch → 7ch` over ~0.5s
   - Thin caret via `border-right`, blink animation that stops after typing completes (use `animation-iteration-count` or `forwards` fill to freeze)

4. **All CSS**: Defined in a `<style>` tag within the component (or as CSS-in-JS via a scoped class block in `index.css`). No external libraries.

5. **Color**: Uses `currentColor` inheriting from the login page's light-on-dark scheme (`hsl(210,40%,98%)`).

### Login Page Update

**`src/pages/Login.tsx`** — lines 61–68:

Replace:
```tsx
<div className="flex justify-center mb-10">
  <AidMindBrand size="lg" showWordmark={false} className="..." />
</div>
```

With:
```tsx
<div className="flex justify-center mb-10">
  <EyeActivation />
</div>
```

Remove the `AidMindBrand` import (if no longer used on this page).

### Layout

The component renders as a centered flex column:
```
   [SVG Eye ~120×60]
      AidMind
```

Eye SVG sized at roughly `w-28 h-14` (112×56px). Wordmark below in `text-2xl font-semibold tracking-tight` matching the existing brand typography.

### Technical Details

- All animations use `animation-fill-mode: forwards` so elements stay visible after drawing
- SVG paths start with `opacity: 0` or full `stroke-dashoffset`, animated to final state
- The pulse on the center ring uses `transform-origin: center` and a very gentle keyframe
- Caret uses `border-right: 2px solid currentColor` with a blink keyframe that runs 2-3 times then stops via `animation-iteration-count: 3`
- `overflow: hidden` on the wordmark container to hide text beyond current width during typing
- No `useEffect` or JS timers needed — pure CSS animation driven by `animation-delay`

