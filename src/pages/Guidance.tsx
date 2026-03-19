import { useParams, useNavigate, useLocation } from "react-router-dom";
import {
  ArrowLeft,
  Sparkles,
  Info,
  Loader2,
  Copy,
  Check,
  BookOpen,
  AlertTriangle,
  FileText,
  Pencil,
  ExternalLink,
  ShieldAlert,
  Clock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useState, useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import {
  type GuidanceQuestion,
  type GuidanceCategory,
  type TimelineConsideration,
  GUIDANCE_CATEGORIES,
} from "@/lib/tools/guidance-types";
import { useGuidanceSession } from "@/hooks/useGuidanceSession";
import { useEyeLogger } from "@/hooks/useEyeLogger";
import { CitationsModal } from "@/components/session/CitationsModal";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";

export default function Guidance() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const contentRef = useRef<HTMLDivElement>(null);
  const actionPanelRef = useRef<HTMLDivElement>(null);

  // Detect if we arrived from template selection/upload
  const cameFromTemplate = !!(location.state as Record<string, unknown>)?.templateId;

  const {
    session,
    loading,
    fetchError,
    runState,
    runError,
    runGuidance,
  } = useGuidanceSession(sessionId);

  const [showLeaveDialog, setShowLeaveDialog] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [citationsModal, setCitationsModal] = useState<{ citations: string[]; question: string } | null>(null);

  // Context-aware scroll: anchor to action panel when arriving from template selection
  const hasScrolled = useRef(false);
  useEffect(() => {
    if (hasScrolled.current || loading) return;
    hasScrolled.current = true;

    const delay = cameFromTemplate ? 400 : 0; // let toast clear first
    setTimeout(() => {
      if (cameFromTemplate && actionPanelRef.current) {
        actionPanelRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
      } else {
        window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
      }
    }, delay);
  }, [loading, cameFromTemplate]);

  const { logEvent } = useEyeLogger();

  // Auto-redirect to template selection if no template attached (skip intermediate screen)
  useEffect(() => {
    if (!loading && session && !session.templateId && !cameFromTemplate) {
      navigate(`/guidance/${sessionId}/template`, { replace: true });
    }
  }, [loading, session, cameFromTemplate, sessionId, navigate]);

  // ── Helpers ────────────────────────────────────────────────────
  const handleBack = () => navigate("/dashboard");
  const handleBackArrow = () => {
    // Guard: if guidance was generated but not yet marked done, show confirmation
    if (isSuccessForGuard && !guidanceAlreadyDone) {
      setShowLeaveDialog(true);
      return;
    }
    navigate("/dashboard");
  };
  const handleChangeTemplate = () => navigate(`/guidance/${sessionId}/template`);
  const handleSelectTemplate = () => navigate(`/guidance/${sessionId}/template`);

  // Done: write explicit completion signal to session metadata, then navigate
  const [markingDone, setMarkingDone] = useState(false);
  const handleDone = async () => {
    if (!session) return;
    setMarkingDone(true);
    try {
      // Read current metadata, merge guidance_completed_at
      const { data: current } = await supabase
        .from("sessions")
        .select("metadata")
        .eq("id", session.id)
        .maybeSingle();
      
      const existingMeta = (current?.metadata as Record<string, unknown>) ?? {};
      await supabase
        .from("sessions")
        .update({
          metadata: { ...existingMeta, guidance_completed_at: new Date().toISOString() },
          updated_at: new Date().toISOString(),
        })
        .eq("id", session.id);

      await logEvent({
        eventType: "guidance.step.completed",
        sessionId: session.sessionId,
        result: "success",
      });
    } catch (err) {
      console.error("[Guidance] Failed to mark completion:", err);
    } finally {
      setMarkingDone(false);
    }
    navigate("/dashboard");
  };

  const handleCopyQuestion = async (question: string, qId: string) => {
    await navigator.clipboard.writeText(question);
    setCopiedId(qId);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCopyCategory = async (category: string) => {
    if (!session?.guidanceOutput) return;
    const questions = session.guidanceOutput.questions.filter((q) => (q.category || "Other") === category);
    const text = questions.map((q, i) => `${i + 1}. ${q.question}`).join("\n");
    await navigator.clipboard.writeText(text);
    setCopiedId(`cat-${category}`);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCopyAll = async () => {
    if (!session?.guidanceOutput) return;
    const output = session.guidanceOutput;
    // Dynamically group for copy
    const seen = new Set<string>();
    const cats: string[] = [];
    for (const q of output.questions) {
      const c = q.category || "Other";
      if (!seen.has(c)) { seen.add(c); cats.push(c); }
    }
    const text = cats.map((cat) => {
      const qs = output.questions.filter((q) => (q.category || "Other") === cat);
      if (qs.length === 0) return "";
      return `## ${cat}\n${qs.map((q, i) => `${i + 1}. ${q.question}`).join("\n")}`;
    })
      .filter(Boolean)
      .join("\n\n");
    await navigator.clipboard.writeText(text);
    setCopiedId("__all__");
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatScope = (scope: string | null, scopeOther: string | null) => {
    if (!scope) return null;
    if (scope === "other" && scopeOther) return scopeOther;
    return scope.replace(/_/g, " ");
  };

  // ── Page-level loading/error ──────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Sparkles className="h-8 w-8 mx-auto text-primary animate-pulse mb-2" />
          <p className="text-muted-foreground">Loading guidance tool...</p>
        </div>
      </div>
    );
  }

  if (fetchError || !session) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center max-w-md">
          <p className="text-destructive mb-4">{fetchError || "Session not found"}</p>
          <Button onClick={handleBack}>Back to Dashboard</Button>
        </div>
      </div>
    );
  }

  // ── Derived state ─────────────────────────────────────────────
  const hasTemplate = !!session.templateId;
  const output = session.guidanceOutput;
  const scopeLabel = formatScope(session.guidanceScope, session.guidanceScopeOther);
  const isSuccess = runState === "success" && output && output.questions.length > 0;
  const guidanceAlreadyDone = !!(session.metadata as Record<string, unknown>)?.guidance_completed_at;
  const isSuccessForGuard = !!(output && output.questions.length > 0);

  // Determine if we should show a specific error banner
  const isTemplateRequired = runError?.code === "TEMPLATE_REQUIRED";
  const isScopeRequired = runError?.code === "SCOPE_REQUIRED";

  // Group questions by category — dynamic to handle both old fixed categories
  // and new schema-driven categories (e.g. template section names)
  const allCategories: string[] = [];
  const groupedQuestions: Record<string, GuidanceQuestion[]> = {};
  if (output) {
    // Collect all unique categories in order of appearance
    for (const q of output.questions) {
      const cat = q.category || "Other";
      if (!groupedQuestions[cat]) {
        groupedQuestions[cat] = [];
        allCategories.push(cat);
      }
      groupedQuestions[cat].push(q);
    }

    // Debug diagnostics (dev only)
    if (import.meta.env.DEV) {
      console.log("[Guidance] payload keys:", Object.keys(output));
      console.log("[Guidance] questions.length:", output.questions.length);
      console.log("[Guidance] first question:", output.questions[0]);
      console.log("[Guidance] categories found:", allCategories);
      console.log("[Guidance] per-category counts:", Object.fromEntries(allCategories.map(c => [c, groupedQuestions[c].length])));
    }
  }

  // Grounding badge helper — only show warnings, not on every question
  const getGroundingBadge = (q: GuidanceQuestion) => {
    if (q.validation_status === "warning") {
      return (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1 border-amber-300/50 text-amber-700 dark:text-amber-400">
                <ShieldAlert className="h-2.5 w-2.5" />
                Review grounding
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[240px]">
              <p className="text-xs">This question is grounded in policy evidence but may benefit from review against the cited sources.</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      );
    }
    // Pass / unset — no badge needed, citations provide traceability
    return null;
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* ── Header ── */}
      <header className="border-b border-border bg-card shrink-0">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={handleBackArrow}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <div className="flex items-center gap-2">
                  <Sparkles className="h-5 w-5 text-primary" />
                  <h1 className="text-xl font-semibold text-foreground">
                    {isSuccess ? "Guidance Ready" : "Generate Guidance"}
                  </h1>
                </div>
                <p className="text-sm text-muted-foreground">
                  {session.caseLabel}
                  {session.interactionType && ` · ${session.interactionType}`}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {scopeLabel && (
                <Badge variant="secondary" className="text-xs">
                  Scope: {scopeLabel}
                </Badge>
              )}
              {session.templateName && (
                <Badge variant="outline" className="text-xs">
                  Template: {session.templateName.length > 20 ? session.templateName.slice(0, 20) + "…" : session.templateName}
                </Badge>
              )}
              <Badge variant="outline" className="text-xs font-mono text-muted-foreground">
                Session: {sessionId?.slice(0, 8)}…
              </Badge>
            </div>
          </div>
        </div>
      </header>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto" ref={contentRef}>
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

          {/* Template required banner */}
          {isTemplateRequired && (
            <Alert className="mb-6 border-destructive/30 bg-destructive/5">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <AlertDescription className="text-sm">
                A template is required before generating guidance.{" "}
                <button onClick={handleSelectTemplate} className="text-primary hover:underline font-medium">
                  Select a template →
                </button>
              </AlertDescription>
            </Alert>
          )}

          {/* Scope required banner */}
          {isScopeRequired && (
            <Alert className="mb-6 border-destructive/30 bg-destructive/5">
              <AlertTriangle className="h-4 w-4 text-destructive" />
              <AlertDescription className="text-sm">
                This session was created before the scope requirement was added.
                Please create a new session with a scope to use guidance.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* ── Left: Context Panel ── */}
            <div className="lg:col-span-2 space-y-4">
              {/* Template card */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Template</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {hasTemplate ? (
                    <>
                      <div className="flex items-center gap-2">
                        <FileText className="h-4 w-4 text-primary shrink-0" />
                        <Badge variant="secondary" className="text-xs max-w-full truncate">
                          {session.templateName || "Template attached"}
                        </Badge>
                      </div>
                      {!isSuccess && (
                        <button
                          onClick={handleChangeTemplate}
                          className="text-xs text-primary hover:underline flex items-center gap-1"
                        >
                          <Pencil className="h-3 w-3" />
                          Change template
                        </button>
                      )}
                    </>
                  ) : (
                    <div className="text-center py-4">
                      <FileText className="h-8 w-8 mx-auto text-muted-foreground/30 mb-2" />
                      <p className="text-sm text-muted-foreground mb-3">No template selected</p>
                      <Button size="sm" onClick={handleSelectTemplate}>
                        Select Template
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Session context */}
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
                    <p className="text-sm font-medium text-foreground">{session.caseLabel}</p>
                  </div>
                  {session.interactionType && (
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Type</p>
                      <p className="text-sm font-medium text-foreground">{session.interactionType}</p>
                    </div>
                  )}
                  {scopeLabel && (
                    <div>
                      <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Scope</p>
                      <Badge variant="outline" className="text-xs capitalize">
                        {scopeLabel}
                      </Badge>
                    </div>
                  )}
                  <div>
                    <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Policy Pack</p>
                    <Badge variant={session.hasPolicyPack ? "default" : "secondary"} className="text-xs">
                      {session.hasPolicyPack ? "Compiled" : "Not assigned"}
                    </Badge>
                  </div>
                  <Separator />
                  <p className="text-xs text-muted-foreground">
                    The tool reads policy snippets from your session's compiled policy pack
                    and generates up to 12 targeted interview questions across 6 categories.
                    Only questions with strong policy grounding are returned.
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* ── Right: Output Panel ── */}
            <div className="lg:col-span-3" ref={actionPanelRef}>
              {/* No template */}
              {!hasTemplate && runState !== "error" && (
                <Card className="border-dashed">
                  <CardContent className="py-16 text-center">
                    <FileText className="h-10 w-10 mx-auto text-muted-foreground/30 mb-4" />
                    <p className="text-sm text-muted-foreground mb-4">
                      Select a template first, then generate interview questions.
                    </p>
                    <Button onClick={handleSelectTemplate}>
                      <FileText className="h-4 w-4 mr-2" />
                      Select Template
                    </Button>
                  </CardContent>
                </Card>
              )}

              {/* Idle (template selected, no output yet) */}
              {hasTemplate && runState === "idle" && !output && (
                <Card className="border-dashed">
                  <CardContent className="py-16 text-center">
                    <Sparkles className="h-10 w-10 mx-auto text-muted-foreground/30 mb-4" />
                    <p className="text-sm text-muted-foreground">
                      Click <strong>Generate Questions</strong> below to produce interview questions
                      from your session's policy pack.
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* Running (compiling or generating) */}
              {(runState === "running" || runState === "compiling" || runState === "generating") && (
                <Card>
                  <CardContent className="py-16 text-center">
                    <Loader2 className="h-10 w-10 mx-auto text-primary animate-spin mb-4" />
                    <p className="text-sm text-muted-foreground">
                      {runState === "compiling"
                        ? "Compiling policy pack from knowledge base…"
                        : "Generating questions from policy pack…"}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">This usually takes 15–30 seconds.</p>
                  </CardContent>
                </Card>
              )}

              {/* Error */}
              {runState === "error" && !isTemplateRequired && !isScopeRequired && (
                <Card className="border-destructive/30">
                  <CardContent className="py-10 text-center">
                    <AlertTriangle className="h-10 w-10 mx-auto text-destructive/50 mb-4" />
                    <p className="text-sm text-destructive font-medium mb-1">
                      {runError?.step === "compile" ? "Policy pack compilation failed" : "Generation failed"}
                    </p>
                    <p className="text-xs text-muted-foreground mb-1">{runError?.message}</p>
                    {runError?.code && (
                      <Badge variant="outline" className="text-[10px] font-mono mb-3">
                        {runError.code}
                      </Badge>
                    )}
                    <div>
                      <Button variant="outline" size="sm" className="mt-2" onClick={runGuidance}>
                        Try again
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Insufficient grounding state */}
              {runState === "success" && output && output.grounding_status === "insufficient" && output.questions.length === 0 && (
                <Card className="border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/20">
                  <CardContent className="py-10 text-center">
                    <AlertTriangle className="h-10 w-10 mx-auto text-amber-500/70 mb-4" />
                    <p className="text-sm font-medium text-foreground mb-2">
                      Insufficient policy grounding
                    </p>
                    <p className="text-xs text-muted-foreground max-w-md mx-auto mb-3">
                      AidMind could not generate reliably grounded guidance from the currently selected policy sources.
                      {output.grounding_reason === "LOW_INFORMATION_POLICY_PACK" &&
                        " The policy pack contains mostly structural or low-information content."}
                      {output.grounding_reason === "WEAK_CITATION_SUPPORT" &&
                        " The generated questions could not be adequately supported by the available policy text."}
                      {output.grounding_reason === "INSUFFICIENT_GROUNDED_SUPPORT" &&
                        " Too few questions could be grounded in substantive policy text."}
                    </p>
                    <p className="text-xs text-muted-foreground mb-4">
                      Add more relevant policy material to the knowledge base, or try a different template.
                    </p>
                    {output.total_generated != null && (
                      <div className="flex items-center justify-center gap-3 mb-4">
                        <Badge variant="outline" className="text-[10px] font-mono">
                          {output.total_generated} generated → {output.total_grounded ?? 0} grounded
                        </Badge>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {/* Success — Questions display */}
              {runState === "success" && output && output.questions.length > 0 && (
                <div className="space-y-4">
                  {/* Success completion banner */}
                  <div className="flex items-center gap-3 px-4 py-3 rounded-lg bg-primary/5 border border-primary/15">
                    <Check className="h-5 w-5 text-primary shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-foreground">Guidance ready</p>
                      <p className="text-xs text-muted-foreground">
                        {output.questions.length} question{output.questions.length !== 1 ? "s" : ""} generated and grounded in your policy pack.
                        {(output.total_grounded_warning ?? 0) > 0 && ` ${output.total_grounded_warning} flagged for review.`}
                      </p>
                    </div>
                  </div>

                  {/* Summary bar */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant="secondary" className="text-xs">
                        {output.questions.length} question{output.questions.length !== 1 ? "s" : ""}
                      </Badge>
                      {output.total_dropped != null && output.total_dropped > 0 && (
                        <Badge variant="outline" className="text-[10px] text-muted-foreground">
                          {output.total_dropped} dropped (weak grounding)
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-xs font-mono">
                        {output.model}
                      </Badge>
                      {output.generated_at && (
                        <span className="text-[10px] text-muted-foreground">
                          {new Date(output.generated_at).toLocaleString()}
                        </span>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCopyAll}
                      className="gap-1.5"
                    >
                      {copiedId === "__all__" ? (
                        <><Check className="h-3.5 w-3.5" /> Copied</>
                      ) : (
                        <><Copy className="h-3.5 w-3.5" /> Copy all</>
                      )}
                    </Button>
                  </div>

                  {/* Review notice */}
                  <p className="text-xs text-muted-foreground italic">
                    Review and edit before using — these are AI-generated suggestions grounded in your policy pack, not final documentation.
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
                              {copiedId === `cat-${category}` ? (
                                <><Check className="h-3 w-3 mr-1" /> Copied</>
                              ) : (
                                <><Copy className="h-3 w-3 mr-1" /> Copy</>
                              )}
                            </Button>
                          </div>
                        </CardHeader>
                        <CardContent className="space-y-3">
                          {questions.map((q, i) => {
                            const qId = `${category}-${i}`;
                            return (
                              <div key={i} className="flex gap-3 group">
                                <span className="text-xs font-mono text-muted-foreground mt-0.5 shrink-0 w-5 text-right">
                                  {i + 1}.
                                </span>
                                <div className="flex-1">
                                  <p className="text-sm text-foreground leading-relaxed">{q.question}</p>
                                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                    {/* Grounding indicator */}
                                    {getGroundingBadge(q)}
                                    {q.citations.length > 0 && (
                                      <div className="flex items-center gap-1 flex-wrap">
                                        <BookOpen className="h-3 w-3 text-muted-foreground" />
                                        {q.citations.slice(0, 2).map((cit) => (
                                          <Badge key={cit} variant="outline" className="text-[10px] font-mono px-1.5 py-0">
                                            {cit.length > 12 ? cit.slice(0, 12) + "…" : cit}
                                          </Badge>
                                        ))}
                                        {q.citations.length > 2 && (
                                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                            +{q.citations.length - 2}
                                          </Badge>
                                        )}
                                        <button
                                          onClick={() => setCitationsModal({ citations: q.citations, question: q.question })}
                                          className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
                                        >
                                          <ExternalLink className="h-2.5 w-2.5" />
                                          View sources
                                        </button>
                                      </div>
                                    )}
                                    <button
                                      onClick={() => handleCopyQuestion(q.question, qId)}
                                      className="opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground ml-auto"
                                      title="Copy question"
                                    >
                                      {copiedId === qId ? (
                                        <Check className="h-3.5 w-3.5 text-primary" />
                                      ) : (
                                        <Copy className="h-3.5 w-3.5" />
                                      )}
                                    </button>
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </CardContent>
                      </Card>
                    );
                  })}

                  {/* Timeline Considerations — rendered when present in guidance payload */}
                  {Array.isArray(output.timeline_considerations) && output.timeline_considerations.length > 0 && (
                    <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <Clock className="h-4 w-4 text-muted-foreground" />
                          Timeline Considerations
                        </CardTitle>
                        <CardDescription className="text-xs">
                          Time-sensitive policy requirements relevant to this session.
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="space-y-3">
                        {output.timeline_considerations.map((tc, i) => (
                          <div key={i} className="flex gap-3">
                            <span className="text-xs font-mono text-muted-foreground mt-0.5 shrink-0 w-5 text-right">
                              {i + 1}.
                            </span>
                            <div className="flex-1">
                              <p className="text-sm text-foreground leading-relaxed">{tc.timeline}</p>
                              {tc.citations.length > 0 && (
                                <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                                  <BookOpen className="h-3 w-3 text-muted-foreground" />
                                  {tc.citations.slice(0, 2).map((cit) => (
                                    <Badge key={cit} variant="outline" className="text-[10px] font-mono px-1.5 py-0">
                                      {cit.length > 12 ? cit.slice(0, 12) + "…" : cit}
                                    </Badge>
                                  ))}
                                  {tc.citations.length > 2 && (
                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                                      +{tc.citations.length - 2}
                                    </Badge>
                                  )}
                                  <button
                                    onClick={() => setCitationsModal({ citations: tc.citations, question: tc.timeline })}
                                    className="text-[10px] text-primary hover:underline flex items-center gap-0.5"
                                  >
                                    <ExternalLink className="h-2.5 w-2.5" />
                                    View sources
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom Action Bar ── */}
      <div className="border-t border-border bg-card shrink-0">
        <div className="container mx-auto px-6 py-3 max-w-5xl flex items-center justify-end">
          {isSuccess ? (
            <Button onClick={handleDone} disabled={markingDone}>
              {markingDone ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</>
              ) : (
                <><Check className="h-4 w-4 mr-2" /> Done</>
              )}
            </Button>
          ) : (
            <div className="flex items-center gap-2 w-full justify-between">
              <Button variant="outline" onClick={handleBack}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Dashboard
              </Button>
              <Button
                onClick={runGuidance}
                disabled={runState === "running" || runState === "compiling" || runState === "generating" || !hasTemplate}
              >
                {runState === "compiling" || runState === "generating" || runState === "running" ? (
                  <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> {runState === "compiling" ? "Compiling…" : "Generating…"}</>
                ) : (
                  <><Sparkles className="h-4 w-4 mr-2" /> Generate Questions</>
                )}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Citations modal */}
      {citationsModal && (
        <CitationsModal
          open={!!citationsModal}
          onOpenChange={(open) => !open && setCitationsModal(null)}
          citations={citationsModal.citations}
          questionText={citationsModal.question}
          sessionDbId={session.id}
        />
      )}

      {/* Leave confirmation dialog */}
      <Dialog open={showLeaveDialog} onOpenChange={setShowLeaveDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Finish guidance before leaving?</DialogTitle>
            <DialogDescription>
              You've already generated guidance questions for this session. Would you like to mark guidance as complete before returning to the dashboard?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex flex-col gap-2 sm:flex-col">
            <Button onClick={async () => { setShowLeaveDialog(false); await handleDone(); }} disabled={markingDone}>
              {markingDone ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving…</>
              ) : (
                <><Check className="h-4 w-4 mr-2" /> Done and return</>
              )}
            </Button>
            <Button variant="outline" onClick={() => { setShowLeaveDialog(false); navigate("/dashboard"); }}>
              Leave without marking done
            </Button>
            <Button variant="ghost" onClick={() => setShowLeaveDialog(false)}>
              Stay here
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
