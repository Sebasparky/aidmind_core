import { useState, useEffect, useCallback } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { DashboardProvider } from "@/contexts/DashboardContext";
import { AuthProvider, useAuth } from "@/contexts/AuthContext";
import { NavigationGuardProvider } from "@/contexts/NavigationGuardContext";
import { DevRoleToggle } from "@/components/dev/DevRoleToggle";
import { DevRlsCheck } from "@/components/dev/DevRlsCheck";
import { RouteGuard } from "@/components/auth/RouteGuard";
import { WelcomeModal, useOnboardingState, WELCOME_ACK_KEY } from "@/components/onboarding/WelcomeModal";
import { TOUR_REPLAY_EVENT } from "@/components/tour/types";
import Login from "./pages/Login";
import AccessPending from "./pages/AccessPending";
import Index from "./pages/Index";
import Calendar from "./pages/Calendar";
import Guidance from "./pages/Guidance";
import GuidanceTemplateSelection from "./pages/GuidanceTemplateSelection";
import Reviewer from "./pages/Reviewer";
import CaseNotes from "./pages/CaseNotes";
import Supervisor from "./pages/Supervisor";
import Auditor from "./pages/Auditor";
import Platform from "./pages/Platform";
import NotFound from "./pages/NotFound";
import KbBulkUpload from "./pages/KbBulkUpload";
import { AuthLoadingScreen } from "@/components/auth/AuthLoadingScreen";

const queryClient = new QueryClient();

/** Root redirect based on role */
function RoleRedirect() {
  const { loading, isAuthenticated, status, role } = useAuth();

  if (loading) {
    return <AuthLoadingScreen />;
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (status !== "active" || !role) return <Navigate to="/access-pending" replace />;

  switch (role) {
    case "supervisor": return <Navigate to="/supervisor" replace />;
    case "auditor": return <Navigate to="/auditor" replace />;
    default: return <Navigate to="/dashboard" replace />;
  }
}

/** Onboarding overlay — renders welcome modal when appropriate */
function OnboardingLayer() {
  const { isAuthenticated, status, role } = useAuth();
  const { showWelcome, acknowledge, dismissViaX } = useOnboardingState();

  if (!isAuthenticated || status !== "active" || !role) return null;

  const handleAcknowledge = () => {
    acknowledge();
    // Start tour after a short delay so modal fully unmounts first
    setTimeout(() => {
      window.dispatchEvent(new CustomEvent(TOUR_REPLAY_EVENT, { detail: { role } }));
    }, 300);
  };

  return <WelcomeModal open={showWelcome} onAcknowledge={handleAcknowledge} onDismissViaX={dismissViaX} />;
}

/** Dev mode panels — toggleable via VITE_DEV_MODE + ⌘+Shift+D runtime toggle */
function DevModeLayer() {
  const envEnabled = import.meta.env.VITE_DEV_MODE === 'true';
  const [runtimeHidden, setRuntimeHidden] = useState(false);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'D') {
      e.preventDefault();
      setRuntimeHidden((prev) => !prev);
    }
  }, []);

  useEffect(() => {
    if (!envEnabled) return;
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [envEnabled, handleKeyDown]);

  if (!envEnabled || runtimeHidden) return null;

  return (
    <>
      <DevRoleToggle />
      <DevRlsCheck />
    </>
  );
}

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
                {/* Public routes */}
                <Route path="/login" element={<Login />} />
                <Route path="/access-pending" element={<AccessPending />} />

                {/* Root redirect */}
                <Route path="/" element={<RoleRedirect />} />

                {/* Caseworker routes */}
                <Route path="/dashboard" element={
                  <RouteGuard allowedRoles={["caseworker"]}>
                    <Index />
                  </RouteGuard>
                } />
                <Route path="/calendar" element={
                  <RouteGuard allowedRoles={["caseworker"]}>
                    <Calendar />
                  </RouteGuard>
                } />
                <Route path="/guidance/:sessionId/template" element={
                  <RouteGuard allowedRoles={["caseworker"]}>
                    <GuidanceTemplateSelection />
                  </RouteGuard>
                } />
                <Route path="/guidance/:sessionId" element={
                  <RouteGuard allowedRoles={["caseworker"]}>
                    <Guidance />
                  </RouteGuard>
                } />
                <Route path="/sessions/:sessionId/case-notes" element={
                  <RouteGuard allowedRoles={["caseworker"]}>
                    <CaseNotes />
                  </RouteGuard>
                } />
                <Route path="/reviewer/:sessionId" element={
                  <RouteGuard allowedRoles={["caseworker"]}>
                    <Reviewer />
                  </RouteGuard>
                } />
                <Route path="/platform/*" element={
                  <RouteGuard allowedRoles={["caseworker"]}>
                    <Platform />
                  </RouteGuard>
                } />
                <Route path="/kb/bulk-upload" element={
                  <RouteGuard allowedRoles={["caseworker", "supervisor"]}>
                    <KbBulkUpload />
                  </RouteGuard>
                } />

                {/* Supervisor route */}
                <Route path="/supervisor" element={
                  <RouteGuard allowedRoles={["supervisor"]}>
                    <Supervisor />
                  </RouteGuard>
                } />

                {/* Auditor route */}
                <Route path="/auditor" element={
                  <RouteGuard allowedRoles={["auditor"]}>
                    <Auditor />
                  </RouteGuard>
                } />

                {/* Catch-all */}
                <Route path="*" element={<NotFound />} />
              </Routes>

              {/* Onboarding overlay */}
              <OnboardingLayer />
            </DashboardProvider>
          </NavigationGuardProvider>
          <DevModeLayer />
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
