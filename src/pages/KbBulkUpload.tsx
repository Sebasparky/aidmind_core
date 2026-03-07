/**
 * KbBulkUploadPage — Polished UI for bulk-uploading PDFs to Knowledge Base.
 * Visual/UX only — all upload logic, extractor behavior, and API calls unchanged.
 */

import { useRef, useState, useCallback } from "react";
import { useKbBulkUploader } from "@/hooks/useKbBulkUploader";
import { useTenant } from "@/hooks/useTenant";
import { kickExtractor } from "@/lib/kb/kbUploadService";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Upload,
  FileText,
  AlertCircle,
  CheckCircle2,
  Loader2,
  Clock,
  ArrowUpCircle,
  XCircle,
  Info,
  Building2,
  Cog,
} from "lucide-react";

const STATUS_CONFIG: Record<string, { label: string; icon: React.ReactNode; className: string }> = {
  queued: {
    label: "Queued",
    icon: <Clock className="h-3.5 w-3.5" />,
    className: "text-muted-foreground",
  },
  uploading: {
    label: "Uploading…",
    icon: <ArrowUpCircle className="h-3.5 w-3.5 animate-pulse" />,
    className: "text-primary",
  },
  uploaded: {
    label: "Done",
    icon: <CheckCircle2 className="h-3.5 w-3.5" />,
    className: "text-[hsl(var(--status-success))]",
  },
  failed: {
    label: "Failed",
    icon: <XCircle className="h-3.5 w-3.5" />,
    className: "text-destructive",
  },
};

const IS_DEV = import.meta.env.DEV;

export default function KbBulkUploadPage() {
  const { tenant, loading: tenantLoading } = useTenant();
  const { tasks, enqueueFiles, cancel, isRunning, stats } = useKbBulkUploader(
    tenant?.tenantId ?? null
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const [kicking, setKicking] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    enqueueFiles(files);
    if (inputRef.current) inputRef.current.value = "";
  };

  const handleKick = async () => {
    setKicking(true);
    try {
      const result = await kickExtractor();
      toast(result.ok ? "Extractor kicked ✓" : `Kick failed: ${result.detail}`);
    } catch {
      toast.error("Kick failed unexpectedly");
    } finally {
      setKicking(false);
    }
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragOver(false);
      if (isRunning) return;
      const files = Array.from(e.dataTransfer.files).filter(
        (f) => f.type === "application/pdf"
      );
      if (files.length > 0) enqueueFiles(files);
    },
    [isRunning, enqueueFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  // ─── Loading / error states ────────────────────────────────
  if (tenantLoading) {
    return (
      <div className="flex items-center justify-center min-h-[40vh]">
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading…
        </div>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16">
        <Card className="border-destructive/30">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-destructive mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium text-foreground">No tenant assigned</p>
                <p className="text-sm text-muted-foreground mt-1">
                  You must be assigned to a tenant before uploading knowledge base documents.
                  Contact your supervisor if you believe this is an error.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const hasFiles = tasks.length > 0;

  return (
    <div className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
      {/* ─── Page header ─── */}
      <div className="space-y-1.5">
        <h1 className="text-lg font-semibold text-foreground tracking-tight">
          Bulk Upload KB PDFs
        </h1>
        <p className="text-sm text-muted-foreground leading-relaxed max-w-xl">
          Upload knowledge base PDF documents for extraction and indexing. Files are
          processed and made available for policy retrieval across sessions.
        </p>
        <div className="flex items-center gap-2 pt-1">
          <Badge variant="secondary" className="font-normal text-xs gap-1.5">
            <Building2 className="h-3 w-3" />
            {tenant.tenantName}
          </Badge>
        </div>
      </div>

      <Separator />

      {/* ─── Main upload card ─── */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium text-foreground">
            Select documents
          </CardTitle>
          <p className="text-xs text-muted-foreground">
            Choose one or more PDF files to upload to the knowledge base.
          </p>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Upload zone */}
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => !isRunning && inputRef.current?.click()}
            className={`
              relative border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
              transition-colors duration-150
              ${isDragOver
                ? "border-primary bg-primary/5"
                : "border-border hover:border-primary/40 hover:bg-muted/50"
              }
              ${isRunning ? "opacity-50 pointer-events-none" : ""}
            `}
          >
            <input
              ref={inputRef}
              type="file"
              multiple
              accept="application/pdf"
              onChange={handleFiles}
              disabled={isRunning}
              className="sr-only"
            />
            <div className="flex flex-col items-center gap-2">
              <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                <Upload className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <p className="text-sm font-medium text-foreground">
                  {isDragOver ? "Drop PDFs here" : "Click to select PDFs"}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  or drag and drop · PDF files only
                </p>
              </div>
            </div>
          </div>

          {/* ─── Action row ─── */}
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              {isRunning && (
                <Button variant="destructive" size="sm" onClick={cancel}>
                  Cancel
                </Button>
              )}
              {IS_DEV && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleKick}
                  disabled={kicking}
                  className="gap-1.5"
                >
                  {kicking ? (
                    <>
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      Running…
                    </>
                  ) : (
                    <>
                      <Cog className="h-3.5 w-3.5" />
                      Run extractor
                    </>
                  )}
                </Button>
              )}
            </div>
            {hasFiles && (
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>{stats.total} file{stats.total !== 1 ? "s" : ""}</span>
                {stats.uploaded > 0 && (
                  <span className="text-emerald-600">
                    {stats.uploaded} done
                  </span>
                )}
                {stats.failed > 0 && (
                  <span className="text-destructive">
                    {stats.failed} failed
                  </span>
                )}
                {stats.uploading > 0 && (
                  <span className="text-primary">
                    {stats.uploading} uploading
                  </span>
                )}
                {stats.queued > 0 && (
                  <span>{stats.queued} queued</span>
                )}
              </div>
            )}
          </div>

          {/* ─── File list ─── */}
          {hasFiles && (
            <div className="border rounded-lg overflow-hidden">
              <div className="max-h-[50vh] overflow-y-auto">
                {tasks.map((t, i) => {
                  const cfg = STATUS_CONFIG[t.status] ?? {
                    label: t.status,
                    icon: null,
                    className: "text-muted-foreground",
                  };
                  return (
                    <div
                      key={t.localId}
                      className={`flex items-center gap-3 px-3 py-2.5 text-sm ${
                        i > 0 ? "border-t" : ""
                      }`}
                    >
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="truncate flex-1 text-foreground" title={t.file.name}>
                        {t.file.name}
                      </span>
                      <div className={`flex items-center gap-1.5 shrink-0 ${cfg.className}`}>
                        {cfg.icon}
                        <span className="text-xs">{cfg.label}</span>
                      </div>
                      {t.error && (
                        <span
                          className="text-xs text-destructive truncate max-w-[180px]"
                          title={t.error}
                        >
                          {t.error}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ─── Empty state ─── */}
          {!hasFiles && (
            <div className="text-center py-2">
              <p className="text-xs text-muted-foreground">
                No files selected. Select PDFs above to begin uploading.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ─── How it works ─── */}
      <Card className="bg-muted/30 border-border/60">
        <CardContent className="pt-5 pb-4">
          <div className="flex items-start gap-3">
            <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
            <div className="space-y-2">
              <p className="text-xs font-medium text-foreground">How it works</p>
              <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                <li>Select one or more PDF files from your device.</li>
                <li>Files are uploaded and a knowledge base record is created for each.</li>
                <li>An ingestion job is queued to extract and index the content.</li>
                <li>Once processed, the content becomes available for policy retrieval.</li>
              </ol>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
