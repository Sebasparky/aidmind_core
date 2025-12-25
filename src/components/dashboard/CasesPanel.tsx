import { useState } from "react";
import { Search, ChevronDown, MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { CaseItem, Case } from "./CaseItem";

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

export function CasesPanel() {
  const [activeCasesOpen, setActiveCasesOpen] = useState(true);
  const [closedCasesOpen, setClosedCasesOpen] = useState(false);

  return (
    <div className="w-[380px] flex-shrink-0 flex flex-col h-full overflow-hidden bg-card rounded-xl border border-border p-5 border-l-2">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-xl font-semibold text-foreground">My Cases</h2>
        <Button className="gap-1">
          New Case
          <ChevronDown className="h-4 w-4 ml-1" />
        </Button>
      </div>

      {/* Search */}
      <div className="relative mb-4">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          type="search"
          placeholder="Search cases..."
          className="pl-10 h-10 bg-card border-border"
          aria-label="Search cases"
        />
      </div>

      {/* Cases List */}
      <div className="overflow-y-auto flex-1 min-h-0 -mx-5 px-5">
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
                <span className="text-xs text-muted-foreground">(6)</span>
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
              {activeCases.map((caseData) => (
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
                <span className="text-xs text-muted-foreground">(18)</span>
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
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              No closed cases to display
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  );
}
