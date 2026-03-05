/**
 * Login Page — AidMind
 *
 * Dark theme, calm, modern, enterprise.
 * Centered card layout. No marketing copy.
 */

import { useState } from "react";
import { Navigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import { AidMindBrand } from "@/components/brand/AidMindBrand";

export default function Login() {
  const { isAuthenticated, loading: authLoading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (authLoading) {
    return (
      <div className="login-bg min-h-screen flex items-center justify-center">
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
      setError(
        signInError.message === "Invalid login credentials"
          ? "Invalid email or password."
          : signInError.message
      );
    }
    setSubmitting(false);
  };

  return (
    <div className="login-bg min-h-screen flex items-center justify-center px-4">
      <div className="relative z-10 w-full max-w-[440px]">
        <div className="login-card px-8 py-10 sm:px-10 sm:py-12">
          {/* Logo */}
          <div className="flex justify-center mb-10">
            <AidMindBrand
              size="lg"
              showWordmark={false}
              className="text-[hsl(210,40%,98%)]"
            />
          </div>

          {/* Form */}
          <form onSubmit={handleSignIn} className="space-y-6">
            <div className="space-y-5">
              <div className="space-y-2">
                <Label
                  htmlFor="email"
                  className="text-sm font-medium text-[hsl(215,20%,65%)]"
                >
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="h-11 bg-[hsl(222,47%,11%)] border-[hsl(217,33%,20%)] text-[hsl(210,40%,98%)] placeholder:text-[hsl(215,20%,35%)] focus:border-[hsl(217,91%,60%)] focus:ring-[hsl(217,91%,60%)]"
                  placeholder="you@example.com"
                />
              </div>
              <div className="space-y-2">
                <Label
                  htmlFor="password"
                  className="text-sm font-medium text-[hsl(215,20%,65%)]"
                >
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="h-11 bg-[hsl(222,47%,11%)] border-[hsl(217,33%,20%)] text-[hsl(210,40%,98%)] placeholder:text-[hsl(215,20%,35%)] focus:border-[hsl(217,91%,60%)] focus:ring-[hsl(217,91%,60%)]"
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
              className="w-full h-11 bg-[hsl(217,91%,60%)] hover:bg-[hsl(217,91%,55%)] text-white font-medium text-sm"
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
          <div className="mt-6 text-center">
            <button
              type="button"
              className="text-xs text-[hsl(215,20%,40%)] hover:text-[hsl(215,20%,60%)] transition-colors"
              onClick={() => {
                // Placeholder — no support flow for MVP
              }}
            >
              Trouble signing in?
            </button>
          </div>
        </div>

        {/* Footer disclaimer — outside card */}
        <p className="mt-6 text-center text-[11px] text-[hsl(215,20%,30%)] leading-relaxed">
          AidMind does not store case notes or documentation.
        </p>
      </div>
    </div>
  );
}
