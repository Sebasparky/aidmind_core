/**
 * TourPopover — Anchored popover for a single tour step.
 * 
 * - Appears immediately with step content
 * - "Next" button delayed by 1.2s to encourage reading
 * - Back / Skip always available
 * - Progress indicator top-right
 * - Keyboard navigable, aria-live
 */

import { useState, useEffect, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TourStep } from "./types";

interface TourPopoverProps {
  step: TourStep;
  stepIndex: number;
  totalSteps: number;
  targetRect: DOMRect | null;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
  isFirst: boolean;
  isLast: boolean;
}

type Placement = "bottom" | "top" | "left" | "right";

function computePlacement(rect: DOMRect | null): Placement {
  if (!rect) return "bottom";
  const viewH = window.innerHeight;
  const viewW = window.innerWidth;
  const spaceBelow = viewH - rect.bottom;
  const spaceAbove = rect.top;
  const spaceRight = viewW - rect.right;
  const spaceLeft = rect.left;

  // Prefer below, then above, then right, then left
  if (spaceBelow >= 220) return "bottom";
  if (spaceAbove >= 220) return "top";
  if (spaceRight >= 340) return "right";
  if (spaceLeft >= 340) return "left";
  return "bottom";
}

function computePosition(rect: DOMRect | null, placement: Placement) {
  if (!rect) return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };

  const gap = 12;
  const style: React.CSSProperties = { position: "fixed" };

  switch (placement) {
    case "bottom":
      style.top = rect.bottom + gap;
      style.left = rect.left + rect.width / 2;
      style.transform = "translateX(-50%)";
      break;
    case "top":
      style.bottom = window.innerHeight - rect.top + gap;
      style.left = rect.left + rect.width / 2;
      style.transform = "translateX(-50%)";
      break;
    case "right":
      style.top = rect.top + rect.height / 2;
      style.left = rect.right + gap;
      style.transform = "translateY(-50%)";
      break;
    case "left":
      style.top = rect.top + rect.height / 2;
      style.right = window.innerWidth - rect.left + gap;
      style.transform = "translateY(-50%)";
      break;
  }

  return style;
}

export function TourPopover({
  step,
  stepIndex,
  totalSteps,
  targetRect,
  onNext,
  onBack,
  onSkip,
  isFirst,
  isLast,
}: TourPopoverProps) {
  const [nextVisible, setNextVisible] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Delay "Next" button by 1.2s
  useEffect(() => {
    setNextVisible(false);
    const timer = setTimeout(() => setNextVisible(true), 1200);
    return () => clearTimeout(timer);
  }, [stepIndex]);

  // Focus trap: focus popover on mount
  useEffect(() => {
    popoverRef.current?.focus();
  }, [stepIndex]);

  // Keyboard handler
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        onSkip();
      } else if (e.key === "ArrowRight" && nextVisible) {
        onNext();
      } else if (e.key === "ArrowLeft" && !isFirst) {
        onBack();
      }
    },
    [onSkip, onNext, onBack, nextVisible, isFirst]
  );

  const placement = computePlacement(targetRect);
  const positionStyle = computePosition(targetRect, placement);

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={`Tour step ${stepIndex + 1} of ${totalSteps}: ${step.title}`}
      aria-live="polite"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className={cn(
        "fixed z-[9999] w-80 rounded-xl border border-border bg-card p-5 shadow-lg",
        "animate-in fade-in-0 zoom-in-[0.98] duration-150",
        "focus:outline-none"
      )}
      style={positionStyle as React.CSSProperties}
    >
      {/* Header: progress + close */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-muted-foreground">
          Step {stepIndex + 1} of {totalSteps}
        </span>
        <button
          onClick={onSkip}
          className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          aria-label="Close tour"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Title with accent underline */}
      <h3 className="text-sm font-semibold text-foreground mb-1">
        <span className="border-b-2 border-primary/40 pb-0.5">{step.title}</span>
      </h3>

      {/* Body */}
      <p className="text-xs text-muted-foreground mt-2 leading-relaxed">
        {step.description}
      </p>
      <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
        <span className="font-medium text-foreground/70">When to use:</span> {step.usage}
      </p>
      {step.boundaryNote && (
        <p className="text-xs text-muted-foreground/80 mt-1.5 italic leading-relaxed">
          {step.boundaryNote}
        </p>
      )}

      {/* Progress dots */}
      <div className="flex items-center gap-1 mt-4 mb-3">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div
            key={i}
            className={cn(
              "h-1.5 rounded-full transition-all duration-200",
              i === stepIndex
                ? "w-4 bg-primary"
                : i < stepIndex
                ? "w-1.5 bg-primary/40"
                : "w-1.5 bg-muted-foreground/20"
            )}
          />
        ))}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          disabled={isFirst}
          className="text-xs"
          aria-label="Previous step"
        >
          Back
        </Button>

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={onSkip}
            className="text-xs text-muted-foreground"
            aria-label="Skip tour"
          >
            Skip tour
          </Button>

          <div
            className={cn(
              "transition-opacity duration-200",
              nextVisible ? "opacity-100" : "opacity-0 pointer-events-none"
            )}
          >
            <Button
              size="sm"
              onClick={isLast ? onSkip : onNext}
              className="text-xs"
              aria-label={isLast ? "Finish tour" : "Next step"}
            >
              {isLast ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
