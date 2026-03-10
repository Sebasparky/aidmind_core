/**
 * Retrieve Page - Source-backed retrieval and research workspace
 * 
 * Citation-first, non-opinionated research surface for caseworkers
 * to find trustworthy information from the knowledge base.
 */

import { DashboardLayout } from "@/components/layout/DashboardLayout";
import {
  Search, FileText, Quote, Scale, ShieldCheck, ArrowRight,
  BookOpen, FileSearch, ChevronDown, ChevronUp, ExternalLink,
  AlertCircle, Loader2, HelpCircle, Download, FlaskConical,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useState, useRef, useCallback, useEffect, lazy, Suspense } from "react";
import { useRetrieve, type EvidenceItem } from "@/hooks/useRetrieve";
import { ResultsRefinement, type RefinementUIState } from "@/components/retrieve/ResultsRefinement";

const IS_DEV = import.meta.env.VITE_DEV_MODE === "true";
const RetrieveEvalPanel = IS_DEV ? lazy(() => import("@/components/dev/RetrieveEvalPanel")) : null;

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

/* ── Evidence Card Component ── */

function EvidenceCard({ item, rank }: { item: EvidenceItem; rank: number }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-card px-5 py-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-2">
        <div className="flex items-start gap-3 min-w-0">
          <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center mt-0.5">
            {rank}
          </span>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground leading-snug truncate">
              {item.document_title}
            </h3>
            {item.section_heading && (
              <p className="text-xs text-muted-foreground mt-0.5 truncate">
                § {item.section_heading}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          {item.source_type && (
            <Badge variant="secondary" className="text-xs font-normal">
              {item.source_type}
            </Badge>
          )}
          {item.is_official && (
            <Badge variant="outline" className="text-xs font-normal border-primary/30 text-primary">
              Official
            </Badge>
          )}
        </div>
      </div>

      {/* Excerpt */}
      <div className="ml-9">
        <blockquote className="text-sm text-foreground leading-relaxed border-l-2 border-primary/20 pl-3 my-2">
          {item.excerpt_text}
        </blockquote>

        {/* Citation */}
        <p className="text-xs text-muted-foreground mt-2">
          <span className="font-medium">Citation:</span> {item.citation_label}
          {item.page_or_location && ` · ${item.page_or_location}`}
        </p>

        {/* Actions row: expand context + source access */}
        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            {expanded ? "Hide full context" : "Show full context"}
          </button>

          {/* Source access actions — only shown when URLs are available */}
          {item.source_url && (
            <a
              href={item.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <ExternalLink className="h-3 w-3" />
              View source
            </a>
          )}
          {item.download_url && (
            <a
              href={item.download_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              <Download className="h-3 w-3" />
              Download
            </a>
          )}
        </div>

        {expanded && (
          <div className="mt-3 rounded-md bg-secondary/50 p-3 text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap max-h-[400px] overflow-y-auto">
            {item.expandable_context}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Results Section ── */

function ResultsSection({
  title,
  icon: Icon,
  items,
  startRank = 1,
}: {
  title: string;
  icon: typeof BookOpen;
  items: EvidenceItem[];
  startRank?: number;
}) {
  if (items.length === 0) return null;
  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-4">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {title}
        </span>
        <Badge variant="secondary" className="text-xs ml-1">{items.length}</Badge>
      </div>
      <div className="space-y-3">
        {items.map((item, idx) => (
          <EvidenceCard key={item.chunk_id} item={item} rank={startRank + idx} />
        ))}
      </div>
    </div>
  );
}

/* ── Main Page ── */

export default function Retrieve() {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { query: storedQuery, status, result, error, search, reset, refine, refining, activeRefinementMode, baseResult } = useRetrieve();
  const [query, setQuery] = useState(storedQuery);
  const [showEval, setShowEval] = useState(false);
  // Hydrate refinement UI state: if we already have results from sessionStorage,
  // don't show the initial prompt again — treat as confirmed.
  const [refinementUIState, setRefinementUIState] = useState<RefinementUIState>(
    () => (status === "success" || status === "no_results") && result ? "confirmed" : "initial_prompt"
  );

  const handleExampleClick = useCallback((description: string) => {
    setQuery(description);
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(description.length, description.length);
      }
    });
  }, []);

  const handleSearch = useCallback(() => {
    if (query.trim()) {
      setRefinementUIState("initial_prompt");
      search(query);
    }
  }, [query, search]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSearch();
    }
  }, [handleSearch]);

  const handleNewSearch = useCallback(() => {
    setQuery("");
    reset();
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [reset]);

  // Use result directly — refinement is now backend-powered via the hook
  const strongEvidence = result?.strong_evidence ?? [];
  const supportingMaterials = result?.supporting_materials ?? [];

  const isLoading = status === "loading";
  const hasResults = status === "success" || status === "no_results" || status === "clarification_needed";
  const showEmptyState = status === "idle";

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
        <div className="w-full max-w-2xl mb-8">
          <div className="relative rounded-xl border border-border bg-card shadow-sm">
            <Textarea
              ref={textareaRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Paste text from a notice, letter, or form — or ask a source-backed question"
              className="min-h-[120px] resize-none border-0 bg-transparent px-5 pt-5 pb-14 text-base placeholder:text-muted-foreground/60 focus-visible:ring-0 focus-visible:ring-offset-0"
              aria-label="Retrieve search input"
              disabled={isLoading}
            />
            <div className="absolute bottom-3 right-3 flex items-center gap-2">
              {hasResults && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={handleNewSearch}
                  className="text-muted-foreground"
                >
                  Clear
                </Button>
              )}
              <Button
                size="sm"
                disabled={!query.trim() || isLoading}
                className="gap-2"
                aria-label="Search trusted sources"
                onClick={handleSearch}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Searching…
                  </>
                ) : (
                  <>
                    <Search className="h-4 w-4" />
                    Search sources
                  </>
                )}
              </Button>
            </div>
          </div>
          {!isLoading && !hasResults && (
            <p className="text-xs text-muted-foreground mt-2 text-center">
              Press <kbd className="px-1 py-0.5 bg-secondary rounded text-xs font-mono">⌘ Enter</kbd> to search
            </p>
          )}
        </div>

        {/* Loading state */}
        {isLoading && (
          <div className="w-full max-w-2xl mb-10">
            <div className="flex items-center gap-3 mb-6">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              <span className="text-sm text-muted-foreground">Retrieving relevant materials…</span>
            </div>
            <div className="space-y-3">
              {[1, 2, 3].map(i => (
                <div key={i} className="rounded-lg border border-border bg-card px-5 py-4">
                  <div className="flex items-center gap-3 mb-3">
                    <Skeleton className="h-6 w-6 rounded-full" />
                    <Skeleton className="h-4 w-48" />
                  </div>
                  <div className="ml-9 space-y-2">
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-5/6" />
                    <Skeleton className="h-3 w-4/6" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error state */}
        {status === "error" && (
          <div className="w-full max-w-2xl mb-10">
            <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-5 py-4">
              <AlertCircle className="h-5 w-5 text-destructive mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground mb-1">Search failed</p>
                <p className="text-sm text-muted-foreground">
                  {error ?? "An unexpected error occurred. Please try again."}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Clarification needed state */}
        {status === "clarification_needed" && result && (
          <div className="w-full max-w-2xl mb-10">
            <div className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 px-5 py-4">
              <HelpCircle className="h-5 w-5 text-primary mt-0.5 flex-shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground mb-1">More detail needed</p>
                <p className="text-sm text-muted-foreground leading-relaxed">
                  {result.clarification_question}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Results state */}
        {hasResults && result && status !== "clarification_needed" && (
          <div className="w-full max-w-2xl">
            {/* Failure/weak match notice */}
            {result.failure_message && result.strong_evidence.length === 0 && result.supporting_materials.length === 0 && (
              <div className="flex items-start gap-3 rounded-lg border border-border bg-secondary/50 px-5 py-4 mb-8">
                <FileSearch className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm text-foreground">{result.failure_message}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Try rephrasing your question or pasting the exact text you need help understanding.
                  </p>
                </div>
              </div>
            )}

            {/* Partial match notice */}
            {result.failure_state === "no_direct_excerpt" && result.supporting_materials.length > 0 && (
              <div className="flex items-start gap-3 rounded-lg border border-border bg-secondary/50 px-5 py-4 mb-6">
                <FileSearch className="h-5 w-5 text-muted-foreground mt-0.5 flex-shrink-0" />
                <p className="text-sm text-muted-foreground">
                  No excerpt directly addresses this question, but related materials were found.
                </p>
              </div>
            )}

            {/* Refinement module — between search and results */}
            {(result.strong_evidence.length > 0 || result.supporting_materials.length > 0) && (
              <ResultsRefinement
                query={storedQuery}
                strongEvidence={baseResult?.strong_evidence ?? result.strong_evidence}
                supportingMaterials={baseResult?.supporting_materials ?? result.supporting_materials}
                hints={baseResult?.refinement_hints ?? result.refinement_hints ?? null}
                activeMode={activeRefinementMode}
                refining={refining}
                uiState={refinementUIState}
                onUIStateChange={setRefinementUIState}
                onRefine={refine}
              />
            )}

            {/* Strong evidence */}
            <ResultsSection
              title="Strong Evidence"
              icon={BookOpen}
              items={strongEvidence}
              startRank={1}
            />

            {/* Supporting materials */}
            <ResultsSection
              title="Supporting Materials"
              icon={FileText}
              items={supportingMaterials}
              startRank={strongEvidence.length + 1}
            />

            {/* Trust footer */}
            {(strongEvidence.length > 0 || supportingMaterials.length > 0) && (
              <div className="flex items-start gap-3 rounded-lg border border-border bg-secondary/30 px-5 py-4 mt-4">
                <Quote className="h-4 w-4 text-muted-foreground mt-0.5 flex-shrink-0" />
                <p className="text-xs text-muted-foreground leading-relaxed">
                  All results are drawn from your organization's knowledge base.
                  Verify excerpts against original sources before relying on them.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Empty state (idle) */}
        {showEmptyState && (
          <>
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
              <div className="rounded-lg border border-border bg-card px-5 py-5 mb-3">
                <div className="flex items-center gap-2 mb-3">
                  <BookOpen className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Strong Evidence</span>
                </div>
                <Skeleton className="h-4 w-full mb-2" />
                <Skeleton className="h-4 w-5/6 mb-2" />
                <Skeleton className="h-4 w-4/6" />
              </div>
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
              <div className="rounded-lg border border-border bg-card px-5 py-5">
                <div className="flex items-center gap-2 mb-3">
                  <FileText className="h-4 w-4 text-muted-foreground" />
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Supporting Materials</span>
                </div>
                <div className="flex gap-3">
                  <Skeleton className="h-16 flex-1 rounded-md" />
                  <Skeleton className="h-16 flex-1 rounded-md" />
                </div>
              </div>
            </div>
          </>
        )}
        {/* Dev-only eval harness toggle */}
        {IS_DEV && RetrieveEvalPanel && (
          <div className="w-full max-w-4xl mt-8">
            <Button
              size="sm"
              variant="ghost"
              className="text-xs text-muted-foreground"
              onClick={() => setShowEval(!showEval)}
            >
              <FlaskConical className="w-3.5 h-3.5 mr-1" />
              {showEval ? "Hide" : "Show"} Eval Harness
            </Button>
            {showEval && (
              <Suspense fallback={<p className="text-xs text-muted-foreground p-4">Loading eval harness...</p>}>
                <div className="mt-3 border border-border rounded-lg p-4 bg-muted/20">
                  <RetrieveEvalPanel />
                </div>
              </Suspense>
            )}
          </div>
        )}
      </div>
    </DashboardLayout>
  );
}
