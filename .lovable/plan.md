

## Problem

The Generate button's `disabled` prop has incorrect logic on line 771:

```ts
disabled={!canGenerate && form.permissionConfirmed}
```

This means the button is disabled only when `canGenerate` is false AND permission is checked — the exact opposite of the intended behavior.

## Fix

Change line 771 to:

```ts
disabled={!canGenerate}
```

`canGenerate` already incorporates `form.permissionConfirmed` (line 242-245), so this single check correctly:
- Disables the button when permission is unchecked
- Enables it when permission is checked (and other requirements met)
- Toggling the checkbox toggles the ability to generate

One line change, no other modifications needed.

