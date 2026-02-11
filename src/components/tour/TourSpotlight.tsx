/**
 * TourSpotlight — Renders a subtle backdrop with a spotlight cutout
 * around the anchored element.
 */

import { useEffect, useState } from "react";

interface TourSpotlightProps {
  targetRect: DOMRect | null;
  visible: boolean;
}

export function TourSpotlight({ targetRect, visible }: TourSpotlightProps) {
  const [opacity, setOpacity] = useState(0);

  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => setOpacity(1));
    } else {
      setOpacity(0);
    }
  }, [visible]);

  if (!visible || !targetRect) return null;

  const padding = 8;
  const borderRadius = 12;
  const x = targetRect.left - padding;
  const y = targetRect.top - padding;
  const w = targetRect.width + padding * 2;
  const h = targetRect.height + padding * 2;

  return (
    <div
      className="fixed inset-0 z-[9998] pointer-events-none"
      style={{
        opacity,
        transition: "opacity 150ms ease",
      }}
    >
      <svg
        className="absolute inset-0 w-full h-full"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <mask id="tour-spotlight-mask">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            <rect
              x={x}
              y={y}
              width={w}
              height={h}
              rx={borderRadius}
              ry={borderRadius}
              fill="black"
            />
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="hsl(222 47% 11% / 0.08)"
          mask="url(#tour-spotlight-mask)"
        />
      </svg>
      {/* Focus ring around spotlight */}
      <div
        className="absolute border-2 border-primary/30 rounded-xl pointer-events-none"
        style={{
          left: x,
          top: y,
          width: w,
          height: h,
          transition: "all 150ms ease",
        }}
      />
    </div>
  );
}
