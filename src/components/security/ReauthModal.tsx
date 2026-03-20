/**
 * ReauthModal — Two-step vault unlock: account reauth → vault password.
 *
 * SECURITY:
 * - Step 1: Account password verifies identity via Supabase signInWithPassword
 * - Step 2: Vault password decrypts the sealed artifact via PBKDF2 → AES-256-GCM
 * - Both passwords cleared from state immediately after use
 * - These are intentionally separate passwords for defense-in-depth
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { Loader2, Lock, ShieldCheck, KeyRound, Unlock } from "lucide-react";
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
  /** Step 1: verify account password via Supabase Auth */
  onReauthenticate: (accountPassword: string) => Promise<{ success: boolean; error?: string }>;
  /** Step 2: decrypt vault with vault-specific password */
  onDecrypt: (vaultPassword: string) => Promise<{ success: boolean; error?: string }>;
  /** Unlock window duration in human-readable form */
  unlockDuration?: string;
}

export function ReauthModal({
  open,
  onOpenChange,
  onReauthenticate,
  onDecrypt,
  unlockDuration = "5 minutes",
}: ReauthModalProps) {
  const [step, setStep] = useState<"reauth" | "decrypt">("reauth");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset on open
  useEffect(() => {
    if (open) {
      setStep("reauth");
      setPassword("");
      setErrorMsg(null);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [open]);

  // Focus input when step changes
  useEffect(() => {
    if (open) {
      setPassword("");
      setErrorMsg(null);
      setTimeout(() => inputRef.current?.focus(), 100);
    }
  }, [step, open]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim() || submitting) return;

    setSubmitting(true);
    setErrorMsg(null);

    try {
      if (step === "reauth") {
        const result = await onReauthenticate(password);
        setPassword(""); // Clear account password immediately
        if (result.success) {
          setStep("decrypt");
        } else {
          setErrorMsg(result.error || "Authentication failed.");
        }
      } else {
        const result = await onDecrypt(password);
        setPassword(""); // Clear vault password immediately
        if (result.success) {
          onOpenChange(false);
        } else {
          setErrorMsg(result.error || "Decryption failed.");
        }
      }
    } catch {
      setErrorMsg("An unexpected error occurred.");
      setPassword("");
    } finally {
      setSubmitting(false);
    }
  }, [password, submitting, step, onReauthenticate, onDecrypt, onOpenChange]);

  const handleCancel = useCallback(() => {
    setPassword("");
    setStep("reauth");
    onOpenChange(false);
  }, [onOpenChange]);

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md rounded-2xl">
        <form onSubmit={handleSubmit}>
          <AlertDialogHeader className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                {step === "reauth" ? (
                  <Lock className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <KeyRound className="h-4 w-4 text-muted-foreground" />
                )}
              </div>
              <div>
                <AlertDialogTitle className="text-base">
                  {step === "reauth" ? "Verify your identity" : "Enter vault password"}
                </AlertDialogTitle>
                {/* Step indicator */}
                <div className="flex items-center gap-1.5 mt-1">
                  <div className={`h-1 w-8 rounded-full ${step === "reauth" ? "bg-primary" : "bg-primary/30"}`} />
                  <div className={`h-1 w-8 rounded-full ${step === "decrypt" ? "bg-primary" : "bg-muted"}`} />
                  <span className="text-[10px] text-muted-foreground ml-1">
                    Step {step === "reauth" ? "1" : "2"} of 2
                  </span>
                </div>
              </div>
            </div>
            <AlertDialogDescription className="text-sm text-muted-foreground space-y-2">
              {step === "reauth" ? (
                <>
                  <span className="block">
                    Accessing encrypted case notes requires identity verification.
                    Enter your account password to proceed.
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
                    <ShieldCheck className="h-3 w-3" />
                    Your account password is used for identity verification only.
                  </span>
                </>
              ) : (
                <>
                  <span className="block">
                    Identity verified. Now enter the vault password you chose
                    when you sealed these case notes.
                  </span>
                  <span className="flex items-center gap-1.5 text-xs text-muted-foreground/70">
                    <Unlock className="h-3 w-3" />
                    Content will remain available for {unlockDuration}, then automatically relock.
                  </span>
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className="py-4 space-y-3">
            <div>
              <label className="text-xs font-medium text-foreground block mb-1">
                {step === "reauth" ? "Account password" : "Vault password"}
              </label>
              <Input
                ref={inputRef}
                type="password"
                placeholder={step === "reauth" ? "Enter your account password" : "Enter vault password"}
                value={password}
                onChange={(e) => { setPassword(e.target.value); setErrorMsg(null); }}
                autoComplete={step === "reauth" ? "current-password" : "off"}
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
              onClick={handleCancel}
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
                <><Loader2 className="h-4 w-4 animate-spin" /> {step === "reauth" ? "Verifying…" : "Decrypting…"}</>
              ) : step === "reauth" ? (
                <><Lock className="h-4 w-4" /> Verify identity</>
              ) : (
                <><Unlock className="h-4 w-4" /> Unlock case notes</>
              )}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
