import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { TaskList } from "@/components/dashboard/TaskList";
import { NotesPanel } from "@/components/dashboard/NotesPanel";

const Index = () => {
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
