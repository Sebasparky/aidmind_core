import { History, CheckCircle2, XCircle, LogOut, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import type { SessionOutcome } from "./SessionHistoryPanel";

/**
 * Session Detail Drawer: Read-only summary of a closed session.
 * Shows accurate outcome status and tool usage derived from eye_events.
 */

interface SessionDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: {
    id: string;
    sessionId: string;
    caseLabel: string;
    interactionType: string;
    outcome: SessionOutcome;
    completedAt: Date;
    guidanceUsed: boolean;
    reviewerUsed: boolean;
    toolCount: number;
  } | null;
}

function getOutcomeIcon(outcome: SessionOutcome) {
  switch (outcome) {
    case "completed": return CheckCircle2;
    case "closed_early": return LogOut;
    case "cancelled": return XCircle;
    default: return History;
  }
}

function getOutcomeLabel(outcome: SessionOutcome) {
  switch (outcome) {
    case "completed": return "Completed";
    case "closed_early": return "Closed early";
    case "cancelled": return "Cancelled";
  }
}

function getOutcomeBadgeVariant(outcome: SessionOutcome) {
  switch (outcome) {
    case "completed": return "default" as const;
    case "closed_early": return "secondary" as const;
    case "cancelled": return "outline" as const;
  }
}

function formatFullDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function SessionDetailDrawer({
  open,
  onOpenChange,
  session,
}: SessionDetailDrawerProps) {
  if (!session) return null;

  const OutcomeIcon = getOutcomeIcon(session.outcome);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md">
        <SheetHeader className="space-y-4 pb-6 border-b border-border">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "w-10 h-10 rounded-full flex items-center justify-center",
                  session.outcome === "completed" && "bg-primary/10 text-primary",
                  session.outcome === "closed_early" && "bg-muted text-muted-foreground",
                  session.outcome === "cancelled" && "bg-muted text-muted-foreground"
                )}
              >
                <OutcomeIcon className="h-5 w-5" />
              </div>
              <div>
                <SheetTitle className="text-left">Session Summary</SheetTitle>
                <Badge
                  variant={getOutcomeBadgeVariant(session.outcome)}
                  className="mt-1"
                >
                  {getOutcomeLabel(session.outcome)}
                </Badge>
              </div>
            </div>
          </div>
        </SheetHeader>

        <div className="py-6 space-y-6">
          {/* Session Info */}
          <div className="space-y-4">
            <div>
              <p className="text-sm text-muted-foreground">Session</p>
              <p className="text-sm font-medium text-foreground mt-1">
                {session.caseLabel}
              </p>
            </div>

            <div>
              <p className="text-sm text-muted-foreground">Interaction Type</p>
              <p className="text-sm font-medium text-foreground mt-1">
                {session.interactionType}
              </p>
            </div>

            <div>
              <p className="text-sm text-muted-foreground">Closed</p>
              <p className="text-sm font-medium text-foreground mt-1">
                {formatFullDate(session.completedAt)}
              </p>
            </div>
          </div>

          {/* Tool Usage Summary */}
          <div className="border-t border-border pt-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-foreground">
                Tools Used
              </p>
              <span className="text-xs text-muted-foreground">
                {session.toolCount}/2
              </span>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50">
                <span className="text-sm text-foreground">Guidance</span>
                <Badge variant={session.guidanceUsed ? "default" : "outline"}>
                  {session.guidanceUsed ? "Used" : "Not used"}
                </Badge>
              </div>
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50">
                <span className="text-sm text-foreground">Reviewer</span>
                <Badge variant={session.reviewerUsed ? "default" : "outline"}>
                  {session.reviewerUsed ? "Used" : "Not used"}
                </Badge>
              </div>
            </div>
          </div>

          {/* Read-only notice */}
          <div className="border-t border-border pt-6">
            <p className="text-xs text-muted-foreground text-center">
              This is a read-only summary. Session tools are no longer available.
            </p>
          </div>
        </div>

        <div className="pt-4 border-t border-border">
          <Button
            variant="outline"
            className="w-full"
            onClick={() => onOpenChange(false)}
          >
            Close
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
