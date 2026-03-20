/**
 * useCaseNotesVault — Manages the encrypted case-notes lifecycle.
 *
 * SECURITY:
 * - Plaintext only exists in React state while unlocked
 * - Auto-relocks after UNLOCK_WINDOW_MS (hard deadline) or IDLE_RELOCK_MS (inactivity)
 * - Clearing state scrubs references (best-effort in JS)
 * - Never persists plaintext to storage or backend
 *
 * ARCHITECTURE:
 * - Seal uses a user-chosen vault password (separate from account password)
 * - Unlock is a two-step process:
 *   1. Reauth: verify account identity via Supabase signInWithPassword
 *   2. Decrypt: use the vault password to AES-256-GCM decrypt the payload
 * - The server never holds either password or the derived key
 * - user_id is stored alongside ciphertext for RLS scoping
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { sealPayload, unsealPayload } from "@/lib/security/crypto";
import type {
  VaultState,
  VaultArtifact,
  VaultMetadata,
  CaseNotesComparisonPacket,
} from "@/lib/security/vault-types";
import { UNLOCK_WINDOW_MS, IDLE_RELOCK_MS } from "@/lib/security/vault-types";

export type RelockReason = "idle_timeout" | "hard_timeout" | "manual" | "unmount" | null;

interface UseCaseNotesVaultReturn {
  /** Current vault state */
  vaultState: VaultState;
  /** Vault metadata (non-sensitive, always readable) */
  vaultMetadata: VaultMetadata | null;
  /** Unlocked plaintext packet (only available in 'unlocked' state) */
  unlockedPacket: CaseNotesComparisonPacket | null;
  /** Time remaining on unlock window (ms) */
  unlockTimeRemaining: number | null;
  /** Seal case notes into encrypted storage */
  seal: (packet: CaseNotesComparisonPacket, vaultPassword: string) => Promise<boolean>;
  /** Step 1 of unlock: verify account identity */
  reauthenticate: (accountPassword: string) => Promise<{ success: boolean; error?: string }>;
  /** Step 2 of unlock: decrypt with vault password */
  decrypt: (vaultPassword: string) => Promise<{ success: boolean; error?: string }>;
  /** Explicitly relock (clears plaintext) */
  relock: (reason?: RelockReason) => void;
  /** Reset idle timer — call on meaningful user activity while unlocked */
  resetIdleTimer: () => void;
  /** Check if a sealed artifact exists for this session */
  checkVaultExists: () => Promise<boolean>;
  /** Whether vault operations are in progress */
  loading: boolean;
  /** Last error message */
  error: string | null;
  /** Why the vault was last relocked (diagnostic) */
  lastRelockReason: RelockReason;
  /** Whether idle timer is currently active (diagnostic) */
  idleTimerActive: boolean;
}

