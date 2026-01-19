import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { TaskList } from "@/components/dashboard/TaskList";
import { NotesPanel } from "@/components/dashboard/NotesPanel";
import { WorkRadarPanel } from "@/components/dashboard/WorkRadarPanel";
import { ActiveSessionsPanel } from "@/components/dashboard/ActiveSessionsPanel";
import { SessionHistoryPanel } from "@/components/dashboard/SessionHistoryPanel";
import { V1_DASHBOARD_REDESIGN } from "@/config/features";

/**
 * Dashboard Page (Signals Hub)
 * 
 * V1 Redesign: Three-panel layout focused on situational awareness.
 * - Work Radar: Derived documentation obligations with provenance
 * - Active Sessions: Access points to Guidance and Reviewer tools
 * - Session History: Completed/closed sessions (read-only)
 * 
 * This is NOT a task manager, calendar, or system of record.
 */
const Index = () => {
  // V1 Dashboard Redesign: Signals Hub layout
  if (V1_DASHBOARD_REDESIGN) {
    return (
      <DashboardLayout>
        <div className="flex h-full min-h-0 gap-4">
          {/* Left Panel: Work Radar */}
          <div className="w-[320px] flex-shrink-0">
            <WorkRadarPanel />
          </div>
          
          {/* Center Panel: Active Sessions */}
          <div className="flex-1 min-w-0">
            <ActiveSessionsPanel className="h-full" />
          </div>
          
          {/* Right Panel: Session History */}
          <div className="w-[340px] flex-shrink-0">
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
