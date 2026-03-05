/**
 * Typed interfaces for the Run Reviewer tool.
 * Extracted from: supabase/functions/run-reviewer/index.ts
 *
 * Request: { session_id: string (UUID), text: string (max 20000 chars) }
 * Response: { tone_flags[], bias_flags[], policy_language_flags[], completeness_flags[] }
 * Each flag: { severity: 'low'|'med'|'high', message: string, snippet: string (≤20 words) }
 * Error: { error: { code: string, message: string } }
 */

export const MAX_REVIEWER_TEXT_LENGTH = 20000;

export interface ReviewerRequest {
  session_id: string; // UUID
  text: string;       // max 20000 chars
}

export type FlagSeverity = "low" | "med" | "high";

export interface CategorizedFlag {
  severity: FlagSeverity;
  message: string;
  snippet: string; // ≤20 word excerpt from the document
}

export type FlagCategory = "tone_flags" | "bias_flags" | "policy_language_flags" | "completeness_flags";

export const FLAG_CATEGORY_META: Record<FlagCategory, { label: string; description: string }> = {
  tone_flags: {
    label: "Tone & Clarity",
    description: "Issues with professional tone, inappropriate language, or emotional content",
  },
  bias_flags: {
    label: "Bias & Assumptions",
    description: "Potential bias, assumptions, or subjective judgments without evidence",
  },
  policy_language_flags: {
    label: "Policy Language",
    description: "Language that conflicts with policy requirements or uses prohibited terms",
  },
  completeness_flags: {
    label: "Completeness",
    description: "Missing required information, gaps, or incomplete sections",
  },
};

export const FLAG_CATEGORIES: FlagCategory[] = [
  "tone_flags",
  "bias_flags",
  "policy_language_flags",
  "completeness_flags",
];

export interface ReviewerOutput {
  tone_flags: CategorizedFlag[];
  bias_flags: CategorizedFlag[];
  policy_language_flags: CategorizedFlag[];
  completeness_flags: CategorizedFlag[];
}

export interface ReviewerErrorResponse {
  error: {
    code: string;
    message: string;
  };
}

// ── Mock Data ──────────────────────────────────────────────────────────────

export const MOCK_REVIEWER_OUTPUT: ReviewerOutput = {
  tone_flags: [
    {
      severity: "med",
      message: "Language in this section may come across as judgmental rather than objective. Consider using neutral phrasing.",
      snippet: "the client failed to comply with the requirements",
    },
    {
      severity: "low",
      message: "This phrasing could be perceived as informal for an official record.",
      snippet: "things got complicated for the family",
    },
  ],
  bias_flags: [
    {
      severity: "high",
      message: "This statement implies a conclusion about the client's intent without citing evidence or the client's own account.",
      snippet: "the client clearly did not want to cooperate",
    },
  ],
  policy_language_flags: [
    {
      severity: "med",
      message: "Policy requires using the term 'participant' rather than 'client' in program-specific documentation.",
      snippet: "the client was enrolled in the program",
    },
    {
      severity: "low",
      message: "Consider referencing the specific statute or regulation number when citing eligibility criteria.",
      snippet: "per eligibility guidelines the applicant qualifies",
    },
  ],
  completeness_flags: [
    {
      severity: "high",
      message: "The assessment section is missing required supervisor review date per template schema.",
      snippet: "",
    },
    {
      severity: "med",
      message: "No referral source is documented. Template requires this field to be populated.",
      snippet: "",
    },
    {
      severity: "low",
      message: "Consider documenting the client's preferred contact method for follow-up communication.",
      snippet: "",
    },
  ],
};

export const MOCK_REVIEWER_ERROR: ReviewerErrorResponse = {
  error: {
    code: "TEXT_TOO_LONG",
    message: `text cannot exceed ${MAX_REVIEWER_TEXT_LENGTH} characters`,
  },
};
