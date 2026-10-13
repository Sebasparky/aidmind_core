/**
 * Client Event Contract — what the browser may report to the audit log.
 *
 * Mirrors the allowlists enforced server-side by
 * `public.report_client_event` (supabase/migrations/20261005240000_audit_event_rpcs.sql).
 * The RPC is authoritative; this module exists so the client never sends a
 * payload the server will reject, and so the contract is unit-testable.
 *
 * Client-reported events are stamped `source: "client_reported", verified: false`
 * by the server. They describe lifecycle/tool activity and are NOT
 * authorization evidence. Supervisor/auditor actions go through
 * `record_governance_event` instead.
 */

export const CLIENT_REPORTABLE_EVENT_TYPES = [
  "tool.run.started",
  "tool.run.completed",
  "tool.run.failed",
  "guidance.step.completed",
  "guidance.step.skipped",
  "session.completed",
  "session.closed_early",
  "SESSION_HEARTBEAT",
] as const;

export type ClientReportableEventType = (typeof CLIENT_REPORTABLE_EVENT_TYPES)[number];

export const CLIENT_METADATA_KEYS = [
  "tool_name",
  "result",
  "step",
  "error_code",
  "recovered_from",
  "question_count",
  "file_size_bytes",
  "page_count",
  "text_length",
  "structured_answers_count",
  "review_worthy_count",
  "unanswered_count",
  "human_review_count",
  "review_tier",
  "notes_source",
  "issue_count",
  "high_severity_count",
  "overall_risk",
  "reconciliation_filtered",
] as const;

export type ClientMetadataKey = (typeof CLIENT_METADATA_KEYS)[number];

/** Keys that must never reach the audit log (mirror of the server denylist). */
export const PHI_DENYLIST_KEYS = [
  "text", "transcript", "prompt", "completion", "audio_url", "raw_text",
  "minimized_text", "draft_text", "note_content", "message", "content", "body",
  "response_text", "input_text", "output_text",
] as const;

export const MAX_METADATA_KEYS = 16;
export const MAX_STRING_VALUE_LENGTH = 200;
export const REQUEST_ID_PATTERN = /^[A-Za-z0-9_.:-]{1,128}$/;

export type ClientMetadataValue = string | number | boolean | null;
export type ClientMetadata = Partial<Record<ClientMetadataKey, ClientMetadataValue>>;

const allowedKeySet = new Set<string>(CLIENT_METADATA_KEYS);
const deniedKeySet = new Set<string>(PHI_DENYLIST_KEYS);
const allowedEventSet = new Set<string>(CLIENT_REPORTABLE_EVENT_TYPES);

export function isClientReportableEventType(value: unknown): value is ClientReportableEventType {
  return typeof value === "string" && allowedEventSet.has(value);
}

export function isValidRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

export interface SanitizeResult {
  metadata: ClientMetadata;
  /** Keys that were dropped and why, for console diagnostics only. */
  dropped: Array<{ key: string; reason: "denied" | "not_allowlisted" | "not_primitive" | "too_long" | "overflow" }>;
}

/**
 * Reduce arbitrary metadata to the server contract:
 *   - denylisted keys dropped first (never forwarded, even if allowlisted elsewhere)
 *   - only allowlisted keys kept
 *   - primitives only (string/number/boolean/null); objects/arrays/undefined dropped
 *   - strings truncated to MAX_STRING_VALUE_LENGTH
 *   - at most MAX_METADATA_KEYS keys
 */
export function sanitizeClientEventMetadata(input: unknown): SanitizeResult {
  const dropped: SanitizeResult["dropped"] = [];
  const metadata: ClientMetadata = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) return { metadata, dropped };

  let kept = 0;
  for (const [key, raw] of Object.entries(input as Record<string, unknown>)) {
    if (deniedKeySet.has(key.toLowerCase())) { dropped.push({ key, reason: "denied" }); continue; }
    if (!allowedKeySet.has(key)) { dropped.push({ key, reason: "not_allowlisted" }); continue; }
    if (raw !== null && typeof raw !== "string" && typeof raw !== "number" && typeof raw !== "boolean") {
      dropped.push({ key, reason: "not_primitive" }); continue;
    }
    if (typeof raw === "number" && !Number.isFinite(raw)) { dropped.push({ key, reason: "not_primitive" }); continue; }
    if (kept >= MAX_METADATA_KEYS) { dropped.push({ key, reason: "overflow" }); continue; }
    let value: ClientMetadataValue = raw as ClientMetadataValue;
    if (typeof value === "string" && value.length > MAX_STRING_VALUE_LENGTH) {
      value = value.slice(0, MAX_STRING_VALUE_LENGTH);
      dropped.push({ key, reason: "too_long" });
    }
    metadata[key as ClientMetadataKey] = value;
    kept++;
  }
  return { metadata, dropped };
}

/** True when an audit row was written by a server-verified path. */
export function isServerVerifiedEvent(eventData: unknown): boolean {
  if (!eventData || typeof eventData !== "object") return false;
  const d = eventData as Record<string, unknown>;
  return d.source === "server_observed" && d.verified === true;
}
