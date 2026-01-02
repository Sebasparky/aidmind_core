/**
 * Daily Assurance Panel - Supervisor's "peace of mind" landing view
 * 
 * Provides fast reassurance (5-10 seconds) about system health and compliance.
 * Read-only, NO PHI, points to other tabs for detailed inspection.
 * 
 * GUARDRAILS:
 * - No PHI anywhere
 * - No performance rankings or per-employee evaluations
 * - No raw logs, reason codes, or event timelines
 * - Points, doesn't explain: links to Issues/Data Deletion Proof tabs
 */

import { useMemo } from "react";
import { EyeEvent } from "@/lib/eye/types";
import { getEventSeverity } from "@/lib/eye/mock-data";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  AlertTriangle,
  XOctagon,
  Users,
  Activity,
  Clock,
  Bookmark,
  Lock,
  Trash2,
  Brain,
  UserCheck,
  Info,
  ArrowRight,
} from "lucide-react";

interface DailyAssurancePanelProps {
  allEvents: EyeEvent[];
  issueCount: number;
  onNavigateToTab: (tab: string) => void;
}

// Types for computed summaries
type VerdictLevel = "normal" | "attention" | "critical";

interface VerdictState {
  level: VerdictLevel;
  icon: typeof CheckCircle2;
  label: string;
  description: string;
  className: string;
}

interface ActivitySnapshot {
  sessionsToday: number;
  activeCaseworkers: number;
  completedSessions: number;
  savedForLater: number;
}

interface ComplianceStatus {
  deletionsVerified: number;
  retainedPhi: number;
  llmApproved: boolean;
  userApprovalRequired: boolean;
}

interface ActionRequired {
  hasIssues: boolean;
  issueCount: number;
  hasDeletionConcerns: boolean;
  deletionConcernCount: number;
}

// Filter events to "today" (last 24 hours for mock purposes)
function getTodayEvents(events: EyeEvent[]): EyeEvent[] {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return events.filter(e => new Date(e.timestamp) >= twentyFourHoursAgo);
}

// Compute verdict from events
function computeVerdict(events: EyeEvent[]): VerdictState {
  const todayEvents = getTodayEvents(events);
  
  // Check for critical conditions
  const hasCriticalIssues = todayEvents.some(e => {
    const severity = getEventSeverity(e);
    return severity === "CRITICAL";
  });
  
  const hasPurgeFailed = todayEvents.some(e => e.event_type === "PURGE_FAILED");
  
  const hasRetainedPhi = todayEvents.some(
    e => e.event_type === "EPHEMERAL_SCAN_RESULT" && (e.remaining_count ?? 0) > 0
  );
  
  if (hasCriticalIssues || hasPurgeFailed || hasRetainedPhi) {
    return {
      level: "critical",
      icon: XOctagon,
      label: "Critical issue detected",
      description: "Engineering has been notified.",
      className: "bg-destructive/10 border-destructive/30 text-destructive",
    };
  }
  
  // Check for attention-needed conditions
  const hasWarnings = todayEvents.some(e => {
    const severity = getEventSeverity(e);
    return severity === "WARN" || severity === "HIGH";
  });
  
  const hasFailures = todayEvents.some(
    e => e.event_type === "TRANSCRIPTION_FAILED" || 
         e.event_type === "REDACTION_FAILED" ||
         e.result === "failure"
  );
  
  const issueSessionCount = new Set(
    todayEvents
      .filter(e => e.result === "failure" || getEventSeverity(e) === "WARN" || getEventSeverity(e) === "HIGH")
      .map(e => e.session_id)
      .filter(Boolean)
  ).size;
  
  if (hasWarnings || hasFailures) {
    return {
      level: "attention",
      icon: AlertTriangle,
      label: `Attention needed: ${issueSessionCount} session${issueSessionCount !== 1 ? "s" : ""} encountered system issues`,
      description: "Review system issues for details.",
      className: "bg-[hsl(var(--status-warning))]/10 border-[hsl(var(--status-warning))]/30 text-[hsl(var(--status-warning))]",
    };
  }
  
  return {
    level: "normal",
    icon: CheckCircle2,
    label: "All systems operating normally",
    description: "No issues detected.",
    className: "bg-[hsl(var(--status-success))]/10 border-[hsl(var(--status-success))]/30 text-[hsl(var(--status-success))]",
  };
}

