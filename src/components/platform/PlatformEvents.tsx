/**
 * Platform Events & Audit Page
 * 
 * Event explorer with filters. Includes retention model info panel.
 */

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MOCK_PLATFORM_EVENTS, PROGRAMS } from "@/lib/platform/mock-data";
import { PlatformEvent, EventSource, EventSeverity } from "@/lib/platform/types";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Search,
  ScrollText,
  Clock,
  AlertTriangle,
  Info,
  CheckCircle2,
  Filter,
  Database,
} from "lucide-react";

const SEVERITY_STYLES: Record<EventSeverity, { bg: string; text: string; icon: typeof Info }> = {
  info: { bg: "bg-[hsl(var(--badge-info-bg))]", text: "text-[hsl(var(--badge-info-text))]", icon: Info },
  warn: { bg: "bg-[hsl(var(--badge-warning-bg))]", text: "text-[hsl(var(--badge-warning-text))]", icon: AlertTriangle },
  error: { bg: "bg-destructive", text: "text-destructive-foreground", icon: AlertTriangle },
};

const SOURCE_STYLES: Record<EventSource, string> = {
  system: "bg-muted text-muted-foreground",
  caseworker: "bg-[hsl(var(--badge-info-bg))] text-[hsl(var(--badge-info-text))]",
  cbo: "bg-[hsl(var(--badge-success-bg))] text-[hsl(var(--badge-success-text))]",
  supervisor: "bg-[hsl(var(--badge-warning-bg))] text-[hsl(var(--badge-warning-text))]",
};

export function PlatformEvents() {
  const [search, setSearch] = useState("");
  const [severityFilter, setSeverityFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");

  // Filter events
  const filteredEvents = useMemo(() => {
    return MOCK_PLATFORM_EVENTS.filter((event) => {
      if (severityFilter !== "all" && event.severity !== severityFilter) return false;
      if (sourceFilter !== "all" && event.source !== sourceFilter) return false;
      if (search && !event.description.toLowerCase().includes(search.toLowerCase()) &&
          !event.caseId.toLowerCase().includes(search.toLowerCase()) &&
          !event.eventType.toLowerCase().includes(search.toLowerCase())) {
        return false;
      }
      return true;
    }).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  }, [search, severityFilter, sourceFilter]);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      {/* Main Event List */}
      <div className="lg:col-span-2 space-y-4">
        {/* Filters */}
        <div className="flex items-center gap-4">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search events..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <Select value={severityFilter} onValueChange={setSeverityFilter}>
            <SelectTrigger className="w-32">
              <SelectValue placeholder="Severity" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Severity</SelectItem>
              <SelectItem value="info">Info</SelectItem>
              <SelectItem value="warn">Warning</SelectItem>
              <SelectItem value="error">Error</SelectItem>
            </SelectContent>
          </Select>

          <Select value={sourceFilter} onValueChange={setSourceFilter}>
            <SelectTrigger className="w-36">
              <SelectValue placeholder="Source" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Sources</SelectItem>
              <SelectItem value="system">System</SelectItem>
              <SelectItem value="caseworker">Caseworker</SelectItem>
              <SelectItem value="cbo">CBO</SelectItem>
              <SelectItem value="supervisor">Supervisor</SelectItem>
            </SelectContent>
          </Select>

          <Badge variant="secondary" className="text-xs">
            {filteredEvents.length} events
          </Badge>
        </div>

        {/* Event List */}
        <Card>
          <ScrollArea className="h-[calc(100vh-280px)]">
            <div className="divide-y divide-border">
              {filteredEvents.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <ScrollText className="h-8 w-8 mb-2" />
                  <p>No events match the current filters</p>
                </div>
              ) : (
                filteredEvents.map((event) => {
                  const SeverityIcon = SEVERITY_STYLES[event.severity].icon;
                  return (
                    <div
                      key={event.id}
                      className={cn(
                        "p-4 hover:bg-muted/50 transition-colors",
                        event.severity === "error" && "border-l-4 border-l-destructive",
                        event.severity === "warn" && "border-l-4 border-l-[hsl(var(--status-warning))]"
                      )}
                    >
                      <div className="flex items-start gap-3">
                        <SeverityIcon className={cn(
                          "h-4 w-4 mt-0.5 flex-shrink-0",
                          event.severity === "error" && "text-destructive",
                          event.severity === "warn" && "text-[hsl(var(--status-warning))]",
                          event.severity === "info" && "text-muted-foreground"
                        )} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm">{event.description}</p>
                          <div className="flex items-center gap-2 mt-2 flex-wrap">
                            <Badge variant="outline" className={cn("text-xs", SOURCE_STYLES[event.source])}>
                              {event.source}
                            </Badge>
                            <span className="text-xs font-mono text-muted-foreground">{event.caseId}</span>
                            {event.referralId && (
                              <span className="text-xs font-mono text-muted-foreground">{event.referralId}</span>
                            )}
                            <span className="text-xs text-muted-foreground">•</span>
                            <span className="text-xs text-muted-foreground">
                              {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </ScrollArea>
        </Card>
      </div>

      {/* Info Panels */}
      <div className="space-y-4">
        {/* Retention Model */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Database className="h-4 w-4" />
              Retention Model
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm">
            <div>
              <h4 className="font-medium text-foreground mb-1">Event Metadata</h4>
              <p className="text-muted-foreground">Long-lived. Retained for audit and compliance.</p>
            </div>
            <div>
              <h4 className="font-medium text-foreground mb-1">Content (Documents, Notes)</h4>
              <p className="text-muted-foreground">Ephemeral by default. Expires after processing.</p>
            </div>
            <div>
              <h4 className="font-medium text-foreground mb-1">Configurable</h4>
              <p className="text-muted-foreground">Retention can be adjusted per program policy.</p>
            </div>
          </CardContent>
        </Card>

        {/* Immutability Notice */}
        <Card className="border-dashed">
          <CardContent className="pt-4">
            <div className="flex items-start gap-3">
              <Info className="h-4 w-4 text-muted-foreground mt-0.5" />
              <div className="text-sm">
                <p className="font-medium text-foreground mb-1">Append-Only Log</p>
                <p className="text-muted-foreground">
                  All events are immutable. Corrections are made by adding new events, never by modifying existing records.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Quick Stats */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium">Event Summary</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Total Events</span>
              <span className="font-medium">{MOCK_PLATFORM_EVENTS.length}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Errors</span>
              <Badge variant="destructive" className="text-xs">
                {MOCK_PLATFORM_EVENTS.filter((e) => e.severity === "error").length}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Warnings</span>
              <Badge variant="outline" className="text-xs bg-[hsl(var(--badge-warning-bg))] text-[hsl(var(--badge-warning-text))]">
                {MOCK_PLATFORM_EVENTS.filter((e) => e.severity === "warn").length}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
