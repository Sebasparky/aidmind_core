import { Loader2 } from "lucide-react";

/**
 * Neutral loading screen shown while auth session + profile are resolving.
 * Prevents route flicker by blocking guard decisions until ready.
 */
export function AuthLoadingScreen() {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-3">
      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      <div className="text-center space-y-1">
        <p className="text-sm font-medium text-foreground">Signing you in…</p>
        <p className="text-xs text-muted-foreground">Verifying access and role</p>
      </div>
    </div>
  );
}
