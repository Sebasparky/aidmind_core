import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Sparkles, Info, Loader2, Copy, Check, RotateCcw, BookOpen, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import {
  type GuidanceOutput,
  type GuidanceQuestion,
  type GuidanceCategory,
  GUIDANCE_CATEGORIES,
  MOCK_GUIDANCE_OUTPUT,
} from "@/lib/tools/guidance-types";

type ToolState = "idle" | "running" | "success" | "error" | "cleared";

interface SessionInfo {
  caseLabel: string;
  interactionType: string | null;
  hasPolicyPack: boolean;
}

export default function Guidance() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  // Tool state
  const [toolState, setToolState] = useState<ToolState>("idle");
  const [output, setOutput] = useState<GuidanceOutput | null>(null);
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
          .select("case_label, interaction_type, policy_pack_id")
          .eq("session_id", sessionId)
          .maybeSingle();

        if (error) throw error;
        if (!data) {
          setPageError("Session not found");
        } else {
          setSessionInfo({
            caseLabel: data.case_label || "Untitled session",
            interactionType: data.interaction_type,
            hasPolicyPack: !!data.policy_pack_id,
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

  const handleGenerate = useCallback(async () => {
    setToolState("running");
    setOutput(null);
    setErrorMessage(null);

    // Mock: simulate 800-1200ms delay
    const delay = 800 + Math.random() * 400;
    await new Promise((r) => setTimeout(r, delay));

    if (simulateError) {
      setToolState("error");
      setErrorMessage("No snippets found — session may not have a compiled policy pack yet.");
      return;
    }

    setOutput(MOCK_GUIDANCE_OUTPUT);
    setToolState("success");
  }, [simulateError]);

  const handleClear = () => {
    setOutput(null);
    setErrorMessage(null);
    setToolState("cleared");
    // Reset to idle after brief feedback
    setTimeout(() => setToolState("idle"), 300);
  };

  const handleCopyCategory = async (category: GuidanceCategory) => {
    if (!output) return;
    const questions = output.questions.filter((q) => q.category === category);
    const text = questions.map((q, i) => `${i + 1}. ${q.question}`).join("\n");
    await navigator.clipboard.writeText(text);
    setCopiedCategory(category);
    setTimeout(() => setCopiedCategory(null), 2000);
  };

  const handleCopyAll = async () => {
    if (!output) return;
    const text = GUIDANCE_CATEGORIES.map((cat) => {
      const qs = output.questions.filter((q) => q.category === cat);
      if (qs.length === 0) return "";
      return `## ${cat}\n${qs.map((q, i) => `${i + 1}. ${q.question}`).join("\n")}`;
    })
      .filter(Boolean)
      .join("\n\n");
    await navigator.clipboard.writeText(text);
    setCopiedCategory("__all__");
    setTimeout(() => setCopiedCategory(null), 2000);
  };

  const handleBack = () => navigate("/dashboard");

  // ── Page-level loading/error ──
  if (pageLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Sparkles className="h-8 w-8 mx-auto text-primary animate-pulse mb-2" />
          <p className="text-muted-foreground">Loading guidance tool...</p>
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

  // Group questions by category for output display
  const groupedQuestions: Record<GuidanceCategory, GuidanceQuestion[]> = {} as any;
  if (output) {
    for (const cat of GUIDANCE_CATEGORIES) {
      groupedQuestions[cat] = output.questions.filter((q) => q.category === cat);
    }
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
                  <Sparkles className="h-5 w-5 text-primary" />
                  <h1 className="text-xl font-semibold text-foreground">Generate Guidance</h1>
                </div>
                <p className="text-sm text-muted-foreground">
                  {sessionInfo.caseLabel}
                  {sessionInfo.interactionType && ` · ${sessionInfo.interactionType}`}
                </p>
              </div>
            </div>

            {/* Session badge */}
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
              Generates structured interview questions grounded in your session's policy pack.
              <strong className="block mt-1 text-foreground">
                AidMind does not create, store, or export documentation.
              </strong>
            </AlertDescription>
          </Alert>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* ── Left: Input Panel ── */}
            <div className="lg:col-span-2 space-y-4">
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Session Context</CardTitle>
                  <CardDescription>
                    Guidance is generated from your session's compiled policy pack.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Session</p>
                    <p className="text-sm font-medium text-foreground">{sessionInfo.caseLabel}</p>
                  </div>
                  {sessionInfo.interactionType && (
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Type</p>
                      <p className="text-sm font-medium text-foreground">{sessionInfo.interactionType}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Policy Pack</p>
                    <Badge variant={sessionInfo.hasPolicyPack ? "default" : "secondary"} className="text-xs">
                      {sessionInfo.hasPolicyPack ? "Compiled" : "Not assigned"}
                    </Badge>
                  </div>

                  <Separator />

                  <p className="text-xs text-muted-foreground">
                    No input required — the tool reads policy snippets from your session's compiled policy pack
                    and generates 12 targeted interview questions across 6 categories.
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
              {/* Idle */}
              {toolState === "idle" && (
                <Card className="border-dashed">
                  <CardContent className="py-16 text-center">
                    <Sparkles className="h-10 w-10 mx-auto text-muted-foreground/30 mb-4" />
                    <p className="text-sm text-muted-foreground">
                      Click <strong>Generate Guidance</strong> below to produce interview questions
                      from your session's policy pack.
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Cleared */}
              {toolState === "cleared" && (
                <Card className="border-dashed">
                  <CardContent className="py-16 text-center">
                    <RotateCcw className="h-10 w-10 mx-auto text-muted-foreground/30 mb-4" />
                    <p className="text-sm text-muted-foreground">
                      Cleared. Ready to generate again.
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Running */}
              {toolState === "running" && (
                <Card>
                  <CardContent className="py-16 text-center">
                    <Loader2 className="h-10 w-10 mx-auto text-primary animate-spin mb-4" />
                    <p className="text-sm text-muted-foreground">Generating guidance from policy pack…</p>
                    <p className="text-xs text-muted-foreground mt-1">This usually takes a few seconds.</p>
                  </CardContent>
                </Card>
              )}

              {/* Error */}
              {toolState === "error" && (
                <Card className="border-destructive/30">
                  <CardContent className="py-10 text-center">
                    <AlertTriangle className="h-10 w-10 mx-auto text-destructive/50 mb-4" />
                    <p className="text-sm text-destructive font-medium mb-1">Generation failed</p>
                    <p className="text-xs text-muted-foreground">{errorMessage}</p>
                    <Button variant="outline" size="sm" className="mt-4" onClick={handleGenerate}>
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
                        {output.questions.length} questions
                      </Badge>
                      <Badge variant="outline" className="text-xs font-mono">
                        {output.model}
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
                        <><Copy className="h-3.5 w-3.5" /> Copy all</>
                      )}
                    </Button>
                  </div>

                  {/* Review before using */}
                  <p className="text-xs text-muted-foreground italic">
                    Review and edit before using — these are AI-generated suggestions, not final documentation.
                  </p>

                  {/* Category cards */}
                  {GUIDANCE_CATEGORIES.map((category) => {
                    const questions = groupedQuestions[category] || [];
                    if (questions.length === 0) return null;

                    return (
                      <Card key={category}>
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-sm font-medium">{category}</CardTitle>
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
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {questions.map((q, i) => (
                            <div key={i} className="flex gap-3">
                              <span className="text-xs font-mono text-muted-foreground mt-0.5 shrink-0 w-5 text-right">
                                {i + 1}.
                              </span>
                              <div className="flex-1">
                                <p className="text-sm text-foreground leading-relaxed">{q.question}</p>
                                {q.citations.length > 0 && (
                                  <div className="flex items-center gap-1 mt-1.5">
                                    <BookOpen className="h-3 w-3 text-muted-foreground" />
                                    {q.citations.map((cit) => (
                                      <Badge key={cit} variant="outline" className="text-[10px] font-mono px-1.5 py-0">
                                        {cit}
                                      </Badge>
                                    ))}
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
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
            {(toolState === "success" || toolState === "error") && (
              <Button variant="outline" onClick={handleClear}>
                <RotateCcw className="h-4 w-4 mr-2" />
                Clear
              </Button>
            )}
            <Button
              onClick={handleGenerate}
              disabled={toolState === "running"}
            >
              {toolState === "running" ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Generating…</>
              ) : (
                <><Sparkles className="h-4 w-4 mr-2" /> Generate Guidance</>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