export function useCaseNotesVault(sessionId: string | undefined): UseCaseNotesVaultReturn {
  const [vaultState, setVaultState] = useState<VaultState>("empty");
  const [vaultMetadata, setVaultMetadata] = useState<VaultMetadata | null>(null);
  const [unlockedPacket, setUnlockedPacket] = useState<CaseNotesComparisonPacket | null>(null);
  const [unlockTimeRemaining, setUnlockTimeRemaining] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRelockReason, setLastRelockReason] = useState<RelockReason>(null);
  const [idleTimerActive, setIdleTimerActive] = useState(false);

  // Track whether reauth has been completed (for two-step unlock)
  const reauthCompleteRef = useRef(false);

  // Timers for auto-relock
  const unlockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const unlockExpiresRef = useRef<number | null>(null);

  // ── Cleanup timers ──────────────────────────────────────
  const clearTimers = useCallback(() => {
    if (unlockTimerRef.current) { clearTimeout(unlockTimerRef.current); unlockTimerRef.current = null; }
    if (idleTimerRef.current) { clearTimeout(idleTimerRef.current); idleTimerRef.current = null; }
    if (countdownRef.current) { clearInterval(countdownRef.current); countdownRef.current = null; }
    unlockExpiresRef.current = null;
    setUnlockTimeRemaining(null);
    setIdleTimerActive(false);
  }, []);

  // ── Relock — scrub plaintext from state ─────────────────
  const relock = useCallback((reason: RelockReason = "manual") => {
    if (import.meta.env.DEV) {
      console.info(`[Vault] Relock triggered: reason=${reason}`);
    }
    setLastRelockReason(reason);
    setUnlockedPacket(null);
    reauthCompleteRef.current = false;
    setVaultState((prev) => (prev === "unlocked" || prev === "relock_pending") ? "sealed" : prev);
    setError(null);
    clearTimers();
  }, [clearTimers]);

  // ── Reset idle timer (call on user activity) ────────────
  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
    }
    // Only set idle timer if we're currently unlocked
    if (unlockExpiresRef.current !== null) {
      idleTimerRef.current = setTimeout(() => {
        relock("idle_timeout");
      }, IDLE_RELOCK_MS);
      setIdleTimerActive(true);
    }
  }, [relock]);

  // ── Start auto-relock timers ────────────────────────────
  const startAutoRelock = useCallback(() => {
    clearTimers();

    const expiresAt = Date.now() + UNLOCK_WINDOW_MS;
    unlockExpiresRef.current = expiresAt;

    // Hard deadline
    unlockTimerRef.current = setTimeout(() => {
      relock();
    }, UNLOCK_WINDOW_MS);

    // Idle timer — relocks after IDLE_RELOCK_MS of no activity
    idleTimerRef.current = setTimeout(() => {
      relock();
    }, IDLE_RELOCK_MS);

    // Countdown display
    countdownRef.current = setInterval(() => {
      const remaining = (unlockExpiresRef.current ?? 0) - Date.now();
      if (remaining <= 0) {
        setUnlockTimeRemaining(0);
        relock();
      } else {
        setUnlockTimeRemaining(remaining);
      }
    }, 1000);

    setUnlockTimeRemaining(UNLOCK_WINDOW_MS);
  }, [clearTimers, relock]);

  // ── Cleanup on unmount — always relock ──────────────────
  useEffect(() => {
    return () => {
      clearTimers();
      // SECURITY: Ensure plaintext is not retained after unmount
      setUnlockedPacket(null);
      reauthCompleteRef.current = false;
    };
  }, [clearTimers]);

  // ── Check if vault artifact exists ──────────────────────
  const checkVaultExists = useCallback(async (): Promise<boolean> => {
    if (!sessionId) return false;
    try {
      const { data } = await supabase
        .from("ephemeral_artifacts")
        .select("id, content")
        .eq("session_id", sessionId)
        .eq("artifact_type", "sealed_case_notes")
        .maybeSingle();

      if (data?.content) {
        try {
          const artifact: VaultArtifact = JSON.parse(data.content);
          setVaultMetadata(artifact.metadata);
          setVaultState("sealed");
          return true;
        } catch {
          setVaultState("empty");
          return false;
        }
      }
      setVaultState("empty");
      return false;
    } catch {
      return false;
    }
  }, [sessionId]);

  // ── Seal — encrypt and store ────────────────────────────
  const seal = useCallback(async (
    packet: CaseNotesComparisonPacket,
    vaultPassword: string,
  ): Promise<boolean> => {
    if (!sessionId) return false;
    setLoading(true);
    setError(null);

    try {
      // Get current user for RLS scoping
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      const plaintext = JSON.stringify(packet);
      const sealed = await sealPayload(plaintext, vaultPassword);

      const metadata: VaultMetadata = {
        sealed_at: sealed.sealed_at,
        session_id: packet.session_id,
        template_id: packet.template_id,
        field_count: packet.answers.length,
        answered_count: packet.answers.filter(a => a.answer !== null).length,
      };

      const artifact: VaultArtifact = {
        sealed_payload: sealed,
        metadata,
      };

      // Upsert: delete old + insert new
      await supabase
        .from("ephemeral_artifacts")
        .delete()
        .eq("session_id", sessionId)
        .eq("artifact_type", "sealed_case_notes");

      const { error: insertError } = await supabase
        .from("ephemeral_artifacts")
        .insert({
          session_id: sessionId,
          artifact_type: "sealed_case_notes",
          content: JSON.stringify(artifact),
          ttl_expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          user_id: user.id,
        });

      if (insertError) throw insertError;

      setVaultMetadata(metadata);
      setVaultState("sealed");
      return true;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Seal operation failed";
      setError(msg);
      console.error("[Vault] Seal failed:", msg);
      return false;
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  // ── Step 1: Reauthenticate — verify account identity ────
  const reauthenticate = useCallback(async (
    accountPassword: string,
  ): Promise<{ success: boolean; error?: string }> => {
    if (!sessionId) return { success: false, error: "No session" };
    setLoading(true);
    setError(null);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) {
        return { success: false, error: "Not authenticated. Please log in again." };
      }

      /**
       * REAUTH METHOD: Supabase signInWithPassword
       *
       * This is compatible with the current email/password auth model.
       * If the project migrates to OAuth or magic-link-only auth,
       * this step would need to use a different verification method
       * (e.g., supabase.auth.reauthenticate() or a server-side
       * verification endpoint).
       */
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: accountPassword,
      });

      if (authError) {
        return { success: false, error: "Incorrect account password." };
      }

      reauthCompleteRef.current = true;
      setVaultState("unlocking");
      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Reauth failed";
      return { success: false, error: msg };
    } finally {
      setLoading(false);
    }
  }, [sessionId]);

  // ── Step 2: Decrypt — use vault password to unseal ──────
  const decrypt = useCallback(async (
    vaultPassword: string,
  ): Promise<{ success: boolean; error?: string }> => {
    if (!sessionId) return { success: false, error: "No session" };
    if (!reauthCompleteRef.current) {
      return { success: false, error: "Identity verification required first." };
    }

    setLoading(true);
    setError(null);

    try {
      // Fetch sealed artifact (RLS ensures only owner can read)
      const { data } = await supabase
        .from("ephemeral_artifacts")
        .select("content")
        .eq("session_id", sessionId)
        .eq("artifact_type", "sealed_case_notes")
        .maybeSingle();

      if (!data?.content) {
        setVaultState("empty");
        reauthCompleteRef.current = false;
        return { success: false, error: "No sealed case notes found for this session." };
      }

      // Decrypt with vault password
      const artifact: VaultArtifact = JSON.parse(data.content);
      let plaintext: string;
      try {
        plaintext = await unsealPayload(artifact.sealed_payload, vaultPassword);
      } catch {
        // Wrong vault password — reauth remains valid, user can retry
        return { success: false, error: "Incorrect vault password — unable to decrypt." };
      }

      const packet: CaseNotesComparisonPacket = JSON.parse(plaintext);

      // Verify session integrity (log only mismatch fact, no content)
      if (packet.session_id !== sessionId && packet.session_id !== "") {
        console.warn("[Vault] Session ID mismatch in sealed payload");
      }

      setUnlockedPacket(packet);
      setVaultMetadata(artifact.metadata);
      setVaultState("unlocked");
      reauthCompleteRef.current = false; // Consume the reauth

      // Start auto-relock timers (hard deadline + idle)
      startAutoRelock();

      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Decrypt failed";
      setError(msg);
      setVaultState("sealed");
      reauthCompleteRef.current = false;
      return { success: false, error: msg };
    } finally {
      setLoading(false);
    }
  }, [sessionId, startAutoRelock]);

  return {
    vaultState,
    vaultMetadata,
    unlockedPacket,
    unlockTimeRemaining,
    seal,
    reauthenticate,
    decrypt,
    relock,
    resetIdleTimer,
    checkVaultExists,
    loading,
    error,
  };
}
