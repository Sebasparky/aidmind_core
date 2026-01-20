import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { DashboardProvider } from "@/contexts/DashboardContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { NavigationGuardProvider } from "@/contexts/NavigationGuardContext";
import Index from "./pages/Index";
import Calendar from "./pages/Calendar";
import Guidance from "./pages/Guidance";
import Reviewer from "./pages/Reviewer";
import Supervisor from "./pages/Supervisor";
import Auditor from "./pages/Auditor";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

/**
 * V1 Routing Structure:
 * - /dashboard: Main dashboard (Work Radar, Active Sessions, Session History)
 * - /guidance/:sessionId: Standalone Guidance tool
 * - /reviewer/:sessionId: Standalone Reviewer tool
 * 
 * REMOVED: /session route (sessions are containers, not pages)
 */
const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <NavigationGuardProvider>
            <DashboardProvider>
              <Routes>
                <Route path="/" element={<Index />} />
                <Route path="/dashboard" element={<Index />} />
                <Route path="/calendar" element={<Calendar />} />
                {/* Tool-specific routes (independent, non-sequential) */}
                <Route path="/guidance/:sessionId" element={<Guidance />} />
                <Route path="/reviewer/:sessionId" element={<Reviewer />} />
                {/* Admin routes */}
                <Route path="/supervisor" element={<Supervisor />} />
                <Route path="/auditor" element={<Auditor />} />
                {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                <Route path="*" element={<NotFound />} />
              </Routes>
            </DashboardProvider>
          </NavigationGuardProvider>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
