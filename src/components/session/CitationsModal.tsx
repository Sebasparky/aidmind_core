import { useState, useEffect, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  BookOpen,
  FileText,
  ChevronDown,
  ChevronUp,
  Loader2,
  AlertTriangle,
  Copy,
  Check,
  Layers,
  MapPin,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface SnippetDetail {
  snippetId: string;
  chunkText: string;
  chunkIndex: number;
  headingPath: string | null;
  documentId: string;
  documentTitle: string;
  documentSource: string | null;
  similarity: number | null;
  rank: number | null;
}

interface CitationsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  citations: string[];
  questionText: string;
  sessionDbId: string;
}

const PREVIEW_CHAR_LIMIT = 500;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Try to highlight keywords from the question within the snippet text.
 * Returns JSX with <mark> tags around matched terms.
 */
function highlightOverlap(snippet: string, question: string): React.ReactNode {
  if (!snippet || !question) return snippet;

  // Extract meaningful words from question (>4 chars, not generic)
  const GENERIC = new Set([
    "what", "when", "where", "which", "does", "have", "been", "this", "that",
    "with", "from", "your", "about", "into", "they", "their", "there", "were",
    "will", "would", "could", "should", "other", "first", "last", "most", "more",
    "than", "each", "some", "also", "currently", "specific", "please", "describe",
    "explain", "provide", "information", "details", "related", "involved", "during",
    "before", "after", "between", "through", "under",
  ]);

  const questionWords = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((w) => w.length > 4 && !GENERIC.has(w));

  if (questionWords.length === 0) return snippet;

  // Build a regex from question keywords
  const stems = questionWords.map((w) =>
    w.replace(/(?:ing|tion|sion|ment|ness|ies|ive|ous|ful|able|ible|ity|ally|ed|er|ly|es|s)$/, "")
  ).filter((s) => s.length >= 3);

  if (stems.length === 0) return snippet;

  const uniqueStems = [...new Set(stems)].slice(0, 12);
  const pattern = new RegExp(`\\b(${uniqueStems.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})\\w*\\b`, "gi");

  const parts: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let matchCount = 0;

  while ((match = pattern.exec(snippet)) !== null && matchCount < 20) {
    if (match.index > lastIndex) {
      parts.push(snippet.slice(lastIndex, match.index));
    }
    parts.push(
      <mark
        key={`m-${match.index}`}
        className="bg-primary/15 text-foreground rounded-sm px-0.5"
      >
        {match[0]}
      </mark>
    );
    lastIndex = pattern.lastIndex;
    matchCount++;
  }

  if (lastIndex < snippet.length) {
    parts.push(snippet.slice(lastIndex));
  }

  return parts.length > 1 ? <>{parts}</> : snippet;
}

