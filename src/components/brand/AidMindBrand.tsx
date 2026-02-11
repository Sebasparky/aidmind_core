import { Link } from "react-router-dom";
import aidmindLogo from "@/assets/aidmind_logo_cropped.png";
import { cn } from "@/lib/utils";

const sizeMap = {
  sm: "h-7 sm:h-8",
  md: "h-7 sm:h-8",
  lg: "h-16",
} as const;

interface AidMindBrandProps {
  size?: "sm" | "md" | "lg";
  showWordmark?: boolean;
  href?: string;
  className?: string;
  onClick?: () => void;
}

export function AidMindBrand({
  size = "md",
  showWordmark = true,
  href,
  className,
  onClick,
}: AidMindBrandProps) {
  const content = (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <img
        src={aidmindLogo}
        alt="AidMind"
        className={cn(sizeMap[size], "w-auto object-contain select-none pointer-events-none")}
        draggable={false}
      />
      {showWordmark && (
        <span
          className={cn(
            "font-semibold text-foreground tracking-tight",
            size === "lg" && "text-3xl",
            size === "md" && "text-2xl",
            size === "sm" && "text-xl",
          )}
        >
          AidMind
        </span>
      )}
    </span>
  );

  if (href) {
    return (
      <Link
        to={href}
        className="hover:opacity-80 transition-opacity outline-none ring-0 border-0 shadow-none focus:outline-none focus-visible:outline-none rounded-lg"
        aria-label="AidMind home"
        onClick={onClick}
      >
        {content}
      </Link>
    );
  }

  if (onClick) {
    return (
      <button
        onClick={onClick}
        className="hover:opacity-80 transition-opacity outline-none ring-0 border-0 shadow-none focus:outline-none focus-visible:outline-none rounded-lg"
        aria-label="AidMind home"
      >
        {content}
      </button>
    );
  }

  return content;
}
