/**
 * Supervisor UI - The Eye Event Viewer
 * 
 * A trust, audit, and safety surface for supervisors to view
 * Eye events without any PHI exposure.
 * 
 * Session-first default view with collapsible filters.
 */

import { useState, useMemo, useCallback } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { 
  generateMockEyeEvents, 
  filterEvents, 
  getPurgeProofEvents,
  getErrorEvents,
  EventFilters,
} from "@/lib/eye/mock-data";
import { EyeEvent } from "@/lib/eye/types";
import { SupervisorHeader } from "@/components/supervisor/SupervisorHeader";
import { EventFiltersPanel } from "@/components/supervisor/EventFiltersPanel";
import { SessionsPanel } from "@/components/supervisor/SessionsPanel";
import { IssuesPanel } from "@/components/supervisor/IssuesPanel";
import { EventDetailDrawer } from "@/components/supervisor/EventDetailDrawer";
import { PurgeProofPanel } from "@/components/supervisor/PurgeProofPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { 
  LayoutList, 
  AlertTriangle, 
  ShieldCheck,
  Filter,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

export default function Supervisor() {
  const { currentUser, canAccessSupervisor } = useAuth();
  
  // Redirect if user doesn't have supervisor access
  if (!canAccessSupervisor) {
    return <Navigate to="/dashboard" replace />;
  }

  // Generate mock events
  const allEvents = useMemo(() => generateMockEyeEvents(), []);
  
  // Filter state
  const [filters, setFilters] = useState<EventFilters>({});
  const [selectedEvent, setSelectedEvent] = useState<EyeEvent | null>(null);
  const [activeTab, setActiveTab] = useState("sessions");
  const [showFilters, setShowFilters] = useState(false);
  const [reviewedIds, setReviewedIds] = useState<Set<string>>(new Set());

  // Apply filters
  const filteredEvents = useMemo(() => 
    filterEvents(allEvents, filters),
    [allEvents, filters]
  );

  // Get specialized views
  const purgeProofEvents = useMemo(() => 
    getPurgeProofEvents(allEvents),
    [allEvents]
  );
  
  const errorEvents = useMemo(() => 
    getErrorEvents(allEvents),
    [allEvents]
  );

  // Check if any filters are active
  const hasActiveFilters = 
    (filters.categories?.length ?? 0) > 0 ||
    (filters.severities?.length ?? 0) > 0 ||
    filters.sessionId ||
    filters.caseId ||
    filters.operatorId;

  // Handle filter changes
  const handleFilterChange = (newFilters: Partial<EventFilters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
  };

  const clearFilters = () => {
    setFilters({});
  };

  // Issues review handlers
  const handleMarkReviewed = useCallback((eventId: string) => {
    setReviewedIds(prev => {
      const next = new Set(prev);
      if (next.has(eventId)) {
        next.delete(eventId);
      } else {
        next.add(eventId);
      }
      return next;
    });
  }, []);

  const handleMarkAllReviewed = useCallback(() => {
    const issueIds = errorEvents.map(e => e.event_id);
    setReviewedIds(new Set(issueIds));
  }, [errorEvents]);

  // Unreviewed count for badge
  const unreviewedCount = useMemo(() => 
    errorEvents.filter(e => !reviewedIds.has(e.event_id)).length,
    [errorEvents, reviewedIds]
  );

  return (
    <div className="min-h-screen bg-canvas flex flex-col">
      {/* Header */}
      <SupervisorHeader user={currentUser} />

      {/* Main Content */}
      <div className="flex-1 flex">
        {/* Collapsible Filters Sidebar */}
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

        {/* Main Panel */}
        <main className="flex-1 p-6 overflow-auto">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
            <div className="flex items-center justify-between mb-4">
              {/* Filters toggle + Tabs */}
              <div className="flex items-center gap-3">
                <Button
                  variant={showFilters ? "secondary" : "outline"}
                  size="sm"
                  onClick={() => setShowFilters(!showFilters)}
                  className="gap-2"
                >
                  {showFilters ? (
                    <X className="h-4 w-4" />
                  ) : (
                    <Filter className="h-4 w-4" />
                  )}
                  Filters
                  {hasActiveFilters && (
                    <Badge variant="secondary" className="ml-1 text-xs bg-primary text-primary-foreground">
                      Active
                    </Badge>
                  )}
                </Button>

                <TabsList className="bg-muted/50">
                  <TabsTrigger value="sessions" className="gap-2">
                    <LayoutList className="h-4 w-4" />
                    Sessions
                  </TabsTrigger>
                  <TabsTrigger value="issues" className="gap-2">
                    <AlertTriangle className="h-4 w-4" />
                    Issues
                    {unreviewedCount > 0 && (
                      <Badge variant="destructive" className="ml-1 text-xs">
                        {unreviewedCount}
                      </Badge>
                    )}
                  </TabsTrigger>
                  <TabsTrigger value="deletion-proof" className="gap-2">
                    <ShieldCheck className="h-4 w-4" />
                    Data Deletion Proof
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* Event count */}
              {hasActiveFilters && (
                <div className="text-sm text-muted-foreground">
                  Showing {filteredEvents.length} of {allEvents.length} events
                </div>
              )}
            </div>

            <TabsContent value="sessions" className="flex-1 mt-0">
              <SessionsPanel
                events={filteredEvents}
                onEventClick={setSelectedEvent}
                selectedEventId={selectedEvent?.event_id}
              />
            </TabsContent>

            <TabsContent value="issues" className="flex-1 mt-0">
              <IssuesPanel
                events={filteredEvents}
                onEventClick={setSelectedEvent}
                reviewedIds={reviewedIds}
                onMarkReviewed={handleMarkReviewed}
                onMarkAllReviewed={handleMarkAllReviewed}
              />
            </TabsContent>

            <TabsContent value="deletion-proof" className="flex-1 mt-0">
              <PurgeProofPanel
                events={purgeProofEvents}
                allEvents={allEvents}
                onEventClick={setSelectedEvent}
              />
            </TabsContent>
          </Tabs>
        </main>
      </div>

      {/* Event Detail Drawer */}
      <EventDetailDrawer
        event={selectedEvent}
        onClose={() => setSelectedEvent(null)}
      />
    </div>
  );
}
