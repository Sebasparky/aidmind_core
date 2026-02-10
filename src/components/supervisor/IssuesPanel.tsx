/**
 * Issues Panel - Combined errors and warnings view with local "seen" tracking
 * 
 * Reframed around supervisor intent: "What needs attention?"
 * Badge shows unseen count only to reduce "issue count anxiety"
 * 
 * IMPORTANT: Seen state is local to the browser session.
 * It does NOT change system state, persist, or imply audit action.
 */

import { useMemo, useState } from "react";
import { EyeEvent, getEventSeverity } from "@/lib/eye/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import {
  AlertTriangle,
  XCircle,
  AlertCircle,
  ChevronRight,
  Mic,
  FileText,
  Trash2,
  CheckCircle2,
  Circle,
  CheckCircle,
  EyeOff,
  Info,
} from "lucide-react";

interface IssuesPanelProps {
  events: EyeEvent[];
  onEventClick: (event: EyeEvent) => void;
  acknowledgedIds: Set<string>;
  onToggleAcknowledged: (eventId: string) => void;
  onAcknowledgeAll: () => void;
}

type FilterMode = "all" | "new" | "seen";

// Get all events with warnings or errors
function getIssueEvents(events: EyeEvent[]): EyeEvent[] {
  return events.filter((event) => {
    const severity = getEventSeverity(event);
    return event.result === "failure" || severity === "WARN" || severity === "HIGH" || severity === "CRITICAL";
  });
}

// Group events by type
function groupByType(events: EyeEvent[]): Map<string, EyeEvent[]> {
  const grouped = new Map<string, EyeEvent[]>();
  
  events.forEach((event) => {
    const existing = grouped.get(event.event_type) || [];
    existing.push(event);
    grouped.set(event.event_type, existing);
  });

  return grouped;
}

// Get icon for issue type
function getIssueIcon(eventType: string): React.ReactNode {
  if (eventType.includes("TRANSCRIPTION")) {
    return <Mic className="h-4 w-4" />;
  }
  if (eventType.includes("REDACTION")) {
    return <FileText className="h-4 w-4" />;
  }
  if (eventType.includes("PURGE")) {
    return <Trash2 className="h-4 w-4" />;
  }
  return <AlertTriangle className="h-4 w-4" />;
}

// Get display name for issue type
// NOTE: TRANSCRIPTION_*, REDACTION_*, VERIFICATION_*, and AUDIO_* are Legacy (v0 pipeline)
function getIssueDisplayName(eventType: string): string {
  const names: Record<string, string> = {
    // Legacy – v0 pipeline events (not emitting in v1)
    TRANSCRIPTION_FAILED: "Transcription Failures (Legacy – v0 pipeline)",
    REDACTION_FAILED: "Redaction Failures (Legacy – v0 pipeline)",
    AUDIO_UPLOAD_FAILED: "Upload Failures (Legacy – v0 pipeline)",
    VERIFICATION_FAILED: "Verification Failures (Legacy – v0 pipeline)",
    // Active v1 events
    PURGE_FAILED: "Purge Failures",
  };
  return names[eventType] || eventType.replace(/_/g, " ");
}

