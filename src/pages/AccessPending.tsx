/**
 * Access Pending / Blocked Screen
 *
 * Handles: pending, disabled, and role-missing states.
 * Calm, centered card. No retry loops.
 */

import { Navigate } from "react-router-dom";
import { useAuth, type ProfileStatus } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Clock, ShieldOff, AlertTriangle, Loader2 } from "lucide-react";

function getStateContent(status: ProfileStatus | null, role: string | null) {
  if (status === "disabled") {
    return {
      icon: ShieldOff,
      title: "Access Disabled",
      message: "Your access to AidMind has been disabled.",
    };
  }
  if (!role) {
    return {
      icon: AlertTriangle,
      title: "Access Pending",
      message: "Your account is not yet assigned to a role.",
    };
  }
  // Default: pending
  return {
    icon: Clock,
    title: "Access Pending",
    message: "Your AidMind account is pending activation. Please contact your administrator.",
  };
}

export default function AccessPending() {
  const { isAuthenticated, loading, status, role, signOut } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-[hsl(222,47%,11%)] flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(215,20%,65%)]" />
      </div>
    );
  }

  // Not logged in → login
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Active user with a valid role shouldn't be here
  if (status === "active" && role) {
    return <Navigate to="/" replace />;
  }

  const { icon: Icon, title, message } = getStateContent(status, role);

  return (
    <div className="min-h-screen bg-[hsl(222,47%,11%)] flex items-center justify-center px-4">
      <Card className="w-full max-w-md bg-[hsl(222,47%,14%)] border-[hsl(217,33%,20%)]">
        <CardContent className="pt-8 pb-4 text-center space-y-4">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[hsl(217,33%,17%)]">
            <Icon className="h-6 w-6 text-[hsl(215,20%,65%)]" />
          </div>
          <h1 className="text-xl font-semibold text-[hsl(210,40%,98%)]">{title}</h1>
          <p className="text-sm text-[hsl(215,20%,55%)] leading-relaxed max-w-xs mx-auto">
            {message}
          </p>
        </CardContent>
        <CardFooter className="flex flex-col gap-4 pb-8">
          <Button
            variant="outline"
            onClick={signOut}
            className="border-[hsl(217,33%,20%)] text-[hsl(210,40%,98%)] hover:bg-[hsl(217,33%,17%)]"
          >
            Log out
          </Button>
          <p className="text-[11px] text-[hsl(215,20%,35%)] text-center leading-relaxed">
            AidMind access is role-based and read-only by default.
          </p>
        </CardFooter>
      </Card>
    </div>
  );
}
