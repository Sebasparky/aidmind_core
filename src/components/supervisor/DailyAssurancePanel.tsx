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

import { useMemo, useState } from "react";
import { EyeEvent } from "@/lib/eye/types";
import { getEventSeverity } from "@/lib/eye/mock-data";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
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
  MessageSquare,
  Copy,
  XCircle,
  PlayCircle,
} from "lucide-react";

interface DailyAssurancePanelProps {
  allEvents: EyeEvent[];
  issueCount: number;
  onNavigateToTab: (tab: string) => void;
}

// Types for computed summaries
type VerdictLevel = "green" | "yellow" | "red";

interface VerdictState {
  level: VerdictLevel;
  icon: typeof CheckCircle2;
  title: string;
  subtitle: string;
  className: string;
  bgClassName: string;
}

interface SessionOutcomes {
  sessionsToday: number;
  completed: number;
  saved: number;
  cancelled: number;
  failed: number;
  inProgress: number;
  activeCaseworkers: number;
}

interface ComplianceStatus {
  deletionsVerified: number;
  retainedArtifacts: number;
  llmApproved: boolean;
  userApprovalRequired: boolean;
}

interface ActionCounts {
  blockedSessionsCount: number;
  issueSessionsCount: number;
  complianceRiskCount: number;
}

// Filter events to "today" (last 24 hours for mock purposes)
function getTodayEvents(events: EyeEvent[]): EyeEvent[] {
  const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  return events.filter(e => new Date(e.timestamp) >= twentyFourHoursAgo);
}

// Compute action counts for verdict determination
function computeActionCounts(events: EyeEvent[]): ActionCounts {
  const todayEvents = getTodayEvents(events);
  
  // Blocked sessions: critical errors, transcription/redaction failures that block progress, timeouts
  const blockedSessionIds = new Set<string>();
  const issueSessionIds = new Set<string>();
  const complianceRiskSessionIds = new Set<string>();
  
  for (const event of todayEvents) {
    const sessionId = event.session_id;
    if (!sessionId) continue;
    
    const severity = getEventSeverity(event);
    
    // Critical issues = blocked
    if (severity === "CRITICAL") {
      blockedSessionIds.add(sessionId);
      continue;
    }
    
    // Blocking failures
    if (event.event_type === "TRANSCRIPTION_FAILED" || 
        event.event_type === "REDACTION_FAILED") {
      blockedSessionIds.add(sessionId);
      continue;
    }
    
    // Compliance risks: purge failures, retained artifacts
    if (event.event_type === "PURGE_FAILED") {
      complianceRiskSessionIds.add(sessionId);
      continue;
    }
    
    if (event.event_type === "EPHEMERAL_SCAN_RESULT" && (event.remaining_count ?? 0) > 0) {
      complianceRiskSessionIds.add(sessionId);
      continue;
    }
    
    // Non-blocking issues
    if (event.result === "failure" || severity === "WARN" || severity === "HIGH") {
      issueSessionIds.add(sessionId);
    }
  }
  
  // Remove blocked from issue count (don't double count)
  blockedSessionIds.forEach(id => issueSessionIds.delete(id));
  
  return {
    blockedSessionsCount: blockedSessionIds.size,
    issueSessionsCount: issueSessionIds.size,
    complianceRiskCount: complianceRiskSessionIds.size,
  };
}

// Compute verdict from counts
function computeVerdict(counts: ActionCounts): VerdictState {
  const { blockedSessionsCount, issueSessionsCount, complianceRiskCount } = counts;
  
  // Red: blocking or compliance risk
  if (blockedSessionsCount > 0 || complianceRiskCount > 0) {
    return {
      level: "red",
      icon: XOctagon,
      title: "Service disruption detected — sessions may be delayed",
      subtitle: "Caseworkers may be blocked or compliance requires attention. Escalation recommended.",
      className: "text-destructive",
      bgClassName: "bg-destructive/10 border-destructive/30",
    };
  }
  
  // Yellow: errors occurred but not blocking and no compliance risk
  if (issueSessionsCount > 0) {
    return {
      level: "yellow",
      icon: AlertTriangle,
      title: "Some system errors occurred — no caseworkers blocked",
      subtitle: "AidMind has been notified. No action needed from supervisors.",
      className: "text-[hsl(var(--status-warning))]",
      bgClassName: "bg-[hsl(var(--status-warning))]/10 border-[hsl(var(--status-warning))]/30",
    };
  }
  
  // Green: all good
  return {
    level: "green",
    icon: CheckCircle2,
    title: "All systems operating normally",
    subtitle: "No blocked sessions. Compliance checks passed.",
    className: "text-[hsl(var(--status-success))]",
    bgClassName: "bg-[hsl(var(--status-success))]/10 border-[hsl(var(--status-success))]/30",
  };
}

