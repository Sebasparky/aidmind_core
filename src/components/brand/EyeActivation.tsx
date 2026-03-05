/**
 * EyeActivation — Animated SVG eye logo + typing wordmark.
 * Runs once on page load (~1.4s), then stays static.
 * Pure CSS keyframes — no external animation libraries.
 */

export function EyeActivation() {
  return (
    <div className="flex flex-col items-center gap-3">
      <style>{`
        /* ---- Eye draw animations ---- */
        @keyframes draw-outline {
          to { stroke-dashoffset: 0; }
        }
        @keyframes draw-arc {
          to { stroke-dashoffset: 0; }
        }
        @keyframes ring-in {
          to { opacity: 1; }
        }
        @keyframes ring-pulse {
          0%   { transform: scale(1); }
          50%  { transform: scale(1.12); }
          100% { transform: scale(1); }
        }

        /* ---- Wordmark typing ---- */
        @keyframes typing {
          from { width: 0; }
          to   { width: 7ch; }
        }
        @keyframes blink-caret {
          0%, 100% { border-color: transparent; }
          50%      { border-color: currentColor; }
        }

        .eye-outline {
          stroke-dasharray: 320;
          stroke-dashoffset: 320;
          animation: draw-outline 0.5s ease-out forwards;
        }
        .eye-arc {
          stroke-dasharray: 60;
          stroke-dashoffset: 60;
          animation: draw-arc 0.35s ease-out 0.45s forwards;
        }
        .eye-center {
          opacity: 0;
          transform-origin: center;
          animation:
            ring-in 0.2s ease-out 0.85s forwards,
            ring-pulse 1.6s ease-in-out 1.05s 1 forwards;
        }
        .eye-wordmark {
          display: inline-block;
          overflow: hidden;
          white-space: nowrap;
          width: 0;
          border-right: 2px solid transparent;
          animation:
            typing 0.46s steps(7) 0.9s forwards,
            blink-caret 0.4s step-end 0.9s 3;
        }
      `}</style>

      {/* SVG Eye */}
      <svg
        className="w-28 h-14"
        viewBox="0 0 120 60"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
      >
        <path
          className="eye-outline"
          d="M10 30 Q60 0 110 30 Q60 60 10 30"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          className="eye-arc"
          d="M40 30 Q60 18 80 30"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          fill="none"
        />
        <circle
          className="eye-center"
          cx="60"
          cy="30"
          r="4"
          stroke="currentColor"
          strokeWidth="1.5"
          fill="none"
        />
      </svg>

      {/* Wordmark */}
      <span className="text-2xl font-semibold tracking-tight text-current">
        <span className="eye-wordmark">AidMind</span>
      </span>
    </div>
  );
}
