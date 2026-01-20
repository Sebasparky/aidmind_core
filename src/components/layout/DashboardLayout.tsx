import { ReactNode } from "react";
import { Header } from "./Header";

interface DashboardLayoutProps {
  children: ReactNode;
}

/**
 * Dashboard Layout - Full width, no sidebar.
 * 
 * V1 Pivot: AidMind is a readiness surface, not an app shell.
 * No persistent sidebar, no navigation hierarchy.
 */
export function DashboardLayout({ children }: DashboardLayoutProps) {
  return (
    <div className="h-screen flex flex-col bg-background overflow-hidden">
      <Header />
      <main className="flex-1 overflow-y-auto p-6 bg-[hsl(var(--canvas))]">
        {children}
      </main>
    </div>
  );
}
