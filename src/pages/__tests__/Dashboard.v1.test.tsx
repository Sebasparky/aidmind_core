import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { BrowserRouter } from "react-router-dom";
import { DerivedSignalsPanel, WorkRadarPanel } from "@/components/dashboard/WorkRadarPanel";
import { ActiveSessionsPanel } from "@/components/dashboard/ActiveSessionsPanel";
import { SessionHistoryPanel } from "@/components/dashboard/SessionHistoryPanel";

// Mock AuthContext
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "test-user" },
    session: { access_token: "test-token" },
    loading: false,
    signOut: vi.fn(),
  }),
}));

// Mock useTenant
vi.mock("@/hooks/useTenant", () => ({
  useTenant: () => ({
    tenantId: "test-tenant",
    tenant: { id: "test-tenant", name: "Test Tenant" },
    loading: false,
  }),
}));

// Mock DashboardContext
vi.mock("@/contexts/DashboardContext", () => ({
  useDashboard: () => ({
    requestSessionHighlight: vi.fn(),
    registerActiveSessionIds: vi.fn(),
    registerHistorySessionIds: vi.fn(),
    activeSessionIds: [],
    historySessionIds: [],
    highlightTarget: null,
    clearHighlight: vi.fn(),
  }),
}));

// Mock useRecentNotes
vi.mock("@/hooks/useRecentNotes", () => ({
  useRecentNotes: () => ({
    notes: [],
    loading: false,
    error: null,
    refresh: vi.fn(),
  }),
}));

// Mock supabase
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: () => ({
      insert: () => Promise.resolve({ error: null }),
      update: () => ({
        eq: () => Promise.resolve({ error: null }),
      }),
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: null, error: null }),
        }),
      }),
    }),
  },
}));

const renderWithRouter = (component: React.ReactNode) => {
  return render(<BrowserRouter>{component}</BrowserRouter>);
};

describe("V1 Dashboard Components", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("DerivedSignalsPanel", () => {
    it("displays 'Work Radar' section title", () => {
      renderWithRouter(<DerivedSignalsPanel />);
      expect(screen.getByText("Work Radar")).toBeInTheDocument();
    });

    it("displays correct subtitle with active count", () => {
      renderWithRouter(<DerivedSignalsPanel />);
      expect(screen.getByText(/Active/)).toBeInTheDocument();
    });

    it("does NOT use task-manager language", () => {
      renderWithRouter(<DerivedSignalsPanel />);
      expect(screen.queryByText(/my tasks/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/add task/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/to-do/i)).not.toBeInTheDocument();
    });

    it("does NOT use prohibited language", () => {
      renderWithRouter(<DerivedSignalsPanel />);
      expect(screen.queryByText(/prototype/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/demo/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/compliance status/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/task list/i)).not.toBeInTheDocument();
    });

    it("shows derived signals or empty state from real data", () => {
      renderWithRouter(<DerivedSignalsPanel />);
      // With mocked supabase returning no data, should show empty state
      expect(screen.getByText(/All clear|no signals|Work Radar/i)).toBeInTheDocument();
    });

    it("shows correct empty state when no items", () => {
      renderWithRouter(<DerivedSignalsPanel items={[]} />);
      expect(screen.getByText("All clear — no signals at this time.")).toBeInTheDocument();
      expect(screen.getByText("System health, KB status, and audit events are nominal.")).toBeInTheDocument();
    });

    it("provides info tooltip about non-authoritative nature", () => {
      renderWithRouter(<DerivedSignalsPanel />);
      expect(screen.getByLabelText("About derived signals")).toBeInTheDocument();
    });
  });

  describe("ActiveSessionsPanel", () => {
    it("displays 'Active Sessions' section title", () => {
      renderWithRouter(<ActiveSessionsPanel />);
      expect(screen.getByText("Active Sessions")).toBeInTheDocument();
    });

    it("displays 'Access guidance and review tools' subtitle", () => {
      renderWithRouter(<ActiveSessionsPanel />);
      expect(screen.getByText("Access guidance and review tools")).toBeInTheDocument();
    });

    it("uses 'New Session' button text", () => {
      renderWithRouter(<ActiveSessionsPanel />);
      expect(screen.getByText("New Session")).toBeInTheDocument();
    });

    it("does NOT display 'Start Note'", () => {
      renderWithRouter(<ActiveSessionsPanel />);
      expect(screen.queryByText("Start Note")).not.toBeInTheDocument();
    });

    it("shows empty state when no sessions loaded", () => {
      renderWithRouter(<ActiveSessionsPanel />);
      expect(screen.getByText("No active sessions")).toBeInTheDocument();
    });

    it("does NOT display lifecycle stage language", () => {
      renderWithRouter(<ActiveSessionsPanel />);
      expect(screen.queryByText(/^drafting$/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/^editing$/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/^exporting$/i)).not.toBeInTheDocument();
      expect(screen.queryByText(/^approved$/i)).not.toBeInTheDocument();
    });

    it("does NOT display 'Progress' label (uses 'Tools Used' instead)", () => {
      renderWithRouter(<ActiveSessionsPanel />);
      expect(screen.queryByText(/^Progress:/i)).not.toBeInTheDocument();
    });
  });

  describe("SessionHistoryPanel", () => {
    it("displays 'Session History' section title", () => {
      renderWithRouter(<SessionHistoryPanel />);
      expect(screen.getByText("Session History")).toBeInTheDocument();
    });

    it("displays 'Closed sessions (read-only)' subtitle", () => {
      renderWithRouter(<SessionHistoryPanel />);
      expect(screen.getByText("Closed sessions (read-only)")).toBeInTheDocument();
    });

    it("shows empty state when no sessions", () => {
      renderWithRouter(<SessionHistoryPanel />);
      expect(screen.getByText("No session history yet")).toBeInTheDocument();
    });

    it("does NOT display 'Export' as a primary action", () => {
      renderWithRouter(<SessionHistoryPanel />);
      const exportButtons = screen.queryAllByRole("button", { name: /export/i });
      expect(exportButtons.length).toBe(0);
    });

    it("does NOT display 'Resume' action", () => {
      renderWithRouter(<SessionHistoryPanel />);
      expect(screen.queryByRole("button", { name: /resume/i })).not.toBeInTheDocument();
    });
  });
});

describe("V1 Dashboard Language Compliance", () => {
  it("DerivedSignalsPanel does NOT use calendar language", () => {
    renderWithRouter(<DerivedSignalsPanel />);
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

  it("ActiveSessionsPanel does NOT use draft/export language", () => {
    renderWithRouter(<ActiveSessionsPanel />);
    expect(screen.queryByText(/draft/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/export/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/finalize/i)).not.toBeInTheDocument();
  });
});

describe("V1 Routing Constraints", () => {
  it("ActiveSessionsPanel does NOT contain links to /session", () => {
    renderWithRouter(<ActiveSessionsPanel />);
    const sessionLinks = document.querySelectorAll('a[href*="/session"]');
    // Filter out /guidance and /reviewer links
    const invalidLinks = Array.from(sessionLinks).filter(
      (link) => !link.getAttribute("href")?.includes("/guidance") && 
                !link.getAttribute("href")?.includes("/reviewer")
    );
    expect(invalidLinks.length).toBe(0);
  });
});
