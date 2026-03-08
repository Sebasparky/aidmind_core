/**
 * Typed interfaces for the Generate Guidance Phase 1 tool.
 * Extracted from: supabase/functions/generate-guidance-phase1/index.ts
 *
 * Request: { session_id: string }
 * Response: { success: true } — guidance saved to session metadata
 * Actual output shape (stored in sessions.metadata.guidance_phase1):
 *   { generated_at, model, questions[] }
 *
 * Each question: { category, question, citations[] }
 * Categories (exactly 2 each):
 *   Timeline, Individuals & Relationships, Event / Situation Details,
 *   Risk / Needs / Safety Factors, Agency / Service Involvement,
 *   Documentation / Evidence / Records
 */

export interface GuidanceRequest {
  session_id: string; // UUID
}

export interface GuidanceResponse {
  success: true;
}

export type GuidanceCategory =
  | "Timeline"
  | "Individuals & Relationships"
  | "Event / Situation Details"
  | "Risk / Needs / Safety Factors"
  | "Agency / Service Involvement"
  | "Documentation / Evidence / Records";

export const GUIDANCE_CATEGORIES: GuidanceCategory[] = [
  "Timeline",
  "Individuals & Relationships",
  "Event / Situation Details",
  "Risk / Needs / Safety Factors",
  "Agency / Service Involvement",
  "Documentation / Evidence / Records",
];

export interface GuidanceQuestion {
  category: GuidanceCategory;
  question: string;
  citations: string[]; // snippet_id references
  validation_status?: "pass" | "warning";
  review_flags?: string[];
}

export interface GuidanceOutput {
  generated_at: string; // ISO timestamp
  model: string;
  questions: GuidanceQuestion[];
  grounding_status?: "sufficient" | "insufficient";
  grounding_reason?: string;
  total_generated?: number;
  total_grounded?: number;
  total_grounded_strong?: number;
  total_grounded_warning?: number;
  total_dropped?: number;
}

export interface GuidanceErrorResponse {
  error: string;
  name?: string;
  stack?: string;
}

// ── Mock Data ──────────────────────────────────────────────────────────────

export const MOCK_GUIDANCE_OUTPUT: GuidanceOutput = {
  generated_at: new Date().toISOString(),
  model: "gpt-4o",
  questions: [
    // Timeline (2)
    {
      category: "Timeline",
      question: "When did the client first become aware of the issue, and what date did they contact your agency?",
      citations: ["snip-001"],
    },
    {
      category: "Timeline",
      question: "What specific dates were any previous services or interventions provided to the client?",
      citations: ["snip-002"],
    },
    // Individuals & Relationships (2)
    {
      category: "Individuals & Relationships",
      question: "Who are the other individuals currently living in the client's household, and what is each person's relationship to the client?",
      citations: ["snip-003"],
    },
    {
      category: "Individuals & Relationships",
      question: "Are there any additional family members, guardians, or support persons involved in the client's situation?",
      citations: ["snip-003", "snip-004"],
    },
    // Event / Situation Details (2)
    {
      category: "Event / Situation Details",
      question: "Can the client describe the specific event or change in circumstances that led to this referral?",
      citations: ["snip-005"],
    },
    {
      category: "Event / Situation Details",
      question: "What is the client's current living arrangement, including address, lease status, and any pending changes?",
      citations: ["snip-006"],
    },
    // Risk / Needs / Safety Factors (2)
    {
      category: "Risk / Needs / Safety Factors",
      question: "Does the client have any immediate safety concerns, including access to safe housing, food, or medical care?",
      citations: ["snip-007"],
    },
    {
      category: "Risk / Needs / Safety Factors",
      question: "Has the client or any household member experienced threats, violence, or substance-related concerns in the past 12 months?",
      citations: ["snip-007", "snip-008"],
    },
    // Agency / Service Involvement (2)
    {
      category: "Agency / Service Involvement",
      question: "Which agencies, programs, or community organizations has the client previously engaged with for assistance?",
      citations: ["snip-009"],
    },
    {
      category: "Agency / Service Involvement",
      question: "Is there an active case or pending application with any other government agency for the client?",
      citations: ["snip-010"],
    },
    // Documentation / Evidence / Records (2)
    {
      category: "Documentation / Evidence / Records",
      question: "What identification documents, proof of income, or residency verification does the client currently have available?",
      citations: ["snip-011"],
    },
    {
      category: "Documentation / Evidence / Records",
      question: "Are there any court orders, medical records, or prior assessments that the client can provide to support the application?",
      citations: ["snip-011", "snip-012"],
    },
  ],
};
