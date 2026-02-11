

## Fix Auditor Separator Color

**Problem:** The `bg-border` CSS variable resolves to a color that appears bluish against the Auditor header's warm yellow/amber background (`bg-[hsl(var(--status-warning-muted))]`). On the Supervisor header (neutral `bg-card` background), the same color looks grey.

**Fix:** Use a hardcoded neutral grey instead of the theme variable so the separator looks consistently grey regardless of surrounding background color.

**File:** `src/pages/Auditor.tsx`, line 67

**Current:**
```tsx
<Separator orientation="vertical" className="h-6 bg-border" />
```

**Updated:**
```tsx
<Separator orientation="vertical" className="h-6 bg-neutral-300 dark:bg-neutral-600" />
```

This ensures the separator reads as a clean grey divider against the amber/warning background, matching the visual weight of the Supervisor header's separator.

