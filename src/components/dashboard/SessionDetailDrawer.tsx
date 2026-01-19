import { History, CheckCircle2, XCircle, Clock, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/**
 * Session Detail Drawer: Read-only summary of a closed session.
 * 
 * IMPORTANT: This is NOT an entry point to reopen work.
 * - No "Generate Guidance" or "Run Reviewer" actions
 * - No "Resume" functionality
 * - Read-only summary only
 */

interface SessionDetailDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: {
    id: string;
    sessionId: string;
    caseLabel: string;
    interactionType: string;
    outcome: "completed" | "cancelled" | "abandoned";
    completedAt: Date;
    guidanceUsed: boolean;
    reviewerUsed: boolean;
  } | null;
}

function getOutcomeIcon(outcome: "completed" | "cancelled" | "abandoned") {
  switch (outcome) {
    case "completed":
      return CheckCircle2;
    case "cancelled":
      return XCircle;
    case "abandoned":
      return Clock;
    default:
      return History;
  }
}

function getOutcomeLabel(outcome: "completed" | "cancelled" | "abandoned") {
  switch (outcome) {
    case "completed":
      return "Completed";
    case "cancelled":
      return "Cancelled";
    case "abandoned":
      return "Abandoned";
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
                  session.outcome === "cancelled" && "bg-muted text-muted-foreground",
                  session.outcome === "abandoned" && "bg-warning/10 text-warning"
                )}
              >
                <OutcomeIcon className="h-5 w-5" />
              </div>
              <div>
                <SheetTitle className="text-left">Session Summary</SheetTitle>
                <Badge
                  variant={
                    session.outcome === "completed" ? "default" : "secondary"
                  }
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
              <p className="text-sm text-muted-foreground">Case</p>
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
            <p className="text-sm font-medium text-foreground mb-3">
              Tools Used
            </p>
            <div className="space-y-2">
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50">
                <span className="text-sm text-foreground">Generate Guidance</span>
                <Badge variant={session.guidanceUsed ? "default" : "outline"}>
                  {session.guidanceUsed ? "Used" : "Not used"}
                </Badge>
              </div>
              <div className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/50">
                <span className="text-sm text-foreground">Run Reviewer</span>
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
