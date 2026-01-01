/**
 * Event Feed - Chronological list of Eye events
 */

import { EyeEvent, EVENT_CATEGORY_MAP, EVENT_SEVERITY_MAP } from "@/lib/eye/types";
import { getEventCategory, getEventSeverity } from "@/lib/eye/mock-data";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronRight,
} from "lucide-react";

interface EventFeedProps {
  events: EyeEvent[];
  onEventClick: (event: EyeEvent) => void;
  selectedEventId?: string;
}

const SEVERITY_STYLES: Record<string, string> = {
  INFO: "bg-[hsl(var(--badge-info-bg))] text-[hsl(var(--badge-info-text))]",
  NOTICE: "bg-[hsl(var(--badge-success-bg))] text-[hsl(var(--badge-success-text))]",
  WARN: "bg-[hsl(var(--badge-warning-bg))] text-[hsl(var(--badge-warning-text))]",
  HIGH: "bg-[hsl(var(--badge-danger-bg))] text-[hsl(var(--badge-danger-text))]",
  CRITICAL: "bg-destructive text-destructive-foreground",
};

const CATEGORY_STYLES: Record<string, string> = {
  AUTH: "border-l-[hsl(var(--status-info))]",
  SESSION: "border-l-[hsl(var(--status-success))]",
  INGEST: "border-l-[hsl(var(--status-info))]",
  TRANSCRIPTION: "border-l-[hsl(var(--primary))]",
  REDACTION: "border-l-[hsl(var(--status-warning))]",
  GENERATION: "border-l-[hsl(var(--status-info))]",
  VALIDATION: "border-l-[hsl(var(--status-warning))]",
  DRAFT: "border-l-[hsl(var(--status-success))]",
  EXPORT: "border-l-[hsl(var(--status-success))]",
  PURGE: "border-l-[hsl(var(--status-danger))]",
  CONFIG: "border-l-[hsl(var(--muted-foreground))]",
  ANOMALY: "border-l-destructive",
};

function ResultIcon({ result }: { result: string }) {
  switch (result) {
    case "success":
      return <CheckCircle2 className="h-4 w-4 text-[hsl(var(--status-success))]" />;
    case "failure":
      return <XCircle className="h-4 w-4 text-destructive" />;
    case "partial":
      return <AlertCircle className="h-4 w-4 text-[hsl(var(--status-warning))]" />;
    default:
      return null;
  }
}

function formatEventType(type: string): string {
  return type
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (l) => l.toUpperCase());
}

export function EventFeed({ events, onEventClick, selectedEventId }: EventFeedProps) {
  if (events.length === 0) {
    return (
      <Card className="h-full flex items-center justify-center">
        <div className="text-center text-muted-foreground">
          <p className="text-sm">No events match the current filters</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="h-full overflow-hidden">
      <ScrollArea className="h-full">
        <div className="divide-y divide-border">
          {events.map((event) => {
            const category = getEventCategory(event);
            const severity = getEventSeverity(event);
            const isSelected = event.event_id === selectedEventId;

            return (
              <div
                key={event.event_id}
                onClick={() => onEventClick(event)}
                className={cn(
                  "flex items-center gap-4 p-4 cursor-pointer transition-colors border-l-4",
                  CATEGORY_STYLES[category] || "border-l-transparent",
                  isSelected
                    ? "bg-muted"
                    : "hover:bg-muted/50"
                )}
              >
                {/* Result Icon */}
                <div className="flex-shrink-0">
                  <ResultIcon result={event.result} />
                </div>

                {/* Event Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-medium text-sm truncate">
                      {formatEventType(event.event_type)}
                    </span>
                    <Badge 
                      variant="outline" 
                      className={cn("text-xs flex-shrink-0", SEVERITY_STYLES[severity])}
                    >
                      {severity}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="truncate">{event.actor_role || event.actor_type}</span>
                    <span>•</span>
                    <span className="truncate">{event.session_id?.slice(0, 16) || "—"}</span>
                    <span>•</span>
                    <span className="flex-shrink-0">
                      {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                    </span>
                  </div>
                </div>

                {/* Chevron */}
                <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </Card>
  );
}
