/**
 * Login Page — AidMind MVP
 *
 * Dark theme, calm, modern, minimal.
 * Email + password only. No sign-up marketing.
 */

import { useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

export default function Login() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Already authenticated → let route guards handle redirect
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[hsl(222,47%,11%)] flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-[hsl(215,20%,65%)]" />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      setError(signInError.message === "Invalid login credentials"
        ? "Invalid email or password."
        : signInError.message
      );
    }
    setSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-[hsl(222,47%,11%)] flex items-center justify-center px-4">
      <div className="w-full max-w-sm space-y-8">
        {/* Branding */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-[hsl(217,91%,60%)]">
            <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-white" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
          </div>
          <h1 className="text-2xl font-semibold text-[hsl(210,40%,98%)] tracking-tight">
            AidMind
          </h1>
          <p className="text-sm text-[hsl(215,20%,55%)] leading-relaxed">
            Policy-aware readiness tools for human service professionals.
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSignIn} className="space-y-5">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email" className="text-sm text-[hsl(215,20%,65%)]">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="bg-[hsl(222,47%,14%)] border-[hsl(217,33%,20%)] text-[hsl(210,40%,98%)] placeholder:text-[hsl(215,20%,40%)] focus:border-[hsl(217,91%,60%)] focus:ring-[hsl(217,91%,60%)]"
                placeholder="you@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-sm text-[hsl(215,20%,65%)]">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="bg-[hsl(222,47%,14%)] border-[hsl(217,33%,20%)] text-[hsl(210,40%,98%)] placeholder:text-[hsl(215,20%,40%)] focus:border-[hsl(217,91%,60%)] focus:ring-[hsl(217,91%,60%)]"
                placeholder="••••••••"
              />
            </div>
          </div>

          {error && (
            <p className="text-sm text-[hsl(0,84%,60%)]" role="alert">
              {error}
            </p>
          )}

          <Button
            type="submit"
            disabled={submitting}
            className="w-full bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,55%)] text-white font-medium"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Signing in…
              </>
            ) : (
              "Sign in"
            )}
          </Button>
        </form>

        {/* Secondary link */}
        <p className="text-center">
          <button
            type="button"
            className="text-xs text-[hsl(215,20%,45%)] hover:text-[hsl(215,20%,60%)] transition-colors"
            onClick={() => {
              // Placeholder — no support flow for MVP
            }}
          >
            Trouble signing in?
          </button>
        </p>

        {/* Footer disclaimer */}
        <p className="text-center text-[11px] text-[hsl(215,20%,35%)] leading-relaxed">
          AidMind does not store case notes or documentation.
        </p>
      </div>
    </div>
  );
}
