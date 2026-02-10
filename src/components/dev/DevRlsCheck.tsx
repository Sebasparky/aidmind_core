/**
 * DevRlsCheck — DEV-ONLY QA helper panel
 *
 * Runs a direct SELECT against public.eye_events to verify
 * RLS enforcement for the currently authenticated user.
 *
 * GATED: Only renders when import.meta.env.DEV is true.
 * Tree-shaken out of production builds.
 */

import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";

interface RlsResult {
  status: "idle" | "loading" | "success" | "blocked";
  rowCount: number | null;
  message: string;
}

export function DevRlsCheck() {
  const { isAuthenticated, profile } = useAuth();
  const [result, setResult] = useState<RlsResult>({
    status: "idle",
    rowCount: null,
    message: "Click to test RLS on eye_events",
  });

  if (!import.meta.env.DEV) return null;
  if (!isAuthenticated) return null;

  const runCheck = async () => {
    setResult({ status: "loading", rowCount: null, message: "Querying…" });

    try {
      const { data, error } = await supabase
        .from("eye_events")
        .select("id, event_type, created_at")
        .limit(10);

      if (error) {
        setResult({
          status: "blocked",
          rowCount: null,
          message: `RLS blocked: ${error.message}`,
        });
      } else {
        setResult({
          status: "success",
          rowCount: data?.length ?? 0,
          message: `${data?.length ?? 0} rows returned`,
        });
      }
    } catch (err: unknown) {
      setResult({
        status: "blocked",
        rowCount: null,
        message: `Error: ${err instanceof Error ? err.message : "Unknown"}`,
      });
    }
  };

  const Icon = result.status === "blocked" ? ShieldAlert : ShieldCheck;

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      <div className="bg-card border border-border rounded-lg shadow-lg p-3 min-w-[260px] max-w-[320px]">
        <div className="flex items-center gap-2 mb-2">
          <Badge
            variant="outline"
            className="text-[10px] font-mono uppercase tracking-wider border-destructive text-destructive bg-destructive/5"
          >
            DEV QA
          </Badge>
          <span className="text-[10px] text-muted-foreground ml-auto">
            {profile?.role ?? "no role"} / {profile?.status ?? "?"}
          </span>
        </div>

        <Button
          variant="outline"
          size="sm"
          className="w-full text-xs gap-2"
          onClick={runCheck}
          disabled={result.status === "loading"}
        >
          {result.status === "loading" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Icon className="h-3 w-3" />
          )}
          Test eye_events RLS
        </Button>

        {result.status !== "idle" && result.status !== "loading" && (
          <div
            className={`mt-2 text-xs p-2 rounded border ${
              result.status === "blocked"
                ? "border-destructive/30 bg-destructive/5 text-destructive"
                : result.rowCount === 0
                  ? "border-primary/30 bg-primary/5 text-primary"
                  : "border-muted bg-muted text-foreground"
            }`}
          >
            {result.message}
          </div>
        )}

        <p className="text-[10px] text-muted-foreground/60 mt-2 leading-tight">
          Dev-only RLS verification. Not shipped in production.
        </p>
      </div>
    </div>
  );
}
