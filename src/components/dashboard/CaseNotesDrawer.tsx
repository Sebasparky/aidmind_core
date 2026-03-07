import { useState, useCallback } from "react";
import {
  FileText,
  Copy,
  Download,
  Send,
  ShieldCheck,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type GenerationStatus = "idle" | "generating" | "success" | "error";

interface CaseNotesState {
  rawNotes: string;
  clientIdentifier: string;
  meetingDate: string;
  contactType: string;
  programDomain: string;
  format: string;
  tone: string;
  includeActionItems: boolean;
  containsIdentifiers: boolean;
  keepQuotes: boolean;
  permissionConfirmed: boolean;
  status: GenerationStatus;
  generatedText: string;
  lastGeneratedAt: string | null;
  errorMessage: string | null;
}

const INITIAL_STATE: CaseNotesState = {
  rawNotes: "",
  clientIdentifier: "",
  meetingDate: "",
  contactType: "",
  programDomain: "",
  format: "",
  tone: "neutral",
  includeActionItems: true,
  containsIdentifiers: false,
  keepQuotes: false,
  permissionConfirmed: false,
  status: "idle",
  generatedText: "",
  lastGeneratedAt: null,
  errorMessage: null,
};

const MOCK_OUTPUT = `## Case Notes — SOAP Format

**Subjective:**
Client reported ongoing difficulty securing stable housing after recent job loss. States feeling overwhelmed by application processes and expressed concern about upcoming benefit recertification deadline. Client mentioned receiving support from a community organization but needs additional guidance navigating housing assistance programs.

**Objective:**
Client appeared alert and cooperative during the interview. Documentation reviewed includes recent pay stubs (last 3 months), proof of current temporary residence, and benefit recertification notice dated 04/15/2026. Client has applied to two housing programs with no response to date.

**Assessment:**
Client is at moderate risk of housing instability. Current income is below the area median and qualifies for expedited housing assistance under local guidelines. Benefit recertification is due within 14 days and requires immediate attention to avoid lapse in coverage.

**Plan:**
- [ ] Submit expedited housing assistance application by 03/14/2026
- [ ] Schedule follow-up call to confirm recertification documents submitted
- [ ] Refer client to community legal aid for lease review
- [ ] Next appointment: 03/21/2026 at 10:00 AM`;

interface CaseNotesDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  session: {
    id: string;
    sessionId: string;
    caseLabel: string;
  } | null;
}

