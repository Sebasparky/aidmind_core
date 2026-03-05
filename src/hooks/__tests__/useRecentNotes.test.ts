import { describe, it, expect } from "vitest";
import { generateTitle, mapStateToStatus, humanizeInteractionType } from "../useRecentNotes";
import type { Tables } from "@/integrations/supabase/types";

type SessionRow = Tables<"sessions">;

// Helper to create a mock session row
function createMockSession(overrides: Partial<SessionRow> = {}): SessionRow {
  return {
    id: "test-id",
    session_id: "test-session-id",
    case_id: "test-case-id",
    case_label: null,
    client_label: null,
    interaction_type: null,
    interview_notes: null,
    review_document_id: null,
    metadata: {},
    policy_pack_id: null,
    status: "initialized",
    template_id: null,
    tenant_id: null,
    user_id: null,
    state: "DRAFT_READY",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ttl_expires_at: new Date(Date.now() + 3600000).toISOString(),
    cancelled_at: null,
    closed_at: null,
    guidance_scope: null,
    guidance_scope_other: null,
    guidance_scope_set_at: null,
    guidance_scope_set_by: null,
    ...overrides,
  };
}

describe("generateTitle", () => {
  it("uses case_label when present and non-empty", () => {
    const session = createMockSession({ case_label: "Housing Intake Case" });
    expect(generateTitle(session)).toBe("Housing Intake Case");
  });

  it("trims whitespace from case_label", () => {
    const session = createMockSession({ case_label: "  Trimmed Title  " });
    expect(generateTitle(session)).toBe("Trimmed Title");
  });

  it("uses humanized interaction_type when case_label is null", () => {
    const session = createMockSession({ 
      case_label: null, 
      interaction_type: "phone_call" 
    });
    expect(generateTitle(session)).toBe("Phone call note");
  });

  it("uses humanized interaction_type when case_label is empty string", () => {
    const session = createMockSession({ 
      case_label: "", 
      interaction_type: "visit" 
    });
    expect(generateTitle(session)).toBe("Visit note");
  });

  it("uses humanized interaction_type when case_label is whitespace-only", () => {
    const session = createMockSession({ 
      case_label: "   ", 
      interaction_type: "meeting" 
    });
    expect(generateTitle(session)).toBe("Meeting note");
  });

  it("falls back to 'Untitled session' when no case_label or interaction_type", () => {
    const session = createMockSession({ 
      case_label: null, 
      interaction_type: null 
    });
    expect(generateTitle(session)).toBe("Untitled session");
  });

  it("falls back to 'Untitled session' when both are empty strings", () => {
    const session = createMockSession({ 
      case_label: "", 
      interaction_type: "" 
    });
    expect(generateTitle(session)).toBe("Untitled session");
  });

  it("NEVER returns 'Housing Assistance' as a hardcoded default", () => {
    // Test various edge cases to ensure no hardcoded defaults
    const testCases = [
      createMockSession({}),
      createMockSession({ case_label: null }),
      createMockSession({ case_label: "" }),
      createMockSession({ case_label: "   " }),
      createMockSession({ interaction_type: null }),
      createMockSession({ interaction_type: "" }),
    ];

    for (const session of testCases) {
      const title = generateTitle(session);
      expect(title).not.toBe("Housing Assistance");
      expect(title.toLowerCase()).not.toContain("housing assistance");
    }
  });
});

describe("mapStateToStatus", () => {
  it("returns 'cancelled' when cancelled_at is set", () => {
    const session = createMockSession({ 
      cancelled_at: new Date().toISOString(),
      state: "DRAFT_READY" // State should be ignored
    });
    expect(mapStateToStatus(session)).toBe("cancelled");
  });

  it("returns 'closed_early' when closed_at is set", () => {
    const session = createMockSession({ 
      closed_at: new Date().toISOString(),
      state: "DRAFT_READY" // State should be ignored
    });
    expect(mapStateToStatus(session)).toBe("closed_early");
  });

  it("prioritizes cancelled_at over closed_at", () => {
    const session = createMockSession({ 
      cancelled_at: new Date().toISOString(),
      closed_at: new Date().toISOString(),
    });
    expect(mapStateToStatus(session)).toBe("cancelled");
  });

  it("returns 'completed' for state EXPORTED", () => {
    const session = createMockSession({ state: "EXPORTED" });
    expect(mapStateToStatus(session)).toBe("completed");
  });

  it("returns 'completed' for state PURGED", () => {
    const session = createMockSession({ state: "PURGED" });
    expect(mapStateToStatus(session)).toBe("completed");
  });

  it("returns 'cancelled' for state CANCELLED", () => {
    const session = createMockSession({ state: "CANCELLED" });
    expect(mapStateToStatus(session)).toBe("cancelled");
  });

  it("returns 'cancelled' for state ABANDONED", () => {
    const session = createMockSession({ state: "ABANDONED" });
    expect(mapStateToStatus(session)).toBe("cancelled");
  });

  it("returns 'saved' for state SAVED_FOR_LATER", () => {
    const session = createMockSession({ state: "SAVED_FOR_LATER" });
    expect(mapStateToStatus(session)).toBe("saved");
  });

  it("returns 'in_progress' for active states", () => {
    const activeStates = ["NEW", "READY_FOR_INPUT", "TEXT_PROVIDED", "DRAFT_READY", "EDITING", "APPROVED", "EXPORTING"];
    
    for (const state of activeStates) {
      const session = createMockSession({ state });
      expect(mapStateToStatus(session)).toBe("in_progress");
    }
  });
});

describe("humanizeInteractionType", () => {
  it("converts phone_call to 'Phone call note'", () => {
    expect(humanizeInteractionType("phone_call")).toBe("Phone call note");
  });

  it("converts visit to 'Visit note'", () => {
    expect(humanizeInteractionType("visit")).toBe("Visit note");
  });

  it("converts meeting to 'Meeting note'", () => {
    expect(humanizeInteractionType("meeting")).toBe("Meeting note");
  });

  it("returns 'Note' for null", () => {
    expect(humanizeInteractionType(null)).toBe("Note");
  });

  it("handles kebab-case input", () => {
    expect(humanizeInteractionType("phone-call")).toBe("Phone call note");
  });

  it("capitalizes unknown types", () => {
    expect(humanizeInteractionType("custom_type")).toBe("Custom_type note");
  });
});
