/**
 * Supervisor UI - The Eye Event Viewer
 * 
 * A trust, audit, and safety surface for supervisors to view
 * Eye events without any PHI exposure.
 */

import { useState, useMemo } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { 
  generateMockEyeEvents, 
  filterEvents, 
  getEventCategory,
  getEventSeverity,
  getPurgeProofEvents,
  getErrorEvents,
  EventFilters,
} from "@/lib/eye/mock-data";
import { 
  EyeEvent, 
  EventCategory, 
  EventSeverity,
  IMPLEMENTED_EVENTS,
  FUTURE_EVENTS,
} from "@/lib/eye/types";
import { ROLE_DISPLAY_NAMES, ROLE_COLORS } from "@/lib/rbac/types";
import { SupervisorHeader } from "@/components/supervisor/SupervisorHeader";
import { EventFiltersPanel } from "@/components/supervisor/EventFiltersPanel";
import { EventFeed } from "@/components/supervisor/EventFeed";
import { EventDetailDrawer } from "@/components/supervisor/EventDetailDrawer";
import { PurgeProofPanel } from "@/components/supervisor/PurgeProofPanel";
import { ErrorsWarningsPanel } from "@/components/supervisor/ErrorsWarningsPanel";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Eye, ShieldCheck, AlertTriangle } from "lucide-react";

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
  const [activeTab, setActiveTab] = useState("feed");

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

  // Handle filter changes
  const handleFilterChange = (newFilters: Partial<EventFilters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
  };

  const clearFilters = () => {
    setFilters({});
  };

  return (
    <div className="min-h-screen bg-canvas flex flex-col">
      {/* Header */}
      <SupervisorHeader user={currentUser} />

      {/* Main Content */}
      <div className="flex-1 flex">
        {/* Filters Sidebar */}
        <aside className="w-64 border-r border-border bg-card p-4 flex-shrink-0">
          <EventFiltersPanel
            filters={filters}
            onFilterChange={handleFilterChange}
            onClearFilters={clearFilters}
          />
        </aside>

        {/* Main Panel */}
        <main className="flex-1 p-6 overflow-auto">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="h-full flex flex-col">
            <div className="flex items-center justify-between mb-4">
              <TabsList className="bg-muted/50">
                <TabsTrigger value="feed" className="gap-2">
                  <Eye className="h-4 w-4" />
                  Event Feed
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {filteredEvents.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="purge-proof" className="gap-2">
                  <ShieldCheck className="h-4 w-4" />
                  Purge Proof
                  <Badge variant="secondary" className="ml-1 text-xs">
                    {purgeProofEvents.length}
                  </Badge>
                </TabsTrigger>
                <TabsTrigger value="errors" className="gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  Errors & Warnings
                  {errorEvents.length > 0 && (
                    <Badge variant="destructive" className="ml-1 text-xs">
                      {errorEvents.length}
                    </Badge>
                  )}
                </TabsTrigger>
              </TabsList>

              <div className="text-sm text-muted-foreground">
                Showing {filteredEvents.length} of {allEvents.length} events
              </div>
            </div>

            <TabsContent value="feed" className="flex-1 mt-0">
              <EventFeed
                events={filteredEvents}
                onEventClick={setSelectedEvent}
                selectedEventId={selectedEvent?.event_id}
              />
            </TabsContent>

            <TabsContent value="purge-proof" className="flex-1 mt-0">
              <PurgeProofPanel
                events={purgeProofEvents}
                allEvents={allEvents}
                onEventClick={setSelectedEvent}
              />
            </TabsContent>

            <TabsContent value="errors" className="flex-1 mt-0">
              <ErrorsWarningsPanel
                events={errorEvents}
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
