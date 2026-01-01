/**
 * Event Filters Panel for Supervisor UI
 */

import { useState } from "react";
import { EventFilters } from "@/lib/eye/mock-data";
import { EventCategory, EventSeverity, FUTURE_EVENTS } from "@/lib/eye/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Filter, X, ChevronDown, ChevronRight, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface EventFiltersPanelProps {
  filters: EventFilters;
  onFilterChange: (filters: Partial<EventFilters>) => void;
  onClearFilters: () => void;
}

const CATEGORIES: { value: EventCategory; label: string; implemented: boolean }[] = [
  { value: "SESSION", label: "Session", implemented: true },
  { value: "INGEST", label: "Ingest", implemented: true },
  { value: "TRANSCRIPTION", label: "Transcription", implemented: true },
  { value: "REDACTION", label: "Redaction", implemented: true },
  { value: "PURGE", label: "Purge", implemented: true },
  { value: "AUTH", label: "Auth", implemented: false },
  { value: "GENERATION", label: "Generation", implemented: false },
  { value: "VALIDATION", label: "Validation", implemented: false },
  { value: "DRAFT", label: "Draft", implemented: false },
  { value: "EXPORT", label: "Export", implemented: false },
  { value: "CONFIG", label: "Config", implemented: false },
  { value: "ANOMALY", label: "Anomaly", implemented: false },
];

const SEVERITIES: { value: EventSeverity; label: string; color: string }[] = [
  { value: "INFO", label: "Info", color: "bg-[hsl(var(--badge-info-bg))] text-[hsl(var(--badge-info-text))]" },
  { value: "NOTICE", label: "Notice", color: "bg-[hsl(var(--badge-success-bg))] text-[hsl(var(--badge-success-text))]" },
  { value: "WARN", label: "Warning", color: "bg-[hsl(var(--badge-warning-bg))] text-[hsl(var(--badge-warning-text))]" },
  { value: "HIGH", label: "High", color: "bg-[hsl(var(--badge-danger-bg))] text-[hsl(var(--badge-danger-text))]" },
  { value: "CRITICAL", label: "Critical", color: "bg-destructive text-destructive-foreground" },
];

export function EventFiltersPanel({
  filters,
  onFilterChange,
  onClearFilters,
}: EventFiltersPanelProps) {
  const [categoryOpen, setCategoryOpen] = useState(true);
  const [severityOpen, setSeverityOpen] = useState(true);
  const [idsOpen, setIdsOpen] = useState(false);

  const hasActiveFilters = 
    (filters.categories?.length ?? 0) > 0 ||
    (filters.severities?.length ?? 0) > 0 ||
    filters.sessionId ||
    filters.caseId;

  const toggleCategory = (category: EventCategory) => {
    const current = filters.categories || [];
    const updated = current.includes(category)
      ? current.filter((c) => c !== category)
      : [...current, category];
    onFilterChange({ categories: updated.length > 0 ? updated : undefined });
  };

  const toggleSeverity = (severity: EventSeverity) => {
    const current = filters.severities || [];
    const updated = current.includes(severity)
      ? current.filter((s) => s !== severity)
      : [...current, severity];
    onFilterChange({ severities: updated.length > 0 ? updated : undefined });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Filter className="h-4 w-4" />
          Filters
        </div>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearFilters}
            className="h-7 text-xs text-muted-foreground"
          >
            <X className="h-3 w-3 mr-1" />
            Clear
          </Button>
        )}
      </div>

      <Separator />

      {/* Category Filter */}
      <Collapsible open={categoryOpen} onOpenChange={setCategoryOpen}>
        <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-sm font-medium hover:text-foreground transition-colors">
          <span>Category</span>
          {categoryOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2 space-y-2">
          {CATEGORIES.map((cat) => (
            <div
              key={cat.value}
              className="flex items-center gap-2"
            >
              <Checkbox
                id={`cat-${cat.value}`}
                checked={filters.categories?.includes(cat.value) ?? false}
                onCheckedChange={() => toggleCategory(cat.value)}
                disabled={!cat.implemented}
              />
              <Label
                htmlFor={`cat-${cat.value}`}
                className={cn(
                  "text-sm cursor-pointer flex items-center gap-2",
                  !cat.implemented && "text-muted-foreground/50"
                )}
              >
                {cat.label}
                {!cat.implemented && (
                  <Badge variant="outline" className="text-[10px] px-1 py-0">
                    TODO
                  </Badge>
                )}
              </Label>
            </div>
          ))}
        </CollapsibleContent>
      </Collapsible>

      <Separator />

      {/* Severity Filter */}
      <Collapsible open={severityOpen} onOpenChange={setSeverityOpen}>
        <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-sm font-medium hover:text-foreground transition-colors">
          <span>Severity</span>
          {severityOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2 space-y-2">
          {SEVERITIES.map((sev) => (
            <div
              key={sev.value}
              className="flex items-center gap-2"
            >
              <Checkbox
                id={`sev-${sev.value}`}
                checked={filters.severities?.includes(sev.value) ?? false}
                onCheckedChange={() => toggleSeverity(sev.value)}
              />
              <Label
                htmlFor={`sev-${sev.value}`}
                className="text-sm cursor-pointer flex items-center gap-2"
              >
                <Badge className={cn("text-xs", sev.color)}>
                  {sev.label}
                </Badge>
              </Label>
            </div>
          ))}
        </CollapsibleContent>
      </Collapsible>

      <Separator />

      {/* ID Filters */}
      <Collapsible open={idsOpen} onOpenChange={setIdsOpen}>
        <CollapsibleTrigger className="flex items-center justify-between w-full py-2 text-sm font-medium hover:text-foreground transition-colors">
          <span>IDs</span>
          {idsOpen ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2 space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="session-id" className="text-xs text-muted-foreground">
              Session ID
            </Label>
            <Input
              id="session-id"
              placeholder="sess_..."
              value={filters.sessionId || ""}
              onChange={(e) => onFilterChange({ sessionId: e.target.value || undefined })}
              className="h-8 text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="case-id" className="text-xs text-muted-foreground">
              Case ID
            </Label>
            <Input
              id="case-id"
              placeholder="case_..."
              value={filters.caseId || ""}
              onChange={(e) => onFilterChange({ caseId: e.target.value || undefined })}
              className="h-8 text-sm"
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      <Separator />

      {/* Time Range (placeholder for future) */}
      <div className="text-xs text-muted-foreground flex items-center gap-2">
        <Clock className="h-3 w-3" />
        <span>Time range: Last 24 hours</span>
      </div>
    </div>
  );
}
