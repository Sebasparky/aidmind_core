/**
 * Retrieve Page - Source-backed retrieval and research workspace
 * 
 * Citation-first, non-opinionated research surface for caseworkers
 * to find trustworthy information from the knowledge base.
 */

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Search, FileText, Quote, Scale, ShieldCheck, ArrowRight, BookOpen, FileSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useState, useRef, useCallback } from "react";

const EXAMPLE_QUERIES = [
  {
    label: "Understand a notice or letter",
    description: "A client received a notice to appear in immigration court. What does it mean and what are their options?",
    icon: FileText,
  },
  {
    label: "Look up benefits rules",
    description: "What does a benefits denial letter require the client to do, and what are the appeal deadlines?",
    icon: Scale,
  },
  {
    label: "Find policy on emergency services",
    description: "What rules apply to emergency services eligibility for non-citizens in this jurisdiction?",
    icon: ShieldCheck,
  },
];

export default function Retrieve() {
  const [query, setQuery] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const handleExampleClick = useCallback((description: string) => {
    setQuery(description);
    // Focus and place cursor at end after state update
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(description.length, description.length);
      }
    });
  }, []);

  return (
    <DashboardLayout hideSearch>
      <div className="flex flex-col items-center justify-start pt-12 pb-16 px-4 min-h-full">
        {/* Page header */}
        <div className="text-center max-w-2xl mb-10">
          <h1 className="text-2xl font-semibold text-foreground tracking-tight mb-2">
            Retrieve
          </h1>
          <p className="text-muted-foreground text-base leading-relaxed">
            Search trusted sources for source-backed answers with citations.
          </p>
        </div>

        {/* Primary input area */}
        <div className="w-full max-w-2xl mb-10">
          <div className="relative rounded-xl border border-border bg-card shadow-sm">
            <Textarea
              ref={textareaRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Paste text from a notice, letter, or form — or ask a source-backed question"
              className="min-h-[120px] resize-none border-0 bg-transparent px-5 pt-5 pb-14 text-base placeholder:text-muted-foreground/60 focus-visible:ring-0 focus-visible:ring-offset-0"
              aria-label="Retrieve search input"
            />
            <div className="absolute bottom-3 right-3">
              <Button
                size="sm"
                disabled={!query.trim()}
                className="gap-2"
                aria-label="Search trusted sources"
              >
                <Search className="h-4 w-4" />
                Search sources
              </Button>
            </div>
          </div>
        </div>

        {/* Trust callout */}
        <div className="w-full max-w-2xl mb-10">
          <div className="flex items-start gap-3 rounded-lg border border-border bg-secondary/50 px-5 py-4">
            <Quote className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm font-medium text-foreground mb-1">
                Every answer is grounded in your knowledge base
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Results are drawn directly from uploaded policies, statutes, and guidance materials.
                All responses include source citations so you can verify the information.
              </p>
            </div>
          </div>
        </div>

        {/* Example queries */}
        <div className="w-full max-w-2xl mb-14">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">
            Ways to use Retrieve
          </p>
          <div className="grid gap-3">
            {EXAMPLE_QUERIES.map((example) => (
              <button
                key={example.label}
                className="flex items-center gap-4 rounded-lg border border-border bg-card px-5 py-4 text-left transition-colors hover:bg-secondary/50 group"
                onClick={() => handleExampleClick(example.description)}
              >
                <div className="flex-shrink-0 h-10 w-10 rounded-lg bg-secondary flex items-center justify-center">
                  <example.icon className="h-5 w-5 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground">
                    {example.label}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {example.description}
                  </p>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-muted-foreground transition-colors flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>

        {/* Results preview — ghosted layout hint */}
        <div className="w-full max-w-2xl opacity-40 pointer-events-none select-none">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-4">
            What you'll see
          </p>

          {/* Answer preview */}
          <div className="rounded-lg border border-border bg-card px-5 py-5 mb-3">
            <div className="flex items-center gap-2 mb-3">
              <BookOpen className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Answer</span>
            </div>
            <Skeleton className="h-4 w-full mb-2" />
            <Skeleton className="h-4 w-5/6 mb-2" />
            <Skeleton className="h-4 w-4/6" />
          </div>

          {/* Sources preview */}
          <div className="rounded-lg border border-border bg-card px-5 py-5 mb-3">
            <div className="flex items-center gap-2 mb-3">
              <FileSearch className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Sources</span>
            </div>
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="flex items-center gap-3">
                  <Skeleton className="h-3 w-3 rounded-full flex-shrink-0" />
                  <Skeleton className="h-3 flex-1" />
                </div>
              ))}
            </div>
          </div>

          {/* Related materials preview */}
          <div className="rounded-lg border border-border bg-card px-5 py-5">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="h-4 w-4 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Related materials</span>
            </div>
            <div className="flex gap-3">
              <Skeleton className="h-16 flex-1 rounded-md" />
              <Skeleton className="h-16 flex-1 rounded-md" />
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
