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
import Session from "./pages/Session";
import Supervisor from "./pages/Supervisor";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

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
                <Route path="/session" element={<Session />} />
                <Route path="/supervisor" element={<Supervisor />} />
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
