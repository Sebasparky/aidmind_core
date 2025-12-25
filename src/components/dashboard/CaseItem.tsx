import { CheckCircle2, AlertTriangle, MinusCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export interface Case {
  id: string;
  client: string;
  caseName: string;
  updatedAt: string;
  status: "active" | "high-risk" | "resolved";
  showActiveBadge?: boolean;
}

interface CaseItemProps {
  caseData: Case;
}

const statusConfig = {
  "high-risk": {
    icon: AlertTriangle,
    iconClass: "text-status-danger",
    bgClass: "bg-[hsl(var(--status-danger-muted))]",
    badgeClass: "badge-critical",
    label: "High Risk",
  },
  active: {
    icon: CheckCircle2,
    iconClass: "text-status-success",
    bgClass: "bg-[hsl(var(--status-success-muted))]",
    badgeClass: "badge-success",
    label: "Active",
  },
  resolved: {
    icon: MinusCircle,
    iconClass: "text-status-neutral",
    bgClass: "bg-[hsl(var(--status-neutral-muted))]",
    badgeClass: "badge-neutral",
    label: "Resolved",
  },
};

export function CaseItem({ caseData }: CaseItemProps) {
  const config = statusConfig[caseData.status] || statusConfig.active;
  const Icon = config.icon;
  const showBadge = caseData.status === "high-risk" || caseData.showActiveBadge;

  return (
    <div className="flex items-start gap-3 p-3 hover:bg-secondary/50 rounded-lg transition-colors cursor-pointer">
      {/* Status icon with semantic color */}
      <div
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
          config.bgClass
        )}
      >
        <Icon className={cn("h-4 w-4", config.iconClass)} />
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">
          Client: {caseData.client}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {caseData.caseName}
        </p>
        <div className="flex items-center gap-2 mt-1.5">
          {showBadge ? (
            <Badge
              className={cn("text-xs px-2 py-0 border-0", config.badgeClass)}
            >
              {config.label}
            </Badge>
          ) : (
            <span className="text-xs text-muted-foreground">
              {caseData.updatedAt}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
