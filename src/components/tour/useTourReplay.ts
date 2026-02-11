/**
 * Hook to replay a role's tour by clearing localStorage keys.
 */

import { useCallback } from "react";
import { getTourCompletedKey, getTourProgressKey } from "./types";
import type { AppRole } from "@/contexts/AuthContext";

export function useTourReplay(role: AppRole) {
  const replay = useCallback(() => {
    localStorage.removeItem(getTourCompletedKey(role));
    localStorage.removeItem(getTourProgressKey(role));
    // Force re-render by reloading — simplest approach for portal-based tour
    window.location.reload();
  }, [role]);

  return { replayTour: replay };
}
