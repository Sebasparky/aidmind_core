/**
 * Vault types for encrypted case-note storage.
 *
 * These types describe the shape of data that flows through
 * the seal/unseal lifecycle, NOT what is stored in plaintext.
 */

import type { SealedPayload } from "./crypto";

/** The sensitive payload that gets encrypted before storage */
export interface CaseNotesComparisonPacket {
  /** Extracted field answers from case notes */
  answers: Array<{
    field_key: string;
    label: string;
    answer: string | null;
    confidence: "high" | "medium" | "low";
    supporting_excerpt: string | null;
  }>;
  /** When extraction was performed */
  generated_at: string;
  /** Model used for extraction */
  model: string;
  /** Session UUID for integrity check */
  session_id: string;
  /** Template ID for integrity check */
  template_id: string | null;
}

/** Vault states the UI can be in */
export type VaultState =
  | "empty"         // No sealed artifact exists
  | "sealed"        // Encrypted artifact exists, locked
  | "unlocking"     // Reauth in progress
  | "unlocked"      // Plaintext available (time-limited)
  | "relock_pending" // About to relock
  | "error";        // Unlock failed

/** Metadata stored alongside the sealed payload (never sensitive) */
export interface VaultMetadata {
  sealed_at: string;
  session_id: string;
  template_id: string | null;
  field_count: number;
  answered_count: number;
}

/** The full vault artifact stored in ephemeral_artifacts */
export interface VaultArtifact {
  sealed_payload: SealedPayload;
  metadata: VaultMetadata;
}

/** Duration in ms that unlocked content remains available */
export const UNLOCK_WINDOW_MS = 5 * 60 * 1000; // 5 minutes

/** Idle timeout before auto-relock (ms) */
export const IDLE_RELOCK_MS = 2 * 60 * 1000; // 2 minutes