export function CaseNotesDrawer({
  open,
  onOpenChange,
  session,
}: CaseNotesDrawerProps) {
  const [state, setState] = useState<CaseNotesState>(INITIAL_STATE);

  const updateField = useCallback(
    <K extends keyof CaseNotesState>(key: K, value: CaseNotesState[K]) => {
      setState((prev) => ({ ...prev, [key]: value }));
    },
    []
  );

  const canGenerate =
    state.rawNotes.trim().length >= 20 &&
    state.format !== "" &&
    state.permissionConfirmed &&
    state.status !== "generating";

  const handleGenerate = useCallback(async () => {
    if (!canGenerate) return;

    setState((prev) => ({
      ...prev,
      status: "generating",
      errorMessage: null,
    }));

    try {
      // Simulate API call — replace with real endpoint later
      await new Promise((resolve) => setTimeout(resolve, 2400));

      const now = new Date().toISOString();
      setState((prev) => ({
        ...prev,
        status: "success",
        generatedText: MOCK_OUTPUT,
        lastGeneratedAt: now,
      }));

      toast({
        title: "Case notes generated",
        description: "Review the draft in the preview pane.",
      });
    } catch {
      setState((prev) => ({
        ...prev,
        status: "error",
        errorMessage: "Failed to generate case notes. Please try again.",
      }));

      toast({
        title: "Failed to generate",
        description: "Something went wrong. Try again.",
        variant: "destructive",
      });
    }
  }, [canGenerate]);

  const handleClear = useCallback(() => {
    setState(INITIAL_STATE);
  }, []);

  const handleCopy = useCallback(async () => {
    if (!state.generatedText) return;
    await navigator.clipboard.writeText(state.generatedText);
    toast({ description: "Copied to clipboard" });
  }, [state.generatedText]);

  const handleDownload = useCallback(() => {
    if (!state.generatedText) return;
    const blob = new Blob([state.generatedText], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `case-notes-${session?.caseLabel?.replace(/\s+/g, "-") || "draft"}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [state.generatedText, session]);

  const handleClose = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) {
        setState(INITIAL_STATE);
      }
      onOpenChange(nextOpen);
    },
    [onOpenChange]
  );

  if (!session) return null;

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent
        side="right"
        className="sm:max-w-[780px] w-full p-0 flex flex-col overflow-hidden"
      >
        {/* Header */}
        <SheetHeader className="px-6 pt-6 pb-4 border-b border-border shrink-0">
          <div className="flex items-start justify-between gap-3">
            <div>
              <SheetTitle className="text-base font-semibold text-foreground">
                Generate Case Notes
              </SheetTitle>
              <p className="text-sm text-muted-foreground mt-0.5">
                Phase 2 — Turn raw notes into structured documentation
              </p>
            </div>
            <Badge variant="outline" className="text-xs shrink-0 mt-0.5">
              Session: {session.caseLabel}
            </Badge>
          </div>
        </SheetHeader>

        {/* Body — two-column on desktop, stacked on mobile */}
        <div className="flex-1 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-0 h-full">
            {/* ─── Left: Inputs ─── */}
            <div className="p-5 space-y-4 md:border-r border-border overflow-y-auto">
              {/* Section 1 — Source Notes */}
              <Card className="border border-border shadow-none">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm font-medium text-foreground">
                    Source Notes
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-3">
                  <div>
                    <Textarea
                      placeholder="Bullets, rough notes, transcripts, or observations…"
                      className="min-h-[140px] text-sm resize-y"
                      value={state.rawNotes}
                      onChange={(e) => updateField("rawNotes", e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground mt-1.5">
                      Paste unstructured notes. We'll format them into case
                      documentation.
                    </p>
                  </div>

                  <div className="space-y-2">
                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                      <Checkbox
                        checked={state.containsIdentifiers}
                        onCheckedChange={(v) =>
                          updateField("containsIdentifiers", !!v)
                        }
                      />
                      Notes include sensitive identifiers (names/addresses)
                    </label>
                    <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                      <Checkbox
                        checked={state.keepQuotes}
                        onCheckedChange={(v) =>
                          updateField("keepQuotes", !!v)
                        }
                      />
                      Keep quotes verbatim where possible
                    </label>
                  </div>
                </CardContent>
              </Card>

              {/* Section 2 — Case Context */}
              <Card className="border border-border shadow-none">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm font-medium text-foreground">
                    Case Context
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        Client Name / ID
                      </Label>
                      <Input
                        placeholder="Optional"
                        className="text-sm h-9"
                        value={state.clientIdentifier}
                        onChange={(e) =>
                          updateField("clientIdentifier", e.target.value)
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        Meeting Date
                      </Label>
                      <Input
                        type="date"
                        className="text-sm h-9"
                        value={state.meetingDate}
                        onChange={(e) =>
                          updateField("meetingDate", e.target.value)
                        }
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        Contact Type
                      </Label>
                      <Select
                        value={state.contactType}
                        onValueChange={(v) => updateField("contactType", v)}
                      >
                        <SelectTrigger className="h-9 text-sm">
                          <SelectValue placeholder="Select…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="in-person">In-person</SelectItem>
                          <SelectItem value="phone">Phone</SelectItem>
                          <SelectItem value="video">Video</SelectItem>
                          <SelectItem value="home-visit">Home visit</SelectItem>
                          <SelectItem value="court">Court</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        Program / Domain
                      </Label>
                      <Select
                        value={state.programDomain}
                        onValueChange={(v) => updateField("programDomain", v)}
                      >
                        <SelectTrigger className="h-9 text-sm">
                          <SelectValue placeholder="Select…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="snap">SNAP</SelectItem>
                          <SelectItem value="medicaid">Medicaid</SelectItem>
                          <SelectItem value="housing">Housing</SelectItem>
                          <SelectItem value="child-welfare">
                            Child Welfare
                          </SelectItem>
                          <SelectItem value="disability">Disability</SelectItem>
                          <SelectItem value="general">General</SelectItem>
                          <SelectItem value="other">Other</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Section 3 — Output */}
              <Card className="border border-border shadow-none">
                <CardHeader className="pb-2 pt-4 px-4">
                  <CardTitle className="text-sm font-medium text-foreground">
                    Output
                  </CardTitle>
                </CardHeader>
                <CardContent className="px-4 pb-4 space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        Format <span className="text-destructive">*</span>
                      </Label>
                      <Select
                        value={state.format}
                        onValueChange={(v) => updateField("format", v)}
                      >
                        <SelectTrigger className="h-9 text-sm">
                          <SelectValue placeholder="Select format…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="soap">SOAP</SelectItem>
                          <SelectItem value="dap">DAP</SelectItem>
                          <SelectItem value="narrative">Narrative</SelectItem>
                          <SelectItem value="bullet-summary">
                            Bullet Summary
                          </SelectItem>
                          <SelectItem value="agency-standard" disabled>
                            Agency Standard (coming soon)
                          </SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">
                        Tone
                      </Label>
                      <Select
                        value={state.tone}
                        onValueChange={(v) => updateField("tone", v)}
                      >
                        <SelectTrigger className="h-9 text-sm">
                          <SelectValue placeholder="Neutral" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="neutral">
                            Neutral / Professional
                          </SelectItem>
                          <SelectItem value="detailed">More detailed</SelectItem>
                          <SelectItem value="concise">More concise</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
                    <Checkbox
                      checked={state.includeActionItems}
                      onCheckedChange={(v) =>
                        updateField("includeActionItems", !!v)
                      }
                    />
                    Include action items / next steps
                  </label>
                </CardContent>
              </Card>

              {/* Section 4 — Compliance */}
              <Card className="border border-border shadow-none bg-muted/30">
                <CardContent className="px-4 py-3">
                  <div className="flex items-start gap-2.5">
                    <ShieldCheck className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground">
                        Generated notes will be saved to this session.
                      </p>
                      <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer">
                        <Checkbox
                          checked={state.permissionConfirmed}
                          onCheckedChange={(v) =>
                            updateField("permissionConfirmed", !!v)
                          }
                        />
                        I confirm I have permission to process these notes.
                      </label>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Error detail */}
              {state.status === "error" && state.errorMessage && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-destructive/5 border border-destructive/20">
                  <AlertCircle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                  <p className="text-xs text-destructive">{state.errorMessage}</p>
                </div>
              )}
            </div>

            {/* ─── Right: Preview ─── */}
            <div className="p-5 flex flex-col overflow-y-auto bg-muted/20">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <h3 className="text-sm font-medium text-foreground">
                    Preview
                  </h3>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs text-muted-foreground">
                      Last generated:{" "}
                      {state.lastGeneratedAt
                        ? new Date(state.lastGeneratedAt).toLocaleTimeString()
                        : "—"}
                    </span>
                    {state.status === "success" && (
                      <Badge variant="secondary" className="text-xs">
                        Draft
                      </Badge>
                    )}
                  </div>
                </div>

                {state.generatedText && (
                  <div className="flex items-center gap-1">
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={handleCopy}
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Copy</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={handleDownload}
                          >
                            <Download className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Download .txt</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            disabled
                          >
                            <Send className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          Send to Reviewer — coming soon
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                )}
              </div>

              <div className="flex-1 rounded-lg border border-border bg-background p-4 overflow-y-auto">
                {state.status === "generating" ? (
                  <div className="flex flex-col items-center justify-center h-full gap-3 py-12">
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">
                      Generating case notes…
                    </p>
                  </div>
                ) : state.generatedText ? (
                  <pre className="whitespace-pre-wrap text-sm text-foreground font-sans leading-relaxed">
                    {state.generatedText}
                  </pre>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-3 py-12">
                    <div className="w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center">
                      <FileText className="h-5 w-5 text-muted-foreground/50" />
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Generated notes will appear here
                    </p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-border shrink-0 flex items-center justify-between gap-3">
          <Button
            variant="outline"
            size="sm"
            onClick={handleClear}
            disabled={state.status === "generating"}
          >
            Clear
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            disabled={!canGenerate}
            onClick={handleGenerate}
          >
            {state.status === "generating" ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Generating…
              </>
            ) : state.status === "success" ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5" />
                Regenerate
              </>
            ) : (
              "Generate Case Notes"
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
