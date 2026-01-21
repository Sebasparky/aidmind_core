/**
 * Event Feed - Chronological list of Eye events (Session Detail Timeline)
 * 
 * Now used as the detail view when drilling into a session.
 * Implements visual noise reduction for low-severity events.
 * Includes source badges for event origin (System, Policy, Legacy, Coordination).
 */

import { EyeEvent, getEventCategory, getEventSeverity, EventCategory } from "@/lib/eye/types";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  ChevronRight,
  ArrowLeftRight,
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
  COORDINATION: "border-l-[hsl(var(--primary))]",
};

// Source badge styles
type EventSourceType = "system" | "policy" | "legacy" | "coordination";

const SOURCE_STYLES: Record<EventSourceType, { bg: string; text: string }> = {
  system: { bg: "bg-muted", text: "text-muted-foreground" },
  policy: { bg: "bg-[hsl(var(--badge-info-bg))]", text: "text-[hsl(var(--badge-info-text))]" },
  legacy: { bg: "bg-[hsl(var(--badge-warning-bg))]", text: "text-[hsl(var(--badge-warning-text))]" },
  coordination: { bg: "bg-[hsl(217_91%_60%/0.15)]", text: "text-primary" },
};

// Determine event source based on category/type
function getEventSource(event: EyeEvent): EventSourceType {
  const category = getEventCategory(event);
  
  // Coordination events from The Platform
  if (category === "COORDINATION") {
    return "coordination";
  }
  
  // Legacy v0 pipeline events
  if (category === "TRANSCRIPTION" || category === "REDACTION") {
    return "legacy";
  }
  
  // Policy/governance events
  if (category === "GOVERNANCE" || category === "AUTH") {
    return "policy";
  }
  
  // Default to system
  return "system";
}

function ResultIcon({ result, muted }: { result: string; muted?: boolean }) {
  const baseClass = muted ? "opacity-50" : "";
  switch (result) {
    case "success":
      return <CheckCircle2 className={cn("h-4 w-4 text-[hsl(var(--status-success))]", baseClass)} />;
    case "failure":
      return <XCircle className={cn("h-4 w-4 text-destructive", baseClass)} />;
    case "partial":
      return <AlertCircle className={cn("h-4 w-4 text-[hsl(var(--status-warning))]", baseClass)} />;
    default:
      return null;
  }
}

// Legacy v0 pipeline event prefixes (not emitting in v1)
const LEGACY_EVENT_PREFIXES = ["TRANSCRIPTION_", "REDACTION_", "VERIFICATION_", "AUDIO_UPLOAD", "AUDIO_UPLOADED"];

function formatEventType(type: string): string {
  const isLegacy = LEGACY_EVENT_PREFIXES.some(prefix => type.startsWith(prefix));
  const formatted = type
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (l) => l.toUpperCase());
  return isLegacy ? `${formatted} (Legacy)` : formatted;
}

// Format coordination event titles for readability
function getEventTitle(event: EyeEvent): string {
  const type = event.event_type;
  
  // Special formatting for coordination events
  if (type === "COORDINATION_REFERRAL_STALLED") {
    return "Referral Stalled";
  }
  if (type === "COORDINATION_SLA_BREACHED") {
    return "SLA Breached";
  }
  if (type === "COORDINATION_EXTERNAL_ACK_DELAYED") {
    return "Acknowledgment Delayed";
  }
  if (type === "COORDINATION_REPEATED_HANDOFF_FAILURE") {
    return "Repeated Handoff Failure";
  }
  
  return formatEventType(type);
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
            const source = getEventSource(event);
            const isSelected = event.event_id === selectedEventId;
            const isLowSeverity = severity === "INFO" || severity === "NOTICE";
            const isHighSeverity = severity === "WARN" || severity === "HIGH" || severity === "CRITICAL";
            const isCoordination = category === "COORDINATION";

            return (
              <div
                key={event.event_id}
                onClick={() => onEventClick(event)}
                className={cn(
                  "flex items-center gap-4 p-4 cursor-pointer transition-colors border-l-4 group",
                  // Only show colored border for high severity events or coordination
                  isHighSeverity || isCoordination ? CATEGORY_STYLES[category] : "border-l-transparent",
                  isSelected ? "bg-muted" : "hover:bg-muted/50",
                  // Muted styling for low severity (unless coordination)
                  isLowSeverity && !isCoordination && "text-muted-foreground"
                )}
              >
                {/* Result Icon or Coordination Icon */}
                <div className="flex-shrink-0">
                  {isCoordination ? (
                    <ArrowLeftRight className="h-4 w-4 text-primary" />
                  ) : (
                    <ResultIcon result={event.result} muted={isLowSeverity} />
                  )}
                </div>

                {/* Event Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className={cn(
                      "text-sm truncate",
                      isLowSeverity && !isCoordination ? "font-normal" : "font-medium"
                    )}>
                      {getEventTitle(event)}
                    </span>
                    
                    {/* Source Badge */}
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Badge
                          variant="outline"
                          className={cn("text-xs flex-shrink-0", SOURCE_STYLES[source].bg, SOURCE_STYLES[source].text)}
                        >
                          {source === "coordination" ? "Coordination" : 
                           source === "legacy" ? "Legacy" :
                           source === "policy" ? "Policy" : "System"}
                        </Badge>
                      </TooltipTrigger>
                      <TooltipContent>
                        {source === "coordination" && "Signal from The Platform coordination layer"}
                        {source === "legacy" && "Legacy v0 pipeline event (disabled in v1)"}
                        {source === "policy" && "Policy or governance event"}
                        {source === "system" && "System-generated event"}
                      </TooltipContent>
                    </Tooltip>
                    
                    {/* Severity Badge */}
                    {isHighSeverity && (
                      <Badge 
                        variant="outline" 
                        className={cn("text-xs flex-shrink-0", SEVERITY_STYLES[severity])}
                      >
                        {severity}
                      </Badge>
                    )}
                    {isLowSeverity && (
                      <Badge 
                        variant="outline" 
                        className={cn(
                          "text-xs flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity",
                          SEVERITY_STYLES[severity]
                        )}
                      >
                        {severity}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="truncate">{event.actor_role || event.actor_type}</span>
                    <span>•</span>
                    <span className="truncate">{event.session_id?.slice(0, 16) || event.case_id?.slice(0, 16) || "—"}</span>
                    <span>•</span>
                    <span className="flex-shrink-0">
                      {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                    </span>
                  </div>
                </div>

                {/* Chevron */}
                <ChevronRight className={cn(
                  "h-4 w-4 text-muted-foreground flex-shrink-0",
                  isLowSeverity && !isCoordination && "opacity-50"
                )} />
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </Card>
  );
}
