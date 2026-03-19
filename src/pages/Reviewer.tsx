import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Shield, Info, Loader2, Copy, Check, RotateCcw,
  AlertTriangle, MessageSquare, Scale, CheckSquare, Eye,
  Upload, FileText, X, RefreshCw, CheckCircle2, FileWarning,
  Search, ChevronDown, ChevronRight, Circle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useEyeLogger } from "@/hooks/useEyeLogger";
import { usePdfTextExtractor, type PageText } from "@/hooks/usePdfTextExtractor";
import { recoverFieldsFromDocument } from "@/lib/tools/field-recovery";
import { parseCompletedTemplate } from "@/lib/tools/completed-template-parser";
import { reconcileNotesAndTemplate } from "@/lib/tools/reconciliation-engine";
import { ReconciliationPanel } from "@/components/session/ReconciliationPanel";
import type {
  ReviewerV2Report,
  ReviewIssue,
  ReviewSeverity,
  ReviewIssueType,
  Phase2SchemaField,
} from "@/lib/tools/reviewer-v2-types";
import type {
  TemplateParserArtifact,
  ReconciliationResult,
  CompletedTemplateParse,
} from "@/lib/tools/parser-artifact-types";

// ─── Types ───────────────────────────────────────────────
type ToolState = "idle" | "ready" | "recovering" | "running" | "success" | "error";

interface SessionInfo {
  caseLabel: string;
  interactionType: string | null;
  sessionUuid: string;
  templateId: string | null;
  phase2SchemaId: string | null;
}

interface SelectedFile {
  file: File;
  objectUrl: string;
}

// ─── Persistence ─────────────────────────────────────────
const PERSIST_DEBUG = import.meta.env.DEV;

interface PersistedReviewerState {
  toolState: ToolState;
  fileName: string | null;
  fileSize: number | null;
  extractedPages: PageText[];
  extractedFullText: string;
  pageCount: number;
  output: ReviewerV2Report | null;
  errorMessage: string | null;
  recoveryStats: { answered: number; missing: number; humanReview: number } | null;
  activeSnippet: string | null;
  copiedCategory: string | null;
  reconciliationResult: ReconciliationResult | null;
  templateParseResult: CompletedTemplateParse | null;
}

function reviewerStorageKey(sessionId: string) {
  return `aidmind:reviewer:${sessionId}`;
}

function logPersist(event: string, payload?: Record<string, unknown>) {
  if (!PERSIST_DEBUG) return;
  console.info(`[Reviewer][persist] ${event}`, payload ?? "");
}

function persistReviewerState(sessionId: string, state: PersistedReviewerState) {
  try {
    sessionStorage.setItem(reviewerStorageKey(sessionId), JSON.stringify(state));
    logPersist("save", { sessionId, toolState: state.toolState, hasOutput: !!state.output });
  } catch (e) {
    logPersist("save_failed", { error: e instanceof Error ? e.message : "unknown" });
  }
}

