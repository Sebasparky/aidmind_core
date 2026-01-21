/**
 * Platform Referrals Page
 * 
 * Referral list with lifecycle tracking. SLA timers and state visualization.
 * Includes lifecycle stepper and SLA rules widget.
 */

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MOCK_REFERRALS, MOCK_CBOS, filterReferrals } from "@/lib/platform/mock-data";
import { Referral, ReferralState } from "@/lib/platform/types";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Search,
  AlertTriangle,
  CheckCircle2,
  Clock,
  ArrowRight,
  Info,
  ArrowLeftRight,
} from "lucide-react";

const REFERRAL_STATES: ReferralState[] = [
  "drafted",
  "sent",
  "acknowledged",
  "client_contacted",
  "service_in_progress",
  "completed",
  "declined",
  "stalled",
];

const STATE_COLORS: Record<ReferralState, { bg: string; text: string }> = {
  drafted: { bg: "bg-[hsl(var(--badge-neutral-bg))]", text: "text-[hsl(var(--badge-neutral-text))]" },
  sent: { bg: "bg-[hsl(var(--badge-info-bg))]", text: "text-[hsl(var(--badge-info-text))]" },
  acknowledged: { bg: "bg-[hsl(var(--badge-info-bg))]", text: "text-[hsl(var(--badge-info-text))]" },
  client_contacted: { bg: "bg-[hsl(var(--badge-success-bg))]", text: "text-[hsl(var(--badge-success-text))]" },
  service_in_progress: { bg: "bg-[hsl(var(--badge-success-bg))]", text: "text-[hsl(var(--badge-success-text))]" },
  completed: { bg: "bg-[hsl(var(--badge-success-bg))]", text: "text-[hsl(var(--badge-success-text))]" },
  declined: { bg: "bg-[hsl(var(--badge-danger-bg))]", text: "text-[hsl(var(--badge-danger-text))]" },
  stalled: { bg: "bg-destructive", text: "text-destructive-foreground" },
};

const SLA_STATUS_COLORS: Record<string, string> = {
  on_track: "text-[hsl(var(--status-success))]",
  at_risk: "text-[hsl(var(--status-warning))]",
  breached: "text-destructive",
};

// Lifecycle Stepper Component
function LifecycleStepper({ currentState, history }: { currentState: ReferralState; history: { state: ReferralState; timestamp: string }[] }) {
  const normalStates: ReferralState[] = ["drafted", "sent", "acknowledged", "client_contacted", "service_in_progress", "completed"];
  const isTerminal = currentState === "completed" || currentState === "declined" || currentState === "stalled";
  
  const completedStates = history.map((h) => h.state);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        {normalStates.map((state, index) => {
          const isCompleted = completedStates.includes(state);
          const isCurrent = currentState === state;
          const isPast = normalStates.indexOf(currentState) > index || isCompleted;

          return (
            <div key={state} className="flex items-center flex-1">
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "h-8 w-8 rounded-full flex items-center justify-center text-xs font-medium border-2",
                    isCurrent && "border-primary bg-primary text-primary-foreground",
                    isPast && !isCurrent && "border-[hsl(var(--status-success))] bg-[hsl(var(--status-success))] text-white",
                    !isPast && !isCurrent && "border-muted-foreground/30 bg-muted text-muted-foreground"
                  )}
                >
                  {isPast && !isCurrent ? (
                    <CheckCircle2 className="h-4 w-4" />
                  ) : (
                    index + 1
                  )}
                </div>
                <span className={cn(
                  "text-xs mt-1 text-center max-w-[60px]",
                  isCurrent && "font-medium text-foreground",
                  !isCurrent && "text-muted-foreground"
                )}>
                  {state.replace(/_/g, " ")}
                </span>
              </div>
              {index < normalStates.length - 1 && (
                <div className={cn(
                  "flex-1 h-0.5 mx-1",
                  isPast ? "bg-[hsl(var(--status-success))]" : "bg-muted-foreground/30"
                )} />
              )}
            </div>
          );
        })}
      </div>
      
      {(currentState === "stalled" || currentState === "declined") && (
        <div className="flex items-center gap-2 p-2 rounded bg-destructive/10 border border-destructive/20">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          <span className="text-sm font-medium text-destructive">
            {currentState === "stalled" ? "Referral Stalled" : "Referral Declined"}
          </span>
        </div>
      )}
    </div>
  );
}

