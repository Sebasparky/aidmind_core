import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { TaskList } from "@/components/dashboard/TaskList";
import { NotesPanel } from "@/components/dashboard/NotesPanel";
import { DerivedSignalsPanel } from "@/components/dashboard/WorkRadarPanel";
import { ActiveSessionsPanel } from "@/components/dashboard/ActiveSessionsPanel";
import { SessionHistoryPanel } from "@/components/dashboard/SessionHistoryPanel";
import { TourController } from "@/components/tour/TourController";
import { V1_DASHBOARD_REDESIGN } from "@/config/features";

const Index = () => {
  if (V1_DASHBOARD_REDESIGN) {
    return (
      <DashboardLayout>
        <TourController role="caseworker" />
        
        <div className="grid grid-cols-3 gap-4 h-full min-h-0">
          <div className="min-h-0" data-tour="derived-signals">
            <DerivedSignalsPanel className="h-full" />
          </div>
          <div className="min-h-0">
            <ActiveSessionsPanel className="h-full" />
          </div>
          <div className="min-h-0" data-tour="session-history">
            <SessionHistoryPanel className="h-full" />
          </div>
        </div>
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      <TourController role="caseworker" />
      <div className="flex h-full min-h-0 gap-6">
        <TaskList />
        <NotesPanel />
      </div>
    </DashboardLayout>
  );
};

export default Index;
