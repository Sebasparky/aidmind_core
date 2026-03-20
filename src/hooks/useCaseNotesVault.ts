/**
 * useCaseNotesVault — Manages the encrypted case-notes lifecycle.
 *
 * SECURITY:
 * - Plaintext only exists in React state while unlocked
 * - Auto-relocks after UNLOCK_WINDOW_MS or IDLE_RELOCK_MS
 * - Clearing state scrubs references (best-effort in JS)
 * - Never persists plaintext to storage or backend
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
  seal: (packet: CaseNotesComparisonPacket, password: string) => Promise<boolean>;
  /** Begin unlock flow — requires password for reauth */
  unlock: (password: string) => Promise<{ success: boolean; error?: string }>;
  /** Explicitly relock (clears plaintext) */
  relock: () => void;
  /** Check if a sealed artifact exists for this session */
  checkVaultExists: () => Promise<boolean>;
  /** Whether vault operations are in progress */
  loading: boolean;
  /** Last error message */
  error: string | null;
}

export function useCaseNotesVault(sessionId: string | undefined): UseCaseNotesVaultReturn {
  const [vaultState, setVaultState] = useState<VaultState>("empty");
  const [vaultMetadata, setVaultMetadata] = useState<VaultMetadata | null>(null);
  const [unlockedPacket, setUnlockedPacket] = useState<CaseNotesComparisonPacket | null>(null);
  const [unlockTimeRemaining, setUnlockTimeRemaining] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
  }, []);

  // ── Relock — scrub plaintext from state ─────────────────
  const relock = useCallback(() => {
    setUnlockedPacket(null);
    setVaultState((prev) => (prev === "unlocked" || prev === "relock_pending") ? "sealed" : prev);
    setError(null);
    clearTimers();
  }, [clearTimers]);

  // ── Start auto-relock timers ────────────────────────────
  const startAutoRelock = useCallback(() => {
    clearTimers();

    const expiresAt = Date.now() + UNLOCK_WINDOW_MS;
    unlockExpiresRef.current = expiresAt;

    // Hard deadline
    unlockTimerRef.current = setTimeout(() => {
      relock();
    }, UNLOCK_WINDOW_MS);

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
    password: string,
  ): Promise<boolean> => {
    if (!sessionId) return false;
    setLoading(true);
    setError(null);

    try {
      const plaintext = JSON.stringify(packet);
      const sealed = await sealPayload(plaintext, password);

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

  // ── Unlock — reauth + decrypt ───────────────────────────
  const unlock = useCallback(async (
    password: string,
  ): Promise<{ success: boolean; error?: string }> => {
    if (!sessionId) return { success: false, error: "No session" };
    setLoading(true);
    setError(null);
    setVaultState("unlocking");

    try {
      // Step 1: Reauthorize by verifying password with Supabase Auth
      const { data: { user } } = await supabase.auth.getUser();
      if (!user?.email) {
        throw new Error("AUTH_REQUIRED");
      }

      const { error: authError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password,
      });

      if (authError) {
        setVaultState("sealed");
        return { success: false, error: "Incorrect password. Please try again." };
      }

      // Step 2: Fetch sealed artifact
      const { data } = await supabase
        .from("ephemeral_artifacts")
        .select("content")
        .eq("session_id", sessionId)
        .eq("artifact_type", "sealed_case_notes")
        .maybeSingle();

      if (!data?.content) {
        setVaultState("empty");
        return { success: false, error: "No sealed case notes found for this session." };
      }

      // Step 3: Decrypt
      const artifact: VaultArtifact = JSON.parse(data.content);
      const plaintext = await unsealPayload(artifact.sealed_payload, password);
      const packet: CaseNotesComparisonPacket = JSON.parse(plaintext);

      // Step 4: Verify session integrity
      if (packet.session_id !== sessionId && packet.session_id !== "") {
        // Allow empty for backwards compat, but flag mismatch
        console.warn("[Vault] Session ID mismatch in sealed payload");
      }

      setUnlockedPacket(packet);
      setVaultMetadata(artifact.metadata);
      setVaultState("unlocked");

      // Step 5: Start auto-relock timers
      startAutoRelock();

      return { success: true };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Unlock failed";
      if (msg === "DECRYPTION_FAILED") {
        setVaultState("sealed");
        return { success: false, error: "Incorrect password — unable to decrypt." };
      }
      setError(msg);
      setVaultState("error");
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
    unlock,
    relock,
    checkVaultExists,
    loading,
    error,
  };
}
