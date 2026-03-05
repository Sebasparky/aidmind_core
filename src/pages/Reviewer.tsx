import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Shield, Info, Loader2, Copy, Check, RotateCcw,
  AlertTriangle, MessageSquare, Scale, CheckSquare, Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  type ReviewerOutput,
  type CategorizedFlag,
  type FlagCategory,
  type FlagSeverity,
  FLAG_CATEGORIES,
  FLAG_CATEGORY_META,
  MAX_REVIEWER_TEXT_LENGTH,
  MOCK_REVIEWER_OUTPUT,
} from "@/lib/tools/reviewer-types";

type ToolState = "idle" | "editing" | "running" | "success" | "error" | "cleared";

interface SessionInfo {
  caseLabel: string;
  interactionType: string | null;
}

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

export default function Reviewer() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  // Tool state
  const [toolState, setToolState] = useState<ToolState>("idle");
  const [userText, setUserText] = useState("");
  const [output, setOutput] = useState<ReviewerOutput | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedCategory, setCopiedCategory] = useState<string | null>(null);
  const [simulateError, setSimulateError] = useState(false);

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

  const textTooLong = userText.length > MAX_REVIEWER_TEXT_LENGTH;
  const textEmpty = userText.trim().length === 0;
  const canRun = !textEmpty && !textTooLong && toolState !== "running";

  const handleTextChange = (val: string) => {
    setUserText(val);
    if (toolState === "idle" || toolState === "cleared") {
      setToolState("editing");
    }
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
    setUserText("");
    setOutput(null);
    setErrorMessage(null);
    setToolState("cleared");
    setTimeout(() => setToolState("idle"), 300);
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
              Paste your documentation to check for tone, bias, policy language, and completeness.
              <strong className="block mt-1 text-foreground">
                AidMind does not store, modify, or export your text.
              </strong>
            </AlertDescription>
          </Alert>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* ── Left: Input Panel ── */}
            <div className="lg:col-span-2 space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Your Documentation</CardTitle>
                  <CardDescription>
                    Paste the text you want reviewed. This text is processed in memory only and never stored.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <Label htmlFor="reviewer-text" className="sr-only">Documentation text</Label>
                    <Textarea
                      id="reviewer-text"
                      placeholder="Paste your documentation here for review…"
                      value={userText}
                      onChange={(e) => handleTextChange(e.target.value)}
                      className="min-h-[280px] resize-y font-mono text-sm"
                      maxLength={MAX_REVIEWER_TEXT_LENGTH + 100} // soft cap, validated below
                    />
                  </div>

                  <div className="flex items-center justify-between">
                    <p className={cn(
                      "text-xs",
                      textTooLong ? "text-destructive font-medium" : "text-muted-foreground"
                    )}>
                      {userText.length.toLocaleString()} / {MAX_REVIEWER_TEXT_LENGTH.toLocaleString()} characters
                    </p>
                    {textTooLong && (
                      <p className="text-xs text-destructive">Text exceeds maximum length</p>
                    )}
                  </div>

                  <p className="text-xs text-muted-foreground">
                    AidMind does not store client content. Your text is cleared when you leave this page.
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

            {/* ── Right: Output Panel ── */}
            <div className="lg:col-span-3">
              {/* Idle / Editing */}
              {(toolState === "idle" || toolState === "editing" || toolState === "cleared") && (
                <Card className="border-dashed">
                  <CardContent className="py-16 text-center">
                    <Shield className="h-10 w-10 mx-auto text-muted-foreground/30 mb-4" />
                    <p className="text-sm text-muted-foreground">
                      {textEmpty
                        ? "Paste your text on the left, then click Run Reviewer."
                        : "Ready to review. Click Run Reviewer below."}
                    </p>
                  </CardContent>
                </Card>
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
            {(toolState === "success" || toolState === "error" || userText.length > 0) && (
              <Button variant="outline" onClick={handleClear}>
                <RotateCcw className="h-4 w-4 mr-2" />
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
