/**
 * Hook to replay a role's tour without page reload.
 * Dispatches a custom event that TourController listens for.
 */

import { useCallback } from "react";
import { getTourCompletedKey, getTourProgressKey, TOUR_REPLAY_EVENT } from "./types";
import type { AppRole } from "@/contexts/AuthContext";

export function useTourReplay(role: AppRole) {
  const replay = useCallback(() => {
    localStorage.removeItem(getTourCompletedKey(role));
    localStorage.removeItem(getTourProgressKey(role));
    window.dispatchEvent(new CustomEvent(TOUR_REPLAY_EVENT, { detail: { role } }));
  }, [role]);

  return { replayTour: replay };
}
