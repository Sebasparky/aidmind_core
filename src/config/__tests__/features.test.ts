/**
 * V1 Pivot Feature Gate Tests
 * 
 * These tests verify that transcription, redaction, and generative note gen
 * are properly disabled in v1.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { 
  V1_ENABLE_TRANSCRIPTION, 
  V1_ENABLE_REDACTION, 
  V1_ENABLE_GENERATIVE_NOTE_GEN,
  FEATURES,
  isV1,
  V1_DISABLED_ERROR,
} from "@/config/features";

describe("V1 Feature Gates", () => {
  describe("Feature flags", () => {
    it("V1_ENABLE_TRANSCRIPTION is false", () => {
      expect(V1_ENABLE_TRANSCRIPTION).toBe(false);
    });

    it("V1_ENABLE_REDACTION is false", () => {
      expect(V1_ENABLE_REDACTION).toBe(false);
    });

    it("V1_ENABLE_GENERATIVE_NOTE_GEN is false", () => {
      expect(V1_ENABLE_GENERATIVE_NOTE_GEN).toBe(false);
    });

    it("FEATURES object matches individual flags", () => {
      expect(FEATURES.transcription).toBe(V1_ENABLE_TRANSCRIPTION);
      expect(FEATURES.redaction).toBe(V1_ENABLE_REDACTION);
      expect(FEATURES.generativeNoteGen).toBe(V1_ENABLE_GENERATIVE_NOTE_GEN);
    });

    it("isV1() returns true when any pipeline feature is disabled", () => {
      expect(isV1()).toBe(true);
    });

    it("V1_DISABLED_ERROR is defined", () => {
      expect(V1_DISABLED_ERROR).toBeTruthy();
      expect(typeof V1_DISABLED_ERROR).toBe("string");
    });
  });
});

describe("useTranscription hook (V1 stub)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("uploadAudio returns null and sets error when transcription disabled", async () => {
    const { useTranscription } = await import("@/hooks/useTranscription");
    const { renderHook, act } = await import("@testing-library/react");
    
    const { result } = renderHook(() => useTranscription());
    
    const mockFile = new File(["audio"], "test.mp3", { type: "audio/mpeg" });
    
    let uploadResult: string | null = null;
    await act(async () => {
      uploadResult = await result.current.uploadAudio("session-123", mockFile);
    });
    
    expect(uploadResult).toBeNull();
    expect(result.current.error).toBe("Transcription is disabled in v1");
  });

  it("transcribe returns null and sets error when transcription disabled", async () => {
    const { useTranscription } = await import("@/hooks/useTranscription");
    const { renderHook, act } = await import("@testing-library/react");
    
    const { result } = renderHook(() => useTranscription());
    
    let transcribeResult: string | null = null;
    await act(async () => {
      transcribeResult = await result.current.transcribe("session-123", "audio-key");
    });
    
    expect(transcribeResult).toBeNull();
    expect(result.current.error).toBe("Transcription is disabled in v1");
  });

  it("redact returns empty result and sets error when redaction disabled", async () => {
    const { useTranscription } = await import("@/hooks/useTranscription");
    const { renderHook, act } = await import("@testing-library/react");
    
    const { result } = renderHook(() => useTranscription());
    
    let redactResult: { minimizedTranscript: string | null } | null = null;
    await act(async () => {
      redactResult = await result.current.redact("session-123", "some transcript");
    });
    
    expect(redactResult?.minimizedTranscript).toBeNull();
    expect(result.current.error).toBe("Redaction is disabled in v1");
  });

  it("reverify returns failure when redaction disabled", async () => {
    const { useTranscription } = await import("@/hooks/useTranscription");
    const { renderHook, act } = await import("@testing-library/react");
    
    const { result } = renderHook(() => useTranscription());
    
    let reverifyResult: { verificationPassed: boolean } | null = null;
    await act(async () => {
      reverifyResult = await result.current.reverify("session-123", "edited text");
    });
    
    expect(reverifyResult?.verificationPassed).toBe(false);
    expect(result.current.error).toBe("Redaction is disabled in v1");
  });

  it("processAudio returns null when pipeline disabled", async () => {
    const { useTranscription } = await import("@/hooks/useTranscription");
    const { renderHook, act } = await import("@testing-library/react");
    
    const { result } = renderHook(() => useTranscription());
    
    const mockFile = new File(["audio"], "test.mp3", { type: "audio/mpeg" });
    
    let processResult: unknown = undefined;
    await act(async () => {
      processResult = await result.current.processAudio("session-123", mockFile);
    });
    
    expect(processResult).toBeNull();
  });
});
