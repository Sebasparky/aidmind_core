/**
 * Sessions Panel - Session-first default view for Supervisor UI
 * 
 * Shows sessions as the primary organizing unit instead of raw events.
 */

import { useMemo, useState } from "react";
import { EyeEvent } from "@/lib/eye/types";
import { getEventSeverity } from "@/lib/eye/mock-data";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { format, formatDistanceToNow } from "date-fns";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronRight,
  ChevronDown,
  Clock,
  Activity,
  Info,
  User,
  Link2,
} from "lucide-react";

interface SessionsPanelProps {
  events: EyeEvent[];
  onEventClick: (event: EyeEvent) => void;
  selectedEventId?: string;
  onSessionSelect?: (sessionId: string) => void;
}

interface SessionSummary {
  sessionId: string;
  caseId: string | null;
  operatorId: string | null;
  startTime: Date;
  endTime: Date | null;
  status: "clean" | "issues" | "failed" | "active" | "saved" | "resumed";
  totalEvents: number;
  errorCount: number;
  warningCount: number;
  purgeStatus: "verified" | "pending" | "failed" | "none";
  events: EyeEvent[];
  isResumed: boolean;
  linkedBundleId?: string;
}

function groupEventsBySession(events: EyeEvent[]): Map<string, EyeEvent[]> {
  const grouped = new Map<string, EyeEvent[]>();
  
  events.forEach((event) => {
    if (!event.session_id) return;
    
    const existing = grouped.get(event.session_id) || [];
    existing.push(event);
    grouped.set(event.session_id, existing);
  });
  
  return grouped;
}

