/**
 * EyeActivation — Animated AidMind spiral-eye mark + typing wordmark.
 * Recreates the filled aperture-style eye logo as inline SVG.
 * Runs once on page load (~1.4s), then stays static.
 * Pure CSS keyframes — no external animation libraries.
 */

export function EyeActivation() {
  return (
    <div className="flex flex-row items-center gap-3">
      <style>{`
        @keyframes eye-reveal {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes eye-scale-reveal {
          from { opacity: 0; transform: scale(0.85); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes eye-typing {
          from { width: 0; }
          to   { width: 7ch; }
        }

        .eye-silhouette {
          opacity: 0;
          animation: eye-scale-reveal 0.35s ease-out 0.05s forwards;
        }
        .eye-spiral {
          opacity: 0;
          animation: eye-reveal 0.3s ease-out 0.35s forwards;
        }
        .eye-wedge-left {
          opacity: 0;
          animation: eye-reveal 0.25s ease-out 0.6s forwards;
        }
        .eye-wedge-right {
          opacity: 0;
          animation: eye-reveal 0.25s ease-out 0.7s forwards;
        }
        .eye-center-dot {
          opacity: 0;
          animation: eye-reveal 0.2s ease-out 0.9s forwards;
        }
        .eye-wordmark-text {
          display: inline-block;
          overflow: hidden;
          white-space: nowrap;
          width: 0;
          animation: eye-typing 0.46s steps(7) 0.95s forwards;
        }
      `}</style>

      {/* AidMind spiral-eye mark — filled paths with negative space */}
      <svg
        className="w-12 h-12 flex-shrink-0"
        viewBox="0 0 200 200"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* 1) Outer eye silhouette — thick filled almond shape */}
        <path
          className="eye-silhouette"
          d="
            M100 20
            C140 20, 175 55, 185 100
            C175 145, 140 180, 100 180
            C60 180, 25 145, 15 100
            C25 55, 60 20, 100 20Z
          "
          fill="currentColor"
        />

        {/* Negative space cutout — inner eye cavity (rendered as background color) */}
        <path
          className="eye-silhouette"
          d="
            M100 42
            C130 42, 158 65, 166 100
            C158 135, 130 158, 100 158
            C70 158, 42 135, 34 100
            C42 65, 70 42, 100 42Z
          "
          fill="hsl(222.2 47.4% 11.2%)"
        />

        {/* 2) Spiral aperture band — thick filled spiral that wraps inward */}
        <path
          className="eye-spiral"
          d="
            M140 68
            C155 82, 158 100, 150 118
            C142 136, 122 148, 100 148
            C78 148, 58 132, 52 112
            C46 92, 54 72, 70 60
            C86 48, 108 50, 124 62
            C136 72, 138 88, 132 104
            C126 118, 112 126, 96 126
            C82 126, 74 116, 72 104
            C70 92, 76 80, 88 74
            C98 70, 108 74, 114 84
            C118 92, 116 102, 108 108
          "
          stroke="currentColor"
          strokeWidth="10"
          strokeLinecap="round"
          fill="none"
        />

        {/* 3a) Left wedge/chevron — curved triangle pointing inward */}
        <path
          className="eye-wedge-left"
          d="
            M42 100
            C44 78, 56 58, 76 50
            C62 62, 52 80, 50 100
            C52 120, 62 138, 76 150
            C56 142, 44 122, 42 100Z
          "
          fill="currentColor"
        />

        {/* 3b) Right wedge/chevron — curved triangle pointing inward */}
        <path
          className="eye-wedge-right"
          d="
            M158 100
            C156 78, 144 58, 124 50
            C138 62, 148 80, 150 100
            C148 120, 138 138, 124 150
            C144 142, 156 122, 158 100Z
          "
          fill="currentColor"
        />

        {/* 4) Center awareness dot */}
        <circle
          className="eye-center-dot"
          cx="100"
          cy="100"
          r="7"
          fill="currentColor"
        />
      </svg>

      {/* Wordmark — no caret */}
      <span className="text-2xl font-semibold tracking-tight text-current">
        <span className="eye-wordmark-text">AidMind</span>
      </span>
    </div>
  );
}