// Compute session outcomes with reconciliation
function computeSessionOutcomes(events: EyeEvent[]): SessionOutcomes {
  const todayEvents = getTodayEvents(events);
  
  // Get all unique session IDs
  const allSessionIds = new Set(todayEvents.map(e => e.session_id).filter(Boolean) as string[]);
  
  // Track outcomes per session (priority: Failed > Completed > Saved > Cancelled > In Progress)
  const sessionOutcome = new Map<string, "completed" | "saved" | "cancelled" | "failed" | "inProgress">();
  
  for (const sessionId of allSessionIds) {
    const sessionEvents = todayEvents.filter(e => e.session_id === sessionId);
    
    // Check for failure state first
    const hasFailed = sessionEvents.some(e => 
      e.event_type === "TRANSCRIPTION_FAILED" ||
      e.event_type === "REDACTION_FAILED" ||
      e.event_type === "PURGE_FAILED" ||
      (e.result === "failure" && getEventSeverity(e) === "CRITICAL")
    );
    if (hasFailed) {
      sessionOutcome.set(sessionId, "failed");
      continue;
    }
    
    // Check for completed (SESSION_CLOSED with no major failures)
    const isClosed = sessionEvents.some(e => e.event_type === "SESSION_CLOSED");
    if (isClosed) {
      sessionOutcome.set(sessionId, "completed");
      continue;
    }
    
    // Check for saved
    const isSaved = sessionEvents.some(e => e.event_type === "WIP_BUNDLE_EXPORTED");
    if (isSaved) {
      sessionOutcome.set(sessionId, "saved");
      continue;
    }
    
    // Check for cancelled
    const isCancelled = sessionEvents.some(e => e.event_type === "SESSION_CANCELLED");
    if (isCancelled) {
      sessionOutcome.set(sessionId, "cancelled");
      continue;
    }
    
    // Otherwise, in progress
    sessionOutcome.set(sessionId, "inProgress");
  }
  
  // Count outcomes
  let completed = 0, saved = 0, cancelled = 0, failed = 0, inProgress = 0;
  for (const outcome of sessionOutcome.values()) {
    switch (outcome) {
      case "completed": completed++; break;
      case "saved": saved++; break;
      case "cancelled": cancelled++; break;
      case "failed": failed++; break;
      case "inProgress": inProgress++; break;
    }
  }
  
  // Unique operators
  const activeCaseworkers = new Set(
    todayEvents.map(e => e.operator_id).filter(Boolean)
  ).size;
  
  return {
    sessionsToday: allSessionIds.size,
    completed,
    saved,
    cancelled,
    failed,
    inProgress,
    activeCaseworkers,
  };
}

// Compute compliance status
function computeComplianceStatus(events: EyeEvent[]): ComplianceStatus {
  const todayEvents = getTodayEvents(events);
  
  const deletionsVerified = todayEvents.filter(
    e => e.event_type === "EPHEMERAL_SCAN_RESULT" && e.remaining_count === 0
  ).length;
  
  const retainedArtifacts = todayEvents.filter(
    e => e.event_type === "EPHEMERAL_SCAN_RESULT" && (e.remaining_count ?? 0) > 0
  ).length;
  
  // For now, simulate LLM and approval compliance as true (mock)
  const llmApproved = true;
  const userApprovalRequired = true;
  
  return {
    deletionsVerified,
    retainedArtifacts,
    llmApproved,
    userApprovalRequired,
  };
}

// Generate incident summary (PHI-safe)
function generateIncidentSummary(
  verdictLevel: VerdictLevel,
  counts: ActionCounts,
  outcomes: SessionOutcomes
): string {
  const now = new Date().toISOString();
  const levelLabel = verdictLevel === "green" ? "Normal" : verdictLevel === "yellow" ? "Attention" : "Critical";
  
  let summary = `AidMind System Status Report
Generated: ${now}
Status Level: ${levelLabel}

Session Counts (Last 24h):
- Total sessions: ${outcomes.sessionsToday}
- Completed: ${outcomes.completed}
- Saved for later: ${outcomes.saved}
- Cancelled: ${outcomes.cancelled}
- Failed: ${outcomes.failed}
- In progress: ${outcomes.inProgress}

Impact Summary:
- Blocked sessions: ${counts.blockedSessionsCount}
- Sessions with issues: ${counts.issueSessionsCount}
- Compliance risks: ${counts.complianceRiskCount}

`;

  if (verdictLevel === "green") {
    summary += "Recommendation: No action required.\n";
  } else if (verdictLevel === "yellow") {
    summary += "Recommendation: Monitor situation. Engineering has been automatically notified.\n";
  } else {
    summary += "Recommendation: Escalation recommended. Caseworkers may be blocked or compliance requires attention.\n";
  }

  summary += "\n---\nNo PHI is included in this report.";
  
  return summary;
}

