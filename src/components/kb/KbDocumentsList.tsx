/**
 * KbDocumentsList — Shows KB documents with ingestion status, chunk counts, and retry actions.
 */

import { useState } from "react";
import { useKbDocuments, type IngestionStatus } from "@/hooks/useKbDocuments";
import { supabase } from "@/integrations/supabase/client";
import { kickExtractor } from "@/lib/kb/kbUploadService";
import { useTenant } from "@/hooks/useTenant";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  CheckCircle2,
  AlertCircle,
  Clock,
  Loader2,
  RefreshCw,
  FileText,
  Database,
  RotateCcw,
} from "lucide-react";

const STATUS_MAP: Record<
  IngestionStatus,
  { label: string; variant: "default" | "secondary" | "destructive" | "outline"; icon: React.ReactNode }
> = {
  uploaded: { label: "Uploaded", variant: "secondary", icon: <Clock className="h-3 w-3" /> },
  queued: { label: "Queued", variant: "secondary", icon: <Clock className="h-3 w-3" /> },
  extracting: { label: "Extracting…", variant: "outline", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  extracted: { label: "Extracted", variant: "outline", icon: <Clock className="h-3 w-3" /> },
  chunking: { label: "Chunking…", variant: "outline", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  embedding: { label: "Embedding…", variant: "outline", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  indexing: { label: "Indexing…", variant: "outline", icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  ready: { label: "Ready", variant: "default", icon: <CheckCircle2 className="h-3 w-3" /> },
  failed: { label: "Failed", variant: "destructive", icon: <AlertCircle className="h-3 w-3" /> },
  indexing_failed: { label: "Indexing Failed", variant: "destructive", icon: <AlertCircle className="h-3 w-3" /> },
  needs_review: { label: "Needs Review", variant: "destructive", icon: <AlertCircle className="h-3 w-3" /> },
  unknown: { label: "Unknown", variant: "secondary", icon: <Clock className="h-3 w-3" /> },
};

function isRetryable(status: IngestionStatus): boolean {
  return ["failed", "indexing_failed", "needs_review", "uploaded", "queued", "extracted", "unknown"].includes(status);
}

function isProcessing(status: IngestionStatus): boolean {
  return ["extracting", "chunking", "embedding", "indexing"].includes(status);
}

export default function KbDocumentsList() {
  const { documents, loading, error, refresh } = useKbDocuments();
  const { tenant } = useTenant();
  const [retrying, setRetrying] = useState<string | null>(null);

  const handleRetry = async (docId: string) => {
    if (!tenant?.tenantId) return;
    setRetrying(docId);
    try {
      // Reset ingestion status
      const { data: doc } = await supabase
        .from("kb_documents")
        .select("metadata")
        .eq("id", docId)
        .single();

      const meta = ((doc?.metadata as any) || {});
      meta.ingestion = {
        ...meta.ingestion,
        status: "queued",
        error: null,
        indexing_error: null,
        failed_at: null,
        indexing_failed_at: null,
        retry_requested_at: new Date().toISOString(),
      };

      await supabase
        .from("kb_documents")
        .update({ metadata: meta })
        .eq("id", docId);

      // Create a new ingestion job
      await supabase
        .from("kb_ingestion_jobs" as any)
        .insert({
          tenant_id: tenant.tenantId,
          kb_document_id: docId,
          status: "queued",
          priority: 60,
        } as any);

      // Kick extractor
      await kickExtractor();

      // Refresh the list
      await refresh();
    } catch (err) {
      console.error("[KbDocumentsList] Retry failed:", err);
    } finally {
      setRetrying(null);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="py-8 flex justify-center">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="border-destructive/30">
        <CardContent className="pt-6">
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (documents.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center">
          <p className="text-sm text-muted-foreground">No knowledge base documents uploaded yet.</p>
        </CardContent>
      </Card>
    );
  }

  const readyCount = documents.filter((d) => d.ingestionStatus === "ready").length;
  const failedCount = documents.filter((d) => ["failed", "indexing_failed", "needs_review"].includes(d.ingestionStatus)).length;
  const processingCount = documents.filter((d) => isProcessing(d.ingestionStatus)).length;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium text-foreground flex items-center gap-2">
            <Database className="h-4 w-4" />
            Knowledge Base Documents
          </CardTitle>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span>{documents.length} total</span>
              {readyCount > 0 && (
                <Badge variant="default" className="text-xs px-1.5 py-0">
                  {readyCount} ready
                </Badge>
              )}
              {failedCount > 0 && (
                <Badge variant="destructive" className="text-xs px-1.5 py-0">
                  {failedCount} failed
                </Badge>
              )}
              {processingCount > 0 && (
                <Badge variant="outline" className="text-xs px-1.5 py-0">
                  {processingCount} processing
                </Badge>
              )}
            </div>
            <Button variant="ghost" size="sm" onClick={refresh} className="h-7 w-7 p-0">
              <RefreshCw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="border rounded-lg overflow-hidden">
          <div className="max-h-[50vh] overflow-y-auto">
            {documents.map((doc, i) => {
              const cfg = STATUS_MAP[doc.ingestionStatus] || STATUS_MAP.unknown;
              const canRetry = isRetryable(doc.ingestionStatus);
              const tenantId = doc.metadata?.ingestion?.tenant_id ||
                (doc.metadata as any)?.tenant_id;

              return (
                <div
                  key={doc.id}
                  className={`flex items-center gap-3 px-3 py-2.5 text-sm ${
                    i > 0 ? "border-t" : ""
                  }`}
                >
                  <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="truncate block text-foreground" title={doc.title}>
                      {doc.title}
                    </span>
                    {doc.ingestionError && (
                      <span
                        className="text-xs text-destructive truncate block mt-0.5"
                        title={doc.ingestionError}
                      >
                        {doc.ingestionError.length > 80
                          ? doc.ingestionError.slice(0, 80) + "…"
                          : doc.ingestionError}
                      </span>
                    )}
                  </div>
                  {doc.chunkCount !== null && doc.chunkCount > 0 && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      {doc.chunkCount} chunks
                    </span>
                  )}
                  <Badge variant={cfg.variant} className="text-xs gap-1 shrink-0">
                    {cfg.icon}
                    {cfg.label}
                  </Badge>
                  {canRetry && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 text-xs shrink-0"
                      disabled={retrying === doc.id}
                      onClick={() => handleRetry(doc.id, tenantId)}
                    >
                      {retrying === doc.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3 w-3" />
                      )}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
