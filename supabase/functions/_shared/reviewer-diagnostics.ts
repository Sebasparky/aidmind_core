/**
 * Reviewer Pipeline Diagnostics — stage-by-stage snapshot hashing
 * 
 * Produces compact, content-free fingerprints at each pipeline stage
 * to identify exactly where run-to-run divergence occurs.
 * 
 * SECURITY: No text content is stored. Only hashes, counts, and metadata.
 */

// Simple hash for Deno runtime (no crypto import needed for non-security use)
async function sha256Short(input: string): Promise<string> {
  const encoded = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest("SHA-256", encoded);
  const bytes = new Uint8Array(hash);
  return Array.from(bytes.slice(0, 8))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

export interface ReviewerStageSnapshot {
  stage: string;
  hash: string;
  counts?: Record<string, number>;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface ReviewerRunDiagnostics {
  run_id: string;
  pipeline_version: string;
  timestamps: Record<string, number>;
  stages: ReviewerStageSnapshot[];
  input_fingerprint: {
    document_text_length: number;
    document_text_hash: string;
    review_worthy_count: number;
    review_worthy_field_keys: string[];
    structured_answer_count: number;
    unanswered_field_count: number;
    unanswered_field_keys: string[];
    has_reconciliation: boolean;
    reconciliation_match_count: number | null;
    reconciliation_discrepancy_count: number | null;
    has_trigger_metadata: boolean;
    trigger_categories: string[];
    template_id: string | null;
    session_id: string;
  };
  llm_config: {
    provider: string;
    model: string;
    temperature: number;
    uses_json_mode: boolean;
    gateway: boolean;
  };
  output_fingerprint: {
    raw_candidate_count: number;
    prefiltered_count: number;
    dce_input_count: number;
    dce_output_count: number;
    final_primary_count: number;
    final_secondary_count: number;
    final_risk: string;
    final_confidence: string;
    final_coverage: string;
    final_issues_hash: string;
  };
}

export async function hashDocumentText(text: string): Promise<string> {
  // Normalize whitespace for stable hashing
  const normalized = text.replace(/\s+/g, " ").trim();
  return sha256Short(normalized);
}

export async function hashReviewPacket(userMessage: string): Promise<string> {
  return sha256Short(userMessage);
}

export async function hashIssuesArray(issues: unknown[]): Promise<string> {
  // Deterministic serialization: sort by type+excerpt for stability
  const sorted = [...issues].map((i: any) => ({
    t: i.type,
    s: i.severity,
    e: (i.excerpt || "").slice(0, 50),
    f: i.field_key || "",
  }));
  sorted.sort((a, b) => {
    const tc = a.t.localeCompare(b.t);
    if (tc !== 0) return tc;
    return a.e.localeCompare(b.e);
  });
  return sha256Short(JSON.stringify(sorted));
}

export async function hashCandidates(candidates: unknown[]): Promise<string> {
  const sorted = [...candidates].map((c: any) => ({
    t: c.type,
    e: (c.excerpt || "").slice(0, 50),
  }));
  sorted.sort((a, b) => a.t.localeCompare(b.t) || a.e.localeCompare(b.e));
  return sha256Short(JSON.stringify(sorted));
}

export function createRunId(): string {
  return crypto.randomUUID().slice(0, 8);
}
