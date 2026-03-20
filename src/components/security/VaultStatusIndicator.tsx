/**
 * VaultStatusIndicator — Visual status for sealed case-notes vault.
 *
 * Shows lock state, countdown timer, and unlock CTA.
 * Used in both CaseNotes (post-seal) and Reviewer (unlock flow).
 */

import { Lock, Unlock, ShieldCheck, Clock, AlertTriangle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import type { VaultState, VaultMetadata } from "@/lib/security/vault-types";

interface VaultStatusIndicatorProps {
  vaultState: VaultState;
  metadata: VaultMetadata | null;
  unlockTimeRemaining: number | null;
  onUnlockClick?: () => void;
  onRelockClick?: () => void;
  compact?: boolean;
}

function formatTimeRemaining(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

export function VaultStatusIndicator({
  vaultState,
  metadata,
  unlockTimeRemaining,
  onUnlockClick,
  onRelockClick,
  compact = false,
}: VaultStatusIndicatorProps) {
  if (vaultState === "empty") return null;

  if (compact) {
    return (
      <div className="flex items-center gap-2">
        {vaultState === "sealed" && (
          <>
            <Lock className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Case notes sealed</span>
            {onUnlockClick && (
              <Button variant="outline" size="sm" className="h-6 px-2 text-[10px] gap-1" onClick={onUnlockClick}>
                <Unlock className="h-3 w-3" /> Unlock
              </Button>
            )}
          </>
        )}
        {vaultState === "unlocked" && unlockTimeRemaining !== null && (
          <>
            <Unlock className="h-3.5 w-3.5 text-[hsl(var(--status-success))]" />
            <span className="text-xs text-[hsl(var(--status-success))]">Unlocked</span>
            <Badge variant="outline" className="text-[10px] text-[hsl(var(--status-warning))] border-[hsl(var(--status-warning))]/30 gap-1 tabular-nums">
              <Clock className="h-2.5 w-2.5" />
              {formatTimeRemaining(unlockTimeRemaining)}
            </Badge>
            {onRelockClick && (
              <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] gap-1" onClick={onRelockClick}>
                <Lock className="h-3 w-3" /> Relock
              </Button>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <Card className="border border-border shadow-none">
      <CardContent className="px-5 py-4 space-y-3">
        {/* Sealed state */}
        {vaultState === "sealed" && (
          <>
            <div className="flex items-start gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted">
                <Lock className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-medium text-foreground">Case notes protected</p>
                <p className="text-xs text-muted-foreground">
                  Encrypted and stored securely. Re-authentication required to access.
                </p>
              </div>
            </div>

            {metadata && (
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant="outline" className="text-[10px]">
                  {metadata.answered_count} of {metadata.field_count} fields
                </Badge>
                <Badge variant="outline" className="text-[10px] text-muted-foreground">
                  Sealed {new Date(metadata.sealed_at).toLocaleString()}
                </Badge>
              </div>
            )}

            {onUnlockClick && (
              <Button variant="outline" className="w-full gap-2" onClick={onUnlockClick}>
                <Unlock className="h-4 w-4" />
                Unlock case notes for comparison
              </Button>
            )}
          </>
        )}

        {/* Unlocked state */}
        {vaultState === "unlocked" && (
          <>
            <div className="flex items-start gap-2.5">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[hsl(var(--status-success-muted))]">
                <Unlock className="h-3.5 w-3.5 text-[hsl(var(--status-success))]" />
              </div>
              <div className="space-y-1 flex-1">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground">Case notes unlocked</p>
                  {unlockTimeRemaining !== null && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] gap-1 tabular-nums",
                        unlockTimeRemaining < 60_000
                          ? "text-[hsl(var(--status-danger))] border-[hsl(var(--status-danger))]/30"
                          : "text-[hsl(var(--status-warning))] border-[hsl(var(--status-warning))]/30",
                      )}
                    >
                      <Clock className="h-2.5 w-2.5" />
                      {formatTimeRemaining(unlockTimeRemaining)}
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Comparison data is available temporarily. Content will relock automatically.
                </p>
              </div>
            </div>

            {onRelockClick && (
              <Button variant="ghost" size="sm" className="w-full gap-2 text-muted-foreground" onClick={onRelockClick}>
                <Lock className="h-3.5 w-3.5" />
                Relock now
              </Button>
            )}
          </>
        )}

        {/* Error state */}
        {vaultState === "error" && (
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
            <div className="space-y-1">
              <p className="text-sm font-medium text-destructive">Vault error</p>
              <p className="text-xs text-muted-foreground">
                Unable to access encrypted case notes. Try again or contact support.
              </p>
            </div>
          </div>
        )}

        {/* Security footer */}
        <div className="flex items-center gap-1.5 pt-1">
          <ShieldCheck className="h-3 w-3 text-muted-foreground/50" />
          <p className="text-[10px] text-muted-foreground/50">
            AES-256 encrypted · Password-derived key · Auto-relock enabled
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
