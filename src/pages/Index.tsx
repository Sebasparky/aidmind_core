import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { TaskList } from "@/components/dashboard/TaskList";
import { CasesPanel } from "@/components/dashboard/CasesPanel";

const Index = () => {
  return (
    <DashboardLayout>
      <div className="flex gap-6 h-full">
        <TaskList />
        <CasesPanel />
      </div>
    </DashboardLayout>
  );
};

export default Index;