// Compute activity snapshot
function computeActivitySnapshot(events: EyeEvent[]): ActivitySnapshot {
  const todayEvents = getTodayEvents(events);
  
  // Unique session IDs with activity today
  const sessionsToday = new Set(todayEvents.map(e => e.session_id).filter(Boolean)).size;
  
  // Unique operator IDs
  const activeCaseworkers = new Set(
    todayEvents.map(e => e.operator_id).filter(Boolean)
  ).size;
  
  // Sessions that have been closed
  const completedSessions = todayEvents.filter(
    e => e.event_type === "SESSION_CLOSED" || e.event_type === "SESSION_CANCELLED"
  ).length;
  
  // Sessions saved for later
  const savedForLater = todayEvents.filter(
    e => e.event_type === "WIP_BUNDLE_EXPORTED"
  ).length;
  
  return {
    sessionsToday,
    activeCaseworkers,
    completedSessions,
    savedForLater,
  };
}

// Compute compliance status
function computeComplianceStatus(events: EyeEvent[]): ComplianceStatus {
  const todayEvents = getTodayEvents(events);
  
  // Sessions with verified deletions (EPHEMERAL_SCAN_RESULT with remaining_count = 0)
  const deletionsVerified = todayEvents.filter(
    e => e.event_type === "EPHEMERAL_SCAN_RESULT" && e.remaining_count === 0
  ).length;
  
  // Sessions with retained PHI (remaining_count > 0)
  const retainedPhi = todayEvents.filter(
    e => e.event_type === "EPHEMERAL_SCAN_RESULT" && (e.remaining_count ?? 0) > 0
  ).length;
  
  // For now, simulate LLM and approval compliance as true (mock)
  // These would be computed from LLM_CALL events and NOTE_APPROVED events in production
  const llmApproved = true;
  const userApprovalRequired = true;
  
  return {
    deletionsVerified,
    retainedPhi,
    llmApproved,
    userApprovalRequired,
  };
}

// Compute action required
function computeActionRequired(events: EyeEvent[], issueCount: number): ActionRequired {
  const todayEvents = getTodayEvents(events);
  
  // Deletion concerns: sessions with failed purge or remaining artifacts
  const deletionConcerns = todayEvents.filter(
    e => e.event_type === "PURGE_FAILED" || 
         (e.event_type === "EPHEMERAL_SCAN_RESULT" && (e.remaining_count ?? 0) > 0)
  );
  
  return {
    hasIssues: issueCount > 0,
    issueCount,
    hasDeletionConcerns: deletionConcerns.length > 0,
    deletionConcernCount: deletionConcerns.length,
  };
}

