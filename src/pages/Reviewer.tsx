import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Shield, Info, Loader2, Copy, Check, RotateCcw,
  AlertTriangle, MessageSquare, Scale, CheckSquare, Eye,
  Upload, FileText, X, RefreshCw, CheckCircle2, FileWarning,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  type ReviewerOutput,
  type CategorizedFlag,
  type FlagCategory,
  type FlagSeverity,
  FLAG_CATEGORIES,
  FLAG_CATEGORY_META,
  MOCK_REVIEWER_OUTPUT,
} from "@/lib/tools/reviewer-types";

type ToolState = "idle" | "ready" | "running" | "success" | "error" | "cleared";

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

export default function Reviewer() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  // Tool state
  const [toolState, setToolState] = useState<ToolState>("idle");
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [contextText, setContextText] = useState("");
  const [output, setOutput] = useState<ReviewerOutput | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedCategory, setCopiedCategory] = useState<string | null>(null);
  const [simulateError, setSimulateError] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // Cleanup object URL on unmount or file change
  useEffect(() => {
    return () => {
      if (selectedFile) {
        URL.revokeObjectURL(selectedFile.objectUrl);
      }
    };
  }, [selectedFile]);

  const canRun = selectedFile !== null && !fileError && toolState !== "running";

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

    // Revoke previous URL
    if (selectedFile) {
      URL.revokeObjectURL(selectedFile.objectUrl);
    }

    const objectUrl = URL.createObjectURL(file);
    setSelectedFile({ file, objectUrl });
    setToolState("ready");
    setOutput(null);
    setErrorMessage(null);
  }, [selectedFile]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) validateAndSetFile(file);
    // Reset input so re-selecting same file triggers change
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) validateAndSetFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleRemoveFile = () => {
    if (selectedFile) {
      URL.revokeObjectURL(selectedFile.objectUrl);
    }
    setSelectedFile(null);
    setFileError(null);
    setToolState("idle");
    setOutput(null);
    setErrorMessage(null);
  };

  const handleReplace = () => {
    fileInputRef.current?.click();
  };

  const handleRun = useCallback(async () => {
    setToolState("running");
    setOutput(null);
    setErrorMessage(null);

    const delay = 800 + Math.random() * 400;
    await new Promise((r) => setTimeout(r, delay));

    if (simulateError) {
      setToolState("error");
      setErrorMessage("Session has no template_id assigned. Create a session with a template first.");
      return;
    }

    setOutput(MOCK_REVIEWER_OUTPUT);
    setToolState("success");
  }, [simulateError]);

  const handleClear = () => {
    handleRemoveFile();
    setContextText("");
    setOutput(null);
    setErrorMessage(null);
    setToolState("idle");
  };

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

  // ── Page-level loading/error ──
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
      {/* ── Header ── */}
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

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="container mx-auto px-6 py-6 max-w-5xl">
          {/* Intent guardrail */}
          <Alert className="mb-6 border-primary/20 bg-primary/5">
            <Info className="h-4 w-4 text-primary" />
            <AlertDescription className="text-sm text-muted-foreground">
              Upload a PDF to check for tone, bias, policy language, and completeness.
              <strong className="block mt-1 text-foreground">
                AidMind does not store or edit your files. Your upload is used only for this review.
              </strong>
            </AlertDescription>
          </Alert>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* ── Left: Upload Panel ── */}
            <div className="lg:col-span-2 space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Upload PDF</CardTitle>
                  <CardDescription>
                    Upload the document you want reviewed. Files are processed in memory only.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Hidden file input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf"
                    onChange={handleFileInputChange}
                    className="sr-only"
                    aria-label="Upload PDF file"
                  />

                  {!selectedFile ? (
                    /* Drop zone */
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
                      <p className="text-xs text-muted-foreground mb-3">
                        or click to choose a file
                      </p>
                      <Button type="button" variant="outline" size="sm" className="pointer-events-none">
                        Choose file
                      </Button>
                      <p className="text-xs text-muted-foreground mt-3">
                        PDF only · Max {MAX_FILE_SIZE_MB}MB
                      </p>
                    </div>
                  ) : (
                    /* File selected card */
                    <div className="border rounded-lg p-4 bg-accent/20">
                      <div className="flex items-start gap-3">
                        <FileText className="h-8 w-8 text-primary shrink-0 mt-0.5" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground truncate">
                            {selectedFile.file.name}
                          </p>
                          <p className="text-xs text-muted-foreground mt-0.5">
                            {formatFileSize(selectedFile.file.size)}
                          </p>
                          <Badge variant="secondary" className="mt-2 text-xs gap-1">
                            <CheckCircle2 className="h-3 w-3" />
                            Ready
                          </Badge>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-3 pt-3 border-t border-border">
                        <Button variant="outline" size="sm" onClick={handleReplace} className="text-xs gap-1.5">
                          <RefreshCw className="h-3 w-3" />
                          Replace
                        </Button>
                        <Button variant="outline" size="sm" onClick={handleRemoveFile} className="text-xs gap-1.5 text-destructive hover:text-destructive">
                          <X className="h-3 w-3" />
                          Remove
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* File error */}
                  {fileError && (
                    <div className="flex items-center gap-2 text-destructive">
                      <FileWarning className="h-4 w-4 shrink-0" />
                      <p className="text-xs font-medium">{fileError}</p>
                    </div>
                  )}

                  <p className="text-xs text-muted-foreground">
                    Files are cleared when you leave this page.
                  </p>
                </CardContent>
              </Card>

              {/* Optional context */}
              <Card>
                <CardContent className="pt-5 space-y-2">
                  <Label htmlFor="reviewer-context" className="text-sm text-foreground">
                    Optional context <span className="text-muted-foreground font-normal">(not stored)</span>
                  </Label>
                  <Input
                    id="reviewer-context"
                    placeholder="e.g., intake summary, case type, program…"
                    value={contextText}
                    onChange={(e) => setContextText(e.target.value)}
                    className="text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Used only for this review. Cleared when you leave the page.
                  </p>
                </CardContent>
              </Card>

              {/* Dev toggle */}
              {import.meta.env.DEV && (
                <Card className="border-dashed border-muted-foreground/30">
                  <CardContent className="py-3">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={simulateError}
                        onChange={(e) => setSimulateError(e.target.checked)}
                        className="rounded"
                      />
                      <span className="text-xs text-muted-foreground">Simulate error (dev only)</span>
                    </label>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* ── Right: Preview + Output Panel ── */}
            <div className="lg:col-span-3 space-y-4">
              {/* Idle / Ready — no results yet */}
              {(toolState === "idle" || toolState === "ready" || toolState === "cleared") && !output && (
                <>
                  {!selectedFile ? (
                    /* Empty state */
                    <Card className="border-dashed">
                      <CardContent className="py-16 text-center">
                        <Shield className="h-10 w-10 mx-auto text-muted-foreground/30 mb-4" />
                        <p className="text-sm text-muted-foreground">
                          Upload a PDF on the left, then click Run Reviewer.
                        </p>
                      </CardContent>
                    </Card>
                  ) : (
                    /* PDF preview + checklist */
                    <div className="space-y-4">
                      <Card>
                        <CardHeader className="pb-2">
                          <CardTitle className="text-sm font-medium">Document Preview</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="rounded-lg border overflow-hidden bg-muted/30" style={{ height: 400 }}>
                            <iframe
                              src={selectedFile.objectUrl}
                              title="PDF preview"
                              className="w-full h-full"
                              style={{ border: "none" }}
                            />
                          </div>
                        </CardContent>
                      </Card>

                      {/* Readiness checklist */}
                      <Card>
                        <CardContent className="py-4">
                          <div className="space-y-2">
                            <div className="flex items-center gap-2 text-sm">
                              <CheckCircle2 className="h-4 w-4 text-primary" />
                              <span className="text-foreground">PDF selected</span>
                            </div>
                            <div className="flex items-center gap-2 text-sm">
                              <CheckCircle2 className="h-4 w-4 text-primary" />
                              <span className="text-foreground">Ready to run</span>
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    </div>
                  )}
                </>
              )}

              {/* Running */}
              {toolState === "running" && (
                <Card>
                  <CardContent className="py-16 text-center">
                    <Loader2 className="h-10 w-10 mx-auto text-primary animate-spin mb-4" />
                    <p className="text-sm text-muted-foreground">Analyzing your documentation…</p>
                    <p className="text-xs text-muted-foreground mt-1">Checking tone, bias, policy language, and completeness.</p>
                  </CardContent>
                </Card>
              )}

              {/* Error */}
              {toolState === "error" && (
                <Card className="border-destructive/30">
                  <CardContent className="py-10 text-center">
                    <AlertTriangle className="h-10 w-10 mx-auto text-destructive/50 mb-4" />
                    <p className="text-sm text-destructive font-medium mb-1">Review failed</p>
                    <p className="text-xs text-muted-foreground">{errorMessage}</p>
                    <Button variant="outline" size="sm" className="mt-4" onClick={handleRun}>
                      Try again
                    </Button>
                  </CardContent>
                </Card>
              )}

              {/* Success */}
              {toolState === "success" && output && (
                <div className="space-y-4">
                  {/* Mock label */}
                  <Badge variant="outline" className="text-xs text-muted-foreground border-muted-foreground/30">
                    Preview (mock)
                  </Badge>

                  {/* Summary bar */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Badge variant="secondary" className="text-xs">
                        {totalFlags} {totalFlags === 1 ? "flag" : "flags"} found
                      </Badge>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCopyAll}
                      className="gap-1.5"
                    >
                      {copiedCategory === "__all__" ? (
                        <><Check className="h-3.5 w-3.5" /> Copied</>
                      ) : (
                        <><Copy className="h-3.5 w-3.5" /> Copy all flags</>
                      )}
                    </Button>
                  </div>

                  {/* Review notice */}
                  <p className="text-xs text-muted-foreground italic">
                    Review and edit before using — these are AI-generated suggestions, not final determinations.
                  </p>

                  {totalFlags === 0 && (
                    <Card>
                      <CardContent className="py-8 text-center">
                        <Badge variant="outline" className="text-primary border-primary/30 px-4 py-2">
                          No flags found — documentation looks good!
                        </Badge>
                      </CardContent>
                    </Card>
                  )}

                  {/* Category cards */}
                  {FLAG_CATEGORIES.map((category) => {
                    const flags = output[category];
                    const meta = FLAG_CATEGORY_META[category];
                    const Icon = CATEGORY_ICONS[category];

                    return (
                      <Card key={category}>
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <Icon className="h-4 w-4 text-muted-foreground" />
                              <CardTitle className="text-sm font-medium">{meta.label}</CardTitle>
                              <Badge variant="secondary" className="text-xs">
                                {flags.length}
                              </Badge>
                            </div>
                            {flags.length > 0 && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 px-2 text-xs text-muted-foreground"
                                onClick={() => handleCopyCategory(category)}
                              >
                                {copiedCategory === category ? (
                                  <><Check className="h-3 w-3 mr-1" /> Copied</>
                                ) : (
                                  <><Copy className="h-3 w-3 mr-1" /> Copy</>
                                )}
                              </Button>
                            )}
                          </div>
                          <CardDescription className="text-xs">{meta.description}</CardDescription>
                        </CardHeader>
                        <CardContent>
                          {flags.length === 0 ? (
                            <p className="text-xs text-muted-foreground py-2">No issues found in this category.</p>
                          ) : (
                            <div className="space-y-2">
                              {flags.map((flag, i) => {
                                const sev = SEVERITY_CONFIG[flag.severity];
                                return (
                                  <div
                                    key={i}
                                    className="p-3 rounded-lg border bg-accent/20"
                                  >
                                    <div className="flex items-start gap-3">
                                      <Badge variant={sev.variant} className="text-xs shrink-0 mt-0.5">
                                        {sev.label}
                                      </Badge>
                                      <div className="flex-1 min-w-0">
                                        <p className="text-sm text-foreground leading-relaxed">{flag.message}</p>
                                        {flag.snippet && (
                                          <p className="text-xs text-muted-foreground mt-1.5 italic border-l-2 border-muted pl-2">
                                            "{flag.snippet}"
                                          </p>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom Action Bar ── */}
      <div className="border-t border-border bg-card shrink-0">
        <div className="container mx-auto px-6 py-3 max-w-5xl flex items-center justify-between">
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
            <Button
              onClick={handleRun}
              disabled={!canRun}
            >
              {toolState === "running" ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Reviewing…</>
              ) : (
                <><Shield className="h-4 w-4 mr-2" /> Run Reviewer</>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
