import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { TaskList } from "@/components/dashboard/TaskList";
import { NotesPanel } from "@/components/dashboard/NotesPanel";
import { DerivedSignalsPanel } from "@/components/dashboard/WorkRadarPanel";
import { ActiveSessionsPanel } from "@/components/dashboard/ActiveSessionsPanel";
import { SessionHistoryPanel } from "@/components/dashboard/SessionHistoryPanel";
import { V1_DASHBOARD_REDESIGN } from "@/config/features";

/**
 * Dashboard Page (Signals Hub)
 * 
 * V1 Redesign: Three-panel layout focused on situational awareness.
 * - Derived Signals: Informational indicators from policy/session context
 * - Active Sessions: Access points to Guidance and Reviewer tools
 * - Session History: Completed/closed sessions (read-only)
 * 
 * This is NOT a task manager, calendar, or system of record.
 */
const Index = () => {
  // V1 Dashboard Redesign: Signals Hub layout
  // 3-column equal-weight layout (no schedule column)
  if (V1_DASHBOARD_REDESIGN) {
    return (
      <DashboardLayout>
        <div className="grid grid-cols-3 gap-4 h-full min-h-0">
          {/* Left Panel: Derived Signals - informational indicators */}
          <div className="min-h-0">
            <DerivedSignalsPanel className="h-full" />
          </div>
          
          {/* Center Panel: Active Sessions - tool access points */}
          <div className="min-h-0">
            <ActiveSessionsPanel className="h-full" />
          </div>
          
          {/* Right Panel: Session History - read-only */}
          <div className="min-h-0">
            <SessionHistoryPanel className="h-full" />
          </div>
        </div>
      </DashboardLayout>
    );
  }

  // Legacy dashboard layout (gated behind feature flag)
  return (
    <DashboardLayout>
      <div className="flex h-full min-h-0 gap-6">
        <TaskList />
        <NotesPanel />
      </div>
    </DashboardLayout>
  );
};

export default Index;
