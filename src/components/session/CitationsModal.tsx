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
  Info,
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

function highlightOverlap(snippet: string, question: string): React.ReactNode {
  if (!snippet || !question) return snippet;

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

  const stems = questionWords
    .map((w) =>
      w.replace(
        /(?:ing|tion|sion|ment|ness|ies|ive|ous|ful|able|ible|ity|ally|ed|er|ly|es|s)$/,
        ""
      )
    )
    .filter((s) => s.length >= 3);

  if (stems.length === 0) return snippet;

  const uniqueStems = [...new Set(stems)].slice(0, 12);
  const pattern = new RegExp(
    `\\b(${uniqueStems
      .map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|")})\\w*\\b`,
    "gi"
  );

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
        className="bg-primary/12 text-foreground rounded-sm px-0.5"
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

/* ─── Evidence Card ─── */

function EvidenceCard({
  snippet,
  index,
  questionText,
  isExpanded,
  onToggleExpand,
  copiedId,
  onCopy,
}: {
  snippet: SnippetDetail;
  index: number;
  questionText: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
  copiedId: string | null;
  onCopy: (text: string, id: string) => void;
}) {
  const hasText = !!snippet.chunkText;
  const isLong = hasText && snippet.chunkText.length > PREVIEW_CHAR_LIMIT;
  const displayText =
    isLong && !isExpanded
      ? snippet.chunkText.slice(0, PREVIEW_CHAR_LIMIT) + "…"
      : snippet.chunkText;

  return (
    <div className="rounded-lg border border-border bg-card overflow-hidden">
      {/* Header: document title + heading */}
      <div className="px-4 py-3 bg-muted/20 border-b border-border">
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary shrink-0" />
          <span className="text-sm font-medium text-foreground truncate flex-1">
            {snippet.documentTitle}
          </span>
          <Badge variant="outline" className="text-[10px] font-mono shrink-0">
            Source {index + 1}
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

      {/* Excerpt — the focal point */}
      <div className="px-4 py-4">
        {hasText ? (
          <>
            <div
              className={cn(
                "text-sm leading-[1.75] text-foreground/90 whitespace-pre-wrap",
                "bg-muted/25 rounded-md p-4",
                "border-l-[3px] border-primary/20"
              )}
            >
              {highlightOverlap(displayText, questionText)}
            </div>
            {isLong && (
              <button
                onClick={onToggleExpand}
                className="flex items-center gap-1 text-[11px] text-primary hover:underline mt-2.5"
              >
                {isExpanded ? (
                  <>
                    <ChevronUp className="h-3 w-3" /> Show less
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3 w-3" /> Show full excerpt
                  </>
                )}
              </button>
            )}
          </>
        ) : (
          <div className="rounded-md border border-border bg-muted/10 p-3.5">
            <p className="text-xs text-muted-foreground leading-relaxed">
              Citation resolved, but excerpt text is missing from stored source
              data. The source chunk reference exists but the content was not
              persisted or has since been updated.
            </p>
          </div>
        )}
      </div>

      {/* Metadata footer */}
      <div className="flex items-center gap-3 px-4 py-2 bg-muted/10 border-t border-border text-[10px] text-muted-foreground">
        {snippet.rank != null && <span>Rank {snippet.rank}</span>}
        {snippet.similarity != null && (
          <span>{(snippet.similarity * 100).toFixed(0)}% similarity</span>
        )}
        {hasText && (
          <button
            onClick={() => onCopy(snippet.chunkText, snippet.snippetId)}
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
}

/* ─── Main Modal ─── */

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
  const [resolutionNote, setResolutionNote] = useState<string | null>(null);

  const realCitations = useMemo(
    () => citations.filter((c) => UUID_RE.test(c)),
    [citations]
  );
  const hasTemplateCitation = useMemo(
    () => citations.some((c) => !UUID_RE.test(c)),
    [citations]
  );

  useEffect(() => {
    if (!open) return;
    setSnippets([]);
    setResolutionNote(null);
    setError(null);
    setExpandedIds(new Set());

    if (realCitations.length > 0) {
      fetchSnippets();
    }
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
        return;
      }

      if (data?.resolution_note) setResolutionNote(data.resolution_note);
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
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  async function copyText(text: string, id: string) {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  // Derived state
  const resolvedIds = new Set(snippets.map((s) => s.snippetId));
  const unresolvedCitations = realCitations.filter((c) => !resolvedIds.has(c));
  const snippetsWithText = snippets.filter((s) => !!s.chunkText);
  const snippetsWithoutText = snippets.filter((s) => !s.chunkText);
  const hasPolicyEvidence = snippetsWithText.length > 0;
  const isTemplateOnly = hasTemplateCitation && !hasPolicyEvidence && unresolvedCitations.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[85vh] flex flex-col">
        <DialogHeader className="pb-0">
          <DialogTitle className="text-base flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            Citation Inspector
          </DialogTitle>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Verify exactly what grounded this generated question
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-5 pr-1 mt-3">
          {/* ── Generated Question ── */}
          <div className="rounded-lg border border-border bg-muted/30 p-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-2">
              Generated Question
            </p>
            <p className="text-sm text-foreground leading-relaxed">
              {questionText}
            </p>
          </div>

          <Separator />

          {/* ── Loading ── */}
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 text-primary animate-spin mr-2" />
              <span className="text-sm text-muted-foreground">
                Resolving citation sources…
              </span>
            </div>
          )}

          {/* ── System error ── */}
          {!loading && error && (
            <div className="flex items-center gap-2 p-3.5 rounded-md border border-border bg-muted/30">
              <AlertTriangle className="h-4 w-4 text-muted-foreground shrink-0" />
              <p className="text-sm text-muted-foreground">{error}</p>
            </div>
          )}

          {/* ═══════════════════════════════════════════
              SECTION A — Policy Evidence
              ═══════════════════════════════════════════ */}
          {!loading && hasPolicyEvidence && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-foreground uppercase tracking-wider">
                  Policy Evidence
                </p>
                <Badge variant="secondary" className="text-[10px]">
                  {snippetsWithText.length} excerpt
                  {snippetsWithText.length !== 1 ? "s" : ""}
                </Badge>
              </div>

              <div className="space-y-4">
                {snippetsWithText.map((snippet, idx) => (
                  <EvidenceCard
                    key={snippet.snippetId}
                    snippet={snippet}
                    index={idx}
                    questionText={questionText}
                    isExpanded={expandedIds.has(snippet.snippetId)}
                    onToggleExpand={() => toggleExpand(snippet.snippetId)}
                    copiedId={copiedId}
                    onCopy={copyText}
                  />
                ))}
              </div>

              {/* Resolved but text-empty citations */}
              {snippetsWithoutText.length > 0 && (
                <div className="rounded-md border border-border bg-muted/10 p-3">
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {snippetsWithoutText.length} additional citation
                    {snippetsWithoutText.length > 1 ? "s" : ""} resolved
                    successfully, but excerpt text is missing from stored source
                    data. The chunk references exist but content was not
                    persisted or has since been updated.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* No policy evidence notice — only when real citations existed but none resolved with text */}
          {!loading &&
            !error &&
            !hasPolicyEvidence &&
            realCitations.length > 0 &&
            snippetsWithoutText.length === 0 &&
            unresolvedCitations.length > 0 && (
              <div className="rounded-md border border-border bg-muted/10 p-4">
                <p className="text-xs font-semibold text-foreground uppercase tracking-wider mb-2">
                  Policy Evidence
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  No retrievable policy excerpt is available for this question.
                  The citation references could not be matched to the current
                  policy pack.
                </p>
              </div>
            )}

          {/* ═══════════════════════════════════════════
              SECTION B — Template Contribution
              ═══════════════════════════════════════════ */}
          {!loading && hasTemplateCitation && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-foreground uppercase tracking-wider">
                Template Contribution
              </p>
              <div className="rounded-lg border border-border bg-muted/10 p-4">
                <div className="flex items-start gap-3">
                  <Layers className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="space-y-1.5">
                    <p className="text-sm text-foreground">
                      {isTemplateOnly
                        ? "This question is currently supported by template structure only."
                        : "This question is also required by the template structure."}
                    </p>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      The form structure indicates this information should be
                      collected. Template structure defines what to ask about,
                      but is not the same as a retrievable policy excerpt.
                    </p>
                    {isTemplateOnly && (
                      <p className="text-xs text-muted-foreground leading-relaxed mt-1">
                        No retrievable policy excerpt is available for this
                        question. The question exists because the template
                        expects this information to be gathered during the
                        interview.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ═══════════════════════════════════════════
              SECTION C — Unresolved References
              ═══════════════════════════════════════════ */}
          {!loading && unresolvedCitations.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-semibold text-foreground uppercase tracking-wider">
                Unresolved References
              </p>
              <div className="rounded-md border border-border bg-muted/10 p-3.5">
                <div className="flex items-start gap-2.5">
                  <Info className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                  <div>
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {resolutionNote === "no_policy_pack"
                        ? "The session's policy pack has not been compiled yet. Citation details will become available after the policy pack is generated."
                        : `${unresolvedCitations.length} citation reference${
                            unresolvedCitations.length > 1 ? "s" : ""
                          } could not be matched to the current policy pack. This typically occurs when the policy pack was recompiled after guidance was generated, or when source documents were updated since the last compilation.`}
                    </p>
                    {unresolvedCitations.length <= 3 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {unresolvedCitations.map((cit) => (
                          <Badge
                            key={cit}
                            variant="outline"
                            className="text-[9px] font-mono text-muted-foreground"
                          >
                            {cit.slice(0, 8)}…
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Complete failure state ── */}
          {!loading &&
            !error &&
            !hasPolicyEvidence &&
            !hasTemplateCitation &&
            unresolvedCitations.length === 0 &&
            snippetsWithoutText.length === 0 && (
              <div className="py-8 text-center space-y-3">
                <div className="h-10 w-10 rounded-xl bg-muted/50 flex items-center justify-center mx-auto">
                  <BookOpen className="h-5 w-5 text-muted-foreground/40" />
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">
                    No citation data available
                  </p>
                  <p className="text-xs text-muted-foreground mt-1.5 max-w-sm mx-auto leading-relaxed">
                    This question has no associated citation references. This
                    can happen if the policy pack was not compiled, if citation
                    metadata was not generated, or if source documents were
                    updated after guidance was produced.
                  </p>
                </div>
              </div>
            )}

          {/* ── Verification footer ── */}
          {!loading && hasPolicyEvidence && (
            <p className="text-[10px] text-muted-foreground leading-relaxed pb-1">
              Compare the policy excerpt{snippetsWithText.length > 1 ? "s" : ""}{" "}
              above with the generated question to verify grounding. Edit or
              discard questions that are not adequately supported.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