export function IssuesPanel({ events, onEventClick, acknowledgedIds = new Set(), onToggleAcknowledged, onAcknowledgeAll }: IssuesPanelProps) {
  const [filterMode, setFilterMode] = useState<FilterMode>("new");
  
  const issueEvents = useMemo(() => getIssueEvents(events), [events]);
  
  const filteredIssues = useMemo(() => {
    if (filterMode === "all") return issueEvents;
    if (filterMode === "seen") return issueEvents.filter(e => acknowledgedIds.has(e.event_id));
    return issueEvents.filter(e => !acknowledgedIds.has(e.event_id));
  }, [issueEvents, acknowledgedIds, filterMode]);
  
  const groupedEvents = useMemo(() => groupByType(filteredIssues), [filteredIssues]);
  const eventTypes = Array.from(groupedEvents.keys()).sort();
  
  const newCount = useMemo(() => 
    issueEvents.filter(e => !acknowledgedIds.has(e.event_id)).length, 
    [issueEvents, acknowledgedIds]
  );

  // All issues seen — calm empty state
  if (issueEvents.length > 0 && newCount === 0 && filterMode === "new") {
    return (
      <Card className="h-full flex items-center justify-center">
        <div className="text-center text-muted-foreground p-8">
          <Circle className="h-12 w-12 mx-auto mb-4 text-muted-foreground/30" />
          <p className="text-sm font-medium">No new issues.</p>
          <p className="text-xs mt-1 mb-4">
            Seen state is local to your session.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setFilterMode("all")}
          >
            View all issues
          </Button>
        </div>
      </Card>
    );
  }

  if (issueEvents.length === 0) {
    return (
      <Card className="h-full flex items-center justify-center">
        <div className="text-center text-muted-foreground p-8">
          <Circle className="h-12 w-12 mx-auto mb-4 text-muted-foreground/30" />
          <p className="text-sm font-medium">No issues at this time</p>
          <p className="text-xs mt-1">
            All operations completed successfully
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="h-full overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-5 w-5 text-[hsl(var(--status-warning))]" />
          <div>
            <CardTitle className="text-base">System Issues</CardTitle>
            <span className="text-xs text-muted-foreground">Not caseworker errors</span>
          </div>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="destructive" className="ml-auto cursor-help">
                  {newCount}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p>Issues not yet seen in this session</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        {/* Supervisor-friendly framing callout */}
        <div className="flex items-center gap-2 mt-2 p-2 rounded bg-muted/40 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 flex-shrink-0" />
          <span>Issues reflect system-level warnings/errors. Caseworkers are not responsible for resolving platform failures.</span>
        </div>
        
        {/* Filter row */}
        <div className="flex items-center justify-between pt-2">
          <div className="flex gap-1">
            <Button
              variant={filterMode === "all" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setFilterMode("all")}
            >
              All
            </Button>
            <Button
              variant={filterMode === "new" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setFilterMode("new")}
            >
              <EyeOff className="h-3 w-3 mr-1" />
              New
            </Button>
            <Button
              variant={filterMode === "seen" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setFilterMode("seen")}
            >
              <CheckCircle className="h-3 w-3 mr-1" />
              Seen
            </Button>
          </div>
          {newCount > 0 && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-muted-foreground"
                    onClick={onAcknowledgeAll}
                  >
                    Mark all as seen
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p className="max-w-[200px] text-xs">Seen state is local to your session and does not change system state.</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </CardHeader>
      <Separator />
      <ScrollArea className="h-[calc(100%-140px)]">
        <CardContent className="p-4 space-y-4">
          {eventTypes.map((eventType) => {
            const typeEvents = groupedEvents.get(eventType) || [];
            const icon = getIssueIcon(eventType);
            const displayName = getIssueDisplayName(eventType);

            return (
              <div key={eventType} className="border rounded-lg overflow-hidden">
                {/* Group Header */}
                <div className="flex items-center gap-3 p-3 bg-muted/50">
                  <div className="p-1.5 rounded bg-[hsl(var(--status-danger-muted))] text-[hsl(var(--status-danger))]">
                    {icon}
                  </div>
                  <div className="flex-1">
                    <div className="font-medium text-sm">{displayName}</div>
                    <div className="text-xs text-muted-foreground">
                      {typeEvents.length} occurrence{typeEvents.length !== 1 ? "s" : ""}
                    </div>
                  </div>
                </div>

                {/* Event List */}
                <div className="divide-y divide-border">
                  {typeEvents.map((event) => {
                    const severity = getEventSeverity(event);
                    const isAcknowledged = acknowledgedIds.has(event.event_id);
                    
                    return (
                      <div
                        key={event.event_id}
                        className={cn(
                          "flex items-center gap-3 p-3 cursor-pointer transition-colors group",
                          isAcknowledged ? "opacity-50 bg-muted/20" : "hover:bg-muted/30"
                        )}
                      >
                        {/* Seen toggle */}
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onToggleAcknowledged(event.event_id);
                                }}
                                className={cn(
                                  "flex-shrink-0 p-0.5 rounded transition-colors",
                                  isAcknowledged 
                                    ? "text-muted-foreground" 
                                    : "text-muted-foreground/30 hover:text-muted-foreground hover:bg-muted"
                                )}
                                aria-label={isAcknowledged ? "Mark as unseen" : "Mark as seen"}
                              >
                                {isAcknowledged ? (
                                  <CheckCircle className="h-4 w-4" />
                                ) : (
                                  <Circle className="h-4 w-4" />
                                )}
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="right">
                              <p className="max-w-[200px] text-xs">
                                Seen state is local to your session and does not change system state.
                              </p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        
                        <div 
                          className="flex-1 min-w-0 flex items-center gap-3"
                          onClick={() => onEventClick(event)}
                        >
                          {event.result === "failure" ? (
                            <XCircle className="h-4 w-4 text-destructive flex-shrink-0" />
                          ) : (
                            <AlertCircle className="h-4 w-4 text-[hsl(var(--status-warning))] flex-shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-mono truncate">
                                {event.session_id?.slice(0, 16) || "—"}
                              </span>
                              {event.reason_code && (
                                <Badge variant="outline" className="text-xs">
                                  {event.reason_code}
                                </Badge>
                              )}
                              <Badge 
                                variant="outline" 
                                className={cn(
                                  "text-xs",
                                  severity === "WARN" && "bg-[hsl(var(--badge-warning-bg))] text-[hsl(var(--badge-warning-text))] border-transparent",
                                  severity === "HIGH" && "bg-[hsl(var(--badge-danger-bg))] text-[hsl(var(--badge-danger-text))] border-transparent",
                                  severity === "CRITICAL" && "bg-destructive text-destructive-foreground border-transparent"
                                )}
                              >
                                {severity}
                              </Badge>
                            </div>
                            <div className="text-xs text-muted-foreground mt-0.5">
                              {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                            </div>
                          </div>
                          <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </CardContent>
      </ScrollArea>
    </Card>
  );
}
