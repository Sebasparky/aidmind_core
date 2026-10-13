import { describe, it, expect } from "vitest";
import {
  CLIENT_METADATA_KEYS,
  CLIENT_REPORTABLE_EVENT_TYPES,
  MAX_METADATA_KEYS,
  MAX_STRING_VALUE_LENGTH,
  PHI_DENYLIST_KEYS,
  isClientReportableEventType,
  isServerVerifiedEvent,
  isValidRequestId,
  sanitizeClientEventMetadata,
} from "./clientEventContract";

describe("clientEventContract: event types", () => {
  it("accepts only the allowlisted lifecycle/tool types", () => {
    for (const t of CLIENT_REPORTABLE_EVENT_TYPES) expect(isClientReportableEventType(t)).toBe(true);
    expect(isClientReportableEventType("AI_USAGE_APPROVED_BY_SUPERVISOR")).toBe(false);
    expect(isClientReportableEventType("AUDITOR_ACCESS_GRANTED")).toBe(false);
    expect(isClientReportableEventType("COMPLIANCE_EXPORT_GENERATED")).toBe(false);
    expect(isClientReportableEventType("LLM_CALL_COMPLETED")).toBe(false);
    expect(isClientReportableEventType("")).toBe(false);
    expect(isClientReportableEventType(undefined)).toBe(false);
  });

  it("never allowlists an authorization event", () => {
    const authEvents = [
      "AI_USAGE_APPROVED_BY_SUPERVISOR", "AI_USAGE_APPROVAL_REVOKED",
      "AUDITOR_ACCESS_GRANTED", "AUDITOR_ACCESS_REVOKED",
    ];
    for (const e of authEvents) expect(CLIENT_REPORTABLE_EVENT_TYPES).not.toContain(e);
  });
});

describe("clientEventContract: request ids", () => {
  it("accepts heartbeat-style and uuid ids, rejects whitespace and length overflow", () => {
    expect(isValidRequestId("hb_abc_1700000000000")).toBe(true);
    expect(isValidRequestId("3f2504e0-4f89-11d3-9a0c-0305e82c3301")).toBe(true);
    expect(isValidRequestId("has space")).toBe(false);
    expect(isValidRequestId("")).toBe(false);
    expect(isValidRequestId("x".repeat(129))).toBe(false);
    expect(isValidRequestId(42)).toBe(false);
  });
});

describe("clientEventContract: metadata sanitization", () => {
  it("keeps allowlisted primitive keys and drops everything else", () => {
    const { metadata, dropped } = sanitizeClientEventMetadata({
      tool_name: "run_reviewer_v2",
      issue_count: 3,
      reconciliation_filtered: true,
      notes_source: null,
      actor_id: "spoofed",
      tenant_id: "spoofed",
      request_id_text: "x",
      nested: { a: 1 },
      list: [1, 2],
    });
    expect(metadata).toEqual({
      tool_name: "run_reviewer_v2",
      issue_count: 3,
      reconciliation_filtered: true,
      notes_source: null,
    });
    const droppedKeys = dropped.map((d) => d.key).sort();
    expect(droppedKeys).toEqual(["actor_id", "list", "nested", "request_id_text", "tenant_id"]);
  });

  it("drops PHI-denylisted keys regardless of case", () => {
    const { metadata, dropped } = sanitizeClientEventMetadata({
      Transcript: "client said…",
      note_content: "…",
      PROMPT: "…",
      tool_name: "ok",
    });
    expect(metadata).toEqual({ tool_name: "ok" });
    expect(dropped.filter((d) => d.reason === "denied").map((d) => d.key).sort())
      .toEqual(["PROMPT", "Transcript", "note_content"]);
  });

  it("truncates long strings and rejects non-finite numbers", () => {
    const long = "a".repeat(MAX_STRING_VALUE_LENGTH + 50);
    const { metadata, dropped } = sanitizeClientEventMetadata({ review_tier: long, page_count: Infinity });
    expect((metadata.review_tier as string).length).toBe(MAX_STRING_VALUE_LENGTH);
    expect(dropped).toEqual([
      { key: "review_tier", reason: "too_long" },
      { key: "page_count", reason: "not_primitive" },
    ]);
  });

  it("caps the number of keys", () => {
    expect(CLIENT_METADATA_KEYS.length).toBeGreaterThan(MAX_METADATA_KEYS);
    const input: Record<string, number> = {};
    for (const k of CLIENT_METADATA_KEYS) input[k] = 1;
    const { metadata, dropped } = sanitizeClientEventMetadata(input);
    expect(Object.keys(metadata).length).toBe(MAX_METADATA_KEYS);
    expect(dropped.every((d) => d.reason === "overflow")).toBe(true);
  });

  it("handles non-object input", () => {
    expect(sanitizeClientEventMetadata(undefined).metadata).toEqual({});
    expect(sanitizeClientEventMetadata("str").metadata).toEqual({});
    expect(sanitizeClientEventMetadata([1]).metadata).toEqual({});
  });

  it("denylist and allowlist never overlap", () => {
    for (const k of PHI_DENYLIST_KEYS) expect(CLIENT_METADATA_KEYS).not.toContain(k as never);
  });
});

describe("clientEventContract: server-verified detection", () => {
  it("requires both source and verified flags", () => {
    expect(isServerVerifiedEvent({ source: "server_observed", verified: true })).toBe(true);
    expect(isServerVerifiedEvent({ source: "server_observed", verified: false })).toBe(false);
    expect(isServerVerifiedEvent({ source: "client_reported", verified: true })).toBe(false);
    expect(isServerVerifiedEvent({ verified: true })).toBe(false);
    expect(isServerVerifiedEvent({ source: "server_observed" })).toBe(false);
    expect(isServerVerifiedEvent(null)).toBe(false);
    expect(isServerVerifiedEvent("x")).toBe(false);
  });
});
