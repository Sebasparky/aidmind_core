/**
 * Auditor Mode UI
 * 
 * Read-only, time-bounded access for external auditors.
 */

import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useEyeEvents, getPurgeProofEvents } from "@/hooks/useEyeEvents";
import { useAIAuthorization } from "@/hooks/useAIAuthorization";
import { computeComplianceStatus } from "@/lib/eye/verdict";
import { EventFeed } from "@/components/supervisor/EventFeed";
import { PurgeProofPanel } from "@/components/supervisor/PurgeProofPanel";
import { TourController } from "@/components/tour/TourController";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useTourReplay } from "@/components/tour/useTourReplay";
import { 
  Eye, 
  ShieldCheck, 
  ShieldAlert, 
  ShieldOff, 
  FileText, 
  Clock,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  LogOut,
  ChevronDown,
  Map,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { AidMindBrand } from "@/components/brand/AidMindBrand";

export default function Auditor() {
  const { profile } = useAuth();
  const { replayTour } = useTourReplay("auditor");

  const { events: allEvents, loading, error, lastRefresh } = useEyeEvents({
    timeRangeHours: 168,
    autoRefresh: true,
    refreshIntervalMs: 60000,
  });

  const { status: aiAuthStatus, loading: aiAuthLoading } = useAIAuthorization();
  const purgeProofEvents = useMemo(() => getPurgeProofEvents(allEvents), [allEvents]);
  const complianceStatus = useMemo(() => computeComplianceStatus(allEvents), [allEvents]);

  const initials = profile?.display_name
    ? profile.display_name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2)
    : "?";

  return (
    <div className="min-h-screen bg-canvas flex flex-col">
      <TourController role="auditor" />

      {/* Auditor Mode Banner */}
      <header className="sticky top-0 z-50 bg-[hsl(var(--status-warning-muted))] border-b border-[hsl(var(--status-warning))]" data-tour="aud-banner">
        <div className="container py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <AidMindBrand size="sm" showWordmark={false} href="/auditor" />
            <Separator orientation="vertical" className="h-5" />
            <Eye className="h-5 w-5 text-[hsl(var(--status-warning-muted-foreground))]" />
            <span className="font-semibold text-[hsl(var(--status-warning-muted-foreground))]">
              AUDITOR MODE
            </span>
            <Badge variant="outline" className="text-xs">Read-Only Access</Badge>
          </div>
          <div className="flex items-center gap-3 text-sm text-[hsl(var(--status-warning-muted-foreground))]">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" className="flex items-center gap-2 px-2" aria-label="User menu">
                  <Avatar className="h-6 w-6">
                    <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <span>{profile?.display_name}</span>
                  <ChevronDown className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuItem onClick={replayTour} className="gap-2">
                  <Map className="h-3.5 w-3.5" />
                  Replay tour
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={async () => {
                    await supabase.auth.signOut();
                    window.location.href = "/login";
                  }}
                  className="gap-2"
                >
                  <LogOut className="h-3.5 w-3.5" />
                  Sign out
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 container py-6">
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-2">Compliance Audit View</h1>
          <p className="text-muted-foreground">
            Read-only access to compliance events and deletion proof. No PHI is displayed.
          </p>
          {lastRefresh && (
            <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
              <Clock className="h-3 w-3" />
              Last updated: {format(lastRefresh, "PPpp")}
            </p>
          )}
        </div>

        {/* Compliance Status Cards */}
        <div className="grid gap-4 md:grid-cols-3 mb-6">
          <Card data-tour="aud-card-ai-auth">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                {aiAuthStatus === "approved" && <ShieldCheck className="h-4 w-4 text-[hsl(var(--status-success))]" />}
                {aiAuthStatus === "missing" && <ShieldOff className="h-4 w-4 text-muted-foreground" />}
                {aiAuthStatus === "revoked" && <ShieldAlert className="h-4 w-4 text-destructive" />}
                AI Authorization
              </CardTitle>
            </CardHeader>
            <CardContent>
              {aiAuthLoading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Badge
                  variant={aiAuthStatus === "approved" ? "default" : "secondary"}
                  className={
                    aiAuthStatus === "approved"
                      ? "bg-[hsl(var(--status-success))] text-white"
                      : aiAuthStatus === "revoked"
                      ? "bg-destructive text-destructive-foreground"
                      : ""
                  }
                >
                  {aiAuthStatus === "approved" && "Authorized"}
                  {aiAuthStatus === "missing" && "Not Authorized"}
                  {aiAuthStatus === "revoked" && "Revoked"}
                </Badge>
              )}
            </CardContent>
          </Card>

          <Card data-tour="aud-card-llm-compliance">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <FileText className="h-4 w-4" />LLM Compliance
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Badge
                variant={complianceStatus.llmComplianceStatus === "passed" ? "default" : "secondary"}
                className={
                  complianceStatus.llmComplianceStatus === "passed"
                    ? "bg-[hsl(var(--status-success))] text-white"
                    : complianceStatus.llmComplianceStatus === "failed"
                    ? "bg-destructive text-destructive-foreground"
                    : ""
                }
              >
                {complianceStatus.llmComplianceStatus === "passed" && "Passed"}
                {complianceStatus.llmComplianceStatus === "failed" && "Failed"}
                {complianceStatus.llmComplianceStatus === "not_instrumented" && "Not Instrumented"}
              </Badge>
            </CardContent>
          </Card>

          <Card data-tour="aud-card-deletion-proof">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <ShieldCheck className="h-4 w-4" />Deletion Proof
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                {purgeProofEvents.length > 0 ? (
                  <>
                    <CheckCircle2 className="h-4 w-4 text-[hsl(var(--status-success))]" />
                    <span className="text-sm">{purgeProofEvents.length} purge events</span>
                  </>
                ) : (
                  <>
                    <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm text-muted-foreground">No purge events yet</span>
                  </>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground mb-4">
            <Loader2 className="h-4 w-4 animate-spin" />Loading events...
          </div>
        )}
        {error && (
          <div className="text-sm text-destructive mb-4 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />{error}
          </div>
        )}

        <Tabs defaultValue="timeline" className="space-y-4">
          <TabsList>
            <TabsTrigger value="timeline" className="gap-2" data-tour="aud-tab-timeline">
              <Clock className="h-4 w-4" />Event Timeline
            </TabsTrigger>
            <TabsTrigger value="deletion-proof" className="gap-2" data-tour="aud-tab-deletion-proof">
              <ShieldCheck className="h-4 w-4" />Deletion Proof
            </TabsTrigger>
          </TabsList>

          <TabsContent value="timeline">
            <Card>
              <CardHeader>
                <CardTitle>Eye Event Timeline</CardTitle>
                <CardDescription>Immutable audit trail of all system events (read-only)</CardDescription>
              </CardHeader>
              <CardContent>
                <EventFeed events={allEvents} onEventClick={() => {}} />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="deletion-proof">
            <PurgeProofPanel events={purgeProofEvents} allEvents={allEvents} onEventClick={() => {}} />
          </TabsContent>
        </Tabs>

        <div className="mt-8 p-4 rounded-lg bg-muted/50 text-sm text-muted-foreground">
          <p className="font-medium mb-1">Auditor Access Notice</p>
          <ul className="list-disc list-inside space-y-1 text-xs">
            <li>This view shows only compliance and deletion proof events</li>
            <li>No Protected Health Information (PHI) is displayed</li>
            <li>Access is time-bounded and automatically expires</li>
            <li>All access is logged for accountability</li>
          </ul>
        </div>
      </main>
    </div>
  );
}
