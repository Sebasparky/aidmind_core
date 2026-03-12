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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

// ─── Types ───────────────────────────────────────────────
type GenerationStatus = "idle" | "generating" | "success" | "error";
type InputMode = "paste" | "upload";

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
  storagePath: string | null;
  status: "reading" | "ready" | "uploaded" | "extracting" | "error";
}

interface CaseNotesFormState {
  rawNotes: string;
  clientIdentifier: string;
  meetingDate: string;
  contactType: string;
  programDomain: string;
  permissionConfirmed: boolean;
}

const INITIAL_FORM: CaseNotesFormState = {
  rawNotes: "",
  clientIdentifier: "",
  meetingDate: "",
  contactType: "",
  programDomain: "",
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

// ─── Main Page ───────────────────────────────────────────
export default function CaseNotes() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const [form, setForm] = useState<CaseNotesFormState>(INITIAL_FORM);
  const [inputMode, setInputMode] = useState<InputMode>("paste");
  const [uploadedFile, setUploadedFile] = useState<UploadedFile | null>(null);
  const [status, setStatus] = useState<GenerationStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<Phase2Result | null>(null);
  const [sessionLabel, setSessionLabel] = useState<string>("");
  const [templateName, setTemplateName] = useState<string | null>(null);
  const [hasTemplate, setHasTemplate] = useState<boolean | null>(null);
  const [permissionError, setPermissionError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filters for results
  const [searchFilter, setSearchFilter] = useState("");
  const [showFilter, setShowFilter] = useState<"all" | "answered" | "missing">("all");

  const updateField = useCallback(
    <K extends keyof CaseNotesFormState>(key: K, value: CaseNotesFormState[K]) => {
      setForm((prev) => ({ ...prev, [key]: value }));
      if (key === "permissionConfirmed" && value) setPermissionError(false);
    },
    []
  );

  // Load session data on mount
  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      const { data, error } = await supabase
        .from("sessions")
        .select("case_label, template_id, interview_notes, metadata")
        .eq("session_id", sessionId)
        .maybeSingle();

      if (error || !data) return;

      setSessionLabel(data.case_label || sessionId);
      setHasTemplate(!!data.template_id);

      // Load template name if assigned
      if (data.template_id) {
        const { data: tmpl } = await supabase
          .from("kb_templates")
          .select("name")
          .eq("id", data.template_id)
          .maybeSingle();
        if (tmpl) setTemplateName(tmpl.name);
      }

      if (data.interview_notes) {
        setForm((prev) => ({ ...prev, rawNotes: data.interview_notes! }));
      }

      const meta = data.metadata as Record<string, unknown> | null;
      if (meta?.guidance_phase2) {
        setResult(meta.guidance_phase2 as Phase2Result);
        setStatus("success");
      }
      if (meta?.case_context) {
        const cc = meta.case_context as Record<string, string>;
        setForm((prev) => ({
          ...prev,
          clientIdentifier: cc.client_identifier || "",
          meetingDate: cc.meeting_date || "",
          contactType: cc.contact_type || "",
          programDomain: cc.program_domain || "",
        }));
      }
    })();
  }, [sessionId]);

  // The effective notes text — both modes converge here
  const effectiveNotes = useMemo(() => {
    if (inputMode === "upload" && uploadedFile?.extractedText) {
      // If user switched to upload and extracted text, use that in the editor
      return uploadedFile.extractedText;
    }
    return form.rawNotes;
  }, [inputMode, uploadedFile, form.rawNotes]);

  const notesLength = effectiveNotes.trim().length;
  const notesReady = notesLength >= MIN_NOTES_LENGTH;
  const notesTooShort = notesLength > 0 && !notesReady;
  const notesEmpty = notesLength === 0;

  // Readiness derivation
  const sessionReady = !!sessionId;
  const templateReady = hasTemplate === true;
  const allReady = sessionReady && templateReady && notesReady;

  const canGenerate =
    allReady &&
    form.permissionConfirmed &&
    status !== "generating";

  // ─── File handling ─────────────────────────────────────
  const handleFileSelect = useCallback(
    async (file: File) => {
      if (!ACCEPTED_MIMES.includes(file.type) && !file.name.endsWith(".md")) {
        toast({ title: "Unsupported file type", variant: "destructive" });
        return;
      }

      const isText = file.type === "text/plain" || file.name.endsWith(".md") || file.type === "text/markdown";

      if (isText) {
        setUploadedFile({
          name: file.name,
          size: file.size,
          mime: file.type || "text/plain",
          extractedText: null,
          storagePath: null,
          status: "reading",
        });
        const text = await file.text();
        setUploadedFile((prev) =>
          prev ? { ...prev, extractedText: text, status: "ready" } : null
        );
        // Also populate the main editor
        setForm((prev) => ({ ...prev, rawNotes: text }));
      } else {
        setUploadedFile({
          name: file.name,
          size: file.size,
          mime: file.type,
          extractedText: null,
          storagePath: null,
          status: "reading",
        });

        try {
          const path = `case-notes/${sessionId}/${Date.now()}-${file.name}`;
          const { error: uploadErr } = await supabase.storage
            .from("review-documents")
            .upload(path, file, { upsert: true });

          if (uploadErr) throw uploadErr;

          setUploadedFile((prev) =>
            prev ? { ...prev, storagePath: path, status: "uploaded" } : null
          );
        } catch {
          setUploadedFile((prev) =>
            prev ? { ...prev, status: "error" } : null
          );
          toast({ title: "File upload failed", variant: "destructive" });
        }
      }
    },
    [sessionId]
  );

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
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  // When extracted text from upload is available, populate the editor
  const handleUseExtractedText = useCallback(() => {
    if (uploadedFile?.extractedText) {
      setForm((prev) => ({ ...prev, rawNotes: uploadedFile.extractedText! }));
      setInputMode("paste"); // Switch to paste so user sees the unified editor
    }
  }, [uploadedFile]);

  // ─── Generate handler ──────────────────────────────────
  const handleGenerate = useCallback(async () => {
    if (!form.permissionConfirmed) {
      setPermissionError(true);
      return;
    }
    if (!canGenerate || !sessionId) return;

    setStatus("generating");
    setErrorMessage(null);

    try {
      const notesText = effectiveNotes.trim();
      const { error: uploadError } = await supabase.functions.invoke(
        "upload-interview-notes-text",
        { body: { session_id: sessionId, notes_text: notesText } }
      );
      if (uploadError) throw new Error(uploadError.message || "Failed to save notes");

      // Merge metadata
      const { data: current } = await supabase
        .from("sessions")
        .select("metadata")
        .eq("session_id", sessionId)
        .maybeSingle();

      const existingMeta = (current?.metadata as Record<string, unknown>) || {};

      const caseContext: Record<string, string> = {};
      if (form.clientIdentifier) caseContext.client_identifier = form.clientIdentifier;
      if (form.meetingDate) caseContext.meeting_date = form.meetingDate;
      if (form.contactType) caseContext.contact_type = form.contactType;
      if (form.programDomain) caseContext.program_domain = form.programDomain;

      const sourceInfo: { mode: string; file?: { name: string; size: number; mime: string; path: string | null } } = { mode: inputMode };
      if (inputMode === "upload" && uploadedFile) {
        sourceInfo.file = {
          name: uploadedFile.name,
          size: uploadedFile.size,
          mime: uploadedFile.mime,
          path: uploadedFile.storagePath,
        };
      }

      const mergedMeta = {
        ...existingMeta,
        ...(Object.keys(caseContext).length > 0 ? { case_context: caseContext } : {}),
        case_notes_permission: {
          confirmed: true,
          confirmed_at: new Date().toISOString(),
        },
        case_notes_source: sourceInfo,
      };

      await supabase
        .from("sessions")
        .update({
          metadata: mergedMeta as unknown as import("@/integrations/supabase/types").Json,
          updated_at: new Date().toISOString(),
        })
        .eq("session_id", sessionId);

      // Call generate-guidance-phase2
      const { error: genError } = await supabase.functions.invoke(
        "generate-guidance-phase2",
        { body: { session_id: sessionId } }
      );
      if (genError) throw new Error(genError.message || "Fact extraction failed");

      // Poll for results
      let attempts = 0;
      const maxAttempts = 8;
      let phase2Data: Phase2Result | null = null;

      while (attempts < maxAttempts) {
        await new Promise((r) => setTimeout(r, 800));
        const { data: refreshed } = await supabase
          .from("sessions")
          .select("metadata")
          .eq("session_id", sessionId)
          .maybeSingle();

        const meta = refreshed?.metadata as Record<string, unknown> | null;
        if (meta?.guidance_phase2) {
          phase2Data = meta.guidance_phase2 as Phase2Result;
          break;
        }
        attempts++;
      }

      if (!phase2Data) {
        throw new Error("Results not yet available. Please refresh in a moment.");
      }

      setResult(phase2Data);
      setStatus("success");
      toast({ title: "Fact extraction complete", description: "Review extracted answers below." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setErrorMessage(msg);
      setStatus("error");
      toast({ title: "Extraction failed", description: msg, variant: "destructive" });
    }
  }, [canGenerate, sessionId, form, effectiveNotes, inputMode, uploadedFile]);

  const handleClear = useCallback(() => {
    setForm(INITIAL_FORM);
    setUploadedFile(null);
    setResult(null);
    setStatus("idle");
    setErrorMessage(null);
    setPermissionError(false);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

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
    a.download = `case-notes-${sessionLabel.replace(/\s+/g, "-") || "draft"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result, sessionLabel]);

  // ─── Readiness derivations ─────────────────────────────
  const sessionReadiness: ReadinessState = sessionReady ? "ready" : "missing";
  const templateReadiness: ReadinessState = hasTemplate === null ? "missing" : hasTemplate ? "ready" : "attention";
  const notesReadiness: ReadinessState = notesReady ? "ready" : notesEmpty ? "missing" : "attention";
  const phase2Readiness: ReadinessState = allReady ? "ready" : "missing";

  const disabledReason = !sessionReady
    ? "No session context available."
    : !templateReady
    ? "Assign a template to this session first."
    : !notesReady
    ? "Add at least 20 characters of case notes."
    : !form.permissionConfirmed
    ? "Confirm permission to process these notes."
    : null;

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        {/* ─── Page Header ─── */}
        <div className="space-y-1">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => navigate(-1)}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-lg font-semibold text-foreground">Case Notes</h1>
              <p className="text-sm text-muted-foreground">
                Paste or upload interview notes, then extract fact-based answers for the selected template.
              </p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground pl-11">
            Only fact-based template fields will be answered from the notes.
          </p>
        </div>

        {/* ─── Two-column layout ─── */}
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6">

          {/* ═══════════════════════════════════════════════
              LEFT COLUMN — Note input workspace
              ═══════════════════════════════════════════════ */}
          <div className="space-y-4">

            {/* Input mode toggle + Source notes */}
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
                        <p className="text-sm text-muted-foreground">
                          Drag & drop or choose a file
                        </p>
                        <p className="text-xs text-muted-foreground/70 mt-1">
                          Case notes, interview notes, or exported documents
                        </p>
                        <p className="text-xs text-muted-foreground/50 mt-0.5">
                          .txt, .md, .pdf, .docx
                        </p>
                        <input
                          ref={fileInputRef}
                          type="file"
                          accept={ACCEPTED_EXTENSIONS}
                          className="hidden"
                          onChange={(e) => {
                            const f = e.target.files?.[0];
                            if (f) handleFileSelect(f);
                          }}
                        />
                      </div>
                    ) : (
                      <div className="border border-border rounded-lg p-4 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-foreground truncate">
                                {uploadedFile.name}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {formatFileSize(uploadedFile.size)}
                              </p>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 shrink-0"
                            onClick={removeFile}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>

                        {uploadedFile.status === "reading" && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            {uploadedFile.mime === "text/plain" || uploadedFile.name.endsWith(".md")
                              ? "Reading file…"
                              : "Uploading…"}
                          </div>
                        )}
                        {uploadedFile.status === "ready" && (
                          <div className="space-y-1.5">
                            <p className="text-xs text-[hsl(var(--status-success))]">
                              <CheckCircle2 className="h-3 w-3 inline mr-1" />
                              Text extracted successfully
                            </p>
                            {uploadedFile.extractedText && !form.rawNotes && (
                              <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleUseExtractedText}>
                                Use extracted text in editor
                              </Button>
                            )}
                          </div>
                        )}
                        {uploadedFile.status === "uploaded" && (
                          <p className="text-xs text-muted-foreground">
                            <CheckCircle2 className="h-3 w-3 inline mr-1 text-[hsl(var(--status-success))]" />
                            Uploaded — server-side text extraction pending
                          </p>
                        )}
                        {uploadedFile.status === "extracting" && (
                          <div className="flex items-center gap-2 text-xs text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            Extracting text from document…
                          </div>
                        )}
                        {uploadedFile.status === "error" && (
                          <p className="text-xs text-destructive">
                            Upload failed. Please try again.
                          </p>
                        )}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Extracted text will populate the notes editor below. You can review and edit before continuing.
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
                        ? "Review and edit extracted text before running extraction."
                        : "Paste interview notes, observations, or transcript excerpts."}
                    </p>
                    <span
                      className={cn(
                        "text-xs tabular-nums",
                        notesTooShort
                          ? "text-[hsl(var(--status-warning))]"
                          : notesReady
                          ? "text-muted-foreground"
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
                      <Info className="h-3 w-3" />
                      Tips for better extraction
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

            {/* Case Context */}
            <Card className="border border-border shadow-none">
              <CardHeader className="pb-2 pt-4 px-5">
                <CardTitle className="text-sm font-medium text-foreground">
                  Case Context
                  <span className="text-xs font-normal text-muted-foreground ml-2">Optional</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="px-5 pb-5">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Client Name / ID</Label>
                    <Input
                      placeholder="Optional"
                      className="text-sm h-9"
                      value={form.clientIdentifier}
                      onChange={(e) => updateField("clientIdentifier", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Meeting Date</Label>
                    <Input
                      type="date"
                      className="text-sm h-9"
                      value={form.meetingDate}
                      onChange={(e) => updateField("meetingDate", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Contact Type</Label>
                    <Select value={form.contactType} onValueChange={(v) => updateField("contactType", v)}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Select…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="home-visit">Home visit</SelectItem>
                        <SelectItem value="phone">Phone</SelectItem>
                        <SelectItem value="court">Court</SelectItem>
                        <SelectItem value="office">Office</SelectItem>
                        <SelectItem value="school">School</SelectItem>
                        <SelectItem value="video">Video</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Program / Domain</Label>
                    <Select value={form.programDomain} onValueChange={(v) => updateField("programDomain", v)}>
                      <SelectTrigger className="h-9 text-sm">
                        <SelectValue placeholder="Select…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="snap">SNAP</SelectItem>
                        <SelectItem value="medicaid">Medicaid</SelectItem>
                        <SelectItem value="housing">Housing</SelectItem>
                        <SelectItem value="child-welfare">Child Welfare</SelectItem>
                        <SelectItem value="disability">Disability</SelectItem>
                        <SelectItem value="benefits">Benefits</SelectItem>
                        <SelectItem value="general">General</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
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
                    {permissionError && !form.permissionConfirmed && (
                      <p className="text-xs text-destructive">Confirmation required.</p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Error banner */}
            {status === "error" && errorMessage && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <p className="text-xs text-destructive">{errorMessage}</p>
              </div>
            )}

            {/* ─── Results panel (shown below workspace on mobile, but also in left col on desktop for full width) ─── */}
            {(status === "success" || status === "generating") && (
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
                          <Badge variant="secondary" className="text-xs">Draft</Badge>
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

                {/* Filters */}
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
                  {status === "generating" ? (
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

          {/* ═══════════════════════════════════════════════
              RIGHT COLUMN — Session readiness + CTA
              ═══════════════════════════════════════════════ */}
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
                  detail={sessionReady ? (sessionLabel || sessionId) : "No active session"}
                />

                <ReadinessRow
                  label="Template assigned"
                  state={templateReadiness}
                  detail={
                    hasTemplate === null
                      ? "Loading…"
                      : hasTemplate
                      ? templateName || "Template ready"
                      : "A template must be selected before fact extraction can run."
                  }
                />

                <ReadinessRow
                  label="Notes present"
                  state={notesReadiness}
                  detail={
                    notesReady
                      ? `${notesLength} characters — looks ready`
                      : notesEmpty
                      ? "No notes entered yet"
                      : `${notesLength} characters — too short to extract from`
                  }
                />

                <Separator className="my-2" />

                <ReadinessRow
                  label={allReady ? "Ready to extract fact-based answers" : "Missing required inputs"}
                  state={phase2Readiness}
                />
              </CardContent>
            </Card>

            {/* Primary CTA */}
            <Card className="border border-border shadow-none">
              <CardContent className="px-5 py-4 space-y-3">
                <Button
                  className="w-full gap-2"
                  disabled={!canGenerate}
                  onClick={handleGenerate}
                >
                  {status === "generating" ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Extracting…
                    </>
                  ) : status === "success" ? (
                    <>
                      <CheckCircle2 className="h-4 w-4" />
                      Re-extract answers
                    </>
                  ) : (
                    <>
                      <FileText className="h-4 w-4" />
                      Extract fact-based answers
                    </>
                  )}
                </Button>

                {disabledReason && status !== "generating" && (
                  <p className="text-xs text-muted-foreground text-center">
                    {disabledReason}
                  </p>
                )}

                {status === "success" && (
                  <p className="text-xs text-muted-foreground text-center">
                    Re-running will replace existing extracted answers.
                  </p>
                )}

                <div className="flex items-center justify-center">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground h-7"
                    onClick={handleClear}
                    disabled={status === "generating"}
                  >
                    Clear all
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Idle empty state for results */}
            {status === "idle" && (
              <Card className="border border-border shadow-none bg-muted/20">
                <CardContent className="px-5 py-8 flex flex-col items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center">
                    <FileText className="h-5 w-5 text-muted-foreground/40" />
                  </div>
                  <p className="text-sm text-muted-foreground text-center">
                    Extracted answers will appear here after running fact extraction.
                  </p>
                </CardContent>
              </Card>
            )}

            {/* Pipeline hint */}
            <div className="rounded-lg bg-muted/30 p-3 space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Workflow</p>
              <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                <span>1. Before meeting → <strong>Guidance</strong></span>
                <span>2. After meeting → <strong>Case Notes</strong> (you are here)</span>
                <span>3. Before submitting → <strong>Reviewer</strong></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
}