export function PlatformReferrals() {
  const [search, setSearch] = useState("");
  const [stateFilter, setStateFilter] = useState<string>("all");
  const [slaFilter, setSlaFilter] = useState<string>("all");
  const [selectedReferral, setSelectedReferral] = useState<Referral | null>(null);
  const [isLoading] = useState(false);

  // Filter referrals
  const filteredReferrals = useMemo(() => {
    let referrals = MOCK_REFERRALS;
    
    referrals = filterReferrals(referrals, {
      states: stateFilter !== "all" ? [stateFilter as ReferralState] : undefined,
      slaStatus: slaFilter !== "all" ? [slaFilter as "on_track" | "at_risk" | "breached"] : undefined,
    });

    if (search) {
      referrals = referrals.filter((r) =>
        r.referralId.toLowerCase().includes(search.toLowerCase()) ||
        r.cboName.toLowerCase().includes(search.toLowerCase()) ||
        r.caseId.toLowerCase().includes(search.toLowerCase())
      );
    }

    return referrals;
  }, [search, stateFilter, slaFilter]);

  return (
    <div className="space-y-4">
      {/* Filters Row */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search referrals..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={stateFilter} onValueChange={setStateFilter}>
          <SelectTrigger className="w-44">
            <SelectValue placeholder="State" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All States</SelectItem>
            {REFERRAL_STATES.map((s) => (
              <SelectItem key={s} value={s}>{s.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={slaFilter} onValueChange={setSlaFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="SLA Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All SLA</SelectItem>
            <SelectItem value="on_track">On Track</SelectItem>
            <SelectItem value="at_risk">At Risk</SelectItem>
            <SelectItem value="breached">Breached</SelectItem>
          </SelectContent>
        </Select>

        <Badge variant="secondary" className="text-xs">
          {filteredReferrals.length} referrals
        </Badge>
      </div>

      {/* Referrals Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Referral ID</TableHead>
              <TableHead>Case ID</TableHead>
              <TableHead>CBO</TableHead>
              <TableHead>State</TableHead>
              <TableHead>SLA Timer</TableHead>
              <TableHead>Last Update</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-32" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                </TableRow>
              ))
            ) : filteredReferrals.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <ArrowLeftRight className="h-8 w-8" />
                    <p>No referrals match the current filters</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredReferrals.map((r) => (
                <TableRow
                  key={r.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setSelectedReferral(r)}
                >
                  <TableCell className="font-mono text-sm">{r.referralId}</TableCell>
                  <TableCell className="font-mono text-sm text-muted-foreground">{r.caseId}</TableCell>
                  <TableCell>{r.cboName}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(STATE_COLORS[r.state].bg, STATE_COLORS[r.state].text)}
                    >
                      {r.state.replace(/_/g, " ")}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <span className={cn("text-sm font-medium", SLA_STATUS_COLORS[r.slaStatus])}>
                      {r.slaRemaining}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDistanceToNow(new Date(r.lastUpdatedAt), { addSuffix: true })}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Referral Detail Panel */}
      <Sheet open={!!selectedReferral} onOpenChange={() => setSelectedReferral(null)}>
        <SheetContent className="w-full sm:max-w-xl">
          {selectedReferral && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-3">
                  <span className="font-mono">{selectedReferral.referralId}</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      STATE_COLORS[selectedReferral.state].bg,
                      STATE_COLORS[selectedReferral.state].text
                    )}
                  >
                    {selectedReferral.state.replace(/_/g, " ")}
                  </Badge>
                </SheetTitle>
                <p className="text-sm text-muted-foreground">
                  {selectedReferral.cboName} • {selectedReferral.serviceType}
                </p>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                {/* Lifecycle Stepper */}
                <div>
                  <h4 className="text-sm font-medium mb-4">Lifecycle Progress</h4>
                  <LifecycleStepper
                    currentState={selectedReferral.state}
                    history={selectedReferral.stateHistory}
                  />
                </div>

                {/* SLA Info */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Clock className="h-4 w-4" />
                      SLA Status
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Timer</span>
                      <span className={cn("font-medium", SLA_STATUS_COLORS[selectedReferral.slaStatus])}>
                        {selectedReferral.slaRemaining}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Deadline</span>
                      <span className="text-sm">
                        {new Date(selectedReferral.slaDeadline).toLocaleDateString()}
                      </span>
                    </div>
                  </CardContent>
                </Card>

                {/* SLA Rules Widget */}
                <Card className="border-dashed">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Info className="h-4 w-4" />
                      SLA Rules (Mock Configuration)
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm text-muted-foreground">
                    <p>• Acknowledgment expected within 24 hours</p>
                    <p>• Client contact expected within 72 hours</p>
                    <p>• Service completion within 7-14 days (program-dependent)</p>
                    <p>• Stall detection: No activity for 5 days</p>
                  </CardContent>
                </Card>

                {/* State History */}
                <div>
                  <h4 className="text-sm font-medium mb-3">State History</h4>
                  <ScrollArea className="h-48">
                    <div className="space-y-2">
                      {selectedReferral.stateHistory.map((h, i) => (
                        <div key={i} className="flex items-center justify-between p-2 rounded bg-muted/50">
                          <Badge variant="outline" className="text-xs">
                            {h.state.replace(/_/g, " ")}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(h.timestamp), { addSuffix: true })}
                          </span>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
