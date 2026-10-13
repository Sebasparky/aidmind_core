import { describe, it, expect, vi } from "vitest";

// kbUploadService imports the Supabase client at module load; stub it out.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { sanitizeForStorageKey } from "@/lib/kb/kbUploadService";

// Must stay in sync with PDF_NAME_RE in
// supabase/functions/_shared/storage-path-authorization.ts and the
// kb-documents INSERT policy in
// supabase/migrations/20261005220000_harden_storage_policies.sql.
const SERVER_KB_NAME_RE = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,203}\.pdf$/;

describe("sanitizeForStorageKey", () => {
  it("never produces a dot-prefixed key", () => {
    const cases: Array<[string, string]> = [
      [".pdf", "document.pdf"],
      ["..pdf", "document.pdf"],
      ["...pdf", "document.pdf"],
      [".hidden.pdf", "hidden.pdf"],
      ["..hidden.pdf", "hidden.pdf"],
      ["._resource.pdf", "resource.pdf"],
      ["_.hidden.PDF", "hidden.pdf"],
      [" .hidden.pdf", "hidden.pdf"],
    ];
    for (const [input, expected] of cases) {
      expect(sanitizeForStorageKey(input), input).toBe(expected);
    }
  });

  it("preserves ordinary file names", () => {
    expect(sanitizeForStorageKey("Intake_Policy-2026.pdf")).toBe("Intake_Policy-2026.pdf");
    expect(sanitizeForStorageKey("report.final.pdf")).toBe("report.final.pdf");
    expect(sanitizeForStorageKey("Résumé draft.pdf")).toBe("Resume_draft.pdf");
    expect(sanitizeForStorageKey("-v2.pdf")).toBe("-v2.pdf");
  });

  it("always yields a name the server-side KB validators accept", () => {
    const inputs = [
      ".pdf", "..pdf", ".hidden.pdf", "._x.pdf", "....", "", "   ", "_", "-",
      "a.pdf", "x".repeat(500) + ".pdf", "日本語.pdf", ".日本語.pdf", "a..pdf",
    ];
    for (const input of inputs) {
      const out = sanitizeForStorageKey(input);
      expect(SERVER_KB_NAME_RE.test(out), `${JSON.stringify(input)} -> ${out}`).toBe(true);
    }
  });
});