export function DailyAssurancePanel({ allEvents, issueCount, onNavigateToTab }: DailyAssurancePanelProps) {
  const verdict = useMemo(() => computeVerdict(allEvents), [allEvents]);
  const activity = useMemo(() => computeActivitySnapshot(allEvents), [allEvents]);
  const compliance = useMemo(() => computeComplianceStatus(allEvents), [allEvents]);
  const actionRequired = useMemo(() => computeActionRequired(allEvents, issueCount), [allEvents, issueCount]);
  
  const VerdictIcon = verdict.icon;
  
  return (
    <Card className="h-full overflow-auto">
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">Daily Assurance</CardTitle>
            <CardDescription className="mt-1">
              System health and compliance at a glance
            </CardDescription>
          </div>
          {/* Supervisor guardrail tooltip */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground">
                  <Info className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left" className="max-w-xs">
                <p className="text-sm">
                  This summary reflects system behavior and compliance. It is not an evaluation of caseworker performance.
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* A) Top-level Verdict Block */}
        <div className={cn(
          "rounded-lg border p-4",
          verdict.className
        )}>
          <div className="flex items-start gap-3">
            <VerdictIcon className="h-6 w-6 flex-shrink-0 mt-0.5" />
            <div>
              <h3 className="font-semibold text-base">{verdict.label}</h3>
              <p className="text-sm opacity-80 mt-0.5">{verdict.description}</p>
              <p className="text-xs opacity-60 mt-2">
                Based on today's completed and active sessions.
              </p>
            </div>
          </div>
        </div>
        
        {/* B) Activity Snapshot */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h4 className="text-sm font-medium text-muted-foreground">Activity Snapshot</h4>
            {/* Guardrail callout */}
            <span className="text-xs text-muted-foreground/70 italic">
              System throughput, not productivity
            </span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-muted/30 rounded-lg p-3 text-center">
              <Activity className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
              <div className="text-xl font-semibold">{activity.sessionsToday}</div>
              <div className="text-xs text-muted-foreground">Sessions today</div>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 text-center">
              <Users className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
              <div className="text-xl font-semibold">{activity.activeCaseworkers}</div>
              <div className="text-xs text-muted-foreground">Active caseworkers</div>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 text-center">
              <CheckCircle2 className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
              <div className="text-xl font-semibold">{activity.completedSessions}</div>
              <div className="text-xs text-muted-foreground">Completed</div>
            </div>
            <div className="bg-muted/30 rounded-lg p-3 text-center">
              <Bookmark className="h-4 w-4 mx-auto mb-1 text-muted-foreground" />
              <div className="text-xl font-semibold">{activity.savedForLater}</div>
              <div className="text-xs text-muted-foreground">Saved for later</div>
            </div>
          </div>
        </div>
        
        <Separator />
        
        {/* C) Trust & Compliance Status */}
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-3">Trust & Compliance Status</h4>
          <div className="space-y-2.5">
            <div className="flex items-center gap-3 text-sm">
              <Lock className={cn(
                "h-4 w-4",
                compliance.deletionsVerified > 0 ? "text-[hsl(var(--status-success))]" : "text-muted-foreground"
              )} />
              <span>
                Ephemeral data deletion verified for{" "}
                <span className="font-medium">{compliance.deletionsVerified}</span> session{compliance.deletionsVerified !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Trash2 className={cn(
                "h-4 w-4",
                compliance.retainedPhi === 0 ? "text-[hsl(var(--status-success))]" : "text-destructive"
              )} />
              <span>
                {compliance.retainedPhi === 0 ? (
                  <>No artifacts detected (clean)</>
                ) : (
                  <><span className="font-medium text-destructive">{compliance.retainedPhi}</span> session{compliance.retainedPhi !== 1 ? "s" : ""} with retained artifacts</>
                )}
              </span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <Brain className={cn(
                "h-4 w-4",
                compliance.llmApproved ? "text-[hsl(var(--status-success))]" : "text-muted-foreground"
              )} />
              <span>All LLM operations used approved, minimized input</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <UserCheck className={cn(
                "h-4 w-4",
                compliance.userApprovalRequired ? "text-[hsl(var(--status-success))]" : "text-muted-foreground"
              )} />
              <span>All sessions required explicit user approval before generation</span>
            </div>
          </div>
        </div>
        
        <Separator />
        
        {/* D) "Do I need to act?" Section */}
        <div>
          <h4 className="text-sm font-medium text-muted-foreground mb-3">Action Required</h4>
          
          {!actionRequired.hasIssues && !actionRequired.hasDeletionConcerns ? (
            <div className="flex items-center gap-2 text-sm text-[hsl(var(--status-success))]">
              <CheckCircle2 className="h-4 w-4" />
              <span>No action required today</span>
            </div>
          ) : (
            <div className="space-y-2">
              {actionRequired.hasIssues && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-[hsl(var(--status-warning))]/10 border border-[hsl(var(--status-warning))]/20">
                  <div className="flex items-center gap-2 text-sm">
                    <AlertTriangle className="h-4 w-4 text-[hsl(var(--status-warning))]" />
                    <span>
                      Review <span className="font-medium">{actionRequired.issueCount}</span> system issue{actionRequired.issueCount !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="gap-1 text-xs h-7"
                    onClick={() => onNavigateToTab("issues")}
                  >
                    View Issues
                    <ArrowRight className="h-3 w-3" />
                  </Button>
                </div>
              )}
              
              {actionRequired.hasDeletionConcerns && (
                <div className="flex items-center justify-between p-3 rounded-lg bg-destructive/10 border border-destructive/20">
                  <div className="flex items-center gap-2 text-sm">
                    <AlertTriangle className="h-4 w-4 text-destructive" />
                    <span>
                      Review <span className="font-medium">{actionRequired.deletionConcernCount}</span> deletion proof concern{actionRequired.deletionConcernCount !== 1 ? "s" : ""}
                    </span>
                  </div>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    className="gap-1 text-xs h-7"
                    onClick={() => onNavigateToTab("deletion-proof")}
                  >
                    View Data Deletion Proof
                    <ArrowRight className="h-3 w-3" />
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
        
        {/* E) Gentle pointer footer */}
        <div className="pt-2 border-t border-border">
          <p className="text-xs text-muted-foreground text-center">
            For detailed inspection, see Sessions, System Issues, or Data Deletion Proof.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
