/**
 * Issues Panel - Combined errors and warnings view
 * 
 * Reframed around supervisor intent: "What needs attention?"
 */

import { useMemo } from "react";
import { EyeEvent } from "@/lib/eye/types";
import { getEventSeverity } from "@/lib/eye/mock-data";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
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
} from "lucide-react";

interface IssuesPanelProps {
  events: EyeEvent[];
  onEventClick: (event: EyeEvent) => void;
}

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

export function IssuesPanel({ events, onEventClick }: IssuesPanelProps) {
  const issueEvents = useMemo(() => getIssueEvents(events), [events]);
  const groupedEvents = useMemo(() => groupByType(issueEvents), [issueEvents]);
  const eventTypes = Array.from(groupedEvents.keys()).sort();

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
          <Badge variant="destructive" className="ml-auto">
            {issueEvents.length}
          </Badge>
        </div>
        <CardDescription>
          Errors and warnings requiring attention
        </CardDescription>
      </CardHeader>
      <Separator />
      <ScrollArea className="h-[calc(100%-80px)]">
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
                    
                    return (
                      <div
                        key={event.event_id}
                        onClick={() => onEventClick(event)}
                        className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/30 transition-colors"
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