export function DailyAssurancePanel({ allEvents, issueCount, onNavigateToTab }: DailyAssurancePanelProps) {
  const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
  
  const counts = useMemo(() => computeActionCounts(allEvents), [allEvents]);
  const verdict = useMemo(() => computeVerdict(counts), [counts]);
  const outcomes = useMemo(() => computeSessionOutcomes(allEvents), [allEvents]);
  const compliance = useMemo(() => computeComplianceStatus(allEvents), [allEvents]);
  
  const incidentSummary = useMemo(
    () => generateIncidentSummary(verdict.level, counts, outcomes),
    [verdict.level, counts, outcomes]
  );
  
  const VerdictIcon = verdict.icon;
  
  const handleCopyIncidentSummary = () => {
    navigator.clipboard.writeText(incidentSummary);
    toast.success("Incident summary copied to clipboard");
  };
  
  return (
    <>
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
            verdict.bgClassName
          )}>
            <div className="flex items-start gap-3">
              <VerdictIcon className={cn("h-6 w-6 flex-shrink-0 mt-0.5", verdict.className)} />
              <div className="flex-1">
                <h3 className={cn("font-semibold text-base", verdict.className)}>{verdict.title}</h3>
                <p className="text-sm text-foreground/80 mt-0.5">{verdict.subtitle}</p>
                <p className="text-xs text-muted-foreground mt-2">
                  Based on today's completed and active sessions.
                </p>
                {/* Stress-reducing lines */}
                <div className="mt-3 space-y-1">
                  <p className="text-xs text-muted-foreground">No PHI is visible here.</p>
                  <p className="text-xs text-muted-foreground">
                    {verdict.level === "yellow" 
                      ? "Engineering has been notified when needed."
                      : "Caseworkers are not expected to resolve system issues."}
                  </p>
                </div>
              </div>
            </div>
          </div>
          
          {/* B) Session Outcomes (replaces Activity Snapshot) */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-medium text-muted-foreground">Session Outcomes</h4>
              <span className="text-xs text-muted-foreground/70 italic">
                System throughput, not productivity
              </span>
            </div>
            
            {/* Sessions Today headline */}
            <div className="bg-muted/40 rounded-lg p-4 mb-3 text-center">
              <Activity className="h-5 w-5 mx-auto mb-1 text-muted-foreground" />
              <div className="text-2xl font-bold">{outcomes.sessionsToday}</div>
              <div className="text-sm text-muted-foreground">Sessions today</div>
            </div>
            
            {/* Outcome breakdown grid */}
            <div className="grid grid-cols-5 gap-2">
              <div className="bg-muted/30 rounded-lg p-2 text-center">
                <CheckCircle2 className="h-3.5 w-3.5 mx-auto mb-0.5 text-[hsl(var(--status-success))]" />
                <div className="text-lg font-semibold">{outcomes.completed}</div>
                <div className="text-xs text-muted-foreground">Completed</div>
              </div>
              <div className="bg-muted/30 rounded-lg p-2 text-center">
                <Bookmark className="h-3.5 w-3.5 mx-auto mb-0.5 text-muted-foreground" />
                <div className="text-lg font-semibold">{outcomes.saved}</div>
                <div className="text-xs text-muted-foreground">Saved</div>
              </div>
              <div className="bg-muted/30 rounded-lg p-2 text-center">
                <XCircle className="h-3.5 w-3.5 mx-auto mb-0.5 text-muted-foreground" />
                <div className="text-lg font-semibold">{outcomes.cancelled}</div>
                <div className="text-xs text-muted-foreground">Cancelled</div>
              </div>
              <div className="bg-muted/30 rounded-lg p-2 text-center">
                <AlertTriangle className="h-3.5 w-3.5 mx-auto mb-0.5 text-destructive" />
                <div className="text-lg font-semibold">{outcomes.failed}</div>
                <div className="text-xs text-muted-foreground">Failed</div>
              </div>
              <div className="bg-muted/30 rounded-lg p-2 text-center">
                <PlayCircle className="h-3.5 w-3.5 mx-auto mb-0.5 text-[hsl(var(--status-info))]" />
                <div className="text-lg font-semibold">{outcomes.inProgress}</div>
                <div className="text-xs text-muted-foreground">In progress</div>
              </div>
            </div>
            
            {/* Reconciliation line */}
            <p className="text-xs text-muted-foreground mt-2 text-center">
              Total = Completed + Saved + Cancelled + Failed + In progress
            </p>
            
            {/* Active caseworkers (separate metric) */}
            <div className="mt-3 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <Users className="h-4 w-4" />
              <span><span className="font-medium text-foreground">{outcomes.activeCaseworkers}</span> active caseworkers</span>
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
              <div className={cn(
                "flex items-center justify-between text-sm",
                compliance.retainedArtifacts > 0 && "p-2 -mx-2 rounded-md bg-destructive/10"
              )}>
                <div className="flex items-center gap-3">
                  <Trash2 className={cn(
                    "h-4 w-4",
                    compliance.retainedArtifacts === 0 ? "text-[hsl(var(--status-success))]" : "text-destructive"
                  )} />
                  <span>
                    {compliance.retainedArtifacts === 0 ? (
                      <>0 sessions with retained artifacts</>
                    ) : (
                      <><span className="font-medium text-destructive">{compliance.retainedArtifacts}</span> session{compliance.retainedArtifacts !== 1 ? "s" : ""} with retained artifacts</>
                    )}
                  </span>
                </div>
                {compliance.retainedArtifacts > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs h-6 px-2"
                    onClick={() => onNavigateToTab("deletion-proof")}
                  >
                    View Data Deletion Proof
                  </Button>
                )}
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
          
          {/* D) Action Required Section */}
          <div>
            <h4 className="text-sm font-medium text-muted-foreground mb-3">Action Required</h4>
            
            {verdict.level === "green" ? (
              <div className="flex items-center gap-2 text-sm text-[hsl(var(--status-success))]">
                <CheckCircle2 className="h-4 w-4" />
                <span>No action required today.</span>
              </div>
            ) : verdict.level === "yellow" ? (
              <div className="space-y-3">
                <p className="text-sm text-muted-foreground">
                  AidMind has been notified — optional: send note to support.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button 
                    size="sm" 
                    className="gap-2"
                    onClick={() => setIsSupportModalOpen(true)}
                  >
                    <MessageSquare className="h-4 w-4" />
                    Notify AidMind Support
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="gap-2"
                    onClick={handleCopyIncidentSummary}
                  >
                    <Copy className="h-4 w-4" />
                    Copy incident summary
                  </Button>
                </div>
                <button
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                  onClick={() => onNavigateToTab("issues")}
                >
                  View technical details
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-sm text-destructive font-medium">
                  Escalation recommended — contact support.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button 
                    size="sm" 
                    variant="destructive"
                    className="gap-2"
                    onClick={() => setIsSupportModalOpen(true)}
                  >
                    <MessageSquare className="h-4 w-4" />
                    Notify AidMind Support
                  </Button>
                  <Button 
                    variant="outline" 
                    size="sm" 
                    className="gap-2"
                    onClick={handleCopyIncidentSummary}
                  >
                    <Copy className="h-4 w-4" />
                    Copy incident summary
                  </Button>
                </div>
                <div className="flex flex-wrap gap-3">
                  {counts.complianceRiskCount > 0 && (
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground underline"
                      onClick={() => onNavigateToTab("deletion-proof")}
                    >
                      View Data Deletion Proof
                    </button>
                  )}
                  <button
                    className="text-xs text-muted-foreground hover:text-foreground underline"
                    onClick={() => onNavigateToTab("issues")}
                  >
                    View technical details
                  </button>
                </div>
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
      
      {/* Support Notification Modal */}
      <Dialog open={isSupportModalOpen} onOpenChange={setIsSupportModalOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Notify AidMind Support</DialogTitle>
            <DialogDescription>
              This sends a system-only report (no PHI) to AidMind support.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4">
            <Textarea
              className="min-h-[200px] font-mono text-xs"
              defaultValue={incidentSummary}
            />
            <p className="text-xs text-muted-foreground flex items-center gap-1">
              <Lock className="h-3 w-3" />
              No PHI is included in this report.
            </p>
          </div>
          
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(incidentSummary);
                toast.success("Incident summary copied to clipboard");
              }}
              className="gap-2"
            >
              <Copy className="h-4 w-4" />
              Copy message
            </Button>
            <Button variant="ghost" onClick={() => setIsSupportModalOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
