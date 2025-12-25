import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { TaskList } from "@/components/dashboard/TaskList";
import { CasesPanel } from "@/components/dashboard/CasesPanel";
import { DashboardProvider } from "@/contexts/DashboardContext";

const Index = () => {
  return (
    <DashboardProvider>
      <DashboardLayout>
        <div className="flex h-full min-h-0 gap-6">
          <TaskList />
          <CasesPanel />
        </div>
      </DashboardLayout>
    </DashboardProvider>
  );
};

export default Index;
