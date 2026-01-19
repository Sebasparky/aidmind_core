import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
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
    render(<TestWrapper><Session /></TestWrapper>);
    const visibleElements = screen.queryAllByText(/audio/i);
    const visibleAudioText = visibleElements.filter(
      (el) => el.offsetParent !== null && !el.closest('[aria-hidden="true"]')
    );
    expect(visibleAudioText).toHaveLength(0);
  });

  it("does not contain 'transcript' in visible text content", async () => {
    render(<TestWrapper><Session /></TestWrapper>);
    const visibleElements = screen.queryAllByText(/transcript/i);
    const visibleTranscriptText = visibleElements.filter(
      (el) => el.offsetParent !== null && !el.closest('[aria-hidden="true"]')
    );
    expect(visibleTranscriptText).toHaveLength(0);
  });

  it("does not show 'Regenerate (X left)' button copy", async () => {
    render(<TestWrapper><Session /></TestWrapper>);
    expect(screen.queryByText(/Regenerate \(\d+ left\)/)).toBeNull();
    expect(screen.queryByText(/Regenerate \(0 left\)/)).toBeNull();
  });

  it("does not mention 'LLM' or 'requests left' in UI", async () => {
    render(<TestWrapper><Session /></TestWrapper>);
    const bodyText = document.body.textContent || "";
    expect(bodyText.toLowerCase()).not.toContain("llm");
    expect(bodyText.toLowerCase()).not.toContain("requests left");
  });

  it("does not mention 'redaction' in UI", async () => {
    render(<TestWrapper><Session /></TestWrapper>);
    const bodyText = document.body.textContent || "";
    expect(bodyText.toLowerCase()).not.toContain("redaction");
  });

  it("shows 'Documentation Session' title instead of 'Note Session'", async () => {
    render(<TestWrapper><Session /></TestWrapper>);
    await waitFor(() => {
      expect(screen.getByText(/Documentation Session/)).toBeInTheDocument();
    });
  });

  it("has 'Generate Guidance' button present", async () => {
    render(<TestWrapper><Session /></TestWrapper>);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Generate Guidance/i })).toBeInTheDocument();
    });
  });

  it("has 'Run Reviewer' button present", async () => {
    render(<TestWrapper><Session /></TestWrapper>);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Run Reviewer/i })).toBeInTheDocument();
    });
  });

  it("has 'Template Preview' tab present", async () => {
    render(<TestWrapper><Session /></TestWrapper>);
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /Template Preview/i })).toBeInTheDocument();
    });
  });
});
