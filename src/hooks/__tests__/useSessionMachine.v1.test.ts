/**
 * V1 Purity Tests for useSessionMachine
 * 
 * These tests verify that v0 pipeline states and actions are NOT exported in v1.
 */

import { describe, it, expect } from "vitest";
import { V1_SESSION_STATES } from "../useSessionMachine";

describe("V1 Session Machine Purity", () => {
  describe("V1_SESSION_STATES", () => {
    it("should NOT include v0-only transcription/redaction states", () => {
      const v0OnlyStates = [
        "AUDIO_UPLOADED",
        "TRANSCRIBING",
        "TRANSCRIBED",
        "REDACTING",
        "VERIFICATION_REVIEW",
        "INPUT_READY",
        "RETRIEVING_CONTEXT",
        "GENERATING",
        "VALIDATING_OUTPUT",
      ];

      for (const v0State of v0OnlyStates) {
        expect(V1_SESSION_STATES).not.toContain(v0State);
      }
    });

    it("should include all v1 states", () => {
      const v1States = [
        "NEW",
        "READY_FOR_INPUT",
        "TEXT_PROVIDED",
        "DRAFT_READY",
        "EDITING",
        "APPROVED",
        "EXPORTING",
        "CLOSING",
        "PURGED",
        "ERROR",
      ];

      for (const v1State of v1States) {
        expect(V1_SESSION_STATES).toContain(v1State);
      }
    });

    it("should have exactly 10 v1 states", () => {
      expect(V1_SESSION_STATES).toHaveLength(10);
    });
  });

  describe("V1 Actions Export", () => {
    it("should NOT export v0-only actions", async () => {
      // Dynamic import to check exports
      const exports = await import("../useSessionMachine");
      
      // These should NOT be exported at the module level
      expect(exports).not.toHaveProperty("startTranscription");
      expect(exports).not.toHaveProperty("startRedaction");
      expect(exports).not.toHaveProperty("generateDraft");
      expect(exports).not.toHaveProperty("reverifyText");
      expect(exports).not.toHaveProperty("discardAndStartOver");
      expect(exports).not.toHaveProperty("uploadAudio");
    });

    it("should NOT export transcription model types", async () => {
      const exports = await import("../useSessionMachine");
      
      expect(exports).not.toHaveProperty("TRANSCRIPTION_MODELS");
      expect(exports).not.toHaveProperty("TranscriptionModel");
    });
  });
});
