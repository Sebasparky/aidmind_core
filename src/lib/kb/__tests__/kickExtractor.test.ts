import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase before importing the module under test
const mockInvoke = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    functions: { invoke: (...args: any[]) => mockInvoke(...args) },
    from: vi.fn(() => ({
      insert: vi.fn(() => ({ select: vi.fn(() => ({ single: vi.fn(() => ({ data: { id: 1 }, error: null })) })) })),
      select: vi.fn(() => ({ eq: vi.fn(() => ({ single: vi.fn(() => ({ data: { metadata: {} }, error: null })) })) })),
      update: vi.fn(() => ({ eq: vi.fn(() => ({ error: null })) })),
    })),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(() => ({ error: null })),
      })),
    },
  },
}));

describe("kickExtractor", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Reset the module-level debounce timestamp by re-importing
    vi.resetModules();
  });

  it("calls kb-kick edge function via supabase.functions.invoke", async () => {
    // Dynamic import to get fresh module state
    const { kickExtractor } = await import("@/lib/kb/kbUploadService");
    mockInvoke.mockResolvedValue({ data: { ok: true, status: 200 }, error: null });

    const result = await kickExtractor();

    expect(mockInvoke).toHaveBeenCalledWith("kb-kick", { method: "POST" });
    expect(result.ok).toBe(true);
  });

  it("returns ok:false when invoke errors, never throws", async () => {
    const { kickExtractor } = await import("@/lib/kb/kbUploadService");
    mockInvoke.mockResolvedValue({ data: null, error: { message: "network fail" } });

    const result = await kickExtractor();

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("network fail");
  });

  it("debounces rapid calls (second call within 2s returns debounced)", async () => {
    const { kickExtractor } = await import("@/lib/kb/kbUploadService");
    mockInvoke.mockResolvedValue({ data: { ok: true }, error: null });

    await kickExtractor(); // first call goes through
    const second = await kickExtractor(); // within 2s, should be debounced

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(second.detail).toBe("debounced");
  });

  it("does not throw even if invoke throws an exception", async () => {
    const { kickExtractor } = await import("@/lib/kb/kbUploadService");
    mockInvoke.mockRejectedValue(new Error("boom"));

    const result = await kickExtractor();

    expect(result.ok).toBe(false);
    expect(result.detail).toContain("boom");
  });
});
