

## Login Screen: Logo-only + Card Glow

Two changes to match the reference image:

### 1. Remove wordmark from logo (Login.tsx, line 63-67)

Change `showWordmark={true}` to `showWordmark={false}` so only the eye icon logo displays, centered.

### 2. Add subtle glow behind the card (index.css)

Add a `box-shadow` glow to `.login-card` using a soft blue radial spread, matching the reference image's ambient light effect:

```css
.login-card {
  background: hsl(222 47% 14%);
  border: 1px solid hsl(217 33% 20%);
  border-radius: var(--radius);
  box-shadow:
    0 4px 24px -4px hsl(0 0% 0% / 0.3),
    0 0 80px 20px hsl(217 91% 60% / 0.07),
    0 0 160px 60px hsl(217 91% 60% / 0.04);
}
```

The two extra shadow layers create a soft blue ambient glow radiating outward from the card, similar to the reference.

### Files modified
- `src/pages/Login.tsx` -- one prop change (`showWordmark={false}`)
- `src/index.css` -- extended `box-shadow` on `.login-card`

