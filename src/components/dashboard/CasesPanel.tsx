import { useState, useMemo } from "react";
import { Search, ChevronDown, MoreHorizontal, X, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { CaseItem, Case } from "./CaseItem";
import { useDashboard } from "@/contexts/DashboardContext";
import { StartNoteModal } from "./StartNoteModal";

const activeCases: Case[] = [
  {
    id: "1",
    client: "A. J.",
    caseName: "Housing assistance — intake",
    updatedAt: "Updated 1 hour ago",
    status: "active",
  },
  {
    id: "2",
    client: "B. R.",
    caseName: "Medical support case",
    updatedAt: "",
    status: "high-risk",
  },
  {
    id: "3",
    client: "C. T.",
    caseName: "Job placement review",
    updatedAt: "Updated Mar 25",
    status: "active",
  },
  {
    id: "4",
    client: "E. O.",
    caseName: "Veteran outreach case",
    updatedAt: "",
    status: "active",
    showActiveBadge: true,
  },
];

const closedCases: Case[] = [
  {
    id: "5",
    client: "F. K.",
    caseName: "Emergency shelter placement",
    updatedAt: "Closed Feb 14",
    status: "resolved",
  },
  {
    id: "6",
    client: "G. M.",
    caseName: "Benefits enrollment",
    updatedAt: "Closed Jan 30",
    status: "resolved",
  },
];

// Sort cases by risk: high-risk first, then active, then resolved
const riskOrder = { "high-risk": 0, active: 1, resolved: 2 };

function sortByRisk(cases: Case[]): Case[] {
  return [...cases].sort((a, b) => riskOrder[a.status] - riskOrder[b.status]);
}

export function CasesPanel() {
  const { searchQuery } = useDashboard();
  const [activeCasesOpen, setActiveCasesOpen] = useState(true);
  const [closedCasesOpen, setClosedCasesOpen] = useState(false);
  const [localSearch, setLocalSearch] = useState("");
  const [startNoteOpen, setStartNoteOpen] = useState(false);

  // Combine global and local search
  const effectiveSearch = searchQuery || localSearch;

  // Filter and sort cases
  const filteredActiveCases = useMemo(() => {
    let cases = sortByRisk(activeCases);
    if (effectiveSearch.trim()) {
      const query = effectiveSearch.toLowerCase();
      cases = cases.filter(
        (c) =>
          c.client.toLowerCase().includes(query) ||
          c.caseName.toLowerCase().includes(query)
      );
    }
    return cases;
  }, [effectiveSearch]);

  const filteredClosedCases = useMemo(() => {
    let cases = sortByRisk(closedCases);
    if (effectiveSearch.trim()) {
      const query = effectiveSearch.toLowerCase();
      cases = cases.filter(
        (c) =>
          c.client.toLowerCase().includes(query) ||
          c.caseName.toLowerCase().includes(query)
      );
    }
    return cases;
  }, [effectiveSearch]);

  const showNoResults =
    effectiveSearch.trim() &&
    filteredActiveCases.length === 0 &&
    filteredClosedCases.length === 0;

  return (
    <div className="w-[380px] flex-shrink-0 flex flex-col h-full overflow-hidden bg-card rounded-xl border border-border p-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-foreground">My Cases</h2>
        <Button onClick={() => setStartNoteOpen(true)} className="gap-2">
          <Plus className="h-4 w-4" />
          Start Note
        </Button>
      </div>

      {/* Start Note Modal */}
      <StartNoteModal open={startNoteOpen} onOpenChange={setStartNoteOpen} />

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search cases..."
          className="pl-10 pr-10 h-10 bg-card border-border"
          aria-label="Search cases"
          value={localSearch}
          onChange={(e) => setLocalSearch(e.target.value)}
        />
        {localSearch && (
          <button
            onClick={() => setLocalSearch("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Cases List */}
      <div className="overflow-y-auto flex-1 min-h-0 -mx-5 px-5">
        {showNoResults ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <p className="text-sm text-muted-foreground">No results found</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Try adjusting your search
            </p>
          </div>
        ) : (
          <>
            {/* Active Cases */}
            <Collapsible open={activeCasesOpen} onOpenChange={setActiveCasesOpen}>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center justify-between px-4 py-3 hover:bg-secondary/50 transition-colors text-left">
                  <div className="flex items-center gap-2">
                    <ChevronDown
                      className={`h-4 w-4 text-muted-foreground transition-transform ${
                        activeCasesOpen ? "" : "-rotate-90"
                      }`}
                    />
                    <span className="text-sm font-medium text-foreground">
                      Active Cases
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ({filteredActiveCases.length})
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={(e) => e.stopPropagation()}
                    aria-label="Active cases options"
                  >
                    <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-2 pb-2">
                  {filteredActiveCases.map((caseData) => (
                    <CaseItem key={caseData.id} caseData={caseData} />
                  ))}
                </div>
              </CollapsibleContent>
            </Collapsible>

            {/* Closed Cases */}
            <Collapsible open={closedCasesOpen} onOpenChange={setClosedCasesOpen}>
              <CollapsibleTrigger asChild>
                <button className="w-full flex items-center justify-between px-4 py-3 hover:bg-secondary/50 transition-colors text-left border-t border-border">
                  <div className="flex items-center gap-2">
                    <ChevronDown
                      className={`h-4 w-4 text-muted-foreground transition-transform ${
                        closedCasesOpen ? "" : "-rotate-90"
                      }`}
                    />
                    <span className="text-sm font-medium text-foreground">
                      Closed Cases
                    </span>
                    <span className="text-xs text-muted-foreground">
                      ({filteredClosedCases.length})
                    </span>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    onClick={(e) => e.stopPropagation()}
                    aria-label="Closed cases options"
                  >
                    <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                  </Button>
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="px-2 pb-2">
                  {filteredClosedCases.length > 0 ? (
                    filteredClosedCases.map((caseData) => (
                      <CaseItem key={caseData.id} caseData={caseData} />
                    ))
                  ) : (
                    <div className="px-4 py-8 text-center text-sm text-muted-foreground">
                      No closed cases to display
                    </div>
                  )}
                </div>
              </CollapsibleContent>
            </Collapsible>
          </>
        )}
      </div>
    </div>
  );
}
