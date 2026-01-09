/**
 * Security Dashboard Panel
 * 
 * Runtime security monitoring surface showing:
 * - Count of rejected insecure requests
 * - TLS version distribution (metadata only)
 * - Recent security incidents
 * 
 * Emits alerts if HTTP requests reach application logic (they shouldn't).
 * 
 * GUARDRAILS:
 * - No raw request bodies or payloads
 * - No tokens or credentials shown
 * - Metadata only for TLS distribution
 */

import { useMemo } from "react";
import { useSecurityMetrics, getSecurityEventSeverity, SecurityIncident } from "@/hooks/useSecurityMetrics";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  Shield,
  ShieldAlert,
  ShieldCheck,
  ShieldX,
  Lock,
  Unlock,
  AlertTriangle,
  RefreshCw,
  Loader2,
  Info,
  TrendingUp,
  TrendingDown,
  Clock,
  Server,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

interface SecurityDashboardPanelProps {
  className?: string;
}

// Severity badge configuration
const SEVERITY_CONFIG = {
  critical: {
    className: "bg-destructive text-destructive-foreground",
    icon: ShieldX,
  },
  high: {
    className: "bg-[hsl(var(--status-warning))] text-[hsl(var(--status-warning-foreground))]",
    icon: ShieldAlert,
  },
  medium: {
    className: "bg-[hsl(var(--status-info))] text-[hsl(var(--status-info-foreground))]",
    icon: Shield,
  },
  low: {
    className: "bg-muted text-muted-foreground",
    icon: ShieldCheck,
  },
};

