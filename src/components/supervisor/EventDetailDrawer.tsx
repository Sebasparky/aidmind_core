/**
 * Event Detail Drawer - Read-only event details
 * 
 * IMPORTANT: This component NEVER displays PHI.
 * Only metadata fields from The Eye event schema are shown.
 * 
 * Includes coordination-specific context for Platform events.
 */

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { EyeEvent, EVENT_CATEGORY_MAP, EventTag, getEventCategory, getEventSeverity } from "@/lib/eye/types";
import { isCoordinationEvent, getCoordinationContext } from "@/lib/platform/coordination-events";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { format } from "date-fns";
import {
  Clock,
  User,
  Server,
  Folder,
  FileText,
  Tag,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Shield,
  Timer,
  Hash,
  ArrowLeftRight,
  ExternalLink,
  Info,
} from "lucide-react";

interface EventDetailDrawerProps {
  event: EyeEvent | null;
  onClose: () => void;
}

const SEVERITY_STYLES: Record<string, string> = {
  INFO: "bg-[hsl(var(--badge-info-bg))] text-[hsl(var(--badge-info-text))]",
  NOTICE: "bg-[hsl(var(--badge-success-bg))] text-[hsl(var(--badge-success-text))]",
  WARN: "bg-[hsl(var(--badge-warning-bg))] text-[hsl(var(--badge-warning-text))]",
  HIGH: "bg-[hsl(var(--badge-danger-bg))] text-[hsl(var(--badge-danger-text))]",
  CRITICAL: "bg-destructive text-destructive-foreground",
};

const TAG_STYLES: Record<EventTag, string> = {
  PHI_TOUCHING: "bg-[hsl(var(--badge-danger-bg))] text-[hsl(var(--badge-danger-text))]",
  EPHEMERAL: "bg-[hsl(var(--badge-warning-bg))] text-[hsl(var(--badge-warning-text))]",
  BREAK_GLASS: "bg-destructive text-destructive-foreground",
  DELETION_PROOF: "bg-[hsl(var(--badge-success-bg))] text-[hsl(var(--badge-success-text))]",
  AUDIT_CRITICAL: "bg-[hsl(var(--badge-info-bg))] text-[hsl(var(--badge-info-text))]",
  COMPLIANCE: "bg-[hsl(var(--badge-info-bg))] text-[hsl(var(--badge-info-text))]",
};

function DetailRow({ 
  icon: Icon, 
  label, 
  value, 
  mono = false 
}: { 
  icon: React.ElementType; 
  label: string; 
  value: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 py-2">
      <Icon className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs text-muted-foreground mb-0.5">{label}</div>
        <div className={cn("text-sm", mono && "font-mono text-xs")}>
          {value || "—"}
        </div>
      </div>
    </div>
  );
}

function ResultBadge({ result }: { result: string }) {
  switch (result) {
    case "success":
      return (
        <Badge className="bg-[hsl(var(--badge-success-bg))] text-[hsl(var(--badge-success-text))] gap-1">
          <CheckCircle2 className="h-3 w-3" />
          Success
        </Badge>
      );
    case "failure":
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" />
          Failure
        </Badge>
      );
    case "partial":
      return (
        <Badge className="bg-[hsl(var(--badge-warning-bg))] text-[hsl(var(--badge-warning-text))] gap-1">
          <AlertCircle className="h-3 w-3" />
          Partial
        </Badge>
      );
    default:
      return <Badge variant="outline">{result}</Badge>;
  }
}

