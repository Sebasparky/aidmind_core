import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { WorkRadarPanel } from "@/components/dashboard/WorkRadarPanel";
import { ActiveSessionsPanel } from "@/components/dashboard/ActiveSessionsPanel";
import { SessionHistoryPanel } from "@/components/dashboard/SessionHistoryPanel";

// Mock useRecentNotes
vi.mock("@/hooks/useRecentNotes", () => ({
  useRecentNotes: () => ({
    notes: [],
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

const renderWithRouter = (component: React.ReactNode) => {
  return render(<BrowserRouter>{component}</BrowserRouter>);
};

describe("V1 Dashboard Components", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("WorkRadarPanel", () => {
    it("displays 'Work Radar' section title", () => {
      renderWithRouter(<WorkRadarPanel />);
      expect(screen.getByText("Work Radar")).toBeInTheDocument();
    });

    it("displays 'Documentation obligations requiring attention' subtitle", () => {
      renderWithRouter(<WorkRadarPanel />);
      expect(
        screen.getByText("Documentation obligations requiring attention")
      ).toBeInTheDocument();
    });

    it("does NOT use task-manager language", () => {
      renderWithRouter(<WorkRadarPanel />);
      expect(screen.queryByText(/my tasks/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/add task/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/to-do/i)).not.toBeInTheDocument();
    });

    it("displays source badges with provenance information (placeholder data)", () => {
      renderWithRouter(<WorkRadarPanel />);
      expect(screen.getByText("Intake session #4821")).toBeInTheDocument();
      expect(screen.getByText("Policy threshold reached")).toBeInTheDocument();
      expect(screen.getByText("Timeline event confirmed")).toBeInTheDocument();
    });

    it("shows obligation text clearly", () => {
      renderWithRouter(<WorkRadarPanel />);
      expect(screen.getByText("Consent form still missing")).toBeInTheDocument();
      expect(screen.getByText("Supervisor sign-off required")).toBeInTheDocument();
      expect(screen.getByText("Follow-up documentation due")).toBeInTheDocument();
    });

    it("shows correct empty state when no items", () => {
      renderWithRouter(<WorkRadarPanel items={[]} />);
      expect(screen.getByText("No outstanding obligations")).toBeInTheDocument();
      expect(screen.getByText("Documentation is up to date")).toBeInTheDocument();
    });
  });

  describe("ActiveSessionsPanel", () => {
    it("displays 'Active Sessions' section title", () => {
      renderWithRouter(<ActiveSessionsPanel />);
      expect(screen.getByText("Active Sessions")).toBeInTheDocument();
    });

    it("displays 'Sessions in progress' subtitle", () => {
      renderWithRouter(<ActiveSessionsPanel />);
      expect(screen.getByText("Sessions in progress")).toBeInTheDocument();
    });

    it("uses 'New Session' button text", () => {
      renderWithRouter(<ActiveSessionsPanel />);
      expect(screen.getByText("New Session")).toBeInTheDocument();
    });

    it("does NOT display 'Start Note'", () => {
      renderWithRouter(<ActiveSessionsPanel />);
      expect(screen.queryByText("Start Note")).not.toBeInTheDocument();
    });

    it("shows correct empty state", () => {
      renderWithRouter(<ActiveSessionsPanel />);
      expect(screen.getByText("No active sessions")).toBeInTheDocument();
      expect(
        screen.getByText("Start a new session to access guidance and review tools")
      ).toBeInTheDocument();
    });

    it("does NOT display lifecycle stage language", () => {
      renderWithRouter(<ActiveSessionsPanel />);
      expect(screen.queryByText(/^drafting$/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/^editing$/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/^exporting$/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/^approved$/i)).not.toBeInTheDocument();
    });
  });

  describe("SessionHistoryPanel", () => {
    it("displays 'Session History' section title", () => {
      renderWithRouter(<SessionHistoryPanel />);
      expect(screen.getByText("Session History")).toBeInTheDocument();
    });

    it("displays 'Completed and closed sessions' subtitle", () => {
      renderWithRouter(<SessionHistoryPanel />);
      expect(screen.getByText("Completed and closed sessions")).toBeInTheDocument();
    });

    it("shows correct empty state", () => {
      renderWithRouter(<SessionHistoryPanel />);
      expect(screen.getByText("No session history")).toBeInTheDocument();
      expect(screen.getByText("Completed sessions will appear here")).toBeInTheDocument();
    });

    it("does NOT display 'Export' as a primary action", () => {
      renderWithRouter(<SessionHistoryPanel />);
      const exportButtons = screen.queryAllByRole("button", { name: /export/i });
      expect(exportButtons.length).toBe(0);
    });
  });
});

describe("V1 Dashboard Language Compliance", () => {
  it("WorkRadarPanel does NOT use calendar language", () => {
    renderWithRouter(<WorkRadarPanel />);
    expect(screen.queryByText(/calendar/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/schedule/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/appointment/i)).not.toBeInTheDocument();
  });

  it("ActiveSessionsPanel does NOT use calendar language", () => {
    renderWithRouter(<ActiveSessionsPanel />);
    expect(screen.queryByText(/calendar/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/schedule/i)).not.toBeInTheDocument();
  });

  it("SessionHistoryPanel does NOT use system-of-record language", () => {
    renderWithRouter(<SessionHistoryPanel />);
    // Should not imply storing final documents
    expect(screen.queryByText(/final document/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/stored record/i)).not.toBeInTheDocument();
  });
});
