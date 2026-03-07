

## Problem

The "Generate Case Notes" button is disabled because **no source notes are present** (the notes text is empty or under 20 characters). The permission checkbox is only one of several requirements. The button needs all of these to be true:

1. Notes text >= 20 characters (`notesReady`)
2. Permission checkbox checked (`permissionConfirmed`)
3. Not currently generating
4. Session has a template assigned

The real issue is **missing feedback** — there's no indication of what's still needed beyond the permission checkbox.

## Plan

### 1. Add a disabled-reason hint below the Generate button

When the button is disabled, show a small muted-text line explaining what's still needed:
- "Enter at least 20 characters of source notes" (if `notesReady` is false)
- "Confirm permission above" (if `permissionConfirmed` is false)
- "Assign a template to this session first" (if `hasTemplate === false`)

This keeps the UI calm but gives the user clear guidance on what to do next. Only show the first unmet condition.

### 2. File change

**`src/pages/CaseNotes.tsx`** — Add a small helper text block below the Generate button (around line 772) that conditionally renders a hint when `!canGenerate`.