// Coordination Context Card
function CoordinationContextCard({ event }: { event: EyeEvent }) {
  const context = getCoordinationContext(event);
  
  return (
    <Card className="border-primary/20 bg-primary/5">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <ArrowLeftRight className="h-4 w-4 text-primary" />
          Coordination Context
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {context.caseId && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Case ID</span>
            <span className="font-mono text-sm">{context.caseId}</span>
          </div>
        )}
        {context.referralId && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Referral ID</span>
            <span className="font-mono text-sm">{context.referralId}</span>
          </div>
        )}
        {context.cboName && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">CBO</span>
            <span className="text-sm">{context.cboName}</span>
          </div>
        )}
        {context.program && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Program</span>
            <Badge variant="outline" className="text-xs">{context.program}</Badge>
          </div>
        )}
        
        {context.platformLink && (
          <Tooltip>
            <TooltipTrigger asChild>
              <span
                role="button"
                aria-disabled="true"
                tabIndex={0}
                className="inline-flex w-full mt-2"
              >
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 opacity-50 cursor-not-allowed pointer-events-none"
                  tabIndex={-1}
                  disabled
                >
                  <ExternalLink className="h-3 w-3" />
                  View in Platform
                </Button>
              </span>
            </TooltipTrigger>
            <TooltipContent>
              <p className="text-xs">Platform integration coming later.</p>
            </TooltipContent>
          </Tooltip>
        )}
        
        <div className="flex items-start gap-2 p-2 rounded bg-muted/50 mt-2">
          <Info className="h-3 w-3 text-muted-foreground mt-0.5 flex-shrink-0" />
          <p className="text-xs text-muted-foreground">
            This is a coordination signal from The Platform. No PHI is exposed.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}