export function SecurityDashboardPanel({ className }: SecurityDashboardPanelProps) {
  const { metrics, loading, error, refresh } = useSecurityMetrics({
    timeRangeHours: 24,
    autoRefresh: true,
    refreshIntervalMs: 30000,
  });

  // Calculate overall security status
  const securityStatus = useMemo(() => {
    const { rejectedInsecureRequests, eventsByType } = metrics;

    // Check for critical events
    const hasCritical = Object.keys(eventsByType).some(
      (type) =>
        type.includes("TLS_FAILURE") || type.includes("CERT_VALIDATION")
    );

    if (hasCritical) {
      return {
        level: "critical" as const,
        icon: ShieldX,
        title: "Security Alert",
        subtitle: "TLS/Certificate issues detected",
        className: "text-destructive",
        bgClassName: "bg-destructive/10 border-destructive/30",
      };
    }

    if (rejectedInsecureRequests > 10) {
      return {
        level: "high" as const,
        icon: ShieldAlert,
        title: "Elevated Threats",
        subtitle: `${rejectedInsecureRequests} insecure requests blocked`,
        className: "text-[hsl(var(--status-warning))]",
        bgClassName: "bg-[hsl(var(--status-warning))]/10 border-[hsl(var(--status-warning))]/30",
      };
    }

    if (rejectedInsecureRequests > 0) {
      return {
        level: "medium" as const,
        icon: Shield,
        title: "Normal Operation",
        subtitle: `${rejectedInsecureRequests} insecure request(s) blocked`,
        className: "text-[hsl(var(--status-info))]",
        bgClassName: "bg-[hsl(var(--status-info))]/10 border-[hsl(var(--status-info))]/30",
      };
    }

    return {
      level: "good" as const,
      icon: ShieldCheck,
      title: "All Clear",
      subtitle: "No security incidents in the last 24 hours",
      className: "text-[hsl(var(--status-success))]",
      bgClassName: "bg-[hsl(var(--status-success))]/10 border-[hsl(var(--status-success))]/30",
    };
  }, [metrics]);

  const StatusIcon = securityStatus.icon;

  // Format TLS distribution for display
  const tlsDistribution = useMemo(() => {
    const { tlsVersionDistribution } = metrics;
    const total = Object.values(tlsVersionDistribution).reduce(
      (sum, count) => sum + count,
      0
    );

    if (total === 0) {
      return [];
    }

    return Object.entries(tlsVersionDistribution)
      .map(([version, count]) => ({
        version,
        count,
        percentage: Math.round((count / total) * 100),
      }))
      .sort((a, b) => b.count - a.count);
  }, [metrics]);

  // Format rejection reasons for display
  const rejectionReasons = useMemo(() => {
    const { rejectedByReason } = metrics;

    return Object.entries(rejectedByReason)
      .map(([reason, count]) => ({
        reason: formatReason(reason),
        count,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [metrics]);

  if (loading) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Security Dashboard
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-48">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Security Dashboard
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4" />
            <span>{error}</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Shield className="h-5 w-5" />
            <CardTitle className="text-lg">Security Dashboard</CardTitle>
          </div>
          <div className="flex items-center gap-2">
            {metrics.lastUpdated && (
              <span className="text-xs text-muted-foreground">
                Updated{" "}
                {formatDistanceToNow(metrics.lastUpdated, { addSuffix: true })}
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={refresh}
              className="h-8 w-8 p-0"
            >
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <CardDescription>
          Runtime transport security monitoring (last 24h)
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Status Banner */}
        <div
          className={cn(
            "rounded-lg border p-3 flex items-center gap-3",
            securityStatus.bgClassName
          )}
        >
          <StatusIcon
            className={cn("h-6 w-6 flex-shrink-0", securityStatus.className)}
          />
          <div>
            <h3 className={cn("font-semibold", securityStatus.className)}>
              {securityStatus.title}
            </h3>
            <p className="text-sm text-foreground/80">
              {securityStatus.subtitle}
            </p>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="grid grid-cols-2 gap-3">
          {/* Rejected Insecure Requests */}
          <div className="bg-muted/30 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <Unlock className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground font-medium">
                Blocked HTTP Requests
              </span>
            </div>
            <div className="text-2xl font-bold">
              {metrics.rejectedInsecureRequests}
            </div>
            {metrics.rejectedInsecureRequests > 0 && (
              <div className="text-xs text-muted-foreground mt-1">
                All rejected at edge
              </div>
            )}
          </div>

          {/* Security Events */}
          <div className="bg-muted/30 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <Lock className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs text-muted-foreground font-medium">
                Security Events
              </span>
            </div>
            <div className="text-2xl font-bold">
              {Object.values(metrics.eventsByType).reduce(
                (sum, count) => sum + count,
                0
              )}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {Object.keys(metrics.eventsByType).length} event types
            </div>
          </div>
        </div>

        {/* Rejection Reasons */}
        {rejectionReasons.length > 0 && (
          <>
            <Separator />
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">
                Rejection Reasons
              </h4>
              <div className="space-y-1.5">
                {rejectionReasons.map(({ reason, count }) => (
                  <div
                    key={reason}
                    className="flex items-center justify-between text-sm"
                  >
                    <span className="text-foreground/80">{reason}</span>
                    <Badge variant="secondary" className="text-xs">
                      {count}
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* TLS Version Distribution */}
        {tlsDistribution.length > 0 && (
          <>
            <Separator />
            <div>
              <div className="flex items-center gap-2 mb-2">
                <h4 className="text-sm font-medium text-muted-foreground">
                  TLS Version Distribution
                </h4>
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger>
                      <Info className="h-3 w-3 text-muted-foreground" />
                    </TooltipTrigger>
                    <TooltipContent side="right" className="max-w-xs">
                      <p className="text-xs">
                        Metadata only - no raw connection data exposed.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>
              <div className="space-y-2">
                {tlsDistribution.map(({ version, count, percentage }) => (
                  <div key={version} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-foreground/80">{version}</span>
                      <span className="text-muted-foreground">
                        {percentage}% ({count})
                      </span>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={cn(
                          "h-full rounded-full",
                          version.includes("1.3")
                            ? "bg-[hsl(var(--status-success))]"
                            : version.includes("1.2")
                              ? "bg-[hsl(var(--status-info))]"
                              : "bg-[hsl(var(--status-warning))]"
                        )}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {/* Recent Incidents */}
        {metrics.recentIncidents.length > 0 && (
          <>
            <Separator />
            <div>
              <h4 className="text-sm font-medium text-muted-foreground mb-2">
                Recent Security Incidents
              </h4>
              <ScrollArea className="h-[160px]">
                <div className="space-y-2">
                  {metrics.recentIncidents.slice(0, 10).map((incident) => (
                    <SecurityIncidentRow key={incident.id} incident={incident} />
                  ))}
                </div>
              </ScrollArea>
            </div>
          </>
        )}

        {/* No incidents message */}
        {metrics.recentIncidents.length === 0 &&
          metrics.rejectedInsecureRequests === 0 && (
            <div className="text-center py-4 text-muted-foreground">
              <ShieldCheck className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No security incidents recorded</p>
              <p className="text-xs mt-1">
                All transport security enforced at edge
              </p>
            </div>
          )}
      </CardContent>
    </Card>
  );
}

// ============================================================
// SUB-COMPONENTS
// ============================================================

function SecurityIncidentRow({ incident }: { incident: SecurityIncident }) {
  const severity = getSecurityEventSeverity(incident.type);
  const config = SEVERITY_CONFIG[severity];
  const SeverityIcon = config.icon;

  return (
    <div className="flex items-start gap-2 p-2 rounded-md bg-muted/20 hover:bg-muted/30 transition-colors">
      <SeverityIcon className={cn("h-4 w-4 mt-0.5 flex-shrink-0", config.className)} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium truncate">
            {formatEventType(incident.type)}
          </span>
          <Badge variant="outline" className="text-[10px] h-4 px-1">
            {incident.service}
          </Badge>
        </div>
        {incident.sanitizedMessage && (
          <p className="text-xs text-muted-foreground truncate mt-0.5">
            {incident.sanitizedMessage}
          </p>
        )}
        <div className="flex items-center gap-1 mt-1 text-[10px] text-muted-foreground/70">
          <Clock className="h-3 w-3" />
          {format(new Date(incident.timestamp), "MMM d, HH:mm:ss")}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// HELPERS
// ============================================================

function formatEventType(type: string): string {
  return type
    .replace("SECURITY_", "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatReason(reason: string): string {
  return reason
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
