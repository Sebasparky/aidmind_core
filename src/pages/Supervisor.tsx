/**
 * Supervisor UI - The Eye Event Viewer
 */

import { useState, useMemo, useCallback } from "react";
import { useEyeEvents, filterEvents, getPurgeProofEvents, getErrorEvents, EventFilters } from "@/hooks/useEyeEvents";
import { EyeEvent } from "@/lib/eye/types";
import { SupervisorHeader } from "@/components/supervisor/SupervisorHeader";
import { EventFiltersPanel } from "@/components/supervisor/EventFiltersPanel";
import { DailyAssurancePanel } from "@/components/supervisor/DailyAssurancePanel";
import { SessionsPanel } from "@/components/supervisor/SessionsPanel";
import { IssuesPanel } from "@/components/supervisor/IssuesPanel";
import { EventDetailDrawer } from "@/components/supervisor/EventDetailDrawer";
import { PurgeProofPanel } from "@/components/supervisor/PurgeProofPanel";
import { AIAuthorizationPanel } from "@/components/supervisor/AIAuthorizationPanel";
import { ComplianceExportPanel } from "@/components/supervisor/ComplianceExportPanel";
import { SecurityDashboardPanel } from "@/components/supervisor/SecurityDashboardPanel";
import { TourController } from "@/components/tour/TourController";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  Gauge,
  LayoutList, 
  AlertTriangle, 
  ShieldCheck,
  Settings2,
  Filter,
  X,
  RefreshCw,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function Supervisor() {
  const { events: allEvents, loading, error, refresh, lastRefresh } = useEyeEvents({
    timeRangeHours: 24,
    autoRefresh: true,
    refreshIntervalMs: 30000,
  });
  
  const [filters, setFilters] = useState<EventFilters>({});
  const [selectedEvent, setSelectedEvent] = useState<EyeEvent | null>(null);
  const [activeTab, setActiveTab] = useState("daily-assurance");
  const [showFilters, setShowFilters] = useState(false);
  const [acknowledgedIds, setAcknowledgedIds] = useState<Set<string>>(new Set());

  const filteredEvents = useMemo(() => filterEvents(allEvents, filters), [allEvents, filters]);
  const purgeProofEvents = useMemo(() => getPurgeProofEvents(allEvents), [allEvents]);
  const errorEvents = useMemo(() => getErrorEvents(allEvents), [allEvents]);

  const hasActiveFilters = 
    (filters.categories?.length ?? 0) > 0 ||
    (filters.severities?.length ?? 0) > 0 ||
    filters.sessionId ||
    filters.caseId ||
    filters.operatorId;

  const handleFilterChange = (newFilters: Partial<EventFilters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
  };

  const clearFilters = () => setFilters({});

  const handleToggleAcknowledged = useCallback((eventId: string) => {
    setAcknowledgedIds(prev => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  }, []);

  const handleAcknowledgeAll = useCallback(() => {
    const issueIds = errorEvents.map(e => e.event_id);
    setAcknowledgedIds(new Set(issueIds));
  }, [errorEvents]);

  const unacknowledgedCount = useMemo(() =>
    errorEvents.filter(e => !acknowledgedIds.has(e.event_id)).length,
    [errorEvents, acknowledgedIds]
  );

  return (
    <div className="min-h-screen bg-canvas flex flex-col">
      <SupervisorHeader />
      <TourController role="supervisor" />

      <div className="flex-1 flex">
        <aside 
          className={cn(
            "border-r border-border bg-card flex-shrink-0 transition-all duration-200 overflow-hidden",
            showFilters ? "w-64 p-4" : "w-0 p-0"
          )}
        >
          {showFilters && (
            <EventFiltersPanel
              filters={filters}
              onFilterChange={handleFilterChange}
              onClearFilters={clearFilters}
            />
          )}
        </aside>

        <main className="flex-1 p-6 overflow-auto">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Button
                  variant={showFilters ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setShowFilters(!showFilters)}
                  className="gap-2"
                  data-tour="filter-toggle"
                >
                  {showFilters ? <X className="h-4 w-4" /> : <Filter className="h-4 w-4" />}
                  Filters
                  {hasActiveFilters && (
                    <Badge variant="secondary" className="ml-1 text-xs bg-primary text-primary-foreground">Active</Badge>
                  )}
                </Button>

                <TabsList className="bg-muted/50">
                  <TabsTrigger value="daily-assurance" className="gap-2" data-tour="tab-daily-assurance">
                    <Gauge className="h-4 w-4" />Daily Assurance
                  </TabsTrigger>
                  <TabsTrigger value="sessions" className="gap-2">
                    <LayoutList className="h-4 w-4" />Sessions
                  </TabsTrigger>
                  <TabsTrigger value="issues" className="gap-2" data-tour="tab-issues">
                    <AlertTriangle className="h-4 w-4" />System Issues
                    {unacknowledgedCount > 0 && (
                      <Badge variant="destructive" className="ml-1 text-xs">{unacknowledgedCount}</Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="deletion-proof" className="gap-2" data-tour="tab-deletion-proof">
                    <ShieldCheck className="h-4 w-4" />Data Deletion Proof
                  </TabsTrigger>
                  <TabsTrigger value="governance" className="gap-2">
                    <Settings2 className="h-4 w-4" />Governance
                  </TabsTrigger>
                </TabsList>
              </div>

              <div className="flex items-center gap-3">
                {loading && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />Loading...
                  </div>
                )}
                {error && (
                  <div className="flex items-center gap-2 text-sm text-destructive">
                    <AlertTriangle className="h-4 w-4" />{error}
                  </div>
                )}
                {!loading && !error && (
                  <div className="flex items-center gap-3 text-sm text-muted-foreground">
                    <span>
                      {allEvents.length} events
                      {hasActiveFilters && ` (${filteredEvents.length} filtered)`}
                    </span>
                    <Button variant="ghost" size="sm" onClick={refresh} className="gap-1 h-8">
                      <RefreshCw className="h-3 w-3" />Refresh
                    </Button>
                  </div>
                )}
              </div>
            </div>

            <TabsContent value="daily-assurance" className="flex-1 mt-0">
              <DailyAssurancePanel allEvents={allEvents} issueCount={unacknowledgedCount} onNavigateToTab={setActiveTab} />
            </TabsContent>
            <TabsContent value="sessions" className="flex-1 mt-0">
              <SessionsPanel events={filteredEvents} onEventClick={setSelectedEvent} selectedEventId={selectedEvent?.event_id} />
            </TabsContent>
            <TabsContent value="issues" className="flex-1 mt-0">
              <IssuesPanel events={filteredEvents} onEventClick={setSelectedEvent} acknowledgedIds={acknowledgedIds} onToggleAcknowledged={handleToggleAcknowledged} onAcknowledgeAll={handleAcknowledgeAll} />
            </TabsContent>
            <TabsContent value="deletion-proof" className="flex-1 mt-0">
              <PurgeProofPanel events={purgeProofEvents} allEvents={allEvents} onEventClick={setSelectedEvent} />
            </TabsContent>
            <TabsContent value="governance" className="flex-1 mt-0">
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                <AIAuthorizationPanel />
                <ComplianceExportPanel />
                <SecurityDashboardPanel className="lg:col-span-1" />
              </div>
            </TabsContent>
          </Tabs>
        </main>
      </div>

      <EventDetailDrawer event={selectedEvent} onClose={() => setSelectedEvent(null)} />
    </div>
  );
}
