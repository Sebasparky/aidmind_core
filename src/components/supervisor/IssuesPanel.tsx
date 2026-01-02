/**
 * Issues Panel - Combined errors and warnings view with "Reviewed" state
 * 
 * Reframed around supervisor intent: "What needs attention?"
 * Badge shows unreviewed count only to reduce "issue count anxiety"
 */

import { useMemo, useState, useCallback } from "react";
import { EyeEvent } from "@/lib/eye/types";
import { getEventSeverity } from "@/lib/eye/mock-data";
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
  Check,
  Eye,
  EyeOff,
  CheckCheck,
} from "lucide-react";

interface IssuesPanelProps {
  events: EyeEvent[];
  onEventClick: (event: EyeEvent) => void;
  reviewedIds: Set<string>;
  onMarkReviewed: (eventId: string) => void;
  onMarkAllReviewed: () => void;
}

type FilterMode = "all" | "unreviewed" | "reviewed";

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
function getIssueDisplayName(eventType: string): string {
  const names: Record<string, string> = {
    TRANSCRIPTION_FAILED: "Transcription Failures",
    REDACTION_FAILED: "Redaction Failures",
    PURGE_FAILED: "Purge Failures",
    AUDIO_UPLOAD_FAILED: "Upload Failures",
    VERIFICATION_FAILED: "Verification Failures",
  };
  return names[eventType] || eventType.replace(/_/g, " ");
}

export function IssuesPanel({ events, onEventClick, reviewedIds, onMarkReviewed, onMarkAllReviewed }: IssuesPanelProps) {
  const [filterMode, setFilterMode] = useState<FilterMode>("unreviewed");
  
  const issueEvents = useMemo(() => getIssueEvents(events), [events]);
  
  const filteredIssues = useMemo(() => {
    if (filterMode === "all") return issueEvents;
    if (filterMode === "reviewed") return issueEvents.filter(e => reviewedIds.has(e.event_id));
    return issueEvents.filter(e => !reviewedIds.has(e.event_id));
  }, [issueEvents, reviewedIds, filterMode]);
  
  const groupedEvents = useMemo(() => groupByType(filteredIssues), [filteredIssues]);
  const eventTypes = Array.from(groupedEvents.keys()).sort();
  
  const unreviewedCount = useMemo(() => 
    issueEvents.filter(e => !reviewedIds.has(e.event_id)).length, 
    [issueEvents, reviewedIds]
  );

  // All issues reviewed state
  if (issueEvents.length > 0 && unreviewedCount === 0 && filterMode === "unreviewed") {
    return (
      <Card className="h-full flex items-center justify-center">
        <div className="text-center text-muted-foreground p-8">
          <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-[hsl(var(--status-success))] opacity-70" />
          <p className="text-sm font-medium">All issues reviewed</p>
          <p className="text-xs mt-1 mb-4">
            New issues will appear here automatically.
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
          <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-[hsl(var(--status-success))] opacity-70" />
          <p className="text-sm font-medium">No issues to review</p>
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
          <CardTitle className="text-base">Issues</CardTitle>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Badge variant="destructive" className="ml-auto cursor-help">
                  {unreviewedCount}
                </Badge>
              </TooltipTrigger>
              <TooltipContent>
                <p>Badge shows unreviewed issues only</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <div className="flex items-center justify-between mt-2">
          <CardDescription>
            Errors and warnings requiring attention
          </CardDescription>
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
              variant={filterMode === "unreviewed" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setFilterMode("unreviewed")}
            >
              <EyeOff className="h-3 w-3 mr-1" />
              Unreviewed
            </Button>
            <Button
              variant={filterMode === "reviewed" ? "secondary" : "ghost"}
              size="sm"
              className="h-7 text-xs"
              onClick={() => setFilterMode("reviewed")}
            >
              <Eye className="h-3 w-3 mr-1" />
              Reviewed
            </Button>
          </div>
          {unreviewedCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-muted-foreground"
              onClick={onMarkAllReviewed}
            >
              <CheckCheck className="h-3 w-3 mr-1" />
              Mark all reviewed
            </Button>
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
                    const isReviewed = reviewedIds.has(event.event_id);
                    
                    return (
                      <div
                        key={event.event_id}
                        className={cn(
                          "flex items-center gap-3 p-3 cursor-pointer transition-colors group",
                          isReviewed ? "opacity-60 bg-muted/20" : "hover:bg-muted/30"
                        )}
                      >
                        {/* Mark reviewed button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            onMarkReviewed(event.event_id);
                          }}
                          className={cn(
                            "flex-shrink-0 p-1 rounded transition-colors",
                            isReviewed 
                              ? "text-[hsl(var(--status-success))]" 
                              : "text-muted-foreground/50 hover:text-foreground hover:bg-muted"
                          )}
                        >
                          <Check className="h-4 w-4" />
                        </button>
                        
                        <div 
                          className="flex-1 min-w-0 flex items-center gap-3"
                          onClick={() => {
                            onEventClick(event);
                            if (!isReviewed) onMarkReviewed(event.event_id);
                          }}
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