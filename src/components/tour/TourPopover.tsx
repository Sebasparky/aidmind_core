/**
 * TourPopover — Anchored popover for a single tour step.
 *
 * - Auto-flips placement to stay within viewport
 * - Clamps position with padding so it's never off-screen
 * - "Next" button delayed by 1.2s to encourage reading
 * - Keyboard navigable, aria-live
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TourStep, TourPlacement } from "./types";

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

const VIEWPORT_PAD = 16;
const GAP = 12;
const POPOVER_MAX_W = 360;
const POPOVER_EST_H = 260;

const FALLBACK_ORDER: TourPlacement[] = ["bottom", "right", "left", "top"];

function pickPlacement(
  rect: DOMRect | null,
  preferred?: TourPlacement
): TourPlacement {
  if (!rect) return "bottom";

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const popW = Math.min(POPOVER_MAX_W, vw - VIEWPORT_PAD * 2);

  const fits = (p: TourPlacement): boolean => {
    switch (p) {
      case "bottom":
        return vh - rect.bottom - GAP >= POPOVER_EST_H;
      case "top":
        return rect.top - GAP >= POPOVER_EST_H;
      case "right":
        return vw - rect.right - GAP >= popW;
      case "left":
        return rect.left - GAP >= popW;
    }
  };

  if (preferred && fits(preferred)) return preferred;
  for (const p of FALLBACK_ORDER) {
    if (fits(p)) return p;
  }
  return "bottom";
}

function computeStyle(
  rect: DOMRect | null,
  placement: TourPlacement,
  popoverEl: HTMLElement | null
): React.CSSProperties {
  if (!rect) return { position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)" };

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const popW = Math.min(POPOVER_MAX_W, vw - VIEWPORT_PAD * 2);
  const popH = popoverEl?.offsetHeight ?? POPOVER_EST_H;

  let top = 0;
  let left = 0;

  switch (placement) {
    case "bottom":
      top = rect.bottom + GAP;
      left = rect.left + rect.width / 2 - popW / 2;
      break;
    case "top":
      top = rect.top - GAP - popH;
      left = rect.left + rect.width / 2 - popW / 2;
      break;
    case "right":
      top = rect.top + rect.height / 2 - popH / 2;
      left = rect.right + GAP;
      break;
    case "left":
      top = rect.top + rect.height / 2 - popH / 2;
      left = rect.left - GAP - popW;
      break;
  }

  // Clamp within viewport
  left = Math.max(VIEWPORT_PAD, Math.min(left, vw - popW - VIEWPORT_PAD));
  top = Math.max(VIEWPORT_PAD, Math.min(top, vh - popH - VIEWPORT_PAD));

  return {
    position: "fixed",
    top,
    left,
    width: popW,
    maxWidth: `min(${POPOVER_MAX_W}px, calc(100vw - ${VIEWPORT_PAD * 2}px))`,
  };
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

  // Focus popover on mount
  useEffect(() => {
    popoverRef.current?.focus();
  }, [stepIndex]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") onSkip();
      else if (e.key === "ArrowRight" && nextVisible) onNext();
      else if (e.key === "ArrowLeft" && !isFirst) onBack();
    },
    [onSkip, onNext, onBack, nextVisible, isFirst]
  );

  const placement = useMemo(() => pickPlacement(targetRect, step.placement), [targetRect, step.placement]);
  const positionStyle = useMemo(
    () => computeStyle(targetRect, placement, popoverRef.current),
    [targetRect, placement]
  );

  return (
    <div
      ref={popoverRef}
      role="dialog"
      aria-label={`Tour step ${stepIndex + 1} of ${totalSteps}: ${step.title}`}
      aria-live="polite"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      className={cn(
        "fixed z-[9999] rounded-xl border border-border bg-card p-5 shadow-lg",
        "animate-in fade-in-0 zoom-in-[0.98] duration-150",
        "focus:outline-none"
      )}
      style={positionStyle as React.CSSProperties}
    >
      {/* Header */}
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

      {/* Title */}
      <h3 className="text-sm font-semibold text-foreground mb-1">
        <span className="border-b-2 border-primary/40 pb-0.5">{step.title}</span>
      </h3>

      {/* Body */}
      <p className="text-xs text-muted-foreground mt-2 leading-relaxed">{step.description}</p>
      <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
        <span className="font-medium text-foreground/70">When to use:</span> {step.usage}
      </p>
      {step.boundaryNote && (
        <p className="text-xs text-muted-foreground/80 mt-1.5 italic leading-relaxed">{step.boundaryNote}</p>
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
        <Button variant="ghost" size="sm" onClick={onBack} disabled={isFirst} className="text-xs" aria-label="Previous step">
          Back
        </Button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={onSkip} className="text-xs text-muted-foreground" aria-label="Skip tour">
            Skip tour
          </Button>
          <div className={cn("transition-opacity duration-200", nextVisible ? "opacity-100" : "opacity-0 pointer-events-none")}>
            <Button size="sm" onClick={isLast ? onSkip : onNext} className="text-xs" aria-label={isLast ? "Finish tour" : "Next step"}>
              {isLast ? "Done" : "Next"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
