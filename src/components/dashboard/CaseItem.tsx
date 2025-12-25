import { CheckCircle2, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export interface Case {
  id: string;
  client: string;
  caseName: string;
  updatedAt: string;
  status: "active" | "high-risk";
  showActiveBadge?: boolean;
}

interface CaseItemProps {
  caseData: Case;
}

export function CaseItem({ caseData }: CaseItemProps) {
  const isHighRisk = caseData.status === "high-risk";

  return (
    <div className="flex items-start gap-3 p-3 hover:bg-secondary/50 rounded-lg transition-colors cursor-pointer">
      <div
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
          isHighRisk
            ? "bg-status-danger/10 text-status-danger"
            : "bg-status-success/10 text-status-success"
        )}
      >
        {isHighRisk ? (
          <AlertTriangle className="h-4 w-4" />
        ) : (
          <CheckCircle2 className="h-4 w-4" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-foreground">
          Client: {caseData.client}
        </p>
        <p className="text-xs text-muted-foreground truncate">
          {caseData.caseName}
        </p>
        <div className="flex items-center gap-2 mt-1.5">
          {isHighRisk ? (
            <Badge className="bg-status-danger text-status-danger-foreground text-xs px-2 py-0 border-0">
              High Risk
            </Badge>
          ) : caseData.showActiveBadge ? (
            <Badge className="bg-status-success text-status-success-foreground text-xs px-2 py-0 border-0">
              Active
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
