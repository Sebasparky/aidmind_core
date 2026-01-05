/**
 * Event Filters Panel for Supervisor UI
 * 
 * Collapsible filter panel - hidden by default to reduce cognitive load.
 * Now uses real EventFilters from useEyeEvents hook.
 */

import { useState } from "react";
import { EventFilters } from "@/hooks/useEyeEvents";
import { EventCategory, EventSeverity } from "@/lib/eye/types";
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
import { X, ChevronDown, ChevronRight, Clock } from "lucide-react";
import { cn } from "@/lib/utils";

interface EventFiltersPanelProps {
  filters: EventFilters;
  onFilterChange: (filters: Partial<EventFilters>) => void;
  onClearFilters: () => void;
}

// Only show implemented categories
const IMPLEMENTED_CATEGORIES: { value: EventCategory; label: string }[] = [
  { value: "SESSION", label: "Session" },
  { value: "INGEST", label: "Ingest" },
  { value: "TRANSCRIPTION", label: "Transcription" },
  { value: "REDACTION", label: "Redaction" },
  { value: "PURGE", label: "Purge" },
];

// Future categories - collapsed by default
const FUTURE_CATEGORIES: { value: EventCategory; label: string }[] = [
  { value: "AUTH", label: "Auth" },
  { value: "GENERATION", label: "Generation" },
  { value: "VALIDATION", label: "Validation" },
  { value: "DRAFT", label: "Draft" },
  { value: "EXPORT", label: "Export" },
  { value: "CONFIG", label: "Config" },
  { value: "ANOMALY", label: "Anomaly" },
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
  const [futureOpen, setFutureOpen] = useState(false);

  const hasActiveFilters = 
    (filters.categories?.length ?? 0) > 0 ||
    (filters.severities?.length ?? 0) > 0 ||
    filters.sessionId ||
    filters.caseId ||
    filters.operatorId;

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
      {/* Header with clear button */}
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">Filters</span>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onClearFilters}
            className="h-7 text-xs text-muted-foreground"
          >
            <X className="h-3 w-3 mr-1" />
            Clear all
          </Button>
        )}
      </div>

      <Separator />

      {/* Category Filter - only implemented */}
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
          {IMPLEMENTED_CATEGORIES.map((cat) => (
            <div key={cat.value} className="flex items-center gap-2">
              <Checkbox
                id={`cat-${cat.value}`}
                checked={filters.categories?.includes(cat.value) ?? false}
                onCheckedChange={() => toggleCategory(cat.value)}
              />
              <Label
                htmlFor={`cat-${cat.value}`}
                className="text-sm cursor-pointer"
              >
                {cat.label}
              </Label>
            </div>
          ))}
          
          {/* Future categories - collapsed */}
          <Collapsible open={futureOpen} onOpenChange={setFutureOpen}>
            <CollapsibleTrigger className="flex items-center gap-2 py-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
              {futureOpen ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              <span>Coming soon</span>
            </CollapsibleTrigger>
            <CollapsibleContent className="pt-2 pl-2 space-y-2">
              {FUTURE_CATEGORIES.map((cat) => (
                <div key={cat.value} className="flex items-center gap-2">
                  <Checkbox
                    id={`cat-${cat.value}`}
                    disabled
                    className="opacity-50"
                  />
                  <Label
                    htmlFor={`cat-${cat.value}`}
                    className="text-sm text-muted-foreground/50 cursor-not-allowed"
                  >
                    {cat.label}
                  </Label>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
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
            <div key={sev.value} className="flex items-center gap-2">
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
            <Label htmlFor="operator-id" className="text-xs text-muted-foreground">
              Operator ID
            </Label>
            <Input
              id="operator-id"
              placeholder="emp_..."
              value={filters.operatorId || ""}
              onChange={(e) => onFilterChange({ operatorId: e.target.value || undefined })}
              className="h-8 text-sm"
            />
          </div>
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

      {/* Time Range info - placeholder */}
      <div className="text-xs text-muted-foreground flex items-center gap-2 opacity-60">
        <Clock className="h-3 w-3" />
        <span>Time range: Last 24 hours (coming soon)</span>
      </div>
    </div>
  );
}
