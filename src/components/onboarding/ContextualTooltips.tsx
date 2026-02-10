/**
 * ContextualTooltips — Per-role informational tooltips.
 *
 * Shown on first login (when welcome modal was shown).
 * Auto-dismiss after interaction. Never reappear unless onboarding replayed.
 * Uses fixed-position floating tips near the top of each landing page.
 */

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AppRole } from "@/contexts/AuthContext";

const TOOLTIPS_SEEN_KEY = "aidmind_tooltips_seen";

const ROLE_TOOLTIPS: Record<string, string[]> = {
  caseworker: [
    "Derived Signals show policy-based indicators — not saved notes.",
    "Sessions are temporary tool containers. Nothing is stored.",
  ],
  supervisor: [
    "Events show system activity, not case content.",
    "Seen state is local to you and does not change system records.",
  ],
  auditor: [
    "Read-only view. No PHI or case data is accessible.",
    "All activity shown is derived from system events.",
  ],
};

interface ContextualTooltipsProps {
  role: AppRole;
}

export function ContextualTooltips({ role }: ContextualTooltipsProps) {
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  useEffect(() => {
    if (localStorage.getItem(TOOLTIPS_SEEN_KEY) !== "true") {
      setVisible(true);
    }
  }, []);

  if (!visible) return null;

  const tips = ROLE_TOOLTIPS[role] ?? [];
  const activeTips = tips.filter((_, i) => !dismissed.has(i));

  if (activeTips.length === 0) {
    // All dismissed — mark as seen
    localStorage.setItem(TOOLTIPS_SEEN_KEY, "true");
    return null;
  }

  const handleDismiss = (index: number) => {
    const next = new Set(dismissed);
    next.add(index);
    setDismissed(next);
    if (next.size >= tips.length) {
      localStorage.setItem(TOOLTIPS_SEEN_KEY, "true");
    }
  };

  return (
    <div className="flex flex-wrap gap-2 mb-4">
      {tips.map((tip, i) => {
        if (dismissed.has(i)) return null;
        return (
          <div
            key={i}
            className={cn(
              "flex items-center gap-2 px-3 py-2 rounded-lg text-xs",
              "bg-[hsl(var(--status-info-muted))] text-[hsl(var(--status-info-muted-foreground))]",
              "animate-in fade-in slide-in-from-top-2 duration-300"
            )}
          >
            <span>{tip}</span>
            <button
              onClick={() => handleDismiss(i)}
              className="p-0.5 rounded hover:bg-[hsl(var(--status-info)/0.15)] transition-colors"
              aria-label="Dismiss tip"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}

/** Reset tooltips so they re-appear */
export function resetContextualTooltips() {
  localStorage.removeItem(TOOLTIPS_SEEN_KEY);
}
