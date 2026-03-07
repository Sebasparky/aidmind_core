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
  status: "reading" | "ready" | "uploaded" | "error";
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
    high: "bg-primary/10 text-primary",
    medium: "bg-muted text-muted-foreground",
    low: "bg-destructive/10 text-destructive",
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
  const [hasTemplate, setHasTemplate] = useState<boolean | null>(null);
  const [permissionError, setPermissionError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Filters
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

      if (data.interview_notes) {
        setForm((prev) => ({ ...prev, rawNotes: data.interview_notes! }));
      }

      const meta = data.metadata as Record<string, unknown> | null;
      if (meta?.guidance_phase2) {
        setResult(meta.guidance_phase2 as Phase2Result);
        setStatus("success");
      }
      // Restore case context
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

  // The effective notes text (from paste or uploaded file)
  const effectiveNotes = useMemo(() => {
    if (inputMode === "upload" && uploadedFile?.extractedText) {
      return uploadedFile.extractedText;
    }
    return form.rawNotes;
  }, [inputMode, uploadedFile, form.rawNotes]);

  const notesReady = effectiveNotes.trim().length >= MIN_NOTES_LENGTH;
  const notesTooShort = effectiveNotes.length > 0 && !notesReady;

  const canGenerate =
    notesReady &&
    form.permissionConfirmed &&
    status !== "generating" &&
    hasTemplate !== false;

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
      } else {
        // PDF / DOCX — upload to storage
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
            prev
              ? { ...prev, storagePath: path, status: "uploaded" }
              : null
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
      // Step 1: Save notes
      const notesText = effectiveNotes.trim();
      const { error: uploadError } = await supabase.functions.invoke(
        "upload-interview-notes-text",
        { body: { session_id: sessionId, notes_text: notesText } }
      );
      if (uploadError) throw new Error(uploadError.message || "Failed to save notes");

      // Step 1b: Merge metadata (case_context + permission + source info)
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

      const sourceInfo: Record<string, unknown> = { mode: inputMode };
      if (inputMode === "upload" && uploadedFile) {
        sourceInfo.file = {
          name: uploadedFile.name,
          size: uploadedFile.size,
          mime: uploadedFile.mime,
          path: uploadedFile.storagePath,
        };
      }

      await supabase
        .from("sessions")
        .update({
          metadata: {
            ...existingMeta,
            ...(Object.keys(caseContext).length > 0 ? { case_context: caseContext } : {}),
            case_notes_permission: {
              confirmed: true,
              confirmed_at: new Date().toISOString(),
            },
            case_notes_source: sourceInfo,
          },
          updated_at: new Date().toISOString(),
        })
        .eq("session_id", sessionId);

      // Step 2: Call generate-guidance-phase2
      const { error: genError } = await supabase.functions.invoke(
        "generate-guidance-phase2",
        { body: { session_id: sessionId } }
      );
      if (genError) throw new Error(genError.message || "Phase 2 generation failed");

      // Step 3: Poll for results
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
      toast({ title: "Case notes generated", description: "Review extracted facts below." });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setErrorMessage(msg);
      setStatus("error");
      toast({ title: "Generation failed", description: msg, variant: "destructive" });
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

  return (
    <DashboardLayout>
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={() => navigate("/dashboard")}
            >
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <div>
              <h1 className="text-lg font-semibold text-foreground">Generate Case Notes</h1>
              <p className="text-sm text-muted-foreground">
                Phase 2 — Turn raw notes into structured documentation
              </p>
            </div>
          </div>
          <Badge variant="outline" className="text-xs shrink-0 mt-1">
            Session: {sessionLabel || sessionId}
          </Badge>
        </div>

        {/* No template warning */}
        {hasTemplate === false && (
          <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/5 border border-destructive/20">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
            <p className="text-sm text-destructive/90">
              This session has no template assigned. Choose a template before generating case notes.
            </p>
          </div>
        )}

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* ─── Left: Inputs ─── */}
          <div className="space-y-4">
            {/* Source Notes */}
            <Card className="border border-border shadow-none">
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-sm font-medium text-foreground">Source Notes</CardTitle>
                  {/* Segmented toggle */}
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
              <CardContent className="px-4 pb-4 space-y-3">
                {inputMode === "paste" ? (
                  <div>
                    <Textarea
                      placeholder="Paste raw notes, bullets, or transcript excerpts…"
                      className="min-h-[160px] text-sm resize-y"
                      value={form.rawNotes}
                      onChange={(e) => updateField("rawNotes", e.target.value)}
                    />
                    <div className="flex items-center justify-between mt-1.5">
                      <p className="text-xs text-muted-foreground">
                        Paste unstructured notes. We'll extract factual answers for the template.
                      </p>
                      <span
                        className={cn(
                          "text-xs tabular-nums",
                          notesTooShort ? "text-destructive" : "text-muted-foreground"
                        )}
                      >
                        {form.rawNotes.trim().length}
                      </span>
                    </div>
                    {notesTooShort && inputMode === "paste" && (
                      <p className="text-xs text-destructive mt-1">
                        Minimum {MIN_NOTES_LENGTH} characters required
                      </p>
                    )}
                  </div>
                ) : (
                  /* Upload mode */
                  <div>
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
                          <p className="text-xs text-primary">
                            <CheckCircle2 className="h-3 w-3 inline mr-1" />
                            Text extracted — ready to generate
                          </p>
                        )}
                        {uploadedFile.status === "uploaded" && (
                          <p className="text-xs text-muted-foreground">
                            <CheckCircle2 className="h-3 w-3 inline mr-1 text-primary" />
                            Uploaded — text extraction will run server-side
                          </p>
                        )}
                        {uploadedFile.status === "error" && (
                          <p className="text-xs text-destructive">
                            Upload failed. Please try again.
                          </p>
                        )}
                      </div>
                    )}
                    <p className="text-xs text-muted-foreground mt-2">
                      We'll extract text and use it as your source notes.
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Case Context */}
            <Card className="border border-border shadow-none">
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm font-medium text-foreground">Case Context</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4">
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
                        <SelectItem value="housing">Housing</SelectItem>
                        <SelectItem value="child-welfare">Child Welfare</SelectItem>
                        <SelectItem value="benefits">Benefits</SelectItem>
                        <SelectItem value="other">Other</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Permission & Compliance */}
            <Card className="border border-border shadow-none bg-muted/30">
              <CardContent className="px-4 py-3">
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
                      Required to generate notes. Logged for audit.
                    </p>
                    {permissionError && !form.permissionConfirmed && (
                      <p className="text-xs text-destructive">
                        Confirmation required.
                      </p>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>

            {/* Error */}
            {status === "error" && errorMessage && (
              <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                <p className="text-xs text-destructive">{errorMessage}</p>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center justify-between gap-3 pt-2">
              <Button variant="outline" size="sm" onClick={handleClear} disabled={status === "generating"}>
                Clear
              </Button>
              <Button
                size="sm"
                className="gap-1.5"
                disabled={!canGenerate && form.permissionConfirmed}
                onClick={handleGenerate}
              >
                {status === "generating" ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Extracting facts…
                  </>
                ) : status === "success" ? (
                  <>
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Regenerate
                  </>
                ) : (
                  "Generate Case Notes"
                )}
              </Button>
            </div>
          </div>

          {/* ─── Right: Results ─── */}
          <div className="space-y-0">
            <Card className="border border-border shadow-none h-full flex flex-col">
              <CardHeader className="pb-2 pt-4 px-4">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-medium text-foreground">
                      Extracted Facts
                    </CardTitle>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">
                        Last generated:{" "}
                        {result?.generated_at
                          ? new Date(result.generated_at).toLocaleString()
                          : "—"}
                      </span>
                      {result && (
                        <Badge variant="secondary" className="text-xs">Draft</Badge>
                      )}
                    </div>
                    {result && (
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs text-muted-foreground">
                          Model: {result.model}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          Answered: {answeredCount} / {totalCount}
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
                          <TooltipContent>Copy</TooltipContent>
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
                <div className="px-4 pb-2 flex items-center gap-2 flex-wrap">
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

              <CardContent className="px-4 py-0 flex-1 overflow-y-auto">
                {status === "generating" ? (
                  <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">Extracting facts…</p>
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
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 gap-3">
                    <div className="w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center">
                      <FileText className="h-5 w-5 text-muted-foreground/50" />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Generated notes will appear here
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Pipeline hint */}
        <div className="flex items-center justify-center gap-6 pt-2 pb-4">
          <span className="text-xs text-muted-foreground">Before meeting: <strong>Guidance</strong></span>
          <Separator orientation="vertical" className="h-3" />
          <span className="text-xs text-muted-foreground">After meeting: <strong>Case Notes</strong></span>
          <Separator orientation="vertical" className="h-3" />
          <span className="text-xs text-muted-foreground">Before submitting: <strong>Reviewer</strong></span>
        </div>
      </div>
    </DashboardLayout>
  );
}
