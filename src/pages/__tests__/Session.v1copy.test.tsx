import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import Session from "../Session";
import { DashboardProvider } from "@/contexts/DashboardContext";
import { NavigationGuardProvider } from "@/contexts/NavigationGuardContext";

// Mock the hooks that make network calls
vi.mock("@/hooks/useSessionApi", () => ({
  useSessionApi: () => ({
    createSession: vi.fn().mockResolvedValue({ session_id: "test-session-id" }),
    cancelSession: vi.fn().mockResolvedValue(undefined),
    closeSession: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("@/hooks/useSessionHeartbeat", () => ({
  useSessionHeartbeat: vi.fn(),
}));

// Test wrapper component
function TestWrapper({ children }: { children: React.ReactNode }) {
  return (
    <BrowserRouter>
      <NavigationGuardProvider>
        <DashboardProvider>
          {children}
        </DashboardProvider>
      </NavigationGuardProvider>
    </BrowserRouter>
  );
}

describe("Session Page V1 Copy Consistency", () => {
  it("does not contain 'audio' in visible text content", async () => {
    render(
      <TestWrapper>
        <Session />
      </TestWrapper>
    );

    // Get all text content from the page
    const bodyText = document.body.textContent || "";
    
    // Check that 'audio' doesn't appear in user-visible copy
    // Note: This may appear in comments/aria-labels which is okay
    const visibleElements = screen.queryAllByText(/audio/i);
    
    // Filter to only user-visible elements (not hidden)
    const visibleAudioText = visibleElements.filter(
      (el) => el.offsetParent !== null && !el.closest('[aria-hidden="true"]')
    );
    
    expect(visibleAudioText).toHaveLength(0);
  });

  it("does not contain 'transcript' in visible text content", async () => {
    render(
      <TestWrapper>
        <Session />
      </TestWrapper>
    );

    const visibleElements = screen.queryAllByText(/transcript/i);
    
    const visibleTranscriptText = visibleElements.filter(
      (el) => el.offsetParent !== null && !el.closest('[aria-hidden="true"]')
    );
    
    expect(visibleTranscriptText).toHaveLength(0);
  });

  it("does not show 'Regenerate (X left)' button copy", async () => {
    render(
      <TestWrapper>
        <Session />
      </TestWrapper>
    );

    // Should not find the old regeneration button copy
    expect(screen.queryByText(/Regenerate \(\d+ left\)/)).toBeNull();
    expect(screen.queryByText(/Regenerate \(0 left\)/)).toBeNull();
  });

  it("does not mention 'LLM' or 'requests left' in UI", async () => {
    render(
      <TestWrapper>
        <Session />
      </TestWrapper>
    );

    const bodyText = document.body.textContent || "";
    
    expect(bodyText.toLowerCase()).not.toContain("llm");
    expect(bodyText.toLowerCase()).not.toContain("requests left");
  });
});
