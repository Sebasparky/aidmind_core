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
 * 
 * VERDICT LOGIC:
 * See src/lib/eye/verdict.ts for deterministic, testable, recovery-aware logic.
 */

import { useMemo, useState } from "react";
import { EyeEvent } from "@/lib/eye/types";
import {
  computeActionCounts,
  computeVerdict,
  computeSessionOutcomes,
  computeComplianceStatus,
  generateIncidentSummary,
  getRelevantEvents,
  VerdictLevel,
} from "@/lib/eye/verdict";
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
  Bookmark,
  Lock,
  Trash2,
  Brain,
  UserCheck,
  Info,
  MessageSquare,
  Copy,
  XCircle,
  PlayCircle,
  HelpCircle,
} from "lucide-react";

interface DailyAssurancePanelProps {
  allEvents: EyeEvent[];
  issueCount: number;
  onNavigateToTab: (tab: string) => void;
}

// Verdict UI configuration (maps verdict level to display properties)
interface VerdictDisplayConfig {
  icon: typeof CheckCircle2;
  className: string;
  bgClassName: string;
}

const VERDICT_DISPLAY: Record<VerdictLevel, VerdictDisplayConfig> = {
  green: {
    icon: CheckCircle2,
    className: "text-[hsl(var(--status-success))]",
    bgClassName: "bg-[hsl(var(--status-success))]/10 border-[hsl(var(--status-success))]/30",
  },
  yellow: {
    icon: AlertTriangle,
    className: "text-[hsl(var(--status-warning))]",
    bgClassName: "bg-[hsl(var(--status-warning))]/10 border-[hsl(var(--status-warning))]/30",
  },
  red: {
    icon: XOctagon,
    className: "text-destructive",
    bgClassName: "bg-destructive/10 border-destructive/30",
  },
};


export function DailyAssurancePanel({ allEvents, issueCount, onNavigateToTab }: DailyAssurancePanelProps) {
  const [isSupportModalOpen, setIsSupportModalOpen] = useState(false);
  
  // Use the new verdict module - applies "last24h" time filter internally
  const relevantEvents = useMemo(() => getRelevantEvents(allEvents, "last24h"), [allEvents]);
  const counts = useMemo(() => computeActionCounts(relevantEvents), [relevantEvents]);
  const verdict = useMemo(() => computeVerdict(counts), [counts]);
  const outcomes = useMemo(() => computeSessionOutcomes(relevantEvents), [relevantEvents]);
  const compliance = useMemo(() => computeComplianceStatus(relevantEvents), [relevantEvents]);
  
  // Generate incident summary using the new module
  const incidentSummaryResult = useMemo(
    () => generateIncidentSummary(verdict.level, counts, outcomes),
    [verdict.level, counts, outcomes]
  );
  
  // Get display config for the current verdict level
  const verdictDisplay = VERDICT_DISPLAY[verdict.level];
  const VerdictIcon = verdictDisplay.icon;
  
  const handleCopyIncidentSummary = () => {
    navigator.clipboard.writeText(incidentSummaryResult.formattedText);
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
            verdictDisplay.bgClassName
          )}>
            <div className="flex items-start gap-3">
              <VerdictIcon className={cn("h-6 w-6 flex-shrink-0 mt-0.5", verdictDisplay.className)} />
              <div className="flex-1">
                <h3 className={cn("font-semibold text-base", verdictDisplay.className)}>{verdict.title}</h3>
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
                  compliance.llmComplianceStatus === "passed" ? "text-[hsl(var(--status-success))]" : 
                  compliance.llmComplianceStatus === "not_instrumented" ? "text-muted-foreground" : "text-destructive"
                )} />
                <span className="flex items-center gap-1.5">
                  {compliance.llmComplianceStatus === "passed" ? (
                    "All LLM operations used approved, minimized input"
                  ) : compliance.llmComplianceStatus === "not_instrumented" ? (
                    <>
                      LLM compliance tracking
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>
                            <HelpCircle className="h-3 w-3 text-muted-foreground" />
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-xs">
                            <p className="text-xs">Not yet instrumented. LLM compliance events will appear here when the system emits them.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <span className="text-xs text-muted-foreground/60 italic">(DEV)</span>
                    </>
                  ) : (
                    <span className="text-destructive">LLM compliance issue detected</span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <UserCheck className={cn(
                  "h-4 w-4",
                  compliance.userApprovalStatus === "passed" ? "text-[hsl(var(--status-success))]" : 
                  compliance.userApprovalStatus === "not_instrumented" ? "text-muted-foreground" : "text-destructive"
                )} />
                <span className="flex items-center gap-1.5">
                  {compliance.userApprovalStatus === "passed" ? (
                    "All sessions required explicit user approval before generation"
                  ) : compliance.userApprovalStatus === "not_instrumented" ? (
                    <>
                      User approval tracking
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>
                            <HelpCircle className="h-3 w-3 text-muted-foreground" />
                          </TooltipTrigger>
                          <TooltipContent side="right" className="max-w-xs">
                            <p className="text-xs">Not yet instrumented. User approval events will appear here when the system emits them.</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <span className="text-xs text-muted-foreground/60 italic">(DEV)</span>
                    </>
                  ) : (
                    <span className="text-destructive">User approval issue detected</span>
                  )}
                </span>
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
              defaultValue={incidentSummaryResult.formattedText}
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
                navigator.clipboard.writeText(incidentSummaryResult.formattedText);
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
