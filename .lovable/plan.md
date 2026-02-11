

## Fix: DEV MODE panels not showing

**Root cause**: The `.env.local` file created in the previous edit doesn't persist in the Lovable environment. Only the `.env` file is used. Since `VITE_DEV_MODE` is not defined in `.env`, it's always `undefined`, so the dev panels never render and the keyboard shortcut listener is never attached.

**Fix**: Add `VITE_DEV_MODE=true` to the main `.env` file. The `.env.production` file already has `VITE_DEV_MODE=false`, which Vite automatically uses for production builds, so production remains safe.

### Changes

1. **`.env`** — Add `VITE_DEV_MODE=true` to the existing file (one line addition)

That's it. The `DevModeLayer` component, the keyboard shortcut, and the `.env.production` override are all already wired correctly. The only missing piece is the variable definition in the base `.env` file.

### Why this is safe
- Vite loads `.env.production` during `vite build`, which sets `VITE_DEV_MODE=false`, overriding the base `.env` value
- In dev (`vite dev`), the base `.env` value of `true` applies
- The Lovable preview environment uses production-mode builds, so it will also get `false`

