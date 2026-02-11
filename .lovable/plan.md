
# Fix: Make AidMind Logo Clearly Visible and Consistently Sized

## Problem
The logo PNG contains both the eye mark and "AidMind" wordmark in one image. At the current Tailwind heights (`h-5` = 20px, `h-7` = 28px), the baked-in text is too small to read -- especially on the Auditor page which uses `sm`.

## Solution

### 1. Increase size presets in `AidMindBrand.tsx`
Update the `sizeMap` to larger, more legible values:
- **sm**: `h-7` (28px) -- used in tight toolbars
- **md**: `h-9` (36px) -- default for all app headers
- **lg**: `h-14` (56px) -- login screen

Keep `min-h-[20px]`, `w-auto`, and `object-contain` unchanged.

### 2. Standardize usage across all headers to `md`
- **Caseworker** (`Header.tsx` line 78): already `size="md"` -- no change needed
- **Supervisor** (`SupervisorHeader.tsx` line 36): already `size="md"` -- no change needed  
- **Auditor** (`Auditor.tsx` line 67): change `size="sm"` to `size="md"` so it matches the other pages

### 3. Files changed
| File | Change |
|------|--------|
| `src/components/brand/AidMindBrand.tsx` | Bump `sm` to `h-7`, `md` to `h-9`, `lg` to `h-14`; update wordmark font sizes to match |
| `src/pages/Auditor.tsx` | Change `size="sm"` to `size="md"` on the `AidMindBrand` in the banner |

No other files, routes, or behaviors change.