export function CitationsModal({
  open,
  onOpenChange,
  citations,
  questionText,
  sessionDbId,
}: CitationsModalProps) {
  const [snippets, setSnippets] = useState<SnippetDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [virtualCitations, setVirtualCitations] = useState<string[]>([]);
  const [resolutionNote, setResolutionNote] = useState<string | null>(null);

  // Separate real and virtual citations
  const realCitations = useMemo(
    () => citations.filter((c) => UUID_RE.test(c)),
    [citations]
  );
  const templateCitations = useMemo(
    () => citations.filter((c) => !UUID_RE.test(c)),
    [citations]
  );

  useEffect(() => {
    if (!open) return;
    // Reset state
    setSnippets([]);
    setVirtualCitations([]);
    setResolutionNote(null);
    setError(null);

    if (realCitations.length === 0) {
      // All citations are virtual (TEMPLATE) — no fetch needed
      setVirtualCitations(templateCitations);
      return;
    }
    fetchSnippets();
  }, [open, citations, sessionDbId]);

  async function fetchSnippets() {
    setLoading(true);
    setError(null);

    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        "get-citation-details",
        { body: { session_id: sessionDbId, citation_ids: realCitations } }
      );

      if (fnError) {
        console.error("[CitationsModal] Edge function error:", fnError);
        setError(null); // Don't show scary error
        return;
      }

      if (data?.resolution_note) {
        setResolutionNote(data.resolution_note);
      }

      if (data?.virtual_citations) {
        setVirtualCitations([...templateCitations, ...data.virtual_citations]);
      } else {
        setVirtualCitations(templateCitations);
      }

      setSnippets(data?.snippets ?? []);
    } catch (err) {
      console.error("[CitationsModal] fetch error:", err);
      setError("Could not connect to citation service. Try again in a moment.");
    } finally {
      setLoading(false);
    }
  }

  function toggleExpand(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function copyText(text: string, id: string) {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  // Find unresolved real citation IDs
  const resolvedIds = new Set(snippets.map((s) => s.snippetId));
  const unresolvedCitations = realCitations.filter((c) => !resolvedIds.has(c));

  const hasTemplateGrounding = templateCitations.length > 0 || virtualCitations.includes("TEMPLATE");
  const hasResolvedSnippets = snippets.length > 0 && snippets.some((s) => !!s.chunkText);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[680px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            Citation Inspector
          </DialogTitle>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Verify how this question is grounded in policy sources
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-5 pr-1">
          {/* Generated question */}
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
              Generated Question
            </p>
            <p className="text-sm text-foreground leading-relaxed">{questionText}</p>
            <p className="text-[10px] text-muted-foreground mt-2.5 leading-relaxed">
              This question was grounded in the following policy text
              {hasTemplateGrounding && " and template structure"}.
            </p>
          </div>

          <Separator />

          {/* Loading */}
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 text-primary animate-spin mr-2" />
              <span className="text-sm text-muted-foreground">
                Loading source details…
              </span>
            </div>
          )}

          {/* Network error */}
          {!loading && error && (
            <div className="flex items-center gap-2 p-3.5 rounded-md border border-border bg-muted/30">
              <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0" />
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          )}

          {/* Template-grounded notice */}
          {!loading && hasTemplateGrounding && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-4">
              <div className="flex items-start gap-3">
                <Layers className="h-4 w-4 text-primary mt-0.5 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Template-grounded question
                  </p>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    This question is driven by the template structure — the form
                    itself requires this information to be collected. The template
                    section defines what to ask about, while policy snippets
                    {hasResolvedSnippets
                      ? " below provide additional compliance context."
                      : " provide supporting context when available."}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Resolved snippet cards */}
          {!loading && snippets.length > 0 && (
            <div className="space-y-4">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                Supporting Policy Sources ({snippets.length})
              </p>

              {snippets.map((snippet, idx) => {
                const isExpanded = expandedIds.has(snippet.snippetId);
                const hasText = !!snippet.chunkText;
                const isLong =
                  hasText && snippet.chunkText.length > PREVIEW_CHAR_LIMIT;
                const displayText =
                  isLong && !isExpanded
                    ? snippet.chunkText.slice(0, PREVIEW_CHAR_LIMIT) + "…"
                    : snippet.chunkText;

                return (
                  <div
                    key={snippet.snippetId}
                    className="rounded-lg border border-border bg-card overflow-hidden"
                  >
                    {/* Document title + heading */}
                    <div className="px-4 py-3 bg-muted/20 border-b border-border">
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-primary shrink-0" />
                        <span className="text-sm font-medium text-foreground truncate flex-1">
                          {snippet.documentTitle}
                        </span>
                        <Badge
                          variant="outline"
                          className="text-[10px] font-mono shrink-0"
                        >
                          Source {idx + 1}
                        </Badge>
                      </div>
                      {snippet.headingPath && (
                        <div className="flex items-center gap-1.5 mt-1.5 ml-6">
                          <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="text-xs text-muted-foreground truncate">
                            {snippet.headingPath}
                          </span>
                        </div>
                      )}
                      {!snippet.headingPath && snippet.chunkIndex != null && (
                        <div className="flex items-center gap-1.5 mt-1.5 ml-6">
                          <MapPin className="h-3 w-3 text-muted-foreground shrink-0" />
                          <span className="text-xs text-muted-foreground">
                            Section {snippet.chunkIndex + 1}
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Excerpt block — the main content */}
                    <div className="px-4 py-4">
                      {hasText ? (
                        <>
                          <div
                            className={cn(
                              "text-sm leading-[1.7] text-foreground/90 whitespace-pre-wrap",
                              "bg-muted/30 rounded-md p-3.5",
                              "border-l-3 border-primary/25"
                            )}
                          >
                            {highlightOverlap(displayText, questionText)}
                          </div>

                          {isLong && (
                            <button
                              onClick={() => toggleExpand(snippet.snippetId)}
                              className="flex items-center gap-1 text-[11px] text-primary hover:underline mt-2.5"
                            >
                              {isExpanded ? (
                                <>
                                  <ChevronUp className="h-3 w-3" /> Show less
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="h-3 w-3" /> Show full
                                  excerpt
                                </>
                              )}
                            </button>
                          )}
                        </>
                      ) : (
                        <div className="bg-muted/20 rounded-md p-3.5 text-center">
                          <p className="text-sm text-muted-foreground">
                            Excerpt text could not be retrieved
                          </p>
                          <p className="text-[10px] text-muted-foreground mt-1">
                            The source chunk reference exists but the snippet
                            content was not stored or has since been updated.
                          </p>
                        </div>
                      )}
                    </div>

                    {/* Compact metadata footer */}
                    <div className="flex items-center gap-3 px-4 py-2 bg-muted/10 border-t border-border text-[10px] text-muted-foreground">
                      {snippet.rank != null && (
                        <span>Relevance rank {snippet.rank}</span>
                      )}
                      {snippet.similarity != null && (
                        <span>
                          {(snippet.similarity * 100).toFixed(0)}% similarity
                        </span>
                      )}
                      {hasText && (
                        <button
                          onClick={() =>
                            copyText(snippet.chunkText, snippet.snippetId)
                          }
                          className="ml-auto hover:text-foreground transition-colors flex items-center gap-1"
                          title="Copy excerpt"
                        >
                          {copiedId === snippet.snippetId ? (
                            <>
                              <Check className="h-3 w-3 text-primary" /> Copied
                            </>
                          ) : (
                            <>
                              <Copy className="h-3 w-3" /> Copy
                            </>
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Unresolved real citations — with precise explanation */}
          {!loading && unresolvedCitations.length > 0 && (
            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
                Unresolved References ({unresolvedCitations.length})
              </p>
              <div className="rounded-md border border-border bg-muted/10 p-3.5">
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {resolutionNote === "no_policy_pack"
                    ? "The session's policy pack has not been compiled yet. Citation details will be available after the policy pack is generated."
                    : `${unresolvedCitations.length} citation reference${unresolvedCitations.length > 1 ? "s" : ""} could not be matched to the current policy pack. This can happen if the policy pack was recompiled after guidance was generated, or if source documents were updated.`}
                </p>
              </div>
            </div>
          )}

          {/* Completely empty state — no snippets, no template, no unresolved */}
          {!loading &&
            !error &&
            snippets.length === 0 &&
            unresolvedCitations.length === 0 &&
            !hasTemplateGrounding && (
              <div className="py-8 text-center space-y-3">
                <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center mx-auto">
                  <BookOpen className="h-5 w-5 text-muted-foreground/40" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    Source details not available
                  </p>
                  <p className="text-xs text-muted-foreground mt-1.5 max-w-sm mx-auto leading-relaxed">
                    Citation metadata exists for this question but source text
                    could not be retrieved. This can happen if the policy pack
                    has not been compiled, or if source documents were updated
                    after guidance was generated.
                  </p>
                </div>
              </div>
            )}

          {/* Trust footer */}
          {!loading && (hasResolvedSnippets || hasTemplateGrounding) && (
            <p className="text-[10px] text-muted-foreground leading-relaxed pb-1">
              Compare the source text above with the generated question to verify
              grounding. Edit or discard questions that are not adequately
              supported by the policy excerpts shown.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
