import { useParams, useNavigate } from "react-router-dom";
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  ArrowLeft,
  FileText,
  Loader2,
  Copy,
  Download,
  Send,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Search,
  ChevronDown,
  ChevronRight,
  Upload,
  X,
  Circle,
  Info,
  Trash2,
  Lock,
  ShieldAlert,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { usePdfTextExtractor } from "@/hooks/usePdfTextExtractor";
import { useCaseNotesVault } from "@/hooks/useCaseNotesVault";
import { VaultStatusIndicator } from "@/components/security/VaultStatusIndicator";
import type { CaseNotesComparisonPacket } from "@/lib/security/vault-types";
import mammoth from "mammoth";

// ─── Types ───────────────────────────────────────────────
type GenerationStatus = "idle" | "generating" | "success" | "error";
type ExtractionStatus = "idle" | "reading" | "extracting" | "extracted" | "extraction_error";
type InputMode = "paste" | "upload";

/**
 * SECURITY: Phase 2 workspace is entirely in-memory.
 * No sessionStorage, localStorage, or backend persistence of raw notes
 * or extracted answers. Content exists only while this component is mounted.
 */

interface FieldAnswer {
  field_key: string;
  label: string;
  question: string;
  answer: string | null;
  confidence: "high" | "medium" | "low";
  supporting_excerpt: string | null;
}

interface Phase2Result {
  generated_at: string;
  model: string;
  answers: FieldAnswer[];
}

interface UploadedFile {
  name: string;
  size: number;
  mime: string;
  extractedText: string | null;
  status: ExtractionStatus;
}

interface CaseNotesFormState {
  rawNotes: string;
  permissionConfirmed: boolean;
}

interface SessionContext {
  id: string;
  sessionId: string;
  caseLabel: string | null;
  templateId: string | null;
  templateName: string | null;
  tenantId: string | null;
  caseNotesCompleted: boolean;
}

const INITIAL_FORM: CaseNotesFormState = {
  rawNotes: "",
  permissionConfirmed: false,
};

