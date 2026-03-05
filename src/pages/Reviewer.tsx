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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useEyeLogger } from "@/hooks/useEyeLogger";
import { usePdfTextExtractor } from "@/hooks/usePdfTextExtractor";
import {
  type ReviewerOutput,
  type CategorizedFlag,
  type FlagCategory,
  type FlagSeverity,
  FLAG_CATEGORIES,
  FLAG_CATEGORY_META,
  MAX_REVIEWER_TEXT_LENGTH,
} from "@/lib/tools/reviewer-types";

type ToolState = "idle" | "ready" | "running" | "success" | "error";

interface SessionInfo {
  caseLabel: string;
  interactionType: string | null;
}

interface SelectedFile {
  file: File;
  objectUrl: string;
}

const MAX_FILE_SIZE_MB = 20;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const SEVERITY_CONFIG: Record<FlagSeverity, { variant: "destructive" | "default" | "secondary"; label: string }> = {
  high: { variant: "destructive", label: "High" },
  med: { variant: "default", label: "Medium" },
  low: { variant: "secondary", label: "Low" },
};

const CATEGORY_ICONS: Record<FlagCategory, typeof MessageSquare> = {
  tone_flags: MessageSquare,
  bias_flags: Eye,
  policy_language_flags: Scale,
  completeness_flags: CheckSquare,
};

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
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  // Tool state
  const [toolState, setToolState] = useState<ToolState>("idle");
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [output, setOutput] = useState<ReviewerOutput | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedCategory, setCopiedCategory] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [activeSnippet, setActiveSnippet] = useState<string | null>(null);

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

  // Load session info
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
          .select("case_label, interaction_type")
          .eq("session_id", sessionId)
          .maybeSingle();

        if (error) throw error;
        if (!data) {
          setPageError("Session not found");
        } else {
          setSessionInfo({
            caseLabel: data.case_label || "Untitled session",
            interactionType: data.interaction_type,
          });
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

  const canRun = selectedFile !== null && !fileError && !extracting && extractedFullText.length > 0 && toolState !== "running";

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

    // Extract text immediately
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
  };

  const handleReplace = () => { fileInputRef.current?.click(); };

  // --- Run Reviewer (real edge function call) ---
  const handleRun = useCallback(async () => {
    if (!sessionId || !extractedFullText) return;

    const requestId = crypto.randomUUID();
    setToolState("running");
    setOutput(null);
    setErrorMessage(null);
    setActiveSnippet(null);

    // Eye: started
    logEvent({
      eventType: "tool.run.started",
      sessionId,
      requestId,
      toolName: "run_reviewer",
      metadata: {
        file_size_bytes: selectedFile?.file.size ?? 0,
        page_count: pageCount,
        text_length: extractedFullText.length,
      },
    });

    // Truncate text if needed
    const textToSend = extractedFullText.length > MAX_REVIEWER_TEXT_LENGTH
      ? extractedFullText.slice(0, MAX_REVIEWER_TEXT_LENGTH)
      : extractedFullText;

    try {
      const { data, error } = await supabase.functions.invoke("run-reviewer", {
        body: { session_id: sessionId, text: textToSend },
      });

      if (error) {
        throw new Error(error.message || "Edge function invocation failed");
      }

      // Check for error response shape
      if (data?.error) {
        const code = data.error.code || "UNKNOWN";
        const msg = data.error.message || "Review failed";

        logEvent({
          eventType: "tool.run.failed",
          sessionId,
          requestId,
          toolName: "run_reviewer",
          result: "failure",
          metadata: { error_code: code },
        });

        setErrorMessage(`${msg} (${code})`);
        setToolState("error");
        return;
      }

      // Validate we got flag arrays
      if (!data?.tone_flags || !data?.bias_flags || !data?.policy_language_flags || !data?.completeness_flags) {
        throw new Error("Invalid response schema from reviewer");
      }

      const result: ReviewerOutput = {
        tone_flags: data.tone_flags,
        bias_flags: data.bias_flags,
        policy_language_flags: data.policy_language_flags,
        completeness_flags: data.completeness_flags,
      };

      const totalFlags = FLAG_CATEGORIES.reduce((sum, cat) => sum + result[cat].length, 0);

      logEvent({
        eventType: "tool.run.completed",
        sessionId,
        requestId,
        toolName: "run_reviewer",
        result: "success",
        metadata: {
          total_flags: totalFlags,
          tone_count: result.tone_flags.length,
          bias_count: result.bias_flags.length,
          policy_count: result.policy_language_flags.length,
          completeness_count: result.completeness_flags.length,
        },
      });

      setOutput(result);
      setToolState("success");
    } catch (err: any) {
      console.error("[Reviewer] Run failed:", err);

      logEvent({
        eventType: "tool.run.failed",
        sessionId,
        requestId,
        toolName: "run_reviewer",
        result: "failure",
        metadata: { error_message: err?.message?.slice(0, 100) ?? "unknown" },
      });

      setErrorMessage(err?.message || "An unexpected error occurred.");
      setToolState("error");
    }
  }, [sessionId, extractedFullText, selectedFile, pageCount, logEvent]);

  const handleClear = () => {
    handleRemoveFile();
    setOutput(null);
    setErrorMessage(null);
    setToolState("idle");
  };

  // --- Highlight / Jump ---
  const handleHighlight = useCallback((snippet: string) => {
    setActiveSnippet(snippet);
    // Scroll to first mark in text panel
    setTimeout(() => {
      const mark = textPanelRef.current?.querySelector("mark");
      if (mark) {
        mark.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }, 50);
  }, []);

  // --- Copy ---
  const handleCopyCategory = async (category: FlagCategory) => {
    if (!output) return;
    const flags = output[category];
    const text = flags
      .map((f) => `[${f.severity.toUpperCase()}] ${f.message}${f.snippet ? ` — "${f.snippet}"` : ""}`)
      .join("\n");
    await navigator.clipboard.writeText(text);
    setCopiedCategory(category);
    setTimeout(() => setCopiedCategory(null), 2000);
  };

  const handleCopyAll = async () => {
    if (!output) return;
    const text = FLAG_CATEGORIES.map((cat) => {
      const flags = output[cat];
      if (flags.length === 0) return "";
      return `## ${FLAG_CATEGORY_META[cat].label}\n${flags
        .map((f) => `- [${f.severity.toUpperCase()}] ${f.message}${f.snippet ? ` — "${f.snippet}"` : ""}`)
        .join("\n")}`;
    })
      .filter(Boolean)
      .join("\n\n");
    await navigator.clipboard.writeText(text);
    setCopiedCategory("__all__");
    setTimeout(() => setCopiedCategory(null), 2000);
  };

  const handleBack = () => navigate("/dashboard");

  const totalFlags = output
    ? FLAG_CATEGORIES.reduce((sum, cat) => sum + output[cat].length, 0)
    : 0;

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
            {sessionId && (
              <Badge variant="outline" className="text-xs font-mono text-muted-foreground">
                Session: {sessionId.slice(0, 8)}…
              </Badge>
            )}
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
              Upload a PDF to check for tone, bias, policy language, and completeness.
              <strong className="block mt-1 text-foreground">
                AidMind does not store or edit your files. Your upload is used only for this review.
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
                  <CardTitle className="text-base">Upload PDF</CardTitle>
                  <CardDescription>
                    Upload the document you want reviewed. Files are processed in memory only.
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
                      <CardTitle className="text-sm font-medium">Reviewed Text</CardTitle>
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
                      Extracted in-browser · Not stored · Cleared on leave
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

              {/* Right: Suggestions */}
              <div className="lg:col-span-4 flex flex-col min-h-0">
                <Card className="flex-1 flex flex-col overflow-hidden">
                  <CardHeader className="pb-2 shrink-0">
                    <CardTitle className="text-sm font-medium">Suggestions</CardTitle>
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
                            {extractedFullText.length > MAX_REVIEWER_TEXT_LENGTH && (
                              <p className="text-xs text-amber-600 mt-2">
                                Text will be truncated to {MAX_REVIEWER_TEXT_LENGTH.toLocaleString()} characters.
                              </p>
                            )}
                          </div>
                        )}

                        {/* Running */}
                        {toolState === "running" && (
                          <div className="text-center py-8">
                            <Loader2 className="h-8 w-8 mx-auto text-primary animate-spin mb-3" />
                            <p className="text-sm text-muted-foreground">Analyzing your document…</p>
                            <p className="text-xs text-muted-foreground mt-1">
                              Checking tone, bias, policy language, and completeness.
                            </p>
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
                        {toolState === "success" && output && (
                          <div className="space-y-3">
                            {/* Summary */}
                            <div className="flex items-center justify-between">
                              <Badge variant="secondary" className="text-xs">
                                {totalFlags} {totalFlags === 1 ? "flag" : "flags"} found
                              </Badge>
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

                            <p className="text-xs text-muted-foreground italic">
                              AI-generated suggestions — review before applying.
                            </p>

                            {totalFlags === 0 && (
                              <div className="text-center py-6">
                                <Badge variant="outline" className="text-primary border-primary/30 px-4 py-2">
                                  No flags found — documentation looks good!
                                </Badge>
                              </div>
                            )}

                            {/* Category groups */}
                            {FLAG_CATEGORIES.map((category) => {
                              const flags = output[category];
                              const meta = FLAG_CATEGORY_META[category];
                              const Icon = CATEGORY_ICONS[category];

                              if (flags.length === 0) return null;

                              return (
                                <div key={category} className="space-y-2">
                                  <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                                      <span className="text-xs font-medium text-foreground">{meta.label}</span>
                                      <Badge variant="secondary" className="text-[10px] px-1.5 h-4">
                                        {flags.length}
                                      </Badge>
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 px-1.5 text-[10px] text-muted-foreground"
                                      onClick={() => handleCopyCategory(category)}
                                    >
                                      {copiedCategory === category ? (
                                        <><Check className="h-2.5 w-2.5 mr-0.5" /> Copied</>
                                      ) : (
                                        <><Copy className="h-2.5 w-2.5 mr-0.5" /> Copy</>
                                      )}
                                    </Button>
                                  </div>

                                  {flags.map((flag, i) => {
                                    const sev = SEVERITY_CONFIG[flag.severity];
                                    const isActive = activeSnippet === flag.snippet && flag.snippet.length > 0;

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
                                            <p className="text-xs text-foreground leading-relaxed">{flag.message}</p>
                                            {flag.snippet && (
                                              <p className="text-[11px] text-muted-foreground mt-1 italic border-l-2 border-muted pl-2">
                                                "{flag.snippet}"
                                              </p>
                                            )}
                                          </div>
                                        </div>
                                        {flag.snippet && flag.snippet.length > 0 && (
                                          <div className="flex items-center gap-1 mt-2 pt-1.5 border-t border-border">
                                            <Button
                                              variant={isActive ? "secondary" : "ghost"}
                                              size="sm"
                                              className="h-6 px-2 text-[10px] gap-1"
                                              onClick={() => handleHighlight(isActive ? "" : flag.snippet)}
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
                                                  `[${flag.severity.toUpperCase()}] ${flag.message}${flag.snippet ? ` — "${flag.snippet}"` : ""}`
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
                {toolState === "running" ? (
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
