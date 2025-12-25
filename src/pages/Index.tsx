import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { TaskList } from "@/components/dashboard/TaskList";
import { CasesPanel } from "@/components/dashboard/CasesPanel";

const Index = () => {
  return (
    <DashboardLayout>
      <div className="flex h-full min-h-0 gap-6">
        <TaskList />
        <CasesPanel />
      </div>
    </DashboardLayout>
  );
};

export default Index;
