import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Trash2, Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

interface CleanupResult {
  matchedSessions: number;
  updatedSessions: number;
  insertedEvents: number;
  sessionIds: string[];
  dryRun: boolean;
  criteria: {
    daysBack: number;
    maxEventCount: number;
    inactiveMinutes: number;
  };
}

/**
 * ⚠️ DEV/DEMO ONLY: Manual trigger for orphan/abandoned session cleanup.
 * 
 * In production, this cleanup MUST be scheduled (cron) to run automatically
 * every 5-10 minutes. This button exists only for development testing.
 * 
 * TODO (PRODUCTION): Replace with scheduled pg_cron job or external scheduler.
 */
export function OrphanCleanupButton() {
  const [open, setOpen] = useState(false);
  const [dryRun, setDryRun] = useState(true);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<CleanupResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleCleanup = async () => {
    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        "cleanup-orphan-sessions-dev",
        {
          body: {
            dryRun,
            daysBack: 7,
            maxEventCount: 3,
            inactiveMinutes: 30,
          },
        }
      );

      if (fnError) {
        throw fnError;
      }

      setResult(data as CleanupResult);
    } catch (err) {
      console.error("Cleanup error:", err);
      setError(err instanceof Error ? err.message : "Cleanup failed");
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setOpen(false);
    // Reset state when closing
    setTimeout(() => {
      setResult(null);
      setError(null);
      setDryRun(true);
    }, 200);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 text-xs">
          <Trash2 className="h-3 w-3" />
          DEV: Cleanup Orphans
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Trash2 className="h-5 w-5" />
            Cleanup Orphan Sessions
            <Badge variant="secondary" className="text-xs">DEV</Badge>
          </DialogTitle>
          <DialogDescription>
            This will mark orphan sessions as cancelled. Orphan sessions are those that:
            <ul className="list-disc list-inside mt-2 space-y-1 text-xs">
              <li>Have no terminal events (closed/cancelled/exported)</li>
              <li>Have 3 or fewer events total, OR</li>
              <li>Have been inactive for 30+ minutes</li>
            </ul>
          </DialogDescription>
        </DialogHeader>

        {/* Dry run checkbox */}
        <div className="flex items-center space-x-2 py-2">
          <Checkbox
            id="dryRun"
            checked={dryRun}
            onCheckedChange={(checked) => setDryRun(checked as boolean)}
            disabled={loading}
          />
          <Label htmlFor="dryRun" className="text-sm font-medium">
            Dry run only (preview without making changes)
          </Label>
        </div>

        {/* Results */}
        {result && (
          <div className="rounded-lg border p-4 space-y-3">
            <div className="flex items-center gap-2">
              {result.dryRun ? (
                <AlertCircle className="h-4 w-4 text-amber-500" />
              ) : (
                <CheckCircle2 className="h-4 w-4 text-green-500" />
              )}
              <span className="font-medium">
                {result.dryRun ? "Dry Run Results" : "Cleanup Complete"}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="text-muted-foreground">Sessions found:</div>
              <div className="font-mono">{result.matchedSessions}</div>
              
              {!result.dryRun && (
                <>
                  <div className="text-muted-foreground">Sessions updated:</div>
                  <div className="font-mono">{result.updatedSessions}</div>
                  
                  <div className="text-muted-foreground">Events inserted:</div>
                  <div className="font-mono">{result.insertedEvents}</div>
                </>
              )}
            </div>

            {result.sessionIds.length > 0 && (
              <div className="space-y-1">
                <div className="text-sm text-muted-foreground">Session IDs:</div>
                <ScrollArea className="h-24 rounded border p-2">
                  <div className="space-y-1">
                    {result.sessionIds.map((id) => (
                      <code key={id} className="block text-xs font-mono text-muted-foreground">
                        {id}
                      </code>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {result.matchedSessions === 0 && (
              <p className="text-sm text-muted-foreground">
                No orphan sessions found. All sessions are properly terminated.
              </p>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-4">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleClose} disabled={loading}>
            {result ? "Done" : "Cancel"}
          </Button>
          {!result && (
            <Button onClick={handleCleanup} disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {dryRun ? "Preview Cleanup" : "Run Cleanup"}
            </Button>
          )}
          {result && result.dryRun && result.matchedSessions > 0 && (
            <Button
              onClick={() => {
                setDryRun(false);
                setResult(null);
              }}
              variant="destructive"
            >
              Run Actual Cleanup
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