export function EventDetailDrawer({ event, onClose }: EventDetailDrawerProps) {
  if (!event) return null;

  const category = getEventCategory(event);
  const severity = getEventSeverity(event);
  const isCoordination = isCoordinationEvent(event);

  return (
    <Sheet open={!!event} onOpenChange={(open) => !open && onClose()}>
      <SheetContent className="w-[400px] sm:w-[450px] p-0">
        <SheetHeader className="p-6 pb-4">
          <div className="flex items-center gap-2 mb-2">
            <Badge variant="outline" className={cn(
              "text-xs",
              isCoordination && "bg-[hsl(217_91%_60%/0.15)] text-primary border-primary/30"
            )}>
              {category}
            </Badge>
            <Badge className={cn("text-xs", SEVERITY_STYLES[severity])}>
              {severity}
            </Badge>
          </div>
          <SheetTitle className="text-lg flex items-center gap-2">
            {isCoordination && <ArrowLeftRight className="h-5 w-5 text-primary" />}
            {event.event_type.replace(/_/g, " ")}
          </SheetTitle>
          <SheetDescription className="flex items-center gap-2">
            <ResultBadge result={event.result} />
            {event.reason_code && (
              <Badge variant="outline" className="text-xs">
                {event.reason_code}
              </Badge>
            )}
          </SheetDescription>
        </SheetHeader>

        <Separator />

        <ScrollArea className="h-[calc(100vh-180px)]">
          <div className="p-6 space-y-4">
            {/* Coordination Context (for Platform events) */}
            {isCoordination && (
              <>
                <CoordinationContextCard event={event} />
                <Separator />
              </>
            )}

            {/* Tags */}
            {event.tags && event.tags.length > 0 && (
              <div className="space-y-2">
                <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Tags
                </div>
                <div className="flex flex-wrap gap-1">
                  {event.tags.map((tag) => (
                    <Badge 
                      key={tag} 
                      className={cn("text-xs", TAG_STYLES[tag])}
                    >
                      {tag}
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {event.tags && event.tags.length > 0 && <Separator />}

            {/* Timing */}
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Timing
              </div>
              <DetailRow
                icon={Clock}
                label="Timestamp (UTC)"
                value={format(new Date(event.timestamp), "PPpp")}
              />
              {event.latency_ms !== undefined && (
                <DetailRow
                  icon={Timer}
                  label="Latency"
                  value={`${event.latency_ms.toLocaleString()} ms`}
                />
              )}
              {event.ttl_seconds !== undefined && (
                <DetailRow
                  icon={Timer}
                  label="TTL"
                  value={`${event.ttl_seconds} seconds`}
                />
              )}
            </div>

            <Separator />

            {/* Actor */}
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Actor
              </div>
              <DetailRow
                icon={User}
                label="Actor Type"
                value={event.actor_type}
              />
              <DetailRow
                icon={User}
                label="Actor ID"
                value={event.actor_id}
                mono
              />
              {event.actor_role && (
                <DetailRow
                  icon={Shield}
                  label="Actor Role"
                  value={event.actor_role}
                />
              )}
            </div>

            <Separator />

            {/* Resource */}
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Resource
              </div>
              <DetailRow
                icon={FileText}
                label="Resource Type"
                value={event.resource_type}
              />
              <DetailRow
                icon={Hash}
                label="Resource ID"
                value={event.resource_id}
                mono
              />
            </div>

            <Separator />

            {/* Context */}
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Context
              </div>
              <DetailRow
                icon={Folder}
                label="Session ID"
                value={event.session_id}
                mono
              />
              <DetailRow
                icon={Folder}
                label="Case ID"
                value={event.case_id}
                mono
              />
              <DetailRow
                icon={Server}
                label="Tenant ID"
                value={event.tenant_id}
                mono
              />
              <DetailRow
                icon={Server}
                label="Environment"
                value={event.environment.toUpperCase()}
              />
            </div>

            <Separator />

            {/* Tracing */}
            <div className="space-y-1">
              <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Tracing
              </div>
              <DetailRow
                icon={Hash}
                label="Event ID"
                value={event.event_id}
                mono
              />
              <DetailRow
                icon={Hash}
                label="Request ID"
                value={event.request_id}
                mono
              />
              <DetailRow
                icon={Tag}
                label="Event Version"
                value={`v${event.event_version}`}
              />
              {event.service_name && (
                <DetailRow
                  icon={Server}
                  label="Service"
                  value={event.service_name}
                />
              )}
            </div>

            {/* Redaction Stats (if applicable) */}
            {event.redaction_counts && Object.keys(event.redaction_counts).length > 0 && (
              <>
                <Separator />
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Redaction Counts
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {Object.entries(event.redaction_counts).map(([key, count]) => (
                      <div key={key} className="flex justify-between text-sm bg-muted/50 rounded px-2 py-1">
                        <span className="text-muted-foreground">{key}</span>
                        <span className="font-medium">{count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* Bytes (if applicable) */}
            {(event.bytes_in !== undefined || event.bytes_out !== undefined) && (
              <>
                <Separator />
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Data Transfer
                  </div>
                  {event.bytes_in !== undefined && (
                    <DetailRow
                      icon={FileText}
                      label="Bytes In"
                      value={`${(event.bytes_in / 1024).toFixed(1)} KB`}
                    />
                  )}
                  {event.bytes_out !== undefined && (
                    <DetailRow
                      icon={FileText}
                      label="Bytes Out"
                      value={`${(event.bytes_out / 1024).toFixed(1)} KB`}
                    />
                  )}
                </div>
              </>
            )}

            {/* Ephemeral Scan Results (if applicable) */}
            {event.remaining_count !== undefined && (
              <>
                <Separator />
                <div className="space-y-2">
                  <div className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Ephemeral Scan Result
                  </div>
                  <div className={cn(
                    "flex items-center gap-2 p-3 rounded-lg",
                    event.remaining_count === 0 
                      ? "bg-[hsl(var(--status-success-muted))]" 
                      : "bg-[hsl(var(--status-warning-muted))]"
                  )}>
                    {event.remaining_count === 0 ? (
                      <CheckCircle2 className="h-5 w-5 text-[hsl(var(--status-success))]" />
                    ) : (
                      <AlertCircle className="h-5 w-5 text-[hsl(var(--status-warning))]" />
                    )}
                    <div>
                      <div className="font-medium text-sm">
                        {event.remaining_count === 0 
                          ? "All ephemeral data purged" 
                          : `${event.remaining_count} items remaining`}
                      </div>
                      {event.remaining_types && event.remaining_types.length > 0 && (
                        <div className="text-xs text-muted-foreground">
                          Types: {event.remaining_types.join(", ")}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </ScrollArea>
      </SheetContent>
    </Sheet>
  );
}