const MIN_NOTES_LENGTH = 20;
const ACCEPTED_EXTENSIONS = ".txt,.md,.pdf,.docx";
const ACCEPTED_MIMES = [
  "text/plain",
  "text/markdown",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

// ─── Helpers ─────────────────────────────────────────────
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function ConfidenceBadge({ level }: { level: string }) {
  const styles: Record<string, string> = {
    high: "bg-[hsl(var(--status-success-muted))] text-[hsl(var(--status-success-muted-foreground))]",
    medium: "bg-muted text-muted-foreground",
    low: "bg-[hsl(var(--status-danger-muted))] text-[hsl(var(--status-danger-muted-foreground))]",
  };
  return (
    <span className={cn("text-xs px-2 py-0.5 rounded-full font-medium", styles[level] || styles.low)}>
      {level}
    </span>
  );
}

function AnswerRow({ answer }: { answer: FieldAnswer }) {
  const [open, setOpen] = useState(false);
  const hasExcerpt = !!answer.supporting_excerpt;

  return (
    <div className="py-3 border-b border-border last:border-b-0">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground">{answer.label}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{answer.question}</p>
          <p className="text-sm text-foreground mt-1.5">
            {answer.answer ?? (
              <span className="text-muted-foreground italic">Not found in notes</span>
            )}
          </p>
        </div>
        <div className="shrink-0 flex items-center gap-2 mt-0.5">
          <ConfidenceBadge level={answer.confidence} />
        </div>
      </div>

      {hasExcerpt && (
        <Collapsible open={open} onOpenChange={setOpen}>
          <CollapsibleTrigger asChild>
            <button className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground mt-1.5 transition-colors">
              {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Supporting excerpt
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <p className="text-xs text-muted-foreground mt-1 pl-4 border-l-2 border-border italic">
              "{answer.supporting_excerpt}"
            </p>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

// ─── Readiness check row ─────────────────────────────────
type ReadinessState = "ready" | "attention" | "missing";

function ReadinessRow({
  label,
  state,
  detail,
}: {
  label: string;
  state: ReadinessState;
  detail?: string;
}) {
  const icon =
    state === "ready" ? (
      <CheckCircle2 className="h-3.5 w-3.5 text-[hsl(var(--status-success))]" />
    ) : state === "attention" ? (
      <AlertCircle className="h-3.5 w-3.5 text-[hsl(var(--status-warning))]" />
    ) : (
      <Circle className="h-3.5 w-3.5 text-muted-foreground/40" />
    );

  return (
    <div className="flex items-start gap-2 py-1.5">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0">
        <p className={cn(
          "text-sm",
          state === "ready" ? "text-foreground" : "text-muted-foreground"
        )}>
          {label}
        </p>
        {detail && (
          <p className="text-xs text-muted-foreground mt-0.5">{detail}</p>
        )}
      </div>
    </div>
  );
}

// ─── Note quality hints ──────────────────────────────────
const NOTE_HINTS = [
  "Include factual details: dates, names, roles, events.",
  "Mention living situation, safety concerns, services discussed.",
  "Include deadlines, referrals, and next steps discussed.",
  "Avoid summary-only shorthand if detail matters for the template.",
];

// ─── Secured/Locked State ────────────────────────────────
/**
 * SECURITY: Shown when a user returns to Case Notes after marking Done,
 * or when there is no in-memory state. This is intentional, not a bug.
 */
function SecuredState({
  caseLabel,
  onBack,
}: {
  caseLabel: string | null;
  onBack: () => void;
}) {
  return (
    <div className="max-w-2xl mx-auto py-16 px-4">
      <div className="flex flex-col items-center text-center space-y-6">
        {/* Icon */}
        <div className="w-14 h-14 rounded-full bg-muted/60 flex items-center justify-center">
          <Lock className="h-6 w-6 text-muted-foreground" />
        </div>

        {/* Heading */}
        <div className="space-y-2">
          <h2 className="text-lg font-semibold text-foreground">
            Case notes secured
          </h2>
          <p className="text-sm text-muted-foreground max-w-md">
            Sensitive case-note content is not retained for casual reopening.
            This step was completed and the working content has been cleared
            from this workspace.
          </p>
        </div>

        {/* Explanation card */}
        <Card className="border border-border shadow-none w-full max-w-md">
          <CardContent className="px-5 py-4 space-y-3">
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="text-left space-y-1.5">
                <p className="text-xs font-medium text-foreground">
                  Why is my previous work not visible?
                </p>
                <p className="text-xs text-muted-foreground">
                  AidMind does not store interview notes or extracted answers
                  in plaintext after you finish working. This protects client
                  information and aligns with privacy-first data handling.
                </p>
              </div>
            </div>
            <Separator />
            <div className="flex items-start gap-2.5">
              <Info className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
              <div className="text-left space-y-1.5">
                <p className="text-xs font-medium text-foreground">
                  What can I do next?
                </p>
                <ul className="text-xs text-muted-foreground space-y-1 list-disc pl-4">
                  <li>Return to the session dashboard to continue your workflow</li>
                  <li>Start a new extraction by re-entering notes in this workspace</li>
                  <li>Proceed to the Reviewer step if extraction is already complete</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Actions */}
        <div className="flex items-center gap-3">
          <Button variant="outline" onClick={onBack} className="gap-2">
            <ArrowLeft className="h-4 w-4" />
            Return to session
          </Button>
        </div>

        {/* Case label if available */}
        {caseLabel && (
          <p className="text-xs text-muted-foreground">
            Session: {caseLabel}
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────
export default function CaseNotes() {
  const { sessionId: routeSessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  // Session context
  const [session, setSession] = useState<SessionContext | null>(null);
  const [sessionLoading, setSessionLoading] = useState(true);

  /**
   * SECURITY: All sensitive state is in-memory only.
   * Nothing below is persisted to sessionStorage, localStorage, or the backend.
   * When the component unmounts, all content is lost. This is intentional.
   */
  const [form, setForm] = useState<CaseNotesFormState>(INITIAL_FORM);
  const [inputMode, setInputMode] = useState<InputMode>("paste");
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);

  const [generationStatus, setGenerationStatus] = useState<GenerationStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<Phase2Result | null>(null);
  const [generationSummary, setGenerationSummary] = useState<{
    factFieldCount: number;
    answeredFieldCount: number;
    model: string;
  } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // PDF extraction hook
  const pdfExtractor = usePdfTextExtractor();

  // Filters for results
  const [searchFilter, setSearchFilter] = useState("");
  const [showFilter, setShowFilter] = useState<"all" | "answered" | "missing">("all");

  // ─── Dialog state ──────────────────────────────────────
  const [showLeaveDialog, setShowLeaveDialog] = useState(false);
  const [showClearDialog, setShowClearDialog] = useState(false);
  const [showDoneDialog, setShowDoneDialog] = useState(false);
  const [isDoneLoading, setIsDoneLoading] = useState(false);

  /**
   * SECURITY: Purge any legacy sessionStorage entries for case notes.
   * Previous versions stored plaintext notes here. This cleanup runs once on mount.
   */
  useEffect(() => {
    if (!routeSessionId) return;
    const legacyKey = `aidmind:case-notes:${routeSessionId}`;
    try {
      sessionStorage.removeItem(legacyKey);
    } catch {
      // Ignore — best-effort cleanup
    }
  }, [routeSessionId]);

  const updateField = useCallback(
    <K extends keyof CaseNotesFormState>(key: K, value: CaseNotesFormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  // ─── Load session data on mount ────────────────────────
  useEffect(() => {
    if (!routeSessionId) {
      setSession(null);
      setSessionLoading(false);
      return;
    }

    let cancelled = false;
    setSessionLoading(true);
    setSession(null);

    (async () => {
      try {
        const { data, error } = await supabase
          .from("sessions")
          .select("id, session_id, case_label, template_id, tenant_id, metadata")
          .eq("session_id", routeSessionId)
          .maybeSingle();

        if (cancelled) return;

        if (error || !data) {
          console.error("[CaseNotes] Session fetch error:", error?.message);
          setSession(null);
          return;
        }

        let templateName: string | null = null;
        if (data.template_id) {
          const { data: tmpl } = await supabase
            .from("kb_templates")
            .select("name")
            .eq("id", data.template_id)
            .maybeSingle();
          if (!cancelled && tmpl) templateName = tmpl.name;
        }

        if (cancelled) return;

        const meta = (data.metadata as Record<string, unknown>) ?? {};
        const caseNotesCompleted = !!meta.case_notes_completed_at;

        setSession({
          id: data.id,
          sessionId: data.session_id,
          caseLabel: data.case_label,
          templateId: data.template_id,
          templateName,
          tenantId: data.tenant_id,
          caseNotesCompleted,
        });
      } finally {
        if (!cancelled) {
          setSessionLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [routeSessionId]);

  // ─── Derived state ─────────────────────────────────────
  const notesLength = form.rawNotes.trim().length;
  const notesReady = notesLength >= MIN_NOTES_LENGTH;
  const notesTooShort = notesLength > 0 && !notesReady;
  const notesEmpty = notesLength === 0;

  const sessionReady = !!session;
  const templateReady = !!session?.templateId;
  const canGenerate =
    sessionReady &&
    templateReady &&
    notesReady &&
    form.permissionConfirmed &&
    generationStatus !== "generating";

  // Whether the user has meaningful in-progress work
  const hasInProgressWork =
    form.rawNotes.trim().length > 0 ||
    form.permissionConfirmed ||
    !!result ||
    !!uploadedFile;

  // Whether extraction is complete and user can mark as Done
  const isExtractionComplete = generationStatus === "success" && !!result;

  // ─── File handling ─────────────────────────────────────
  const handleFileSelect = useCallback(
    async (file: File) => {
      if (!ACCEPTED_MIMES.includes(file.type) && !file.name.endsWith(".md")) {
        toast({ title: "Unsupported file type", variant: "destructive" });
        return;
      }

      const isText = file.type === "text/plain" || file.name.endsWith(".md") || file.type === "text/markdown";
      const isPdf = file.type === "application/pdf" || file.name.endsWith(".pdf");
      const isDocx = file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" || file.name.endsWith(".docx");

      if (isText) {
        setUploadedFile({
          name: file.name, size: file.size, mime: file.type || "text/plain",
          extractedText: null, status: "reading",
        });
        const text = await file.text();
        setUploadedFile((prev) => prev ? { ...prev, extractedText: text, status: "extracted" } : null);
        setForm((prev) => ({ ...prev, rawNotes: text }));
      } else if (isPdf) {
        setUploadedFile({
          name: file.name, size: file.size, mime: file.type,
          extractedText: null, status: "extracting",
        });
        try {
          await pdfExtractor.extractText(file);
        } catch {
          setUploadedFile((prev) => prev ? { ...prev, status: "extraction_error" } : null);
          toast({ title: "PDF extraction failed", variant: "destructive" });
        }
      } else if (isDocx) {
        setUploadedFile({
          name: file.name, size: file.size, mime: file.type,
          extractedText: null, status: "extracting",
        });
        try {
          const arrayBuffer = await file.arrayBuffer();
          const result = await mammoth.extractRawText({ arrayBuffer });
          const extractedText = result.value.trim();
          if (!extractedText) {
            setUploadedFile((prev) => prev ? { ...prev, status: "extraction_error" } : null);
            toast({ title: "No text found in document", description: "The file may be empty or image-only.", variant: "destructive" });
            return;
          }
          setUploadedFile((prev) => prev ? { ...prev, extractedText, status: "extracted" } : null);
          setForm((prev) => ({ ...prev, rawNotes: extractedText }));
        } catch (err) {
          const msg = err instanceof Error ? err.message : "DOCX extraction failed";
          setUploadedFile((prev) => prev ? { ...prev, status: "extraction_error" } : null);
          toast({ title: "File extraction failed", description: msg, variant: "destructive" });
        }
      } else {
        toast({ title: "Unsupported file type", description: "Only .txt, .md, .pdf, and .docx files can be processed locally.", variant: "destructive" });
      }
    },
    [pdfExtractor]
  );

  // Sync PDF extractor results
  useEffect(() => {
    if (pdfExtractor.fullText && uploadedFile?.status === "extracting") {
      setUploadedFile((prev) => prev ? { ...prev, extractedText: pdfExtractor.fullText, status: "extracted" } : null);
      setForm((prev) => ({ ...prev, rawNotes: pdfExtractor.fullText }));
    }
    if (pdfExtractor.error && uploadedFile?.status === "extracting") {
      setUploadedFile((prev) => prev ? { ...prev, status: "extraction_error" } : null);
    }
  }, [pdfExtractor.fullText, pdfExtractor.error, uploadedFile?.status]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file) handleFileSelect(file);
    },
    [handleFileSelect]
  );

  const removeFile = useCallback(() => {
    setUploadedFile(null);
    pdfExtractor.clearText();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [pdfExtractor]);

  // ─── Generate handler (fully transient) ────────────────
  const handleGenerate = useCallback(async () => {
    if (!canGenerate || !session) return;

    setGenerationStatus("generating");
    setErrorMessage(null);
    setGenerationSummary(null);

    try {
      const { data: genResponse, error: genError } = await supabase.functions.invoke(
        "generate-guidance-phase2",
        { body: { session_id: session.id, interview_notes: form.rawNotes.trim() } }
      );
      if (genError) throw new Error(genError.message || "Fact extraction failed");
      if (genResponse && !genResponse.success) throw new Error(genResponse.error || "Fact extraction failed");

      setResult({
        generated_at: genResponse.generated_at,
        model: genResponse.model,
        answers: genResponse.answers,
      });
      setGenerationSummary({
        factFieldCount: genResponse?.fact_field_count ?? 0,
        answeredFieldCount: genResponse?.answered_field_count ?? 0,
        model: genResponse?.model ?? "unknown",
      });

      setGenerationStatus("success");
      toast({
        title: "Fact extraction complete",
        description: `${genResponse?.answered_field_count ?? 0} of ${genResponse?.fact_field_count ?? 0} fields answered.`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setErrorMessage(msg);
      setGenerationStatus("error");
      toast({ title: "Extraction failed", description: msg, variant: "destructive" });
    }
  }, [canGenerate, session, form]);

  /**
   * SECURITY: Clear all in-memory sensitive state.
   * This is called on Done, Discard, and Clear All.
   */
  const purgeWorkingContent = useCallback(() => {
    setForm(INITIAL_FORM);
    setUploadedFile(null);
    setResult(null);
    setGenerationStatus("idle");
    setGenerationSummary(null);
    setErrorMessage(null);
    setSearchFilter("");
    setShowFilter("all");
    pdfExtractor.clearText();
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [pdfExtractor]);

  const handleClear = useCallback(() => {
    purgeWorkingContent();
    setShowClearDialog(false);
  }, [purgeWorkingContent]);

  // ─── Done handler — marks step complete and purges content ─
  const handleDone = useCallback(async () => {
    if (!session) return;
    setIsDoneLoading(true);

    try {
      const { data: current } = await supabase
        .from("sessions")
        .select("metadata")
        .eq("id", session.id)
        .maybeSingle();

      const existingMeta = (current?.metadata as Record<string, unknown>) ?? {};

      const { error } = await supabase
        .from("sessions")
        .update({
          metadata: {
            ...existingMeta,
            case_notes_completed_at: new Date().toISOString(),
          },
        })
        .eq("id", session.id);

      if (error) throw error;

      // SECURITY: Purge all working content from memory before navigating
      purgeWorkingContent();

      toast({
        title: "Case Notes secured",
        description: "Step marked as done. Sensitive content has been cleared.",
      });

      navigate(-1);
    } catch (err) {
      console.error("[CaseNotes] Done handler error:", err);
      toast({
        title: "Failed to mark as done",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsDoneLoading(false);
      setShowDoneDialog(false);
    }
  }, [session, navigate, purgeWorkingContent]);

  // ─── Back navigation with security guard ───────────────
  const handleBack = useCallback(() => {
    if (hasInProgressWork) {
      setShowLeaveDialog(true);
    } else {
      navigate(-1);
    }
  }, [hasInProgressWork, navigate]);

  // ─── Clear all with confirmation ───────────────────────
  const handleClearClick = useCallback(() => {
    if (hasInProgressWork) {
      setShowClearDialog(true);
    } else {
      handleClear();
    }
  }, [hasInProgressWork, handleClear]);

  // ─── Filtered answers ──────────────────────────────────
  const filteredAnswers = useMemo(() => {
    if (!result?.answers) return [];
    let items = result.answers;
    if (showFilter === "answered") items = items.filter((a) => a.answer !== null);
    if (showFilter === "missing") items = items.filter((a) => a.answer === null);
    const q = searchFilter.trim().toLowerCase();
    if (q) {
      items = items.filter(
        (a) =>
          a.label.toLowerCase().includes(q) ||
          a.question.toLowerCase().includes(q) ||
          (a.answer && a.answer.toLowerCase().includes(q))
      );
    }
    return items;
  }, [result, searchFilter, showFilter]);

  const answeredCount = result?.answers.filter((a) => a.answer !== null).length ?? 0;
  const totalCount = result?.answers.length ?? 0;

  // ─── Copy / Download ───────────────────────────────────
  const handleCopy = useCallback(async () => {
    if (!result) return;
    const text = result.answers
      .map((a) => `${a.label}: ${a.answer ?? "N/A"}`)
      .join("\n");
    await navigator.clipboard.writeText(text);
    toast({ description: "Copied to clipboard" });
  }, [result]);

  const handleDownload = useCallback(() => {
    if (!result) return;
    const text = result.answers
      .map((a) => `${a.label}\nQ: ${a.question}\nA: ${a.answer ?? "N/A"}\nConfidence: ${a.confidence}\n`)
      .join("\n---\n\n");
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `case-notes-${(session?.caseLabel || "draft").replace(/\s+/g, "-")}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result, session]);

  // ─── Readiness derivations ─────────────────────────────
  const sessionReadiness: ReadinessState = sessionReady ? "ready" : "missing";
  const templateReadiness: ReadinessState = !session ? "missing" : session.templateId ? "ready" : "attention";
  const notesReadiness: ReadinessState = notesReady
    ? "ready"
    : notesEmpty ? "missing" : "attention";
  const permissionReadiness: ReadinessState = form.permissionConfirmed ? "ready" : "missing";
  const allReady = sessionReady && templateReady && notesReady && form.permissionConfirmed;
  const phase2Readiness: ReadinessState = allReady ? "ready" : "missing";

  const disabledReason = !sessionReady
    ? "No session context available."
    : !templateReady
    ? "Assign a template to this session first."
    : !notesReady
    ? notesEmpty
      ? "Add case notes to continue."
      : "Notes are too short — add at least 20 characters."
    : !form.permissionConfirmed
    ? "Confirm permission before extraction."
    : null;

  // ─── Loading state ─────────────────────────────────────
  if (sessionLoading) {
    return (
      <DashboardLayout>
        <div className="max-w-6xl mx-auto flex items-center justify-center py-24">
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="h-6 w-6 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Loading session…</p>
          </div>
        </div>
      </DashboardLayout>
    );
  }

  if (!session) {
    return (
      <DashboardLayout>
        <div className="max-w-6xl mx-auto flex flex-col items-center justify-center py-24 gap-4">
          <AlertCircle className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">Session not found.</p>
          <Button variant="outline" size="sm" onClick={() => navigate(-1)}>
            Go back
          </Button>
        </div>
      </DashboardLayout>
    );
  }

  /**
   * SECURITY: If step was already completed and there's no in-memory work,
   * show the secured/locked state instead of a confusing empty workspace.
   */
  if (session.caseNotesCompleted && !hasInProgressWork) {
    return (
      <DashboardLayout>
        <SecuredState caseLabel={session.caseLabel} onBack={() => navigate(-1)} />
      </DashboardLayout>
    );
  }

  return (
    <DashboardLayout>
      {/* ─── Security Leave Dialog ─── */}
      <AlertDialog open={showLeaveDialog} onOpenChange={setShowLeaveDialog}>
        <AlertDialogContent className="max-w-md rounded-2xl">
          <AlertDialogHeader className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                <ShieldAlert className="h-4 w-4 text-muted-foreground" />
              </div>
              <AlertDialogTitle className="text-base">Sensitive content in workspace</AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-sm text-muted-foreground">
              Your case notes and any extracted answers are held in memory only.
              Leaving this page will clear all working content — it will not be
              available for later return.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => {
                purgeWorkingContent();
                setShowLeaveDialog(false);
                navigate(-1);
              }}
            >
              Discard and leave
            </Button>
            <Button onClick={() => setShowLeaveDialog(false)}>
              Continue working
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Done & Lock Confirmation Dialog ─── */}
      <AlertDialog open={showDoneDialog} onOpenChange={setShowDoneDialog}>
        <AlertDialogContent className="max-w-md rounded-2xl">
          <AlertDialogHeader className="space-y-2">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                <Lock className="h-4 w-4 text-muted-foreground" />
              </div>
              <AlertDialogTitle className="text-base">Complete and secure this step?</AlertDialogTitle>
            </div>
            <AlertDialogDescription className="text-sm text-muted-foreground">
              Marking this step as done will clear all case-note content from
              this workspace. AidMind does not retain sensitive notes for
              casual reopening — returning later will show a secured state.
              <span className="block mt-2 text-xs text-muted-foreground/70">
                Copy or download your extraction results before continuing if you need them.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <Button variant="outline" onClick={() => setShowDoneDialog(false)}>
              Continue working
            </Button>
            <Button
              onClick={handleDone}
              disabled={isDoneLoading}
              className="gap-2"
            >
              {isDoneLoading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Securing…
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4" />
                  Done and secure
                </>
              )}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ─── Clear All Confirmation Dialog ─── */}
      <AlertDialog open={showClearDialog} onOpenChange={setShowClearDialog}>
        <AlertDialogContent className="max-w-md rounded-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Clear all work?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove your notes, permission confirmation, and any extracted answers from memory. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex-col gap-2 sm:flex-row">
            <Button variant="outline" onClick={() => setShowClearDialog(false)}>
              Keep working
            </Button>
            <Button variant="destructive" onClick={handleClear}>
              Clear all
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <div className="max-w-6xl mx-auto space-y-6">
        {/* ─── Page Header ─── */}
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={handleBack}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold text-foreground">Case Notes</h1>
                <Badge variant="secondary" className="text-xs font-normal">Step 2 of 3</Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Extract structured, fact-based answers from interview notes into the selected template.
              </p>
            </div>
          </div>
          {/* SECURITY: Privacy notice */}
          <div className="flex items-center gap-1.5 pl-11">
            <Lock className="h-3 w-3 text-muted-foreground/60" />
            <p className="text-xs text-muted-foreground">
              Sensitive content is held in memory only and cleared when you leave or finish.
            </p>
          </div>
        </div>

        {/* ─── Two-column layout ─── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">

          {/* ═══ LEFT COLUMN — Note input workspace ═══ */}
          <div className="space-y-4">

            {/* Source Notes card */}
            <Card className="border border-border shadow-none">
              <CardHeader className="pb-2 pt-4 px-5">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-foreground">
                    Source Notes
                  </CardTitle>
                  <div className="flex items-center rounded-md border border-border overflow-hidden">
                    <button
                      className={cn(
                        "px-3 py-1 text-xs font-medium transition-colors",
                        inputMode === "paste"
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-muted-foreground hover:text-foreground"
                      )}
                      onClick={() => setInputMode("paste")}
                    >
                      Paste notes
                    </button>
                    <button
                      className={cn(
                        "px-3 py-1 text-xs font-medium transition-colors border-l border-border",
                        inputMode === "upload"
                          ? "bg-primary text-primary-foreground"
                          : "bg-background text-muted-foreground hover:text-foreground"
                      )}
                      onClick={() => setInputMode("upload")}
                    >
                      Upload file
                    </button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-5 pb-5 space-y-3">
                {inputMode === "upload" && (
                  <div className="space-y-3">
                    {!uploadedFile ? (
                      <div
                        className="border-2 border-dashed border-border rounded-lg p-8 text-center hover:border-primary/40 transition-colors cursor-pointer"
                        onClick={() => fileInputRef.current?.click()}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={handleDrop}
                      >
                        <Upload className="h-6 w-6 mx-auto text-muted-foreground/60 mb-2" />
                        <p className="text-sm text-muted-foreground">Drag & drop or choose a file</p>
                        <p className="text-xs text-muted-foreground/70 mt-1">Case notes, interview notes, or exported documents</p>
                        <p className="text-xs text-muted-foreground/50 mt-0.5">.txt, .md, .pdf, .docx</p>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept={ACCEPTED_EXTENSIONS}
                          className="hidden"
                          onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileSelect(f); }}
                        />
                      </div>
                    ) : (
                      <div className="border border-border rounded-lg p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">{uploadedFile.name}</p>
                              <p className="text-xs text-muted-foreground">{formatFileSize(uploadedFile.size)}</p>
                            </div>
                          </div>
                          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={removeFile}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                        {uploadedFile.status === "reading" && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" /> Reading file…
                          </div>
                        )}
                        {uploadedFile.status === "extracting" && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" /> Extracting text from document…
                          </div>
                        )}
                        {uploadedFile.status === "extracted" && (
                          <p className="text-xs text-[hsl(var(--status-success))]">
                            <CheckCircle2 className="h-3 w-3 inline mr-1" />
                            Text extracted — {uploadedFile.extractedText?.length ?? 0} characters
                          </p>
                        )}
                        {uploadedFile.status === "extraction_error" && (
                          <p className="text-xs text-destructive">
                            Text extraction failed. The file may be image-only or unsupported. Try pasting notes instead.
                          </p>
                        )}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Extracted text populates the editor below. Review and edit before saving.
                    </p>
                  </div>
                )}

                {/* ─── Unified notes editor ─── */}
                <div>
                  <Textarea
                    placeholder={
                      inputMode === "upload"
                        ? "Extracted text will appear here, or paste additional notes…"
                        : "Client reported they are currently facing eviction from their apartment. The lease expires on April 30. They have two children enrolled at Lincoln Elementary. They applied for emergency housing assistance last week but have not received a response…"
                    }
                    className="min-h-[200px] text-sm resize-y"
                    value={form.rawNotes}
                    onChange={(e) => updateField("rawNotes", e.target.value)}
                  />
                  <div className="flex items-center justify-between mt-1.5">
                    <p className="text-xs text-muted-foreground">
                      {inputMode === "upload"
                        ? "Review and edit before extracting."
                        : "Paste interview notes, observations, or transcript excerpts."}
                    </p>
                    <span
                      className={cn(
                        "text-xs tabular-nums",
                        notesTooShort ? "text-[hsl(var(--status-warning))]"
                          : notesReady ? "text-muted-foreground"
                          : "text-muted-foreground/50"
                      )}
                    >
                      {notesLength} chars
                    </span>
                  </div>
                  {notesTooShort && (
                    <p className="text-xs text-[hsl(var(--status-warning))] mt-1">
                      Too short to extract from — minimum {MIN_NOTES_LENGTH} characters.
                    </p>
                  )}
                </div>

                {/* Note quality hints */}
                {!notesReady && (
                  <div className="rounded-lg bg-muted/40 p-3 space-y-1">
                    <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
                      <Info className="h-3 w-3" /> Tips for better extraction
                    </p>
                    <ul className="text-xs text-muted-foreground space-y-0.5 pl-5">
                      {NOTE_HINTS.map((hint, i) => (
                        <li key={i} className="list-disc">{hint}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Permission & Compliance */}
            <Card className="border border-border shadow-none bg-muted/30">
              <CardContent className="px-5 py-3">
                <div className="flex items-start gap-2.5">
                  <ShieldCheck className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="space-y-2 flex-1">
                    <p className="text-xs font-medium text-foreground">Permission & Compliance</p>
                    <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                      <Checkbox
                        checked={form.permissionConfirmed}
                        onCheckedChange={(v) => updateField("permissionConfirmed", !!v)}
                      />
                      I confirm I have permission to process these notes.
                    </label>
                    <p className="text-xs text-muted-foreground">
                      Required before extraction. Logged for audit.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Error banner */}
            {errorMessage && generationStatus === "error" && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-medium text-destructive">
                    Fact extraction failed
                  </p>
                  <p className="text-xs text-destructive/80 mt-0.5">{errorMessage}</p>
                </div>
              </div>
            )}

            {/* Generation success summary */}
            {generationStatus === "success" && generationSummary && (
              <div className="flex items-start gap-2 p-4 rounded-lg bg-[hsl(var(--status-success-muted))] border border-[hsl(var(--status-success)/0.2)]">
                <CheckCircle2 className="h-4 w-4 text-[hsl(var(--status-success))] mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-sm font-medium text-[hsl(var(--status-success-muted-foreground))]">
                    Fact extraction complete
                  </p>
                  <p className="text-xs text-[hsl(var(--status-success-muted-foreground))]">
                    {generationSummary.answeredFieldCount} of {generationSummary.factFieldCount} fact-based fields answered.
                    Review the results below, then click <strong>Done and secure</strong> to finish this step.
                  </p>
                </div>
              </div>
            )}

            {/* ─── Results panel ─── */}
            {(generationStatus === "success" || generationStatus === "generating") && (
              <Card className="border border-border shadow-none">
                <CardHeader className="pb-2 pt-4 px-5">
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle className="text-sm font-medium text-foreground">
                        Extracted Fact-Based Answers
                      </CardTitle>
                      {result && (
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          <span className="text-xs text-muted-foreground">
                            {answeredCount} of {totalCount} fields answered
                          </span>
                          <span className="text-xs text-muted-foreground">
                            Generated {new Date(result.generated_at).toLocaleString()}
                          </span>
                          
                        </div>
                      )}
                    </div>
                    {result && (
                      <div className="flex items-center gap-1">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleCopy}>
                                <Copy className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Copy all</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleDownload}>
                                <Download className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Download .txt</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8" disabled>
                                <Send className="h-3.5 w-3.5" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent>Send to Reviewer — coming soon</TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                    )}
                  </div>
                </CardHeader>
                {result && (
                  <div className="px-5 pb-2 flex items-center gap-2 flex-wrap">
                    <div className="relative flex-1 min-w-[140px] max-w-[220px]">
                      <Search className="h-3.5 w-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        placeholder="Search fields…"
                        className="h-8 text-xs pl-8"
                        value={searchFilter}
                        onChange={(e) => setSearchFilter(e.target.value)}
                      />
                    </div>
                    {(["all", "answered", "missing"] as const).map((f) => (
                      <Button
                        key={f}
                        variant={showFilter === f ? "secondary" : "ghost"}
                        size="sm"
                        className="h-7 text-xs px-2.5"
                        onClick={() => setShowFilter(f)}
                      >
                        {f === "all" ? "All" : f === "answered" ? "Answered" : "Missing"}
                      </Button>
                    ))}
                  </div>
                )}
                <Separator />
                <CardContent className="px-5 py-0">
                  {generationStatus === "generating" ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-3">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                      <p className="text-sm text-muted-foreground">Extracting fact-based answers…</p>
                      <p className="text-xs text-muted-foreground">This may take a few seconds.</p>
                    </div>
                  ) : result && filteredAnswers.length > 0 ? (
                    <div className="divide-y divide-border">
                      {filteredAnswers.map((answer) => (
                        <AnswerRow key={answer.field_key} answer={answer} />
                      ))}
                    </div>
                  ) : result && filteredAnswers.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-16 gap-2">
                      <p className="text-sm text-muted-foreground">No matching fields</p>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            )}
          </div>

          {/* ═══ RIGHT COLUMN — Session readiness + CTA ═══ */}
          <div className="space-y-4 lg:sticky lg:top-6 lg:self-start">

            {/* Session readiness card */}
            <Card className="border border-border shadow-none">
              <CardHeader className="pb-3 pt-4 px-5">
                <CardTitle className="text-sm font-medium text-foreground">
                  Extraction Setup
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5 space-y-1">
                <ReadinessRow
                  label="Session context"
                  state={sessionReadiness}
                  detail={session.caseLabel || session.sessionId}
                />
                <ReadinessRow
                  label="Template assigned"
                  state={templateReadiness}
                  detail={
                    session.templateId
                      ? session.templateName || "Template ready"
                      : "A template must be selected before fact extraction can run."
                  }
                />
                <ReadinessRow
                  label="Notes present"
                  state={notesReadiness}
                  detail={
                    notesReady
                      ? `${notesLength} characters — ready`
                      : notesEmpty
                      ? "No notes entered yet"
                      : `${notesLength} characters — too short to extract from`
                  }
                />
                <ReadinessRow
                  label="Permission confirmed"
                  state={permissionReadiness}
                  detail={
                    form.permissionConfirmed
                      ? "Confirmed"
                      : "Confirm permission before extraction"
                  }
                />
                <Separator className="my-2" />
                <ReadinessRow
                  label={allReady ? "Ready to extract fact-based answers" : "Missing required inputs"}
                  state={phase2Readiness}
                />
              </CardContent>
            </Card>

            {/* Primary CTA card */}
            <Card className="border border-border shadow-none">
              <CardContent className="px-5 py-4 space-y-3">
                {isExtractionComplete ? (
                  <>
                    {/* Done is the only primary action after extraction success */}
                    <Button
                      className="w-full gap-2"
                      onClick={() => setShowDoneDialog(true)}
                      disabled={isDoneLoading}
                    >
                      <Lock className="h-4 w-4" />
                      Done and secure
                    </Button>
                    <p className="text-xs text-muted-foreground text-center">
                      Completes this step and clears sensitive content from the workspace.
                    </p>
                  </>
                ) : (
                  <>
                    {/* Extract is primary before success */}
                    <Button
                      className="w-full gap-2"
                      disabled={!canGenerate}
                      onClick={handleGenerate}
                    >
                      {generationStatus === "generating" ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Extracting…
                        </>
                      ) : (
                        <>
                          <FileText className="h-4 w-4" />
                          Extract fact-based answers
                        </>
                      )}
                    </Button>

                    {disabledReason && generationStatus !== "generating" && (
                      <p className="text-xs text-muted-foreground text-center">
                        {disabledReason}
                      </p>
                    )}
                  </>
                )}

                {!isExtractionComplete && (
                  <>
                    <Separator />
                    <div className="flex items-center justify-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-xs text-muted-foreground/70 hover:text-destructive h-7 gap-1.5"
                        onClick={handleClearClick}
                        disabled={generationStatus === "generating"}
                      >
                        <Trash2 className="h-3 w-3" />
                        Clear all
                      </Button>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>

            {/* Security notice card */}
            <Card className="border border-border shadow-none bg-muted/20">
              <CardContent className="px-5 py-4 space-y-2">
                <div className="flex items-start gap-2">
                  <ShieldCheck className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-foreground">Privacy notice</p>
                    <p className="text-xs text-muted-foreground">
                      Sensitive content is not saved for later return. Finish and
                      secure when ready — leaving clears the workspace.
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Idle empty state for results */}
            {generationStatus === "idle" && (
              <Card className="border border-border shadow-none bg-muted/20">
                <CardContent className="px-5 py-8 flex flex-col items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center">
                    <FileText className="h-5 w-5 text-muted-foreground/40" />
                  </div>
                  <p className="text-sm text-muted-foreground text-center">
                    Extracted answers will appear after running fact extraction.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Pipeline hint */}
            <div className="rounded-lg bg-muted/30 p-3 space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Workflow</p>
              <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                <span>1. Before meeting → <strong>Guidance</strong></span>
                <span className="text-foreground font-medium">2. After meeting → <strong>Case Notes</strong> (you are here)</span>
                <span>3. Before submitting → <strong>Reviewer</strong></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
