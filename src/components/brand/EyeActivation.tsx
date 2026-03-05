/**
 * EyeActivation — Animated spiral-eye SVG + typing wordmark.
 * Runs once on page load (~1.4s), then stays static.
 * Pure CSS keyframes — no external animation libraries.
 */

export function EyeActivation() {
  return (
    <div className="flex flex-row items-center gap-3">
      <style>{`
        @keyframes eye-draw {
          to { stroke-dashoffset: 0; }
        }
        @keyframes eye-fade {
          to { opacity: 1; }
        }
        @keyframes eye-pulse {
          0%   { transform: scale(1); }
          50%  { transform: scale(1.1); }
          100% { transform: scale(1); }
        }
        @keyframes eye-typing {
          from { width: 0; }
          to   { width: 7ch; }
        }

        /* Layer 1: Outer eye outline */
        .eye-layer-1 {
          stroke-dasharray: 420;
          stroke-dashoffset: 420;
          animation: eye-draw 0.45s ease-out 0s forwards;
        }
        /* Layer 2: Inner band */
        .eye-layer-2 {
          stroke-dasharray: 320;
          stroke-dashoffset: 320;
          animation: eye-draw 0.35s ease-out 0.2s forwards;
        }
        /* Layer 3: Iris ring */
        .eye-layer-3 {
          stroke-dasharray: 190;
          stroke-dashoffset: 190;
          animation: eye-draw 0.35s ease-out 0.4s forwards;
        }
        /* Layer 4: Spiral tail */
        .eye-layer-4 {
          stroke-dasharray: 120;
          stroke-dashoffset: 120;
          animation: eye-draw 0.3s ease-out 0.55s forwards;
        }
        /* Layer 5: Center pupil */
        .eye-layer-5 {
          opacity: 0;
          transform-origin: center;
          animation:
            eye-fade 0.15s ease-out 0.85s forwards,
            eye-pulse 1.4s ease-in-out 1.0s 1 forwards;
        }
        /* Wordmark typing — no caret */
        .eye-wordmark-text {
          display: inline-block;
          overflow: hidden;
          white-space: nowrap;
          width: 0;
          animation: eye-typing 0.46s steps(7) 0.95s forwards;
        }
      `}</style>

      {/* Spiral Eye SVG */}
      <svg
        className="w-12 h-12 flex-shrink-0"
        viewBox="0 0 200 120"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        {/* Outer eye outline — almond shape */}
        <path
          className="eye-layer-1"
          d="M10 60 Q50 5 100 5 Q150 5 190 60 Q150 115 100 115 Q50 115 10 60Z"
          stroke="currentColor"
          strokeWidth="4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Inner band — smaller almond */}
        <path
          className="eye-layer-2"
          d="M30 60 Q55 22 100 22 Q145 22 170 60 Q145 98 100 98 Q55 98 30 60Z"
          stroke="currentColor"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Iris ring */}
        <circle
          className="eye-layer-3"
          cx="100"
          cy="60"
          r="30"
          stroke="currentColor"
          strokeWidth="3.5"
        />
        {/* Spiral tail — connects iris to inner band */}
        <path
          className="eye-layer-4"
          d="M130 60 Q135 38 118 28 Q100 20 82 32 Q68 44 72 60 Q76 76 92 80 Q108 82 116 70"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
        {/* Center pupil */}
        <circle
          className="eye-layer-5"
          cx="100"
          cy="60"
          r="8"
          fill="currentColor"
        />
      </svg>

      {/* Wordmark */}
      <span className="text-2xl font-semibold tracking-tight text-current">
        <span className="eye-wordmark-text">AidMind</span>
      </span>
    </div>
  );
}
