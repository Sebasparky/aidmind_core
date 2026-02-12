import { ExternalLink, CheckCircle2 } from "lucide-react";
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
 * Obligation Detail Panel: Structured slide-over for Work Radar obligations.
 *
 * Flow: Radar → Obligation → Action → Resolution
 * 
 * This is NOT a generic drawer. It is a purpose-built enforcement panel
 * that transforms derived signals into actionable obligations.
 */

export type ObligationStatus = "open" | "in_progress" | "resolved";
export type ObligationSeverity = "low" | "medium" | "high";

export interface ObligationData {
  id: string;
  title: string;
  status: ObligationStatus;
  severity: ObligationSeverity;
  description: string;
  relatedSession?: {
    label: string;
    caseLabel?: string;
    sessionId?: string;
  };
  policySource: string;
  triggeredAt: string;
  allowedActions: {
    canOpenSession: boolean;
  };
}

interface ObligationPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  obligation: ObligationData | null;
  onOpenSession?: (sessionId: string) => void;
  onResolve?: (id: string) => void;
}

function getStatusLabel(status: ObligationStatus): string {
  switch (status) {
    case "open": return "Open";
    case "in_progress": return "In Progress";
    case "resolved": return "Resolved";
  }
}

function getStatusBadgeClass(status: ObligationStatus): string {
  switch (status) {
    case "open": return "badge-danger";
    case "in_progress": return "badge-warning";
    case "resolved": return "badge-success";
  }
}

function getSeverityBorderClass(severity: ObligationSeverity): string {
  switch (severity) {
    case "high": return "border-l-[hsl(var(--destructive))]";
    case "medium": return "border-l-[hsl(var(--status-warning))]";
    case "low": return "border-l-[hsl(var(--muted-foreground))]";
  }
}

export function ObligationPanel({
  open,
  onOpenChange,
  obligation,
  onOpenSession,
  onResolve,
}: ObligationPanelProps) {
  if (!obligation) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-md p-0 overflow-y-auto">
        {/* Severity stripe + content wrapper */}
        <div className={cn("border-l-4 h-full flex flex-col", getSeverityBorderClass(obligation.severity))}>
          
          {/* A) Header Section */}
          <SheetHeader className="p-6 pb-4 border-b border-border space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1 min-w-0">
                <SheetTitle className="text-left text-lg leading-snug">
                  {obligation.title}
                </SheetTitle>
                <Badge className={cn("mt-2", getStatusBadgeClass(obligation.status))}>
                  {getStatusLabel(obligation.status)}
                </Badge>
              </div>
            </div>
          </SheetHeader>

          <div className="flex-1 flex flex-col p-6 space-y-6">
            
            {/* B) What This Means */}
            <section>
              <h3 className="text-sm font-medium text-foreground mb-2">What this means</h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                {obligation.description}
              </p>
              <p className="text-xs text-muted-foreground/60 mt-2">
                This item will remain until you mark it resolved.
              </p>
            </section>

            {/* C) Related Entity */}
            {obligation.relatedSession && (
              <section className="border-t border-border pt-5">
                <h3 className="text-sm font-medium text-foreground mb-3">Related Session</h3>
                <div className="p-3 rounded-lg bg-muted/50 space-y-1">
                  {obligation.relatedSession.sessionId ? (
                    <button
                      onClick={() => onOpenSession?.(obligation.relatedSession!.sessionId!)}
                      className="text-sm font-medium text-primary hover:underline underline-offset-2 flex items-center gap-1.5"
                    >
                      Session: {obligation.relatedSession.label}
                      <ExternalLink className="h-3 w-3" />
                    </button>
                  ) : (
                    <p className="text-sm font-medium text-foreground">
                      Session: {obligation.relatedSession.label}
                    </p>
                  )}
                  {obligation.relatedSession.caseLabel && (
                    <p className="text-xs text-muted-foreground">
                      Case: {obligation.relatedSession.caseLabel}
                    </p>
                  )}
                </div>
              </section>
            )}

            {/* D) Required Action */}
            <section className="border-t border-border pt-5">
              <h3 className="text-sm font-medium text-foreground mb-3">Required Action</h3>
              <div className="space-y-2">
                {obligation.allowedActions.canOpenSession && obligation.relatedSession?.sessionId && (
                  <Button
                    className="w-full gap-2"
                    onClick={() => onOpenSession?.(obligation.relatedSession!.sessionId!)}
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open Session
                  </Button>
                )}
                
                {!obligation.relatedSession?.sessionId && (
                  <Button
                    className="w-full gap-2"
                    onClick={() => onResolve?.(obligation.id)}
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    Resolve Documentation
                  </Button>
                )}

                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full gap-1.5 text-xs text-muted-foreground"
                  onClick={() => onResolve?.(obligation.id)}
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Mark as resolved
                </Button>
              </div>
            </section>

            {/* Spacer to push audit metadata to bottom */}
            <div className="flex-1" />

            {/* E) Audit Metadata */}
            <section className="border-t border-border pt-4">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground/70">
                  Derived from: {obligation.policySource}
                </p>
                <p className="text-xs text-muted-foreground/70">
                  Last triggered: {obligation.triggeredAt}
                </p>
              </div>
            </section>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
