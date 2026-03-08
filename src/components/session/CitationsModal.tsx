import { useState, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { BookOpen, FileText, ChevronDown, ChevronUp, Loader2, AlertTriangle, Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";

interface SnippetDetail {
  snippetId: string;
  chunkText: string;
  chunkIndex: number;
  documentId: string;
  documentTitle: string;
  similarity: number | null;
  rank: number | null;
}

interface CitationsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  citations: string[];
  questionText: string;
  sessionDbId: string; // sessions.id (UUID) for querying
}

const PREVIEW_CHAR_LIMIT = 400;

export function CitationsModal({ open, onOpenChange, citations, questionText, sessionDbId }: CitationsModalProps) {
  const [snippets, setSnippets] = useState<SnippetDetail[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);

  useEffect(() => {
    if (!open || citations.length === 0) return;
    fetchSnippets();
  }, [open, citations, sessionDbId]);

  async function fetchSnippets() {
    setLoading(true);
    setError(null);
    setSnippets([]);

    try {
      const { data, error: fnError } = await supabase.functions.invoke(
        "get-citation-details",
        { body: { session_id: sessionDbId, citation_ids: citations } },
      );

      if (fnError) throw fnError;

      if (!data || (!data.snippets?.length && !data.unresolved?.length)) {
        setError("Citation details could not be resolved");
        return;
      }

      setSnippets(data.snippets ?? []);
    } catch (err) {
      console.error("[CitationsModal] fetch error:", err);
      setError("Failed to load citation details");
    } finally {
      setLoading(false);
    }
  }

  function toggleExpand(id: string) {
    setExpandedIds(prev => {
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

  // Find unresolved citation IDs
  const resolvedIds = new Set(snippets.map(s => s.snippetId));
  const unresolvedCitations = citations.filter(c => !resolvedIds.has(c));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[640px] max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            Citation Inspector
          </DialogTitle>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Verify that this question is grounded in policy sources
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-5 pr-1">
          {/* Generated question */}
          <div className="rounded-md border border-border bg-muted/30 p-3.5">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1.5">
              Generated Question
            </p>
            <p className="text-sm text-foreground leading-relaxed">{questionText}</p>
          </div>

          <Separator />

          {/* Sources header */}
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
              Policy Sources ({citations.length})
            </p>
            {!loading && snippets.length > 0 && (
              <Badge variant="secondary" className="text-[10px]">
                {new Set(snippets.map(s => s.documentId)).size} document{new Set(snippets.map(s => s.documentId)).size !== 1 ? "s" : ""}
              </Badge>
            )}
          </div>

          {/* Loading state */}
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 text-primary animate-spin mr-2" />
              <span className="text-sm text-muted-foreground">Loading source details…</span>
            </div>
          )}

          {/* Error state */}
          {!loading && error && (
            <div className="flex items-center gap-2 p-3.5 rounded-md border border-destructive/20 bg-destructive/5">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
              <p className="text-sm text-destructive">{error}</p>
            </div>
          )}

          {/* Snippet cards */}
          {!loading && snippets.length > 0 && (
            <div className="space-y-3">
              {snippets.map((snippet, idx) => {
                const isExpanded = expandedIds.has(snippet.snippetId);
                const isLong = snippet.chunkText.length > PREVIEW_CHAR_LIMIT;
                const displayText = isLong && !isExpanded
                  ? snippet.chunkText.slice(0, PREVIEW_CHAR_LIMIT) + "…"
                  : snippet.chunkText;

                return (
                  <div
                    key={snippet.snippetId}
                    className="rounded-lg border border-border bg-card overflow-hidden"
                  >
                    {/* Source header */}
                    <div className="flex items-center gap-2 px-3.5 py-2.5 bg-muted/20 border-b border-border">
                      <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="text-xs font-medium text-foreground truncate flex-1">
                        {snippet.documentTitle}
                      </span>
                      <Badge variant="outline" className="text-[10px] font-mono shrink-0">
                        Source {idx + 1}
                      </Badge>
                    </div>

                    {/* Snippet text */}
                    <div className="px-3.5 py-3">
                      {snippet.chunkText ? (
                        <div
                          className={cn(
                            "text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap",
                            "border-l-2 border-primary/30 pl-3"
                          )}
                        >
                          {displayText}
                        </div>
                      ) : (
                        <p className="text-sm text-muted-foreground italic">
                          Source text unavailable
                        </p>
                      )}

                      {isLong && (
                        <button
                          onClick={() => toggleExpand(snippet.snippetId)}
                          className="flex items-center gap-1 text-[11px] text-primary hover:underline mt-2"
                        >
                          {isExpanded ? (
                            <><ChevronUp className="h-3 w-3" /> Show less</>
                          ) : (
                            <><ChevronDown className="h-3 w-3" /> Show full snippet</>
                          )}
                        </button>
                      )}
                    </div>

                    {/* Metadata footer */}
                    <div className="flex items-center gap-3 px-3.5 py-2 bg-muted/10 border-t border-border text-[10px] text-muted-foreground">
                      <span className="font-mono">
                        Chunk #{snippet.chunkIndex}
                      </span>
                      {snippet.rank != null && (
                        <span>Rank {snippet.rank}</span>
                      )}
                      {snippet.similarity != null && (
                        <span>Similarity {(snippet.similarity * 100).toFixed(0)}%</span>
                      )}
                      <span className="font-mono truncate max-w-[120px]" title={snippet.snippetId}>
                        {snippet.snippetId.slice(0, 8)}…
                      </span>
                      <button
                        onClick={() => copyText(snippet.chunkText, snippet.snippetId)}
                        className="ml-auto hover:text-foreground transition-colors"
                        title="Copy snippet text"
                      >
                        {copiedId === snippet.snippetId ? (
                          <Check className="h-3 w-3 text-primary" />
                        ) : (
                          <Copy className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Unresolved citations */}
          {!loading && unresolvedCitations.length > 0 && (
            <div className="space-y-2">
              {unresolvedCitations.map(cit => (
                <div key={cit} className="flex items-center gap-2 p-2.5 rounded-md border border-border bg-muted/10">
                  <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <Badge variant="outline" className="text-[10px] font-mono">
                    {cit.slice(0, 12)}…
                  </Badge>
                  <span className="text-[10px] text-muted-foreground">
                    Source text unavailable
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Trust note */}
          {!loading && snippets.length > 0 && (
            <p className="text-[10px] text-muted-foreground leading-relaxed">
              These excerpts are from the session's compiled policy pack. Compare the source text
              above with the generated question to verify grounding. Edit or discard questions
              that are not adequately supported.
            </p>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
