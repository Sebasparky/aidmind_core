import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { TaskList } from "@/components/dashboard/TaskList";
import { NotesPanel } from "@/components/dashboard/NotesPanel";
import { DerivedSignalsPanel } from "@/components/dashboard/WorkRadarPanel";
import { ActiveSessionsPanel } from "@/components/dashboard/ActiveSessionsPanel";
import { SessionHistoryPanel } from "@/components/dashboard/SessionHistoryPanel";
import { ContextualTooltips } from "@/components/onboarding/ContextualTooltips";
import { V1_DASHBOARD_REDESIGN } from "@/config/features";

/**
 * Dashboard Page (Signals Hub)
 * 
 * V1 Redesign: Three-panel layout focused on situational awareness.
 */
const Index = () => {
  if (V1_DASHBOARD_REDESIGN) {
    return (
      <DashboardLayout>
        {/* Contextual tooltips for caseworker */}
        <ContextualTooltips role="caseworker" />
        
        <div className="grid grid-cols-3 gap-4 h-full min-h-0">
          <div className="min-h-0">
            <DerivedSignalsPanel className="h-full" />
          </div>
          <div className="min-h-0">
            <ActiveSessionsPanel className="h-full" />
          </div>
          <div className="min-h-0">
            <SessionHistoryPanel className="h-full" />
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <ContextualTooltips role="caseworker" />
      <div className="flex h-full min-h-0 gap-6">
        <TaskList />
        <NotesPanel />
      </div>
    </DashboardLayout>
  );
};

export default Index;