function loadReviewerState(sessionId: string): PersistedReviewerState | null {
  try {
    const raw = sessionStorage.getItem(reviewerStorageKey(sessionId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedReviewerState;
    // Normalize in-flight states
    if (parsed.toolState === "running" || parsed.toolState === "recovering") {
      parsed.toolState = parsed.output ? "success" : "ready";
    }
    logPersist("restore_hit", { sessionId, toolState: parsed.toolState });
    return parsed;
  } catch {
    logPersist("restore_failed", { sessionId });
    return null;
  }
}

function clearReviewerState(sessionId: string) {
  sessionStorage.removeItem(reviewerStorageKey(sessionId));
  logPersist("cleared", { sessionId });
}

// ─── Constants ───────────────────────────────────────────
const MAX_FILE_SIZE_MB = 20;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const SEVERITY_CONFIG: Record<ReviewSeverity, { variant: "destructive" | "default" | "secondary"; label: string }> = {
  high: { variant: "destructive", label: "High" },
  medium: { variant: "default", label: "Medium" },
  low: { variant: "secondary", label: "Low" },
};

const ISSUE_TYPE_META: Record<ReviewIssueType, { label: string; icon: typeof MessageSquare }> = {
  tone: { label: "Tone & Clarity", icon: MessageSquare },
  bias: { label: "Bias & Assumptions", icon: Eye },
  policy_language: { label: "Policy Language", icon: Scale },
  completeness: { label: "Completeness", icon: CheckSquare },
  consistency: { label: "Consistency", icon: Shield },
};

const ISSUE_TYPES: ReviewIssueType[] = ["completeness", "policy_language", "tone", "bias", "consistency"];

// ─── Helpers ─────────────────────────────────────────────
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function renderHighlightedText(fullText: string, snippet: string | null): React.ReactNode {
  if (!snippet || snippet.trim().length < 3) return fullText;
  try {
    const re = new RegExp(escapeRegExp(snippet), "gi");
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    let key = 0;
    while ((match = re.exec(fullText)) !== null) {
      if (match.index > lastIndex) parts.push(fullText.slice(lastIndex, match.index));
      parts.push(
        <mark key={key++} className="bg-[hsl(var(--status-warning-muted))] text-[hsl(var(--status-warning-muted-foreground))] rounded px-0.5">
          {match[0]}
        </mark>
      );
      lastIndex = re.lastIndex;
      if (match[0].length === 0) re.lastIndex++;
    }
    if (lastIndex < fullText.length) parts.push(fullText.slice(lastIndex));
    return parts.length > 0 ? parts : fullText;
  } catch {
    return fullText;
  }
}

// ─── Readiness Row ───────────────────────────────────────
type ReadinessState = "ready" | "attention" | "missing";

function ReadinessRow({ label, state, detail }: { label: string; state: ReadinessState; detail?: string }) {
  const icon =
    state === "ready" ? <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--status-success))]" /> :
    state === "attention" ? <AlertTriangle className="h-3.5 w-3.5 text-[hsl(var(--status-warning))]" /> :
    <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />;

  return (
    <div className="flex items-start gap-2 py-1.5">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className={cn("text-sm", state === "ready" ? "text-foreground" : "text-muted-foreground")}>{label}</p>
        {detail && <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>}
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────
export default function Reviewer() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { logEvent } = useEyeLogger();

  // Session data
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [schemaFields, setSchemaFields] = useState<Phase2SchemaField[] | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  // Tool state
  const [toolState, setToolState] = useState<ToolState>("idle");
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [output, setOutput] = useState<ReviewerV2Report | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedCategory, setCopiedCategory] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [activeSnippet, setActiveSnippet] = useState<string | null>(null);
  const [recoveryStats, setRecoveryStats] = useState<{ answered: number; missing: number; humanReview: number } | null>(null);

  // Restored state (for when File object isn't available)
  const [restoredPages, setRestoredPages] = useState<PageText[]>([]);
  const [restoredFullText, setRestoredFullText] = useState("");
  const [restoredPageCount, setRestoredPageCount] = useState(0);
  const [restoredFileName, setRestoredFileName] = useState<string | null>(null);
  const [restoredFileSize, setRestoredFileSize] = useState<number | null>(null);

  const [hydratedSessionId, setHydratedSessionId] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textPanelRef = useRef<HTMLDivElement>(null);

  // PDF text extraction hook
  const {
    pages: livePages,
    fullText: liveFullText,
    pageCount: livePageCount,
    extracting,
    error: extractError,
    extractText,
    clearText,
  } = usePdfTextExtractor();

  // Unified accessors - prefer live data, fall back to restored
  const extractedPages = livePages.length > 0 ? livePages : restoredPages;
  const extractedFullText = liveFullText || restoredFullText;
  const pageCount = livePageCount || restoredPageCount;
  const fileName = selectedFile?.file.name ?? restoredFileName;
  const fileSize = selectedFile?.file.size ?? restoredFileSize;
  const hasDocument = selectedFile !== null || restoredFullText.length > 0;

  // ─── Load session info + schema ────────────────────────
  useEffect(() => {
    async function fetchSession() {
      if (!sessionId) { setPageError("No session ID provided"); setPageLoading(false); return; }
      try {
        const { data, error } = await supabase
          .from("sessions")
          .select("id, case_label, interaction_type, template_id, phase2_schema_id")
          .eq("session_id", sessionId)
          .maybeSingle();
        if (error) throw error;
        if (!data) { setPageError("Session not found"); setPageLoading(false); return; }
        setSessionInfo({
          caseLabel: data.case_label || "Untitled session",
          interactionType: data.interaction_type,
          sessionUuid: data.id,
          templateId: data.template_id,
          phase2SchemaId: data.phase2_schema_id,
        });
        if (data.phase2_schema_id) {
          const { data: schema, error: schemaErr } = await supabase
            .from("template_phase2_schemas")
            .select("schema_json")
            .eq("id", data.phase2_schema_id)
            .maybeSingle();
          if (!schemaErr && schema?.schema_json) {
            const parsed = schema.schema_json as any;
            if (parsed?.fields && Array.isArray(parsed.fields)) setSchemaFields(parsed.fields as Phase2SchemaField[]);
          }
        }
      } catch { setPageError("Failed to load session"); }
      finally { setPageLoading(false); }
    }
    fetchSession();
  }, [sessionId]);

  // ─── Hydrate from sessionStorage ───────────────────────
  useEffect(() => {
    if (!sessionId) { setHydratedSessionId(null); return; }
    const persisted = loadReviewerState(sessionId);
    if (persisted) {
      setToolState(persisted.toolState);
      setRestoredPages(persisted.extractedPages ?? []);
      setRestoredFullText(persisted.extractedFullText ?? "");
      setRestoredPageCount(persisted.pageCount ?? 0);
      setRestoredFileName(persisted.fileName);
      setRestoredFileSize(persisted.fileSize);
      setOutput(persisted.output);
      setErrorMessage(persisted.errorMessage);
      setRecoveryStats(persisted.recoveryStats);
      setActiveSnippet(persisted.activeSnippet);
    } else {
      setToolState("idle");
      setRestoredPages([]);
      setRestoredFullText("");
      setRestoredPageCount(0);
      setRestoredFileName(null);
      setRestoredFileSize(null);
      setOutput(null);
      setErrorMessage(null);
      setRecoveryStats(null);
      setActiveSnippet(null);
    }
    setHydratedSessionId(sessionId);
  }, [sessionId]);

  // ─── Persist to sessionStorage on change ───────────────
  useEffect(() => {
    if (!sessionId || hydratedSessionId !== sessionId) return;
    persistReviewerState(sessionId, {
      toolState: (toolState === "running" || toolState === "recovering") ? (output ? "success" : "ready") : toolState,
      fileName: selectedFile?.file.name ?? restoredFileName,
      fileSize: selectedFile?.file.size ?? restoredFileSize,
      extractedPages,
      extractedFullText,
      pageCount,
      output,
      errorMessage,
      recoveryStats,
      activeSnippet,
      copiedCategory: null,
    });
  }, [sessionId, hydratedSessionId, toolState, selectedFile, restoredFileName, restoredFileSize, extractedPages, extractedFullText, pageCount, output, errorMessage, recoveryStats, activeSnippet]);

  // Cleanup object URL on unmount
  useEffect(() => {
    return () => { if (selectedFile) URL.revokeObjectURL(selectedFile.objectUrl); };
  }, [selectedFile]);

  const canRun = hasDocument && !fileError && !extracting && extractedFullText.length > 0 && toolState !== "running" && toolState !== "recovering";

  // ─── File handling ─────────────────────────────────────
  const validateAndSetFile = useCallback((file: File) => {
    setFileError(null);
    if (file.type !== "application/pdf") { setFileError("Please upload a PDF file."); return; }
    if (file.size > MAX_FILE_SIZE_BYTES) { setFileError(`File exceeds ${MAX_FILE_SIZE_MB}MB limit.`); return; }
    if (selectedFile) URL.revokeObjectURL(selectedFile.objectUrl);
    const objectUrl = URL.createObjectURL(file);
    setSelectedFile({ file, objectUrl });
    setRestoredFullText("");
    setRestoredPages([]);
    setRestoredPageCount(0);
    setRestoredFileName(null);
    setRestoredFileSize(null);
    setToolState("ready");
    setOutput(null);
    setErrorMessage(null);
    setActiveSnippet(null);
    setRecoveryStats(null);
    extractText(file);
  }, [selectedFile, extractText]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) validateAndSetFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); const file = e.dataTransfer.files?.[0]; if (file) validateAndSetFile(file); };
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };

  const handleRemoveFile = () => {
    if (selectedFile) URL.revokeObjectURL(selectedFile.objectUrl);
    setSelectedFile(null);
    setFileError(null);
    clearText();
    setRestoredFullText("");
    setRestoredPages([]);
    setRestoredPageCount(0);
    setRestoredFileName(null);
    setRestoredFileSize(null);
    setToolState("idle");
    setOutput(null);
    setErrorMessage(null);
    setActiveSnippet(null);
    setRecoveryStats(null);
    if (sessionId) clearReviewerState(sessionId);
  };

  const handleReplace = () => fileInputRef.current?.click();

  // ─── Run Reviewer v2 ──────────────────────────────────
  const handleRun = useCallback(async () => {
    if (!sessionId || !sessionInfo || !extractedFullText) return;
    const requestId = crypto.randomUUID();
    setOutput(null);
    setErrorMessage(null);
    setActiveSnippet(null);

    setToolState("recovering");
    let structured_answers: any[] = [];
    let review_worthy_answers: any[] = [];
    let unanswered_fields: any[] = [];
    let human_review_fields: any[] = [];

    if (schemaFields && schemaFields.length > 0) {
      try {
        const recovery = recoverFieldsFromDocument(extractedFullText, schemaFields);
        structured_answers = recovery.structured_answers;
        review_worthy_answers = recovery.review_worthy_answers;
        unanswered_fields = recovery.unanswered_fields;
        human_review_fields = recovery.human_review_fields;
        setRecoveryStats({
          answered: structured_answers.filter((a) => !a.missing && !a.requires_human_review).length,
          missing: unanswered_fields.length,
          humanReview: human_review_fields.length,
        });
      } catch (err) {
        console.warn("[Reviewer] Field recovery failed, proceeding with text-only:", err);
      }
    }

    setToolState("running");
    logEvent({
      eventType: "tool.run.started", sessionId, requestId,
      toolName: "run_reviewer_v2",
      metadata: {
        file_size_bytes: fileSize ?? 0, page_count: pageCount,
        text_length: extractedFullText.length,
        structured_answers_count: structured_answers.length,
        review_worthy_count: review_worthy_answers.length,
        unanswered_count: unanswered_fields.length,
        human_review_count: human_review_fields.length,
        has_schema: !!schemaFields,
      },
    });

    try {
      const payload = {
        session_id: sessionInfo.sessionUuid,
        template_id: sessionInfo.templateId || undefined,
        phase2_schema_id: sessionInfo.phase2SchemaId || undefined,
        document_text: extractedFullText,
        structured_answers, review_worthy_answers, unanswered_fields, human_review_fields,
      };
      const { data, error } = await supabase.functions.invoke("run-reviewer", { body: payload });
      if (error) throw new Error(error.message || "Edge function invocation failed");
      if (data?.error) {
        const code = data.error.code || "UNKNOWN";
        const msg = data.error.message || "Review failed";
        logEvent({ eventType: "tool.run.failed", sessionId, requestId, toolName: "run_reviewer_v2", result: "failure", metadata: { error_code: code } });
        setErrorMessage(`${msg} (${code})`);
        setToolState("error");
        return;
      }
      if (!data?.review_report) throw new Error("Invalid response from reviewer");
      const report = data.review_report as ReviewerV2Report;
      logEvent({ eventType: "tool.run.completed", sessionId, requestId, toolName: "run_reviewer_v2", result: "success", metadata: { issue_count: report.metrics.issue_count, high_severity_count: report.metrics.high_severity_count, overall_risk: report.summary.overall_risk } });
      setOutput(report);
      setToolState("success");
    } catch (err: any) {
      console.error("[Reviewer] Run failed:", err);
      logEvent({ eventType: "tool.run.failed", sessionId, requestId, toolName: "run_reviewer_v2", result: "failure", metadata: { error_message: err?.message?.slice(0, 100) ?? "unknown" } });
      setErrorMessage(err?.message || "An unexpected error occurred.");
      setToolState("error");
    }
  }, [sessionId, sessionInfo, extractedFullText, fileSize, pageCount, schemaFields, logEvent]);

  const handleClear = () => {
    handleRemoveFile();
  };

  // ─── Highlight / Jump ─────────────────────────────────
  const handleHighlight = useCallback((snippet: string) => {
    setActiveSnippet(snippet);
    setTimeout(() => {
      const mark = textPanelRef.current?.querySelector("mark");
      if (mark) mark.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }, []);

  // ─── Copy ──────────────────────────────────────────────
  const handleCopyAll = async () => {
    if (!output) return;
    const text = ISSUE_TYPES.map((type) => {
      const issues = output.issues.filter((i) => i.type === type);
      if (issues.length === 0) return "";
      return `## ${ISSUE_TYPE_META[type].label}\n${issues.map((i) => `- [${i.severity.toUpperCase()}] ${i.explanation}${i.excerpt ? ` — "${i.excerpt}"` : ""}`).join("\n")}`;
    }).filter(Boolean).join("\n\n");
    await navigator.clipboard.writeText(text);
    setCopiedCategory("__all__");
    setTimeout(() => setCopiedCategory(null), 2000);
  };

  const handleCopyType = async (type: ReviewIssueType) => {
    if (!output) return;
    const issues = output.issues.filter((i) => i.type === type);
    const text = issues.map((i) => `[${i.severity.toUpperCase()}] ${i.explanation}${i.excerpt ? ` — "${i.excerpt}"` : ""}`).join("\n");
    await navigator.clipboard.writeText(text);
    setCopiedCategory(type);
    setTimeout(() => setCopiedCategory(null), 2000);
  };

  const handleBack = () => navigate("/dashboard");

  const totalIssues = output ? output.metrics.issue_count : 0;

  const issuesByType = useMemo(() => {
    if (!output) return null;
    return ISSUE_TYPES.reduce((acc, type) => {
      acc[type] = output.issues.filter((i) => i.type === type);
      return acc;
    }, {} as Record<ReviewIssueType, ReviewIssue[]>);
  }, [output]);

  // ─── Page-level loading/error ──────────────────────────
  if (pageLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Shield className="h-8 w-8 mx-auto text-primary animate-pulse mb-2" />
          <p className="text-muted-foreground">Loading reviewer…</p>
        </div>
      </div>
    );
  }

  if (pageError || !sessionInfo) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center max-w-md">
          <p className="text-destructive mb-4">{pageError || "Session not found"}</p>
          <Button onClick={handleBack}>Back to Dashboard</Button>
        </div>
      </div>
    );
  }

  // ─── Readiness checks ─────────────────────────────────
  const docReady: ReadinessState = hasDocument ? "ready" : "missing";
  const extractReady: ReadinessState = extracting ? "attention" : extractedFullText.length > 0 ? "ready" : "missing";
  const schemaReady: ReadinessState = schemaFields ? "ready" : "attention";
  const isRestoredWithoutFile = !selectedFile && restoredFullText.length > 0;

  return (
    <div className="h-screen bg-[hsl(var(--canvas))] flex flex-col overflow-hidden">
      {/* ─── Header ──────────────────────────────────────── */}
      <header className="border-b border-border bg-card shrink-0">
        <div className="px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={handleBack} className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Separator orientation="vertical" className="h-6" />
            <div>
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                <h1 className="text-base font-semibold text-foreground">Reviewer</h1>
                <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">Step 3</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {sessionInfo.caseLabel}{sessionInfo.interactionType ? ` · ${sessionInfo.interactionType}` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {schemaFields && (
              <Badge variant="outline" className="text-[10px] text-primary border-primary/30">
                Schema · {schemaFields.length} fields
              </Badge>
            )}
          </div>
        </div>
      </header>

      {/* ─── Main content ────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {!hasDocument ? (
          /* ─── Upload state ──────────────────────────────── */
          <div className="flex-1 flex items-center justify-center p-6">
            <div className="w-full max-w-lg space-y-4">
              <div className="text-center mb-6">
                <Shield className="h-10 w-10 mx-auto text-primary/30 mb-3" />
                <h2 className="text-lg font-semibold text-foreground">Review a completed document</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Upload the filled-out form to check for tone, bias, policy language, and completeness.
                </p>
              </div>

              <Card>
                <CardContent className="pt-6 space-y-4">
                  <input ref={fileInputRef} type="file" accept="application/pdf" onChange={handleFileInputChange} className="sr-only" aria-label="Upload PDF file" />
                  <div
                    role="button" tabIndex={0}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRef.current?.click(); } }}
                    onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}
                    className={cn(
                      "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      isDragging ? "border-primary bg-primary/5" : "border-muted-foreground/25 hover:border-primary/50 hover:bg-accent/5"
                    )}
                  >
                    <Upload className="h-8 w-8 mx-auto text-muted-foreground/40 mb-3" />
                    <p className="text-sm font-medium text-foreground mb-1">Drag & drop your PDF here</p>
                    <p className="text-xs text-muted-foreground mb-3">or click to choose a file</p>
                    <Button type="button" variant="outline" size="sm" className="pointer-events-none">Choose file</Button>
                    <p className="text-xs text-muted-foreground mt-3">PDF only · Max {MAX_FILE_SIZE_MB}MB</p>
                  </div>
                  {fileError && (
                    <div className="flex items-center gap-2 text-destructive">
                      <FileWarning className="h-4 w-4 shrink-0" />
                      <p className="text-xs font-medium">{fileError}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Alert className="border-primary/20 bg-primary/5">
                <Info className="h-4 w-4 text-primary" />
                <AlertDescription className="text-xs text-muted-foreground">
                  Files are extracted locally in your browser. <strong className="text-foreground">Nothing is uploaded or stored.</strong>
                </AlertDescription>
              </Alert>
            </div>
          </div>
        ) : (
          /* ─── Workspace layout ─────────────────────────── */
          <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
            {/* ─── Left column: Document + Text ──────────── */}
            <div className="flex-1 min-w-0 flex flex-col lg:flex-row overflow-hidden">
              {/* PDF Preview panel */}
              {selectedFile && (
                <div className="lg:w-[340px] xl:w-[380px] shrink-0 border-r border-border flex flex-col overflow-hidden">
                  <div className="px-4 py-2.5 border-b border-border bg-card flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-xs text-foreground font-medium truncate">{fileName}</span>
                      {pageCount > 0 && <Badge variant="secondary" className="text-[10px] shrink-0">{pageCount}p</Badge>}
                    </div>
                    {toolState !== "success" && (
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="sm" onClick={handleReplace} className="h-6 px-2 text-[10px] gap-1">
                          <RefreshCw className="h-3 w-3" /> Replace
                        </Button>
                        <Button variant="ghost" size="sm" onClick={handleRemoveFile} className="h-6 px-2 text-[10px] gap-1 text-destructive hover:text-destructive">
                          <X className="h-3 w-3" />
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 overflow-hidden bg-muted/30 p-1">
                    <iframe src={selectedFile.objectUrl} title="PDF preview" className="w-full h-full rounded border-0" />
                  </div>
                  <input ref={fileInputRef} type="file" accept="application/pdf" onChange={handleFileInputChange} className="sr-only" />
                </div>
              )}

              {/* Extracted text panel */}
              <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                <div className="px-4 py-2.5 border-b border-border bg-card flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-foreground">Extracted Text</span>
                    {isRestoredWithoutFile && fileName && (
                      <Badge variant="outline" className="text-[10px]">
                        <FileText className="h-2.5 w-2.5 mr-1" />{fileName}
                        {fileSize ? ` · ${formatFileSize(fileSize)}` : ""}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    {activeSnippet && (
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={() => setActiveSnippet(null)}>
                        Clear highlight
                      </Button>
                    )}
                    {isRestoredWithoutFile && toolState !== "success" && (
                      <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px] gap-1" onClick={handleReplace}>
                        <Upload className="h-3 w-3" /> Re-upload PDF
                      </Button>
                    )}
                  </div>
                </div>
                {isRestoredWithoutFile && (
                  <div className="px-4 py-2 bg-[hsl(var(--status-info-muted))] border-b border-[hsl(var(--status-info))]/20 shrink-0">
                    <p className="text-[11px] text-[hsl(var(--status-info-muted-foreground))]">
                      <Info className="h-3 w-3 inline mr-1 -mt-0.5" />
                      Extracted text and results restored from your session. PDF preview requires re-upload.
                    </p>
                  </div>
                )}
                <ScrollArea className="flex-1">
                  <div ref={textPanelRef} className="p-4 space-y-4 text-sm leading-relaxed">
                    {extracting && (
                      <div className="flex items-center gap-2 text-muted-foreground py-8 justify-center">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-xs">Extracting text…</span>
                      </div>
                    )}
                    {extractError && <div className="text-destructive text-xs p-4">{extractError}</div>}
                    {!extracting && extractedPages.length === 0 && !extractError && (
                      <p className="text-xs text-muted-foreground text-center py-8">No text extracted yet.</p>
                    )}
                    {extractedPages.map((page) => (
                      <div key={page.pageNumber}>
                        <Badge variant="outline" className="text-[10px] mb-2">Page {page.pageNumber}</Badge>
                        <p className="text-foreground whitespace-pre-wrap break-words text-[13px]">
                          {page.text
                            ? renderHighlightedText(page.text, activeSnippet)
                            : <span className="text-muted-foreground italic">(no text on this page)</span>}
                        </p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </div>

            {/* ─── Right rail: Action + Results ──────────── */}
            <div className="lg:w-[340px] xl:w-[380px] shrink-0 border-l border-border bg-card flex flex-col overflow-hidden">
              {/* Readiness + Action area */}
              <div className="p-4 border-b border-border space-y-3 shrink-0">
                <div className="space-y-0.5">
                  <ReadinessRow label="Document uploaded" state={docReady} detail={isRestoredWithoutFile ? "Restored from session (re-upload for preview)" : undefined} />
                  <ReadinessRow label="Text extracted" state={extractReady} detail={extracting ? "Extracting…" : extractedFullText.length > 0 ? `${extractedFullText.length.toLocaleString()} characters · ${pageCount} pages` : undefined} />
                  <ReadinessRow label="Template schema" state={schemaReady} detail={schemaFields ? `${schemaFields.length} fields` : "No schema — text-only review"} />
                </div>

                {/* Primary CTA */}
                {toolState !== "success" && (
                  <Button
                    onClick={handleRun}
                    disabled={!canRun}
                    className="w-full gap-2"
                    size="lg"
                  >
                    {toolState === "running" || toolState === "recovering" ? (
                      <><Loader2 className="h-4 w-4 animate-spin" /> {toolState === "recovering" ? "Recovering fields…" : "Analyzing…"}</>
                    ) : (
                      <><Shield className="h-4 w-4" /> Run Reviewer</>
                    )}
                  </Button>
                )}

                {toolState === "success" && (
                  <Button variant="default" onClick={handleBack} className="w-full gap-2" size="lg">
                    <CheckCircle2 className="h-4 w-4" /> Done — Back to Dashboard
                  </Button>
                )}

                {toolState === "error" && (
                  <div className="flex gap-2">
                    <Button onClick={handleRun} disabled={!canRun} className="flex-1 gap-1.5">
                      <RefreshCw className="h-3.5 w-3.5" /> Try again
                    </Button>
                    <Button variant="outline" onClick={handleClear} className="gap-1.5">
                      <RotateCcw className="h-3.5 w-3.5" /> Clear
                    </Button>
                  </div>
                )}
              </div>

              {/* Results area */}
              <ScrollArea className="flex-1">
                <div className="p-4 space-y-4">
                  {/* Idle / Ready */}
                  {(toolState === "idle" || toolState === "ready") && !output && (
                    <div className="text-center py-10">
                      <Shield className="h-10 w-10 mx-auto text-muted-foreground/20 mb-3" />
                      <p className="text-sm text-muted-foreground">
                        {extracting ? "Waiting for extraction…" : canRun ? "Ready to review" : "Upload a document to begin"}
                      </p>
                      <p className="text-xs text-muted-foreground/70 mt-1">
                        Checks tone, bias, policy language, and completeness
                      </p>
                    </div>
                  )}

                  {/* Recovering */}
                  {toolState === "recovering" && (
                    <div className="text-center py-10">
                      <Loader2 className="h-8 w-8 mx-auto text-primary animate-spin mb-3" />
                      <p className="text-sm text-muted-foreground">Recovering field structure…</p>
                      <p className="text-xs text-muted-foreground/70 mt-1">Matching document content to template fields</p>
                    </div>
                  )}

                  {/* Running */}
                  {toolState === "running" && (
                    <div className="text-center py-10">
                      <Loader2 className="h-8 w-8 mx-auto text-primary animate-spin mb-3" />
                      <p className="text-sm text-muted-foreground">Analyzing document…</p>
                      <p className="text-xs text-muted-foreground/70 mt-1">Checking tone, bias, policy language, and completeness</p>
                      {recoveryStats && (
                        <div className="flex items-center justify-center gap-2 mt-3 flex-wrap">
                          <Badge variant="outline" className="text-[10px]">{recoveryStats.answered} recovered</Badge>
                          {recoveryStats.missing > 0 && <Badge variant="secondary" className="text-[10px]">{recoveryStats.missing} missing</Badge>}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Error */}
                  {toolState === "error" && (
                    <div className="text-center py-8">
                      <AlertTriangle className="h-8 w-8 mx-auto text-destructive/50 mb-3" />
                      <p className="text-sm text-destructive font-medium mb-1">Review failed</p>
                      <p className="text-xs text-muted-foreground">{errorMessage}</p>
                    </div>
                  )}

                  {/* Success */}
                  {toolState === "success" && output && issuesByType && (
                    <div className="space-y-4">
                      {/* Summary header */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={output.summary.overall_risk === "high" ? "destructive" : output.summary.overall_risk === "medium" ? "default" : "secondary"}
                            className="text-xs"
                          >
                            {output.summary.overall_risk.toUpperCase()} risk
                          </Badge>
                          <Badge variant="secondary" className="text-xs">
                            {totalIssues} {totalIssues === 1 ? "issue" : "issues"}
                          </Badge>
                        </div>
                        <Button variant="ghost" size="sm" onClick={handleCopyAll} className="h-7 px-2 text-[10px] gap-1">
                          {copiedCategory === "__all__" ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy all</>}
                        </Button>
                      </div>

                      {/* Key findings */}
                      {output.summary.key_findings.length > 0 && (
                        <div className="rounded-lg border p-3 bg-accent/5">
                          <p className="text-[10px] uppercase font-medium text-muted-foreground mb-2 tracking-wide">Key Findings</p>
                          <ul className="space-y-1">
                            {output.summary.key_findings.map((f, i) => (
                              <li key={i} className="text-xs text-foreground">• {f}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {/* Recovery stats */}
                      {recoveryStats && (
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="text-[10px]">{recoveryStats.answered} fields answered</Badge>
                          {recoveryStats.missing > 0 && (
                            <Badge variant="outline" className="text-[10px] text-[hsl(var(--status-warning))] border-[hsl(var(--status-warning))]/30">
                              {recoveryStats.missing} missing
                            </Badge>
                          )}
                          {recoveryStats.humanReview > 0 && (
                            <Badge variant="outline" className="text-[10px]">{recoveryStats.humanReview} human-review</Badge>
                          )}
                        </div>
                      )}

                      <p className="text-[10px] text-muted-foreground italic">AI-generated audit — review before acting.</p>

                      {totalIssues === 0 && (
                        <div className="text-center py-6">
                          <CheckCircle2 className="h-8 w-8 mx-auto text-[hsl(var(--status-success))]/50 mb-2" />
                          <p className="text-sm text-foreground font-medium">No issues found</p>
                          <p className="text-xs text-muted-foreground">Documentation looks good.</p>
                        </div>
                      )}

                      {/* Issue groups */}
                      {ISSUE_TYPES.map((type) => {
                        const issues = issuesByType[type];
                        if (!issues || issues.length === 0) return null;
                        const meta = ISSUE_TYPE_META[type];
                        const Icon = meta.icon;

                        return (
                          <Collapsible key={type} defaultOpen>
                            <div className="flex items-center justify-between">
                              <CollapsibleTrigger className="flex items-center gap-2 group">
                                <ChevronDown className="h-3 w-3 text-muted-foreground transition-transform group-data-[state=closed]:rotate-[-90deg]" />
                                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                                <span className="text-xs font-medium text-foreground">{meta.label}</span>
                                <Badge variant="secondary" className="text-[10px] px-1.5 h-4">{issues.length}</Badge>
                              </CollapsibleTrigger>
                              <Button variant="ghost" size="sm" className="h-6 px-1.5 text-[10px] text-muted-foreground" onClick={() => handleCopyType(type)}>
                                {copiedCategory === type ? <><Check className="h-2.5 w-2.5 mr-0.5" /> Copied</> : <><Copy className="h-2.5 w-2.5 mr-0.5" /> Copy</>}
                              </Button>
                            </div>
                            <CollapsibleContent>
                              <div className="space-y-2 mt-2">
                                {issues.map((issue, i) => {
                                  const sev = SEVERITY_CONFIG[issue.severity];
                                  const isActive = activeSnippet === issue.excerpt && !!issue.excerpt && issue.excerpt.length > 0;
                                  return (
                                    <div
                                      key={i}
                                      className={cn(
                                        "p-2.5 rounded-lg border text-sm",
                                        isActive ? "border-[hsl(var(--status-warning))] bg-[hsl(var(--status-warning-muted))]" : "bg-muted/30"
                                      )}
                                    >
                                      <div className="flex items-start gap-2">
                                        <Badge variant={sev.variant} className="text-[10px] shrink-0 mt-0.5 px-1.5">{sev.label}</Badge>
                                        <div className="flex-1 min-w-0">
                                          <p className="text-xs text-foreground leading-relaxed">{issue.explanation}</p>
                                          {issue.field_key && (
                                            <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">Field: {issue.field_key}</p>
                                          )}
                                          {issue.excerpt && (
                                            <p className="text-[11px] text-muted-foreground mt-1 italic border-l-2 border-border pl-2">"{issue.excerpt}"</p>
                                          )}
                                        </div>
                                      </div>
                                      {issue.excerpt && issue.excerpt.length > 0 && (
                                        <div className="flex items-center gap-1 mt-2 pt-1.5 border-t border-border/50">
                                          <Button
                                            variant={isActive ? "secondary" : "ghost"}
                                            size="sm"
                                            className="h-6 px-2 text-[10px] gap-1"
                                            onClick={() => handleHighlight(isActive ? "" : issue.excerpt)}
                                          >
                                            <Search className="h-2.5 w-2.5" />
                                            {isActive ? "Unhighlight" : "Highlight in text"}
                                          </Button>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            </CollapsibleContent>
                          </Collapsible>
                        );
                      })}
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
