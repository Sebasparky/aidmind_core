/**
 * Platform Overview Page
 * 
 * Operational snapshot of coordination health.
 * Cards: Coordination Health, Referral Throughput, Document Flow, CBO Responsiveness
 */

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { COORDINATION_STATS } from "@/lib/platform/mock-data";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock,
  FileText,
  Info,
  TrendingUp,
  Users,
} from "lucide-react";

export function PlatformOverview() {
  const stats = COORDINATION_STATS;

  return (
    <div className="space-y-6">
      {/* Info Banner */}
      <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 border border-border">
        <Info className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <p className="text-sm text-muted-foreground">
          These are coordination signals, not worker productivity metrics.
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
        {/* Coordination Health */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Coordination Health</CardTitle>
              <Tooltip>
                <TooltipTrigger>
                  <Info className="h-4 w-4 text-muted-foreground" />
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <p className="text-xs">Active issues requiring attention. Not a worker performance metric.</p>
                </TooltipContent>
              </Tooltip>
            </div>
            <CardDescription>Active coordination issues</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Stalled Referrals</span>
              <Badge variant="destructive" className="font-mono">
                {stats.stalledReferrals}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">SLA Breaches</span>
              <Badge variant="destructive" className="font-mono">
                {stats.slaBreaches}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* Referral Throughput */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Referral Throughput</CardTitle>
              <TrendingUp className="h-4 w-4 text-muted-foreground" />
            </div>
            <CardDescription>Last 30 days</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ArrowRight className="h-3 w-3 text-[hsl(var(--status-info))]" />
                <span className="text-sm text-muted-foreground">Sent</span>
              </div>
              <span className="text-sm font-medium">{stats.referralsThroughput.sent}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-3 w-3 text-[hsl(var(--status-success))]" />
                <span className="text-sm text-muted-foreground">Acknowledged</span>
              </div>
              <span className="text-sm font-medium">{stats.referralsThroughput.acknowledged}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-3 w-3 text-[hsl(var(--status-success))]" />
                <span className="text-sm text-muted-foreground">Completed</span>
              </div>
              <span className="text-sm font-medium">{stats.referralsThroughput.completed}</span>
            </div>
          </CardContent>
        </Card>

        {/* Document Flow */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">Document Flow</CardTitle>
              <FileText className="h-4 w-4 text-muted-foreground" />
            </div>
            <CardDescription>Current status</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Requested</span>
              <span className="text-sm font-medium">{stats.documentFlow.requested}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Received</span>
              <span className="text-sm font-medium">{stats.documentFlow.received}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">Overdue</span>
              <Badge variant="outline" className="bg-[hsl(var(--badge-warning-bg))] text-[hsl(var(--badge-warning-text))]">
                {stats.documentFlow.overdue}
              </Badge>
            </div>
          </CardContent>
        </Card>

        {/* CBO Responsiveness */}
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium">CBO Responsiveness</CardTitle>
              <Users className="h-4 w-4 text-muted-foreground" />
            </div>
            <CardDescription>External partners</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-3 w-3 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Avg Ack Time</span>
              </div>
              <span className="text-sm font-medium">{stats.cboResponsiveness.avgAcknowledgeTime}</span>
            </div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-3 w-3 text-[hsl(var(--status-warning))]" />
                <span className="text-sm text-muted-foreground">Late Acks</span>
              </div>
              <Badge variant="outline" className="bg-[hsl(var(--badge-warning-bg))] text-[hsl(var(--badge-warning-text))]">
                {stats.cboResponsiveness.lateAcknowledges}
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Empty State for additional sections */}
      <Card className="border-dashed">
        <CardContent className="flex flex-col items-center justify-center py-12 text-center">
          <div className="h-12 w-12 rounded-full bg-muted flex items-center justify-center mb-4">
            <TrendingUp className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-sm font-medium text-foreground mb-1">No additional signals</h3>
          <p className="text-sm text-muted-foreground max-w-sm">
            All coordination metrics are within normal ranges. Additional alerts will appear here when detected.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
