

## Re-color Auditor Header Separator

**File:** `src/pages/Auditor.tsx`, line 67

**Current:**
```tsx
<Separator orientation="vertical" className="h-5" />
```

**Updated:**
```tsx
<Separator orientation="vertical" className="h-6 bg-border" />
```

**What changes:**
- Height from `h-5` to `h-6` to match the Supervisor header separator
- Explicitly set `bg-border` so the color stays consistent with the Supervisor separator regardless of the Auditor header's warning-toned background

No other files or behavior affected.

