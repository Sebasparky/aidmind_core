import type { AppRole } from "@/contexts/AuthContext";

export type TourPlacement = "bottom" | "top" | "left" | "right";

export interface TourStep {
  /** data-tour attribute value to anchor to */
  anchor: string;
  /** Fallback anchor if primary is missing */
  fallbackAnchor?: string;
  /** 3–6 word title */
  title: string;
  /** What this does */
  description: string;
  /** When to use it */
  usage: string;
  /** Optional boundary note */
  boundaryNote?: string;
  /** Preferred placement */
  placement?: TourPlacement;
  /** Tab value to activate before showing this step (supervisor tabs) */
  activateTab?: string;
}

export interface TourConfig {
  role: AppRole;
  steps: TourStep[];
}

export const TOUR_STORAGE_PREFIX = "aidmind_tour_completed_";
export const TOUR_PROGRESS_PREFIX = "aidmind_tour_progress_";
export const TOUR_REPLAY_EVENT = "aidmind:tour-replay";

export function getTourCompletedKey(role: AppRole): string {
  return `${TOUR_STORAGE_PREFIX}${role}_v1`;
}

export function getTourProgressKey(role: AppRole): string {
  return `${TOUR_PROGRESS_PREFIX}${role}_v1`;
}
