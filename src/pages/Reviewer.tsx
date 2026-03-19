import React from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Shield, Info, Loader2, Copy, Check, RotateCcw,
  AlertTriangle, MessageSquare, Scale, CheckSquare, Eye,
  Upload, FileText, X, RefreshCw, CheckCircle2, FileWarning,
  Search, ChevronLeft, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useEyeLogger } from "@/hooks/useEyeLogger";
import { usePdfTextExtractor } from "@/hooks/usePdfTextExtractor";
import { recoverFieldsFromDocument } from "@/lib/tools/field-recovery";
import type {
  ReviewerV2Report,
  ReviewIssue,
  ReviewSeverity,
  ReviewIssueType,
  Phase2SchemaField,
} from "@/lib/tools/reviewer-v2-types";

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
      if (match.index > lastIndex) {
        parts.push(fullText.slice(lastIndex, match.index));
      }
      parts.push(
        <mark key={key++} className="bg-yellow-200 dark:bg-yellow-700/50 rounded px-0.5">
          {match[0]}
        </mark>
      );
      lastIndex = re.lastIndex;
      if (match[0].length === 0) { re.lastIndex++; }
    }
    if (lastIndex < fullText.length) {
      parts.push(fullText.slice(lastIndex));
    }
    return parts.length > 0 ? parts : fullText;
  } catch {
    return fullText;
  }
}

