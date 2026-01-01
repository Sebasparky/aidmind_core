/**
 * Purge Proof Panel - Trust signal showing successful purges
 */

import { EyeEvent } from "@/lib/eye/types";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { formatDistanceToNow, format } from "date-fns";
import {
  ShieldCheck,
  CheckCircle2,
  FileX,
  Trash2,
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
    "PURGE_COMPLETED",
  ];

  return allEvents
    .filter((e) => e.session_id === sessionId && purgeEventTypes.includes(e.event_type))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
}

export function PurgeProofPanel({ events, allEvents, onEventClick }: PurgeProofPanelProps) {
  // Get unique sessions with successful purges
  const groupedEvents = groupBySession(events);
  const sessions = Array.from(groupedEvents.keys());

  // Find sessions where remaining_count = 0
  const cleanSessions = sessions.filter((sessionId) => {
    const sessionEvents = groupedEvents.get(sessionId) || [];
    return sessionEvents.some(
      (e) => e.event_type === "EPHEMERAL_SCAN_RESULT" && e.remaining_count === 0
    );
  });

  if (cleanSessions.length === 0) {
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
          <CardTitle className="text-base">Verified Purges</CardTitle>
        </div>
        <CardDescription>
          Sessions with confirmed deletion of all ephemeral data
        </CardDescription>
      </CardHeader>
      <Separator />
      <ScrollArea className="h-[calc(100%-80px)]">
        <CardContent className="p-4 space-y-4">
          {cleanSessions.map((sessionId) => {
            const purgeSequence = getPurgeSequence(sessionId, allEvents);
            const purgeCompleted = purgeSequence.find(
              (e) => e.event_type === "PURGE_COMPLETED"
            );
            const scanResult = purgeSequence.find(
              (e) => e.event_type === "EPHEMERAL_SCAN_RESULT"
            );
            const deletionEvents = purgeSequence.filter(
              (e) => e.event_type.endsWith("_DELETED")
            );

            return (
              <div
                key={sessionId}
                className="border rounded-lg p-4 bg-[hsl(var(--status-success-muted)/0.3)] border-[hsl(var(--status-success)/0.2)]"
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-[hsl(var(--status-success))]" />
                    <span className="font-mono text-sm font-medium">
                      {sessionId}
                    </span>
                  </div>
                  <Badge className="bg-[hsl(var(--badge-success-bg))] text-[hsl(var(--badge-success-text))]">
                    Clean
                  </Badge>
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
                      <span>{event.event_type.replace(/_DELETED$/, "").toLowerCase()}</span>
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
                    <FileX className="h-4 w-4 text-[hsl(var(--status-success))]" />
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
