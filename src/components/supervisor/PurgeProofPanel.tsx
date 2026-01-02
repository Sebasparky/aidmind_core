/**
 * Data Deletion Proof Panel - Trust signal showing successful purges
 * 
 * Reframed from "Purge Proof" to "Data Deletion Proof" for clarity.
 * Shows operator_id and session end time for each deletion card.
 */

import { useState, useMemo } from "react";
import { EyeEvent } from "@/lib/eye/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, format } from "date-fns";
import {
  ShieldCheck,
  CheckCircle2,
  FileX,
  Trash2,
  User,
  Filter,
  Info,
} from "lucide-react";

interface PurgeProofPanelProps {
  events: EyeEvent[];
  allEvents: EyeEvent[];
  onEventClick: (event: EyeEvent) => void;
}

// Group events by session
function groupBySession(events: EyeEvent[]): Map<string, EyeEvent[]> {
  const grouped = new Map<string, EyeEvent[]>();
  
  events.forEach((event) => {
    if (!event.session_id) return;
    
    const existing = grouped.get(event.session_id) || [];
    existing.push(event);
    grouped.set(event.session_id, existing);
  });

  return grouped;
}

// Get full purge sequence for a session
function getPurgeSequence(sessionId: string, allEvents: EyeEvent[]): EyeEvent[] {
  const purgeEventTypes = [
    "PURGE_STARTED",
    "AUDIO_DELETED",
    "TRANSCRIPT_DELETED",
    "MINIMIZED_TRANSCRIPT_DELETED",
    "DRAFT_DELETED",
    "EPHEMERAL_SCAN_RESULT",
    "EPHEMERAL_INPUTS_PURGED",
    "PURGE_COMPLETED",
  ];

  return allEvents
    .filter((e) => e.session_id === sessionId && purgeEventTypes.includes(e.event_type))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

// Get operator_id for a session
function getSessionOperator(sessionId: string, allEvents: EyeEvent[]): string | null {
  const sessionEvent = allEvents.find(e => e.session_id === sessionId && e.operator_id);
  return sessionEvent?.operator_id ?? null;
}

// Get session end time
function getSessionEndTime(sessionId: string, allEvents: EyeEvent[]): Date | null {
  const endEvent = allEvents.find(
    e => e.session_id === sessionId && 
    (e.event_type === "SESSION_CLOSED" || e.event_type === "SESSION_CANCELLED" || e.event_type === "PURGE_COMPLETED")
  );
  return endEvent ? new Date(endEvent.timestamp) : null;
}

export function PurgeProofPanel({ events, allEvents, onEventClick }: PurgeProofPanelProps) {
  const [showVerifiedOnly, setShowVerifiedOnly] = useState(true);
  
  // Get unique sessions with successful purges
  const groupedEvents = groupBySession(events);
  const sessions = Array.from(groupedEvents.keys());

  // Find sessions where remaining_count = 0
  const cleanSessions = useMemo(() => {
    return sessions.filter((sessionId) => {
      const sessionEvents = groupedEvents.get(sessionId) || [];
      return sessionEvents.some(
        (e) => e.event_type === "EPHEMERAL_SCAN_RESULT" && e.remaining_count === 0
      );
    });
  }, [sessions, groupedEvents]);

  // Filter based on toggle
  const displayedSessions = showVerifiedOnly ? cleanSessions : sessions;

  if (sessions.length === 0) {
    return (
      <Card className="h-full flex items-center justify-center">
        <div className="text-center text-muted-foreground p-8">
          <ShieldCheck className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p className="text-sm font-medium">No purge proof events yet</p>
          <p className="text-xs mt-1">
            Completed sessions with verified purges will appear here
          </p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="h-full overflow-hidden">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-[hsl(var(--status-success))]" />
          <CardTitle className="text-base">Verified Data Deletions</CardTitle>
          <Badge className="ml-auto bg-[hsl(var(--badge-success-bg))] text-[hsl(var(--badge-success-text))]">
            {cleanSessions.length} verified
          </Badge>
        </div>
        {/* Supervisor-friendly framing callout */}
        <div className="flex items-center gap-2 mt-2 p-2 rounded bg-muted/40 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 flex-shrink-0" />
          <span>Verified sessions have deleted all ephemeral data. Use this for compliance assurance.</span>
        </div>
        
        {/* Filter toggle */}
        <div className="flex items-center gap-2 pt-2">
          <Button
            variant={showVerifiedOnly ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => setShowVerifiedOnly(true)}
          >
            <CheckCircle2 className="h-3 w-3" />
            Verified only
          </Button>
          <Button
            variant={!showVerifiedOnly ? "secondary" : "ghost"}
            size="sm"
            className="h-7 text-xs gap-1"
            onClick={() => setShowVerifiedOnly(false)}
          >
            <Filter className="h-3 w-3" />
            Show all
          </Button>
        </div>
      </CardHeader>
      <Separator />
      <ScrollArea className="h-[calc(100%-130px)]">
        <CardContent className="p-4 space-y-4">
          {displayedSessions.map((sessionId) => {
            const purgeSequence = getPurgeSequence(sessionId, allEvents);
            const purgeCompleted = purgeSequence.find(
              (e) => e.event_type === "PURGE_COMPLETED"
            );
            const scanResult = purgeSequence.find(
              (e) => e.event_type === "EPHEMERAL_SCAN_RESULT"
            );
            const deletionEvents = purgeSequence.filter(
              (e) => e.event_type.endsWith("_DELETED") || e.event_type === "EPHEMERAL_INPUTS_PURGED"
            );
            const operatorId = getSessionOperator(sessionId, allEvents);
            const sessionEndTime = getSessionEndTime(sessionId, allEvents);
            const isVerified = scanResult?.remaining_count === 0;

            return (
              <div
                key={sessionId}
                className={cn(
                  "border rounded-lg p-4",
                  isVerified 
                    ? "bg-[hsl(var(--status-success-muted)/0.3)] border-[hsl(var(--status-success)/0.2)]"
                    : "bg-muted/30 border-border"
                )}
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className={cn(
                      "h-5 w-5",
                      isVerified ? "text-[hsl(var(--status-success))]" : "text-muted-foreground"
                    )} />
                    <span className="font-mono text-sm font-medium">
                      {sessionId}
                    </span>
                  </div>
                  <Badge className={cn(
                    isVerified 
                      ? "bg-[hsl(var(--badge-success-bg))] text-[hsl(var(--badge-success-text))]"
                      : "bg-muted text-muted-foreground"
                  )}>
                    {isVerified ? "Verified" : "Pending"}
                  </Badge>
                </div>

                {/* Operator and session end time */}
                <div className="flex items-center gap-4 mb-3 text-xs text-muted-foreground">
                  {operatorId && (
                    <span className="flex items-center gap-1">
                      <User className="h-3 w-3" />
                      Operator {operatorId}
                    </span>
                  )}
                  {sessionEndTime && (
                    <span>
                      Session ended {format(sessionEndTime, "MMM d, HH:mm")}
                    </span>
                  )}
                </div>

                {/* Deletion Summary */}
                <div className="space-y-2 mb-3">
                  {deletionEvents.map((event) => (
                    <div
                      key={event.event_id}
                      onClick={() => onEventClick(event)}
                      className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer transition-colors"
                    >
                      <Trash2 className="h-3 w-3" />
                      <span>
                        {event.event_type === "EPHEMERAL_INPUTS_PURGED" 
                          ? "ephemeral inputs" 
                          : event.event_type.replace(/_DELETED$/, "").toLowerCase()}
                      </span>
                      <span className="text-muted-foreground/50">•</span>
                      <span>
                        {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                      </span>
                    </div>
                  ))}
                </div>

                {/* Scan Result */}
                {scanResult && (
                  <div
                    onClick={() => onEventClick(scanResult)}
                    className="flex items-center gap-2 p-2 rounded bg-background/50 cursor-pointer hover:bg-background transition-colors"
                  >
                    <FileX className={cn(
                      "h-4 w-4",
                      isVerified ? "text-[hsl(var(--status-success))]" : "text-muted-foreground"
                    )} />
                    <div className="flex-1">
                      <div className="text-xs font-medium">Ephemeral Scan</div>
                      <div className="text-xs text-muted-foreground">
                        {scanResult.remaining_count === 0
                          ? "No artifacts remaining"
                          : `${scanResult.remaining_count} items remaining`}
                      </div>
                    </div>
                    {purgeCompleted && (
                      <div className="text-xs text-muted-foreground">
                        {format(new Date(purgeCompleted.timestamp), "HH:mm:ss")}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </CardContent>
      </ScrollArea>
    </Card>
  );
}
