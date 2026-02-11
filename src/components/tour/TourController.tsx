/**
 * TourController — Orchestrates the guided tour for a specific role.
 *
 * - Reads/writes localStorage for completion and progress
 * - Locates anchor elements via data-tour attributes
 * - Gracefully skips missing anchors
 * - Manages spotlight overlay + popover positioning
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { TourSpotlight } from "./TourSpotlight";
import { TourPopover } from "./TourPopover";
import { tourConfigs } from "./tour-steps";
import { getTourCompletedKey, getTourProgressKey } from "./types";
import type { AppRole } from "@/contexts/AuthContext";
import type { TourStep } from "./types";

interface TourControllerProps {
  role: AppRole;
}

function findAnchor(anchor: string): HTMLElement | null {
  return document.querySelector(`[data-tour="${anchor}"]`);
}

function getVisibleSteps(steps: TourStep[]): { step: TourStep; element: HTMLElement }[] {
  const result: { step: TourStep; element: HTMLElement }[] = [];
  for (const step of steps) {
    const el = findAnchor(step.anchor);
    if (el) {
      result.push({ step, element: el });
    }
  }
  return result;
}

export function TourController({ role }: TourControllerProps) {
  const config = tourConfigs[role];
  const [active, setActive] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [visibleSteps, setVisibleSteps] = useState<{ step: TourStep; element: HTMLElement }[]>([]);
  const rafRef = useRef<number>();

  const completedKey = getTourCompletedKey(role);
  const progressKey = getTourProgressKey(role);

  // Check if tour should auto-start
  useEffect(() => {
    if (!config) return;

    const completed = localStorage.getItem(completedKey) === "true";
    if (completed) return;

    // Delay to let page render and data-tour attributes mount
    const timer = setTimeout(() => {
      const steps = getVisibleSteps(config.steps);
      if (steps.length === 0) return;

      setVisibleSteps(steps);

      // Resume from saved progress if available
      const savedProgress = localStorage.getItem(progressKey);
      const startIndex = savedProgress ? Math.min(parseInt(savedProgress, 10), steps.length - 1) : 0;
      setCurrentIndex(startIndex);
      setActive(true);
    }, 800);

    return () => clearTimeout(timer);
  }, [config, completedKey, progressKey]);

  // Update target rect when step changes
  const updateRect = useCallback(() => {
    if (!active || visibleSteps.length === 0) return;

    const { element } = visibleSteps[currentIndex];
    if (element) {
      const rect = element.getBoundingClientRect();
      setTargetRect(rect);
      element.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [active, currentIndex, visibleSteps]);

  useEffect(() => {
    updateRect();

    // Track scroll/resize for repositioning
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
    if (currentIndex < visibleSteps.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    }
  }, [currentIndex, visibleSteps.length]);

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

  if (!active || visibleSteps.length === 0) return null;

  const currentStep = visibleSteps[currentIndex];
  if (!currentStep) return null;

  return createPortal(
    <>
      <TourSpotlight targetRect={targetRect} visible={active} />
      <TourPopover
        step={currentStep.step}
        stepIndex={currentIndex}
        totalSteps={visibleSteps.length}
        targetRect={targetRect}
        onNext={handleNext}
        onBack={handleBack}
        onSkip={handleSkip}
        isFirst={currentIndex === 0}
        isLast={currentIndex === visibleSteps.length - 1}
      />
    </>,
    document.body
  );
}
