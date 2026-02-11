/**
 * TourController — Orchestrates the guided tour for a specific role.
 *
 * - Reads/writes localStorage for completion and progress
 * - Locates anchor elements via data-tour attributes
 * - Gracefully skips missing anchors (with fallback)
 * - Manages spotlight overlay + popover positioning
 * - Auto-switches tabs via activateTab on steps
 * - Repositions on scroll/resize
 * - Supports instant replay via custom event (no page reload)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { TourSpotlight } from "./TourSpotlight";
import { TourPopover } from "./TourPopover";
import { tourConfigs } from "./tour-steps";
import { getTourCompletedKey, getTourProgressKey, TOUR_REPLAY_EVENT } from "./types";
import type { AppRole } from "@/contexts/AuthContext";
import type { TourStep } from "./types";

interface TourControllerProps {
  role: AppRole;
  /** Optional callback to programmatically switch tabs */
  onActivateTab?: (tabValue: string) => void;
}

function findAnchor(anchor: string): HTMLElement | null {
  return document.querySelector(`[data-tour="${anchor}"]`);
}

function resolveElement(step: TourStep): HTMLElement | null {
  return findAnchor(step.anchor) || (step.fallbackAnchor ? findAnchor(step.fallbackAnchor) : null);
}

export function TourController({ role, onActivateTab }: TourControllerProps) {
  const config = tourConfigs[role];
  const [active, setActive] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [replayNonce, setReplayNonce] = useState(0);
  const rafRef = useRef<number>();
  const [positioned, setPositioned] = useState(false);

  const completedKey = getTourCompletedKey(role);
  const progressKey = getTourProgressKey(role);

  const steps = config?.steps ?? [];

  // Helper: wait for a tour anchor to be measurable before proceeding
  const waitForTarget = useCallback(
    (step: TourStep, timeoutMs = 2000): Promise<DOMRect | null> => {
      return new Promise((resolve) => {
        const start = Date.now();
        let lastRect: DOMRect | null = null;
        let stableCount = 0;

        function check() {
          const el = resolveElement(step);
          if (el) {
            const rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              if (
                lastRect &&
                Math.abs(rect.top - lastRect.top) < 2 &&
                Math.abs(rect.left - lastRect.left) < 2
              ) {
                stableCount++;
              } else {
                stableCount = 0;
              }
              lastRect = rect;
              if (stableCount >= 2) {
                resolve(rect);
                return;
              }
            }
          }
          if (Date.now() - start > timeoutMs) {
            resolve(lastRect);
            return;
          }
          requestAnimationFrame(check);
        }
        requestAnimationFrame(check);
      });
    },
    []
  );

  // Auto-start on first login — only if welcome modal was acknowledged
  useEffect(() => {
    if (!config || steps.length === 0) return;
    const completed = localStorage.getItem(completedKey) === "true";
    if (completed) return;

    // Gate: don't auto-start unless welcome was explicitly acknowledged
    const welcomeAck = localStorage.getItem("aidmind_welcome_ack_v1");
    if (welcomeAck !== "true") return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      const savedProgress = localStorage.getItem(progressKey);
      const startIndex = savedProgress ? Math.min(parseInt(savedProgress, 10), steps.length - 1) : 0;
      const step = steps[startIndex];

      // Wait for target to be stable before showing
      if (step) {
        const rect = await waitForTarget(step);
        if (cancelled) return;
        if (rect) {
          setTargetRect(rect);
          setPositioned(true);
        }
      }

      setCurrentIndex(startIndex);
      setActive(true);
    }, 800);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [config, completedKey, progressKey, steps.length, replayNonce, waitForTarget]);

  // Listen for replay events
  useEffect(() => {
    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.role !== role) return;

      // Reset tour state without reload
      setActive(false);
      setCurrentIndex(0);
      setTargetRect(null);
      setPositioned(false);
      setReplayNonce((n) => n + 1);

      // Wait for first step target before showing
      const step = steps[0];
      if (step) {
        const rect = await waitForTarget(step);
        if (rect) {
          setTargetRect(rect);
          setPositioned(true);
        }
      }

      setActive(true);
    };

    window.addEventListener(TOUR_REPLAY_EVENT, handler);
    return () => window.removeEventListener(TOUR_REPLAY_EVENT, handler);
  }, [role, steps, waitForTarget]);

  // When step changes, activate the required tab then scroll element into view
  useEffect(() => {
    if (!active || steps.length === 0) return;

    const step = steps[currentIndex];
    if (!step) return;

    // Activate tab if needed
    if (step.activateTab && onActivateTab) {
      onActivateTab(step.activateTab);
    }

    // For step 0 when already positioned by waitForTarget, skip re-measure
    if (currentIndex === 0 && positioned) {
      setPositioned(false); // consume the flag
      return;
    }

    // Wait a tick for DOM to settle after tab switch, then find + scroll
    const timer = setTimeout(() => {
      const el = resolveElement(step);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
        // Wait for scroll to finish before measuring
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            setTargetRect(el.getBoundingClientRect());
          });
        });
      } else {
        // No anchor found — show centered (null rect)
        setTargetRect(null);
      }
    }, 150);

    return () => clearTimeout(timer);
  }, [active, currentIndex, steps, onActivateTab, positioned]);

  // Reposition on scroll/resize
  const updateRect = useCallback(() => {
    if (!active || steps.length === 0) return;
    const step = steps[currentIndex];
    if (!step) return;
    const el = resolveElement(step);
    if (el) {
      setTargetRect(el.getBoundingClientRect());
    }
  }, [active, currentIndex, steps]);

  useEffect(() => {
    const handleUpdate = () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updateRect);
    };
    window.addEventListener("scroll", handleUpdate, true);
    window.addEventListener("resize", handleUpdate);
    return () => {
      window.removeEventListener("scroll", handleUpdate, true);
      window.removeEventListener("resize", handleUpdate);
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [updateRect]);

  // Save progress
  useEffect(() => {
    if (active) {
      localStorage.setItem(progressKey, String(currentIndex));
    }
  }, [active, currentIndex, progressKey]);

  const handleNext = useCallback(() => {
    if (currentIndex < steps.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    }
  }, [currentIndex, steps.length]);

  const handleBack = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex((prev) => prev - 1);
    }
  }, [currentIndex]);

  const handleSkip = useCallback(() => {
    setActive(false);
    localStorage.setItem(completedKey, "true");
    localStorage.removeItem(progressKey);
  }, [completedKey, progressKey]);

  if (!active || steps.length === 0) return null;

  const currentStep = steps[currentIndex];
  if (!currentStep) return null;

  return createPortal(
    <>
      <TourSpotlight targetRect={targetRect} visible={active} />
      <TourPopover
        step={currentStep}
        stepIndex={currentIndex}
        totalSteps={steps.length}
        targetRect={targetRect}
        onNext={handleNext}
        onBack={handleBack}
        onSkip={handleSkip}
        isFirst={currentIndex === 0}
        isLast={currentIndex === steps.length - 1}
      />
    </>,
    document.body
  );
}