export default function Reviewer() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { logEvent } = useEyeLogger();

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

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textPanelRef = useRef<HTMLDivElement>(null);

  // PDF text extraction
  const {
    pages: extractedPages,
    fullText: extractedFullText,
    pageCount,
    extracting,
    error: extractError,
    extractText,
    clearText,
  } = usePdfTextExtractor();

  // Load session info + schema
  useEffect(() => {
    async function fetchSession() {
      if (!sessionId) {
        setPageError("No session ID provided");
        setPageLoading(false);
        return;
      }
      try {
        const { data, error } = await supabase
          .from("sessions")
          .select("id, case_label, interaction_type, template_id, phase2_schema_id")
          .eq("session_id", sessionId)
          .maybeSingle();

        if (error) throw error;
        if (!data) {
          setPageError("Session not found");
          setPageLoading(false);
          return;
        }

        setSessionInfo({
          caseLabel: data.case_label || "Untitled session",
          interactionType: data.interaction_type,
          sessionUuid: data.id,
          templateId: data.template_id,
          phase2SchemaId: data.phase2_schema_id,
        });

        // Load schema if available
        if (data.phase2_schema_id) {
          const { data: schema, error: schemaErr } = await supabase
            .from("template_phase2_schemas")
            .select("schema_json")
            .eq("id", data.phase2_schema_id)
            .maybeSingle();

          if (!schemaErr && schema?.schema_json) {
            const parsed = schema.schema_json as any;
            if (parsed?.fields && Array.isArray(parsed.fields)) {
              setSchemaFields(parsed.fields as Phase2SchemaField[]);
            }
          }
        }
      } catch {
        setPageError("Failed to load session");
      } finally {
        setPageLoading(false);
      }
    }
    fetchSession();
  }, [sessionId]);

  // Cleanup object URL on unmount
  useEffect(() => {
    return () => {
      if (selectedFile) {
        URL.revokeObjectURL(selectedFile.objectUrl);
      }
    };
  }, [selectedFile]);

  const canRun = selectedFile !== null && !fileError && !extracting && extractedFullText.length > 0 && toolState !== "running" && toolState !== "recovering";

  const validateAndSetFile = useCallback((file: File) => {
    setFileError(null);
    if (file.type !== "application/pdf") {
      setFileError("Please upload a PDF file.");
      return;
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      setFileError(`File exceeds ${MAX_FILE_SIZE_MB}MB limit.`);
      return;
    }
    if (selectedFile) {
      URL.revokeObjectURL(selectedFile.objectUrl);
    }
    const objectUrl = URL.createObjectURL(file);
    setSelectedFile({ file, objectUrl });
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

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) validateAndSetFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
  const handleDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };

  const handleRemoveFile = () => {
    if (selectedFile) URL.revokeObjectURL(selectedFile.objectUrl);
    setSelectedFile(null);
    setFileError(null);
    clearText();
    setToolState("idle");
    setOutput(null);
    setErrorMessage(null);
    setActiveSnippet(null);
    setRecoveryStats(null);
  };

  const handleReplace = () => { fileInputRef.current?.click(); };

  // --- Run Reviewer v2 (schema-aware transient flow) ---
  const handleRun = useCallback(async () => {
    if (!sessionId || !sessionInfo || !extractedFullText) return;

    const requestId = crypto.randomUUID();
    setOutput(null);
    setErrorMessage(null);
    setActiveSnippet(null);

    // Stage 1: Schema-aware field recovery (local, deterministic)
    setToolState("recovering");

    let structured_answers: any[] = [];
    let unanswered_fields: any[] = [];
    let human_review_fields: any[] = [];

    if (schemaFields && schemaFields.length > 0) {
      try {
        const recovery = recoverFieldsFromDocument(extractedFullText, schemaFields);
        structured_answers = recovery.structured_answers;
        unanswered_fields = recovery.unanswered_fields;
        human_review_fields = recovery.human_review_fields;

        const answered = structured_answers.filter((a) => !a.missing && !a.requires_human_review).length;
        setRecoveryStats({
          answered,
          missing: unanswered_fields.length,
          humanReview: human_review_fields.length,
        });
      } catch (err) {
        console.warn("[Reviewer] Field recovery failed, proceeding with text-only:", err);
      }
    }

    // Stage 2: Send transient payload to run-reviewer
    setToolState("running");

    logEvent({
      eventType: "tool.run.started",
      sessionId,
      requestId,
      toolName: "run_reviewer_v2",
      metadata: {
        file_size_bytes: selectedFile?.file.size ?? 0,
        page_count: pageCount,
        text_length: extractedFullText.length,
        structured_answers_count: structured_answers.length,
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
        structured_answers,
        unanswered_fields,
        human_review_fields,
      };

      const { data, error } = await supabase.functions.invoke("run-reviewer", {
        body: payload,
      });

      if (error) {
        throw new Error(error.message || "Edge function invocation failed");
      }

      if (data?.error) {
        const code = data.error.code || "UNKNOWN";
        const msg = data.error.message || "Review failed";

        logEvent({
          eventType: "tool.run.failed",
          sessionId,
          requestId,
          toolName: "run_reviewer_v2",
          result: "failure",
          metadata: { error_code: code },
        });

        setErrorMessage(`${msg} (${code})`);
        setToolState("error");
        return;
      }

      if (!data?.review_report) {
        throw new Error("Invalid response from reviewer");
      }

      const report = data.review_report as ReviewerV2Report;

      logEvent({
        eventType: "tool.run.completed",
        sessionId,
        requestId,
        toolName: "run_reviewer_v2",
        result: "success",
        metadata: {
          issue_count: report.metrics.issue_count,
          high_severity_count: report.metrics.high_severity_count,
          overall_risk: report.summary.overall_risk,
        },
      });

      setOutput(report);
      setToolState("success");
    } catch (err: any) {
      console.error("[Reviewer] Run failed:", err);

      logEvent({
        eventType: "tool.run.failed",
        sessionId,
        requestId,
        toolName: "run_reviewer_v2",
        result: "failure",
        metadata: { error_message: err?.message?.slice(0, 100) ?? "unknown" },
      });

      setErrorMessage(err?.message || "An unexpected error occurred.");
      setToolState("error");
    }
  }, [sessionId, sessionInfo, extractedFullText, selectedFile, pageCount, schemaFields, logEvent]);

  const handleClear = () => {
    handleRemoveFile();
    setOutput(null);
    setErrorMessage(null);
    setToolState("idle");
  };

  // --- Highlight / Jump ---
  const handleHighlight = useCallback((snippet: string) => {
    setActiveSnippet(snippet);
    setTimeout(() => {
      const mark = textPanelRef.current?.querySelector("mark");
      if (mark) {
        mark.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 50);
  }, []);

  // --- Copy ---
  const handleCopyAll = async () => {
    if (!output) return;
    const text = ISSUE_TYPES.map((type) => {
      const issues = output.issues.filter((i) => i.type === type);
      if (issues.length === 0) return "";
      return `## ${ISSUE_TYPE_META[type].label}\n${issues
        .map((i) => `- [${i.severity.toUpperCase()}] ${i.explanation}${i.excerpt ? ` — "${i.excerpt}"` : ""}`)
        .join("\n")}`;
    })
      .filter(Boolean)
      .join("\n\n");
    await navigator.clipboard.writeText(text);
    setCopiedCategory("__all__");
    setTimeout(() => setCopiedCategory(null), 2000);
  };

  const handleCopyType = async (type: ReviewIssueType) => {
    if (!output) return;
    const issues = output.issues.filter((i) => i.type === type);
    const text = issues
      .map((i) => `[${i.severity.toUpperCase()}] ${i.explanation}${i.excerpt ? ` — "${i.excerpt}"` : ""}`)
      .join("\n");
    await navigator.clipboard.writeText(text);
    setCopiedCategory(type);
    setTimeout(() => setCopiedCategory(null), 2000);
  };

  const handleBack = () => navigate("/dashboard");

  const totalIssues = output ? output.metrics.issue_count : 0;

  // Group issues by type
  const issuesByType = output
    ? ISSUE_TYPES.reduce((acc, type) => {
        acc[type] = output.issues.filter((i) => i.type === type);
        return acc;
      }, {} as Record<ReviewIssueType, ReviewIssue[]>)
    : null;

  // Page-level loading/error
  if (pageLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Shield className="h-8 w-8 mx-auto text-primary animate-pulse mb-2" />
          <p className="text-muted-foreground">Loading reviewer tool...</p>
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

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="border-b border-border bg-card shrink-0">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={handleBack}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <div className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-primary" />
                  <h1 className="text-xl font-semibold text-foreground">Run Reviewer</h1>
                </div>
                <p className="text-sm text-muted-foreground">
                  {sessionInfo.caseLabel}
                  {sessionInfo.interactionType && ` · ${sessionInfo.interactionType}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {schemaFields && (
                <Badge variant="outline" className="text-xs text-primary border-primary/30">
                  Schema-aware · {schemaFields.length} fields
                </Badge>
              )}
              {sessionId && (
                <Badge variant="outline" className="text-xs font-mono text-muted-foreground">
                  Session: {sessionId.slice(0, 8)}…
                </Badge>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {/* Banner */}
        <div className="container mx-auto px-6 pt-4 max-w-[1600px]">
          <Alert className="mb-4 border-primary/20 bg-primary/5">
            <Info className="h-4 w-4 text-primary" />
            <AlertDescription className="text-sm text-muted-foreground">
              Upload a completed PDF to check for tone, bias, policy language, and completeness.
              <strong className="block mt-1 text-foreground">
                Files are extracted locally in your browser. Nothing is uploaded or stored.
              </strong>
            </AlertDescription>
          </Alert>
        </div>

        {/* 3-panel layout (or upload state) */}
        <div className="flex-1 overflow-hidden container mx-auto px-6 pb-4 max-w-[1600px]">
          {!selectedFile ? (
            /* Upload zone (centered) */
            <div className="max-w-lg mx-auto mt-8">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Upload Completed Document</CardTitle>
                  <CardDescription>
                    Upload the filled-out document you want reviewed. Text is extracted locally — nothing leaves your browser.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf"
                    onChange={handleFileInputChange}
                    className="sr-only"
                    aria-label="Upload PDF file"
                  />
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        fileInputRef.current?.click();
                      }
                    }}
                    onDrop={handleDrop}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    className={cn(
                      "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      isDragging
                        ? "border-primary bg-primary/5"
                        : "border-muted-foreground/25 hover:border-primary/50 hover:bg-accent/30"
                    )}
                  >
                    <Upload className="h-8 w-8 mx-auto text-muted-foreground/50 mb-3" />
                    <p className="text-sm font-medium text-foreground mb-1">
                      Drag & drop your PDF here
                    </p>
                    <p className="text-xs text-muted-foreground mb-3">or click to choose a file</p>
                    <Button type="button" variant="outline" size="sm" className="pointer-events-none">
                      Choose file
                    </Button>
                    <p className="text-xs text-muted-foreground mt-3">
                      PDF only · Max {MAX_FILE_SIZE_MB}MB
                    </p>
                  </div>
                  {fileError && (
                    <div className="flex items-center gap-2 text-destructive">
                      <FileWarning className="h-4 w-4 shrink-0" />
                      <p className="text-xs font-medium">{fileError}</p>
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : (
            /* 3-panel layout */
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 h-full">
              {/* Left: PDF Preview */}
              <div className="lg:col-span-4 flex flex-col min-h-0">
                <Card className="flex-1 flex flex-col overflow-hidden">
                  <CardHeader className="pb-2 shrink-0">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium">PDF Preview</CardTitle>
                      <div className="flex items-center gap-1">
                        <Button variant="outline" size="sm" onClick={handleReplace} className="text-xs gap-1 h-7">
                          <RefreshCw className="h-3 w-3" /> Replace
                        </Button>
                        <Button variant="outline" size="sm" onClick={handleRemoveFile} className="text-xs gap-1 h-7 text-destructive hover:text-destructive">
                          <X className="h-3 w-3" /> Remove
                        </Button>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <FileText className="h-4 w-4 text-muted-foreground" />
                      <span className="text-xs text-muted-foreground truncate">{selectedFile.file.name}</span>
                      <span className="text-xs text-muted-foreground">({formatFileSize(selectedFile.file.size)})</span>
                      {pageCount > 0 && (
                        <Badge variant="secondary" className="text-xs">{pageCount} pages</Badge>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 overflow-hidden p-2">
                    <div className="rounded-lg border overflow-hidden bg-muted/30 h-full">
                      <iframe
                        src={selectedFile.objectUrl}
                        title="PDF preview"
                        className="w-full h-full"
                        style={{ border: "none", minHeight: 400 }}
                      />
                    </div>
                  </CardContent>
                </Card>
                {/* Hidden file input for replace */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/pdf"
                  onChange={handleFileInputChange}
                  className="sr-only"
                />
              </div>

              {/* Middle: Extracted Text */}
              <div className="lg:col-span-4 flex flex-col min-h-0">
                <Card className="flex-1 flex flex-col overflow-hidden">
                  <CardHeader className="pb-2 shrink-0">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium">Extracted Text</CardTitle>
                      {activeSnippet && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-xs h-7"
                          onClick={() => setActiveSnippet(null)}
                        >
                          Clear highlight
                        </Button>
                      )}
                    </div>
                    <CardDescription className="text-xs">
                      Extracted locally in your browser · Not stored anywhere
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="flex-1 overflow-hidden p-2">
                    <ScrollArea className="h-full" style={{ minHeight: 400 }}>
                      <div ref={textPanelRef} className="p-3 space-y-4 text-sm leading-relaxed">
                        {extracting && (
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <Loader2 className="h-4 w-4 animate-spin" />
                            <span className="text-xs">Extracting text…</span>
                          </div>
                        )}
                        {extractError && (
                          <div className="text-destructive text-xs">{extractError}</div>
                        )}
                        {!extracting && extractedPages.length === 0 && !extractError && (
                          <p className="text-xs text-muted-foreground">No text extracted yet.</p>
                        )}
                        {extractedPages.map((page) => (
                          <div key={page.pageNumber}>
                            <Badge variant="outline" className="text-xs mb-2">
                              Page {page.pageNumber}
                            </Badge>
                            <p className="text-foreground whitespace-pre-wrap break-words">
                              {page.text
                                ? renderHighlightedText(page.text, activeSnippet)
                                : <span className="text-muted-foreground italic">(no text on this page)</span>}
                            </p>
                          </div>
                        ))}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>

              {/* Right: Review Results */}
              <div className="lg:col-span-4 flex flex-col min-h-0">
                <Card className="flex-1 flex flex-col overflow-hidden">
                  <CardHeader className="pb-2 shrink-0">
                    <CardTitle className="text-sm font-medium">Review Results</CardTitle>
                  </CardHeader>
                  <CardContent className="flex-1 overflow-hidden p-2">
                    <ScrollArea className="h-full" style={{ minHeight: 400 }}>
                      <div className="p-2 space-y-4">
                        {/* Idle / Ready */}
                        {(toolState === "idle" || toolState === "ready") && !output && (
                          <div className="text-center py-8">
                            <Shield className="h-8 w-8 mx-auto text-muted-foreground/30 mb-3" />
                            <p className="text-sm text-muted-foreground mb-1">
                              {extracting
                                ? "Extracting text from PDF…"
                                : canRun
                                  ? "Ready to review"
                                  : "Waiting for text extraction"}
                            </p>
                            {schemaFields && canRun && (
                              <p className="text-xs text-primary/70 mt-2">
                                Schema-aware review: {schemaFields.length} fields will be checked
                              </p>
                            )}
                          </div>
                        )}

                        {/* Recovering */}
                        {toolState === "recovering" && (
                          <div className="text-center py-8">
                            <Loader2 className="h-8 w-8 mx-auto text-primary animate-spin mb-3" />
                            <p className="text-sm text-muted-foreground">Recovering field structure…</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              Matching document content to template fields
                            </p>
                          </div>
                        )}

                        {/* Running */}
                        {toolState === "running" && (
                          <div className="text-center py-8">
                            <Loader2 className="h-8 w-8 mx-auto text-primary animate-spin mb-3" />
                            <p className="text-sm text-muted-foreground">Analyzing document…</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              Checking tone, bias, policy language, and completeness
                            </p>
                            {recoveryStats && (
                              <div className="flex items-center justify-center gap-3 mt-3">
                                <Badge variant="outline" className="text-[10px]">
                                  {recoveryStats.answered} fields recovered
                                </Badge>
                                {recoveryStats.missing > 0 && (
                                  <Badge variant="secondary" className="text-[10px]">
                                    {recoveryStats.missing} missing
                                  </Badge>
                                )}
                              </div>
                            )}
                          </div>
                        )}

                        {/* Error */}
                        {toolState === "error" && (
                          <div className="text-center py-8">
                            <AlertTriangle className="h-8 w-8 mx-auto text-destructive/50 mb-3" />
                            <p className="text-sm text-destructive font-medium mb-1">Review failed</p>
                            <p className="text-xs text-muted-foreground mb-3">{errorMessage}</p>
                            <Button variant="outline" size="sm" onClick={handleRun}>
                              Try again
                            </Button>
                          </div>
                        )}

                        {/* Success */}
                        {toolState === "success" && output && issuesByType && (
                          <div className="space-y-3">
                            {/* Summary */}
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
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={handleCopyAll}
                                className="gap-1 h-7 text-xs"
                              >
                                {copiedCategory === "__all__" ? (
                                  <><Check className="h-3 w-3" /> Copied</>
                                ) : (
                                  <><Copy className="h-3 w-3" /> Copy all</>
                                )}
                              </Button>
                            </div>

                            {/* Key findings */}
                            {output.summary.key_findings.length > 0 && (
                              <div className="rounded-lg border p-2.5 bg-accent/20">
                                <p className="text-[10px] uppercase font-medium text-muted-foreground mb-1.5">Key Findings</p>
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
                                <Badge variant="outline" className="text-[10px]">
                                  {recoveryStats.answered} fields answered
                                </Badge>
                                {recoveryStats.missing > 0 && (
                                  <Badge variant="outline" className="text-[10px] text-amber-600 border-amber-300">
                                    {recoveryStats.missing} missing
                                  </Badge>
                                )}
                                {recoveryStats.humanReview > 0 && (
                                  <Badge variant="outline" className="text-[10px]">
                                    {recoveryStats.humanReview} human-review
                                  </Badge>
                                )}
                              </div>
                            )}

                            <p className="text-xs text-muted-foreground italic">
                              AI-generated audit — review before acting.
                            </p>

                            {totalIssues === 0 && (
                              <div className="text-center py-6">
                                <Badge variant="outline" className="text-primary border-primary/30 px-4 py-2">
                                  No issues found — documentation looks good!
                                </Badge>
                              </div>
                            )}

                            {/* Issue groups by type */}
                            {ISSUE_TYPES.map((type) => {
                              const issues = issuesByType[type];
                              if (!issues || issues.length === 0) return null;
                              const meta = ISSUE_TYPE_META[type];
                              const Icon = meta.icon;

                              return (
                                <div key={type} className="space-y-2">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                                      <span className="text-xs font-medium text-foreground">{meta.label}</span>
                                      <Badge variant="secondary" className="text-[10px] px-1.5 h-4">
                                        {issues.length}
                                      </Badge>
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-1.5 text-[10px] text-muted-foreground"
                                      onClick={() => handleCopyType(type)}
                                    >
                                      {copiedCategory === type ? (
                                        <><Check className="h-2.5 w-2.5 mr-0.5" /> Copied</>
                                      ) : (
                                        <><Copy className="h-2.5 w-2.5 mr-0.5" /> Copy</>
                                      )}
                                    </Button>
                                  </div>

                                  {issues.map((issue, i) => {
                                    const sev = SEVERITY_CONFIG[issue.severity];
                                    const isActive = activeSnippet === issue.excerpt && issue.excerpt.length > 0;

                                    return (
                                      <div
                                        key={i}
                                        className={cn(
                                          "p-2.5 rounded-lg border text-sm",
                                          isActive ? "border-yellow-400 bg-yellow-50 dark:bg-yellow-900/20" : "bg-accent/20"
                                        )}
                                      >
                                        <div className="flex items-start gap-2">
                                          <Badge variant={sev.variant} className="text-[10px] shrink-0 mt-0.5 px-1.5">
                                            {sev.label}
                                          </Badge>
                                          <div className="flex-1 min-w-0">
                                            <p className="text-xs text-foreground leading-relaxed">{issue.explanation}</p>
                                            {issue.field_key && (
                                              <p className="text-[10px] text-muted-foreground mt-0.5 font-mono">
                                                Field: {issue.field_key}
                                              </p>
                                            )}
                                            {issue.excerpt && (
                                              <p className="text-[11px] text-muted-foreground mt-1 italic border-l-2 border-muted pl-2">
                                                "{issue.excerpt}"
                                              </p>
                                            )}
                                          </div>
                                        </div>
                                        {issue.excerpt && issue.excerpt.length > 0 && (
                                          <div className="flex items-center gap-1 mt-2 pt-1.5 border-t border-border">
                                            <Button
                                              variant={isActive ? "secondary" : "ghost"}
                                              size="sm"
                                              className="h-6 px-2 text-[10px] gap-1"
                                              onClick={() => handleHighlight(isActive ? "" : issue.excerpt)}
                                            >
                                              <Search className="h-2.5 w-2.5" />
                                              {isActive ? "Unhighlight" : "Highlight"}
                                            </Button>
                                            <Button
                                              variant="ghost"
                                              size="sm"
                                              className="h-6 px-2 text-[10px] gap-1"
                                              onClick={async () => {
                                                await navigator.clipboard.writeText(
                                                  `[${issue.severity.toUpperCase()}] ${issue.explanation}${issue.excerpt ? ` — "${issue.excerpt}"` : ""}`
                                                );
                                              }}
                                            >
                                              <Copy className="h-2.5 w-2.5" /> Copy
                                            </Button>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </ScrollArea>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Action Bar */}
      <div className="border-t border-border bg-card shrink-0">
        <div className="container mx-auto px-6 py-3 max-w-[1600px] flex items-center justify-between">
          <Button variant="outline" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
          <div className="flex items-center gap-2">
            {(selectedFile || output || toolState === "error") && (
              <Button variant="outline" onClick={handleClear} className="gap-1.5">
                <RotateCcw className="h-4 w-4" />
                Clear
              </Button>
            )}
            {selectedFile && (
              <Button onClick={handleRun} disabled={!canRun}>
                {toolState === "running" || toolState === "recovering" ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Analyzing…</>
                ) : (
                  <><Shield className="h-4 w-4 mr-2" /> Run Reviewer</>
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
