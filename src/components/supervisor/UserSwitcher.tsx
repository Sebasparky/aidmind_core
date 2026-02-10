/**
 * UserSwitcher — DEPRECATED for production.
 * 
 * Kept as a no-op component to avoid breaking imports.
 * The DevRoleToggle now handles dev-mode role switching.
 */

export function UserSwitcher() {
  // No-op in production auth — DevRoleToggle handles dev-mode switching
  return null;
}