function calculateSessionSummary(sessionId: string, events: EyeEvent[]): SessionSummary {
  const sortedEvents = [...events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  
  const startEvent = sortedEvents[0];
  const endEvent = sortedEvents.find(
    (e) => e.event_type === "SESSION_CLOSED" || e.event_type === "SESSION_CANCELLED"
  );
  
  // Get operator_id from the first user event
  const operatorEvent = sortedEvents.find(e => e.operator_id);
  const operatorId = operatorEvent?.operator_id ?? null;
  
  const errorCount = events.filter((e) => e.result === "failure").length;
  const warningCount = events.filter((e) => {
    const severity = getEventSeverity(e);
    return severity === "WARN" || severity === "HIGH";
  }).length;
  
  const purgeCompleted = events.find((e) => e.event_type === "PURGE_COMPLETED");
  const purgeFailed = events.find((e) => e.event_type === "PURGE_FAILED");
  const purgeStarted = events.find((e) => e.event_type === "PURGE_STARTED");
  const ephemeralScan = events.find(
    (e) => e.event_type === "EPHEMERAL_SCAN_RESULT" && e.remaining_count === 0
  );
  
  // Check for Save for Later / Resume events
  const wipExported = events.find((e) => e.event_type === "WIP_BUNDLE_EXPORTED");
  const wipImported = events.find((e) => e.event_type === "WIP_BUNDLE_IMPORTED");
  const sessionLinked = events.find((e) => e.event_type === "SESSION_LINKED");
  const isResumed = !!wipImported || !!sessionLinked;
  const linkedBundleId = sessionLinked?.previous_bundle_id ?? wipImported?.bundle_id;
  
  let purgeStatus: SessionSummary["purgeStatus"] = "none";
  if (purgeCompleted && ephemeralScan) {
    purgeStatus = "verified";
  } else if (purgeFailed) {
    purgeStatus = "failed";
  } else if (purgeStarted) {
    purgeStatus = "pending";
  }
  
  let status: SessionSummary["status"] = "active";
  
  // Determine status - check for Saved first
  if (wipExported && !endEvent) {
    status = "saved";
  } else if (endEvent) {
    if (errorCount > 0) {
      status = "failed";
    } else if (warningCount > 0) {
      status = "issues";
    } else if (isResumed) {
      status = "resumed"; // Successfully completed resumed session
    } else {
      status = "clean";
    }
  } else if (isResumed) {
    status = "resumed"; // Active resumed session
  }
  
  return {
    sessionId,
    caseId: startEvent?.case_id ?? null,
    operatorId,
    startTime: new Date(startEvent?.timestamp ?? Date.now()),
    endTime: endEvent ? new Date(endEvent.timestamp) : null,
    status,
    totalEvents: events.length,
    errorCount,
    warningCount,
    purgeStatus,
    events: sortedEvents,
    isResumed,
    linkedBundleId,
  };
}

const STATUS_STYLES: Record<SessionSummary["status"], { icon: typeof CheckCircle2; className: string; label: string }> = {
  clean: { icon: CheckCircle2, className: "text-[hsl(var(--status-success))]", label: "Clean" },
  issues: { icon: AlertTriangle, className: "text-[hsl(var(--status-warning))]", label: "Issues" },
  failed: { icon: XCircle, className: "text-destructive", label: "Failed" },
  active: { icon: Activity, className: "text-[hsl(var(--status-info))]", label: "Active" },
  saved: { icon: Clock, className: "text-muted-foreground", label: "Saved" },
  resumed: { icon: Activity, className: "text-[hsl(var(--status-info))]", label: "Resumed" },
};

const PURGE_STYLES: Record<SessionSummary["purgeStatus"], { className: string; label: string }> = {
  verified: { className: "bg-[hsl(var(--badge-success-bg))] text-[hsl(var(--badge-success-text))]", label: "Verified" },
  pending: { className: "bg-[hsl(var(--badge-warning-bg))] text-[hsl(var(--badge-warning-text))]", label: "Pending" },
  failed: { className: "bg-destructive text-destructive-foreground", label: "Failed" },
  none: { className: "bg-muted text-muted-foreground", label: "—" },
};

interface SessionDetailTimelineProps {
  session: SessionSummary;
  onEventClick: (event: EyeEvent) => void;
  selectedEventId?: string;
}

function SessionDetailTimeline({ session, onEventClick, selectedEventId }: SessionDetailTimelineProps) {
  return (
    <div className="border-t border-border bg-muted/30 divide-y divide-border">
      {session.events.map((event) => {
        const severity = getEventSeverity(event);
        const isLowSeverity = severity === "INFO" || severity === "NOTICE";
        const isSelected = event.event_id === selectedEventId;
        
        return (
          <div
            key={event.event_id}
            onClick={(e) => {
              e.stopPropagation();
              onEventClick(event);
            }}
            className={cn(
              "flex items-center gap-3 px-4 py-2 cursor-pointer transition-colors group",
              isSelected ? "bg-muted" : "hover:bg-muted/50",
              isLowSeverity && "text-muted-foreground"
            )}
          >
            {/* Result indicator */}
            <div className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{
                backgroundColor: event.result === "success" 
                  ? "hsl(var(--status-success))" 
                  : event.result === "failure"
                  ? "hsl(var(--destructive))"
                  : "hsl(var(--status-warning))"
              }}
            />
            
            {/* Event type */}
            <span className={cn(
              "text-xs flex-1 truncate",
              isLowSeverity ? "font-normal" : "font-medium"
            )}>
              {event.event_type.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, l => l.toUpperCase())}
            </span>
            
            {/* Severity badge - only show for high severity or on hover */}
            {!isLowSeverity && (
              <Badge 
                variant="outline" 
                className={cn(
                  "text-[10px] px-1.5 py-0",
                  severity === "WARN" && "bg-[hsl(var(--badge-warning-bg))] text-[hsl(var(--badge-warning-text))] border-transparent",
                  severity === "HIGH" && "bg-[hsl(var(--badge-danger-bg))] text-[hsl(var(--badge-danger-text))] border-transparent",
                  severity === "CRITICAL" && "bg-destructive text-destructive-foreground border-transparent"
                )}
              >
                {severity}
              </Badge>
            )}
            {isLowSeverity && (
              <Badge 
                variant="outline" 
                className="text-[10px] px-1.5 py-0 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                {severity}
              </Badge>
            )}
            
            {/* Timestamp */}
            <span className="text-[10px] text-muted-foreground flex-shrink-0">
              {format(new Date(event.timestamp), "HH:mm:ss")}
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function SessionsPanel({ events, onEventClick, selectedEventId, onSessionSelect }: SessionsPanelProps) {
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  
  const sessions = useMemo(() => {
    const grouped = groupEventsBySession(events);
    const summaries: SessionSummary[] = [];
    
    grouped.forEach((sessionEvents, sessionId) => {
      summaries.push(calculateSessionSummary(sessionId, sessionEvents));
    });
    
    // Sort by start time, newest first
    return summaries.sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
  }, [events]);

  const hasFiltersApplied = false; // Will be passed as prop in future

  if (sessions.length === 0) {
    return (
      <Card className="h-full flex items-center justify-center">
        <div className="text-center text-muted-foreground p-8">
          <Clock className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="text-sm font-medium">No sessions found</p>
          <p className="text-xs mt-1">Sessions will appear here as they occur</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="h-full overflow-hidden flex flex-col">
      {/* Supervisor-friendly framing callout */}
      {!hasFiltersApplied && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-muted/40 border-b border-border text-sm text-muted-foreground">
          <Info className="h-4 w-4 flex-shrink-0" />
          <span>Sessions are shown for transparency into system activity. No PHI is displayed.</span>
        </div>
      )}
      
      <ScrollArea className="flex-1">
        <div className="divide-y divide-border">
          {sessions.map((session) => {
            const StatusIcon = STATUS_STYLES[session.status].icon;
            const isExpanded = expandedSessionId === session.sessionId;
            
            return (
              <div key={session.sessionId}>
                {/* Session Row */}
                <div
                  onClick={() => {
                    setExpandedSessionId(isExpanded ? null : session.sessionId);
                    onSessionSelect?.(session.sessionId);
                  }}
                  className={cn(
                    "flex items-center gap-4 p-4 cursor-pointer transition-colors",
                    isExpanded ? "bg-muted/50" : "hover:bg-muted/30"
                  )}
                >
                  {/* Expand/Collapse indicator */}
                  <div className="flex-shrink-0">
                    {isExpanded ? (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  
                  {/* Status icon */}
                  <div className="flex-shrink-0">
                    <StatusIcon className={cn("h-5 w-5", STATUS_STYLES[session.status].className)} />
                  </div>
                  
                  {/* Session info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-mono text-sm font-medium truncate">
                        {session.sessionId}
                      </span>
                      <Badge 
                        variant="outline" 
                        className={cn("text-xs flex-shrink-0", 
                          session.status === "clean" && "bg-[hsl(var(--badge-success-bg))] text-[hsl(var(--badge-success-text))] border-transparent",
                          session.status === "issues" && "bg-[hsl(var(--badge-warning-bg))] text-[hsl(var(--badge-warning-text))] border-transparent",
                          session.status === "failed" && "bg-destructive text-destructive-foreground border-transparent",
                          session.status === "active" && "bg-[hsl(var(--badge-info-bg))] text-[hsl(var(--badge-info-text))] border-transparent",
                          session.status === "saved" && "bg-muted text-muted-foreground border-transparent",
                          session.status === "resumed" && "bg-[hsl(var(--badge-info-bg))] text-[hsl(var(--badge-info-text))] border-transparent"
                        )}
                      >
                        {STATUS_STYLES[session.status].label}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      {session.operatorId && (
                        <>
                          <span className="flex items-center gap-1">
                            <User className="h-3 w-3" />
                            Operator {session.operatorId}
                          </span>
                          <span>•</span>
                        </>
                      )}
                      <span className="flex-shrink-0">
                        {format(session.startTime, "MMM d, HH:mm")}
                        {session.endTime && ` → ${format(session.endTime, "HH:mm")}`}
                      </span>
                      {session.caseId && (
                        <>
                          <span>•</span>
                          <span className="truncate font-mono text-[10px]">{session.caseId}</span>
                        </>
                      )}
                      {session.isResumed && session.linkedBundleId && (
                        <>
                          <span>•</span>
                          <span className="flex items-center gap-1 text-[10px]">
                            <Link2 className="h-3 w-3" />
                            linked
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  
                  {/* Summary counts */}
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <div className="text-center">
                      <div className="text-sm font-medium">{session.totalEvents}</div>
                      <div className="text-[10px] text-muted-foreground">events</div>
                    </div>
                    
                    {session.errorCount > 0 && (
                      <div className="text-center">
                        <div className="text-sm font-medium text-destructive">{session.errorCount}</div>
                        <div className="text-[10px] text-muted-foreground">errors</div>
                      </div>
                    )}
                    
                    <Badge 
                      variant="outline" 
                      className={cn("text-xs", PURGE_STYLES[session.purgeStatus].className)}
                    >
                      {PURGE_STYLES[session.purgeStatus].label}
                    </Badge>
                  </div>
                </div>
                
                {/* Session Detail Timeline (inline expand) */}
                {isExpanded && (
                  <SessionDetailTimeline 
                    session={session} 
                    onEventClick={onEventClick}
                    selectedEventId={selectedEventId}
                  />
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </Card>
  );
}
