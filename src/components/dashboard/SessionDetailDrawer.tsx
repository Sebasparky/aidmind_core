import { History, CheckCircle2, XCircle, LogOut } from "lucide-react";
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
 * Shows accurate outcome status and tool usage derived from session metadata.
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
    guidanceCompleted: boolean;
    guidanceSkipped: boolean;
    caseNotesCompleted: boolean;
    reviewerCompleted: boolean;
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

type ToolStatus = "completed" | "skipped" | "not_used";

function getToolStatusBadge(status: ToolStatus) {
  switch (status) {
    case "completed":
      return <Badge variant="default">Completed</Badge>;
    case "skipped":
      return <Badge variant="secondary">Skipped</Badge>;
    case "not_used":
      return <Badge variant="outline">Not used</Badge>;
  }
}

export function SessionDetailDrawer({
  open,
  onOpenChange,
  session,
}: SessionDetailDrawerProps) {
  if (!session) return null;

  const OutcomeIcon = getOutcomeIcon(session.outcome);

  // Derive tool statuses from metadata
  const guidanceStatus: ToolStatus = session.guidanceCompleted
    ? "completed"
    : session.guidanceSkipped
      ? "skipped"
      : "not_used";

  const caseNotesStatus: ToolStatus = session.caseNotesCompleted ? "completed" : "not_used";
  const reviewerStatus: ToolStatus = session.reviewerCompleted ? "completed" : "not_used";

  // Skipped counts as addressed for the total
  const guidanceAddressed = guidanceStatus !== "not_used";
  const toolCount = (guidanceAddressed ? 1 : 0) + (session.caseNotesCompleted ? 1 : 0) + (session.reviewerCompleted ? 1 : 0);

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

          {/* Tool Usage Summary — 3-tool model */}
          <div className="border-t border-border pt-6">
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-medium text-foreground">
                Tools Used
              </p>
              <span className="text-xs text-muted-foreground">
                {toolCount}/3
              </span>
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50">
                <span className="text-sm text-foreground">Guidance</span>
                {getToolStatusBadge(guidanceStatus)}
              </div>
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50">
                <span className="text-sm text-foreground">Case Notes</span>
                {getToolStatusBadge(caseNotesStatus)}
              </div>
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50">
                <span className="text-sm text-foreground">Reviewer</span>
                {getToolStatusBadge(reviewerStatus)}
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
