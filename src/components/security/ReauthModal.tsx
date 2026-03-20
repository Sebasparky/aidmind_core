/**
 * ReauthModal — Password re-entry for vault unlock.
 *
 * SECURITY:
 * - Password is never stored — used only for PBKDF2 derivation
 * - Cleared from state immediately after use
 * - Auto-focuses password input for quick entry
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { Loader2, Lock, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface ReauthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAuthenticate: (password: string) => Promise<{ success: boolean; error?: string }>;
  /** Unlock window duration in human-readable form */
  unlockDuration?: string;
}

export function ReauthModal({
  open,
  onOpenChange,
  onAuthenticate,
  unlockDuration = "5 minutes",
}: ReauthModalProps) {
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-focus on open
  useEffect(() => {
    if (open) {
      setPassword("");
      setErrorMsg(null);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim() || submitting) return;

    setSubmitting(true);
    setErrorMsg(null);

    try {
      const result = await onAuthenticate(password);
      // SECURITY: Clear password from state immediately
      setPassword("");

      if (result.success) {
        onOpenChange(false);
      } else {
        setErrorMsg(result.error || "Authentication failed.");
      }
    } catch {
      setErrorMsg("An unexpected error occurred.");
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  }, [password, submitting, onAuthenticate, onOpenChange]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md rounded-2xl">
        <form onSubmit={handleSubmit}>
          <AlertDialogHeader className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                <Lock className="h-4 w-4 text-muted-foreground" />
              </div>
              <AlertDialogTitle className="text-base">
                Verify your identity
              </AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-sm text-muted-foreground space-y-2">
              <span className="block">
                Case-note content is encrypted and requires re-authentication to access.
                Enter your password to unlock temporarily.
              </span>
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
                <ShieldCheck className="h-3 w-3" />
                Content will remain available for {unlockDuration}, then automatically relock.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="py-4 space-y-3">
            <div>
              <Input
                ref={inputRef}
                type="password"
                placeholder="Enter your password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setErrorMsg(null); }}
                autoComplete="current-password"
                disabled={submitting}
                className="h-10"
              />
            </div>

            {errorMsg && (
              <p className="text-xs text-destructive font-medium">{errorMsg}</p>
            )}
          </div>

          <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={() => { setPassword(""); onOpenChange(false); }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!password.trim() || submitting}
              className="gap-2"
            >
              {submitting ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Verifying…</>
              ) : (
                <><Lock className="h-4 w-4" /> Unlock case notes</>
              )}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
