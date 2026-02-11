import { Link } from "react-router-dom";
import aidmindLogo from "@/assets/aidmind_logo_transparent.png";
import { cn } from "@/lib/utils";

const sizeMap = {
  sm: "h-5 min-h-[20px]",
  md: "h-7 min-h-[20px]",
  lg: "h-12 min-h-[20px]",
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
        className={cn(sizeMap[size], "w-auto object-contain")}
        draggable={false}
      />
      {showWordmark && (
        <span
          className={cn(
            "font-semibold text-foreground tracking-tight",
            size === "lg" && "text-2xl",
            size === "md" && "text-xl",
            size === "sm" && "text-base",
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
        className="hover:opacity-80 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-lg"
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
        className="hover:opacity-80 transition-opacity focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 rounded-lg"
        aria-label="AidMind home"
      >
        {content}
      </button>
    );
  }

  return content;
}
