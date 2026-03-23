import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft, Shield, Info, Loader2, Copy, Check, RotateCcw,
  AlertTriangle, MessageSquare, Scale, CheckSquare, Eye,
  Upload, FileText, X, RefreshCw, CheckCircle2, FileWarning,
  Search, ChevronDown, ChevronRight, Circle, Lock, Unlock,
  ShieldCheck, Clock, AlertCircle, ExternalLink,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { useEyeLogger } from "@/hooks/useEyeLogger";
import { usePdfTextExtractor, type PageText } from "@/hooks/usePdfTextExtractor";
import { useCaseNotesVault } from "@/hooks/useCaseNotesVault";
import { ReauthModal } from "@/components/security/ReauthModal";
import { recoverFieldsFromDocument } from "@/lib/tools/field-recovery";
import { parseCompletedTemplate } from "@/lib/tools/completed-template-parser";
import { reconcileNotesAndTemplate } from "@/lib/tools/reconciliation-engine";
import { ReconciliationPanel } from "@/components/session/ReconciliationPanel";
import {
  filterToReviewerEligible,
  filterUnansweredToNarrativeOnly,
  filterReconciliationToNarrative,
  isRecoveredFieldReviewerEligible,
  isReconciliationFieldEligible,
  isReviewerLanguageField,
  isReviewerNarrativeCompletionField,
  computeEligibilityDiagnostics,
} from "@/lib/tools/reviewer-eligibility";
import { ReviewerVerificationPanel, type ReviewerDiagnostics, type NotesSourceType } from "@/components/dev/ReviewerVerificationPanel";
import type {
  ReviewerV2Report,
  ReviewIssue,
  ReviewSeverity,
  ReviewIssueType,
  ReviewConfidence,
  NarrativeCoverage,
  FindingTrack,
  Phase2SchemaField,
  RecoveredField,
} from "@/lib/tools/reviewer-v2-types";
import { assignFindingTrack } from "@/lib/tools/reviewer-v2-types";
import {
  scanForLanguageTriggers,
  detectAttributionContext,
  buildTriggerMetadata,
} from "@/lib/tools/language-risk-rubric";
import type {
  TemplateParserArtifact,
  ReconciliationResult,
  CompletedTemplateParse,
  FieldReconciliation,
  ParsedFieldResult,
} from "@/lib/tools/parser-artifact-types";
import type { CaseNotesComparisonPacket } from "@/lib/security/vault-types";

/**
 * SECURITY NOTES — Reviewer Pipeline
 *
 * 1. No sessionStorage/localStorage persistence of extracted text,
 *    reconciliation results, or reviewer output. All state is in-memory only.
 * 2. Case-note comparison data is accessed only through the encrypted vault.
 *    The user must complete a two-step unlock:
 *      Step 1: Verify identity with account password
 *      Step 2: Decrypt vault with vault password
 * 3. Unlocked data auto-relocks after 5 minutes.
 * 4. Parser artifacts are fetched from the DB — these are template-level
 *    reusable assets, not sensitive per-session data.
 * 5. The unlocked packet is the true notes-side source of truth for
 *    reconciliation. Without it, only template-only comparison is available.
 */

// ─── Types ───────────────────────────────────────────────
type ToolState = "idle" | "ready" | "recovering" | "running" | "success" | "error";

/** Describes the quality tier of the current review run */
type ReviewTier = "full" | "template_only" | "basic";

interface SessionInfo {
  caseLabel: string;
  interactionType: string | null;
  sessionUuid: string;
  templateId: string | null;
  phase2SchemaId: string | null;
  tenantId: string | null;
}

interface SelectedFile {
  file: File;
  objectUrl: string;
}

// ─── Constants ───────────────────────────────────────────
const MAX_FILE_SIZE_MB = 20;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

const SEVERITY_CONFIG: Record<ReviewSeverity, { variant: "destructive" | "default" | "secondary"; label: string; dotClass: string }> = {
  high: { variant: "destructive", label: "High", dotClass: "bg-[hsl(var(--status-danger))]" },
  medium: { variant: "default", label: "Medium", dotClass: "bg-[hsl(var(--status-warning))]" },
  low: { variant: "secondary", label: "Low", dotClass: "bg-muted-foreground/40" },
};

/** Human-readable labels for issue types — used as the primary card title */
const ISSUE_TYPE_LABELS: Record<ReviewIssueType, string> = {
  tone: "Judgmental Tone",
  bias: "Bias or Assumption",
  unsupported_conclusion: "Unsupported Conclusion",
  policy_language: "Policy Language Concern",
  completeness: "Missing Narrative Context",
  consistency: "Narrative Discrepancy",
};

const ISSUE_TYPE_META: Record<ReviewIssueType, { label: string; icon: typeof MessageSquare; description: string }> = {
  tone: { label: "Judgmental Tone", icon: MessageSquare, description: "Judgmental, unprofessional, or emotionally charged language" },
  bias: { label: "Bias & Assumptions", icon: Eye, description: "Stigmatizing language, unsupported assumptions, or stereotypes" },
  unsupported_conclusion: { label: "Unsupported Conclusions", icon: AlertCircle, description: "Conclusions presented with more certainty than the evidence supports" },
  policy_language: { label: "Policy Language Concerns", icon: Scale, description: "Prohibited terminology or policy-inconsistent wording" },
  completeness: { label: "Missing Narrative Context", icon: CheckSquare, description: "Major narrative sections that appear blank or insufficient" },
  consistency: { label: "Narrative Discrepancies", icon: Shield, description: "Narrative content that conflicts between notes and form" },
};

/** Primary issue types shown prominently */
const PRIMARY_ISSUE_TYPES: ReviewIssueType[] = ["tone", "bias", "unsupported_conclusion", "policy_language"];
/** Secondary issue types shown in collapsed section */
const SECONDARY_ISSUE_TYPES: ReviewIssueType[] = ["completeness", "consistency"];
/** All issue types for iteration */
const ISSUE_TYPES: ReviewIssueType[] = [...PRIMARY_ISSUE_TYPES, ...SECONDARY_ISSUE_TYPES];

// ─── Helpers ─────────────────────────────────────────────
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
      if (match.index > lastIndex) parts.push(fullText.slice(lastIndex, match.index));
      parts.push(
        <mark key={key++} className="bg-[hsl(var(--status-warning-muted))] text-[hsl(var(--status-warning-muted-foreground))] rounded px-0.5">
          {match[0]}
        </mark>
      );
      lastIndex = re.lastIndex;
      if (match[0].length === 0) re.lastIndex++;
    }
    if (lastIndex < fullText.length) parts.push(fullText.slice(lastIndex));
    return parts.length > 0 ? parts : fullText;
  } catch {
    return fullText;
  }
}

function formatTimeRemaining(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

// ─── Language-first post-processing ──────────────────────

/** Hard-blocked field label patterns — these MUST NOT appear as final findings */
const FINDING_BLOCKED_LABEL_RE = [
  /^time$/i,
  /^date$/i,
  /\b(dob|date\s*of\s*birth|birth\s*date)\b/i,
  /\b(ssn|social\s*security)\b/i,
  /\b(phone|telephone|fax|cell)\b/i,
  /\b(address|street|city|state|zip)\b/i,
  /\b(age|gender|sex|race|ethnicity)\b/i,
  /\b(email|e-mail)\b/i,
  /\b(signature|signed\s*by|date\s*signed)\b/i,
  /\b(case\s*number|case\s*id|file\s*number|record\s*number)\b/i,
  /\b(worker\s*id|employee\s*id)\b/i,
  /\b(application\s*date|received\s*date|entry\s*date)\b/i,
  /\b(relationship\s*to|relation\s*to)\b/i,
  /\bperson\s*\d/i,
  /\bchild\s*\d/i,
  /\b(height|weight)\b/i,
  /\b(medicaid|medicare)\s*(number|#|id)\b/i,
  /\btime\s*(of|for)\b/i,
  /\b(start|end|begin)\s*(time|date)\b/i,
  /\breport\s*(date|time)\b/i,
  /\bincident\s*(date|time)\b/i,
  /\b(am|pm)\s*$/i,
  /\bmarital\s*status\b/i,
];

function isFieldKeyBlocked(fieldKey: string | undefined): boolean {
  if (!fieldKey) return false;
  const label = fieldKey.replace(/_/g, " ");
  return FINDING_BLOCKED_LABEL_RE.some(re => re.test(label) || re.test(fieldKey));
}

/** Check if an issue's explanation/excerpt references a blocked structured field */
function isExplanationAboutBlockedField(explanation: string, excerpt: string): boolean {
  const combined = `${explanation} ${excerpt}`.toLowerCase();
  const structuredFieldTerms = [
    "time narrative section is blank",
    "time field",
    "date of birth",
    "dob field",
    "ssn field",
    "phone number",
    "address field",
    "checkbox",
    "select one",
    "select many",
    "boolean",
    "demographic",
    "relationship matrix",
    "signature field",
  ];
  return structuredFieldTerms.some(term => combined.includes(term));
}

function applyLanguageFirstFiltering(
  issues: ReviewIssue[],
  reconciliation: ReconciliationResult | null,
  schemaFields: Phase2SchemaField[] | null,
): { filtered: ReviewIssue[]; suppressed: number; reclassified: number } {
  let suppressed = 0;
  let reclassified = 0;

  const schemaMap = schemaFields
    ? new Map(schemaFields.map((sf) => [sf.field_key, sf]))
    : null;

  const reconMap = new Map<string, FieldReconciliation>();
  if (reconciliation) {
    for (const f of reconciliation.fields) {
      reconMap.set(f.field_key, f);
    }
  }

  const result = issues.filter((issue) => {
    if (isFieldKeyBlocked(issue.field_key)) {
      suppressed++;
      return false;
    }
    if ((issue.type === "completeness" || issue.type === "consistency") &&
        isExplanationAboutBlockedField(issue.explanation, issue.excerpt || "")) {
      suppressed++;
      return false;
    }
    if (issue.type === "tone" || issue.type === "bias" || issue.type === "policy_language" || issue.type === "unsupported_conclusion") {
      return true;
    }
    if (issue.field_key) {
      const sf = schemaMap?.get(issue.field_key);
      if (sf) {
        if (issue.type === "completeness" && !isReviewerNarrativeCompletionField(sf)) {
          suppressed++;
          return false;
        }
        if (issue.type === "consistency" && !isReviewerLanguageField(sf)) {
          suppressed++;
          return false;
        }
      }
      if (reconciliation?.reliable_for_review) {
        const recon = reconMap.get(issue.field_key);
        if (recon) {
          if (issue.type === "completeness" && recon.resolution === "confirmed_match") { suppressed++; return false; }
          if (issue.type === "completeness" && recon.resolution === "likely_correction") { suppressed++; return false; }
        }
      }
    }
    return true;
  }).map((issue) => {
    if (issue.field_key && issue.type === "completeness" && reconciliation?.reliable_for_review) {
      const recon = reconMap.get(issue.field_key);
      if (recon?.resolution === "possible_discrepancy") {
        reclassified++;
        return { ...issue, type: "consistency" as ReviewIssueType, explanation: `${issue.explanation} (Notes and completed form differ in narrative content)` };
      }
    }
    if (issue.field_key && issue.type === "completeness" && reconciliation?.template_parse_confidence === "low") {
      const recon = reconMap.get(issue.field_key);
      if (recon?.resolution === "unresolved") {
        return { ...issue, severity: "low" as ReviewSeverity, explanation: `${issue.explanation} (Low parse confidence — manual verification recommended)` };
      }
    }
    return issue;
  });

  return { filtered: result, suppressed, reclassified };
}

// ─── Auto-ensure parser artifact ─────────────────────────
function isParserArtifactValid(artifact: TemplateParserArtifact | null): boolean {
  if (!artifact) return false;
  if (!artifact.sections || !Array.isArray(artifact.sections) || artifact.sections.length === 0) return false;
  return true;
}

async function ensureParserArtifact(
  templateId: string,
  tenantId: string,
): Promise<TemplateParserArtifact | null> {
  const { data: existing } = await supabase
    .from("template_parser_artifacts")
    .select("artifact_json")
    .eq("template_id", templateId)
    .eq("is_active", true)
    .maybeSingle();

  if (existing?.artifact_json) {
    const artifact = existing.artifact_json as unknown as TemplateParserArtifact;
    if (isParserArtifactValid(artifact)) {
      if (import.meta.env.DEV) console.log("[Reviewer] Parser artifact valid:", artifact.sections.length, "sections");
      return artifact;
    }
    if (import.meta.env.DEV) console.warn("[Reviewer] Existing parser artifact is invalid (0 sections), will force regeneration");
  }

  try {
    const shouldForce = !!existing?.artifact_json;
    if (import.meta.env.DEV) console.log("[Reviewer] Invoking generate-parser-artifacts", { templateId, tenantId, force: shouldForce });
    const { data, error } = await supabase.functions.invoke("generate-parser-artifacts", {
      body: { template_id: templateId, tenant_id: tenantId, force: shouldForce },
    });
    if (error) throw error;
    if (data?.status === "generated" || data?.status === "exists") {
      const { data: fresh } = await supabase
        .from("template_parser_artifacts")
        .select("artifact_json")
        .eq("template_id", templateId)
        .eq("is_active", true)
        .maybeSingle();
      if (fresh?.artifact_json) {
        const artifact = fresh.artifact_json as unknown as TemplateParserArtifact;
        if (isParserArtifactValid(artifact)) return artifact;
      }
    }
  } catch (err) {
    console.warn("[Reviewer] Failed to auto-generate parser artifact:", err);
  }
  return null;
}

function packetToRecoveredFields(packet: CaseNotesComparisonPacket): RecoveredField[] {
  return packet.answers.map((a) => ({
    field_key: a.field_key,
    label: a.label,
    template_prompt: "",
    answer: a.answer,
    recovery_confidence: a.confidence === "high" ? "high" : a.confidence === "medium" ? "medium" : "low",
    recovery_method: "label_same_line" as const,
    anchor_used: null,
    source_excerpt: a.supporting_excerpt,
    matching_mode: "extract_short_text",
    review_relevance: "review_worthy" as const,
    requires_human_review: false,
    missing: a.answer === null,
  }));
}

// ─── Review Configuration Card ──────────────────────────
function ReviewConfigCard({
  schemaFields,
  parserArtifact,
  artifactStatus,
  vaultState,
  reviewTier,
  toolState,
}: {
  schemaFields: Phase2SchemaField[] | null;
  parserArtifact: TemplateParserArtifact | null;
  artifactStatus: "loading" | "ready" | "missing" | "generating";
  vaultState: string;
  reviewTier: ReviewTier;
  toolState: ToolState;
}) {
  const rows: { label: string; value: string; status: "ready" | "partial" | "unavailable" }[] = [
    {
      label: "Template schema",
      value: schemaFields ? `${schemaFields.length} fields` : "Not available",
      status: schemaFields ? "ready" : "partial",
    },
    {
      label: "Parser artifacts",
      value: artifactStatus === "ready" ? `${parserArtifact?.sections?.length ?? 0} sections` :
             artifactStatus === "generating" ? "Generating…" : "Not available",
      status: artifactStatus === "ready" ? "ready" : artifactStatus === "generating" ? "partial" : "unavailable",
    },
    {
      label: "Notes comparison",
      value: vaultState === "unlocked" ? "Full comparison" :
             vaultState === "sealed" ? "Available (locked)" : "Not available",
      status: vaultState === "unlocked" ? "ready" : vaultState === "sealed" ? "partial" : "unavailable",
    },
  ];

  const tierLabel = reviewTier === "full" ? "Full notes-to-form" : reviewTier === "template_only" ? "Template-only" : "Basic text";

  return (
    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Review Configuration</p>
        {toolState === "success" && (
          <Badge variant="outline" className={cn(
            "text-[10px]",
            reviewTier === "full" ? "text-[hsl(var(--status-success))] border-[hsl(var(--status-success))]/30" :
            reviewTier === "template_only" ? "text-[hsl(var(--status-warning))] border-[hsl(var(--status-warning))]/30" :
            "text-muted-foreground"
          )}>
            {tierLabel}
          </Badge>
        )}
      </div>
      <div className="space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">{row.label}</span>
            <div className="flex items-center gap-1.5">
              <span className={cn(
                "text-xs",
                row.status === "ready" ? "text-foreground" : "text-muted-foreground"
              )}>{row.value}</span>
              <div className={cn(
                "h-1.5 w-1.5 rounded-full shrink-0",
                row.status === "ready" ? "bg-[hsl(var(--status-success))]" :
                row.status === "partial" ? "bg-[hsl(var(--status-warning))]" :
                "bg-muted-foreground/30"
              )} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Vault Section ───────────────────────────────────────
function VaultSection({
  vaultState,
  metadata,
  unlockTimeRemaining,
  onUnlockClick,
  onRelockClick,
  hasDocument,
  toolState,
}: {
  vaultState: string;
  metadata: any;
  unlockTimeRemaining: number | null;
  onUnlockClick: () => void;
  onRelockClick: () => void;
  hasDocument: boolean;
  toolState: ToolState;
}) {
  if (vaultState === "empty") return null;

  return (
    <div className="rounded-xl border border-border bg-card overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-2.5">
        {vaultState === "unlocked" ? (
          <div className="h-7 w-7 rounded-lg bg-[hsl(var(--status-success-muted))] flex items-center justify-center shrink-0">
            <Unlock className="h-3.5 w-3.5 text-[hsl(var(--status-success))]" />
          </div>
        ) : (
          <div className="h-7 w-7 rounded-lg bg-muted flex items-center justify-center shrink-0">
            <Lock className="h-3.5 w-3.5 text-muted-foreground" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium text-foreground">
              {vaultState === "unlocked" ? "Case notes unlocked" : "Encrypted case notes"}
            </p>
            {vaultState === "unlocked" && unlockTimeRemaining != null && (
              <Badge variant="outline" className={cn(
                "text-[10px] gap-1 tabular-nums",
                unlockTimeRemaining < 60_000
                  ? "text-[hsl(var(--status-danger))] border-[hsl(var(--status-danger))]/30"
                  : "text-[hsl(var(--status-warning))] border-[hsl(var(--status-warning))]/30"
              )}>
                <Clock className="h-2.5 w-2.5" />
                {formatTimeRemaining(unlockTimeRemaining)}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {vaultState === "unlocked"
              ? "Full notes-to-form comparison is active. Auto-relocks when idle."
              : hasDocument
                ? "Unlock before running for full notes-to-form comparison."
                : "Upload a document first, then unlock for comparison."}
          </p>
        </div>
      </div>
      <div className="px-4 pb-3 flex items-center gap-2">
        {vaultState === "sealed" && (
          <Button variant="outline" size="sm" className="gap-1.5 text-xs" onClick={onUnlockClick}>
            <Unlock className="h-3 w-3" /> Unlock for comparison
          </Button>
        )}
        {vaultState === "unlocked" && (
          <Button variant="ghost" size="sm" className="gap-1.5 text-xs text-muted-foreground" onClick={onRelockClick}>
            <Lock className="h-3 w-3" /> Relock now
          </Button>
        )}
        <div className="ml-auto flex items-center gap-1">
          <ShieldCheck className="h-3 w-3 text-muted-foreground/40" />
          <span className="text-[10px] text-muted-foreground/40">AES-256 encrypted</span>
        </div>
      </div>
    </div>
  );
}

// ─── Issue Card (Redesigned for results mode) ────────────
function IssueCard({
  issue,
  isActive,
  onHighlight,
  variant = "primary",
}: {
  issue: ReviewIssue;
  isActive: boolean;
  onHighlight: (snippet: string) => void;
  variant?: "primary" | "secondary";
}) {
  const sev = SEVERITY_CONFIG[issue.severity];
  const typeLabel = ISSUE_TYPE_LABELS[issue.type] ?? issue.type;
  const isPrimary = variant === "primary";

  const sectionLabel = issue.field_key
    ? issue.field_key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase())
    : null;

  return (
    <div className={cn(
      "rounded-xl border transition-colors",
      isActive
        ? "border-[hsl(var(--status-warning))]/50 bg-[hsl(var(--status-warning-muted))]/30"
        : isPrimary
          ? "border-border bg-card shadow-sm"
          : "border-border/50 bg-card/50",
    )}>
      <div className={cn("space-y-3", isPrimary ? "p-5" : "p-4")}>
        {/* Row 1: Issue type label — bold, prominent */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={cn("h-2.5 w-2.5 rounded-full shrink-0", sev.dotClass)} />
            <h4 className={cn(
              "font-semibold leading-tight",
              isPrimary ? "text-base text-foreground" : "text-sm text-muted-foreground"
            )}>
              {typeLabel}
            </h4>
          </div>
          <Badge variant={sev.variant} className="text-[10px] shrink-0 px-2.5 py-0.5">{sev.label}</Badge>
        </div>

        {/* Row 2: Plain-English summary */}
        <p className={cn(
          "leading-relaxed",
          isPrimary ? "text-sm text-foreground/85" : "text-xs text-muted-foreground"
        )}>
          {issue.explanation}
        </p>

        {/* Row 3: Metadata — section name, actions */}
        <div className="flex items-center gap-3 flex-wrap">
          {sectionLabel && (
            <span className="text-[11px] text-muted-foreground/60 font-medium bg-muted/50 px-2 py-0.5 rounded">
              {sectionLabel}
            </span>
          )}
          {issue.excerpt && issue.excerpt.length > 0 && (
            <Button
              variant={isActive ? "secondary" : "ghost"}
              size="sm"
              className="h-6 px-2 text-[11px] gap-1 text-muted-foreground"
              onClick={() => onHighlight(isActive ? "" : issue.excerpt)}
            >
              <Search className="h-2.5 w-2.5" />
              {isActive ? "Unhighlight" : "Show in text"}
            </Button>
          )}
        </div>

        {/* Excerpt */}
        {issue.excerpt && (
          <blockquote className={cn(
            "border-l-2 pl-3 py-1.5 italic",
            isPrimary
              ? "text-xs text-muted-foreground border-border"
              : "text-[11px] text-muted-foreground/60 border-border/60"
          )}>
            "{issue.excerpt}"
          </blockquote>
        )}
      </div>
    </div>
  );
}

// ─── Results Mode Component ─────────────────────────────
function ResultsMode({
  output,
  reconciliationResult,
  reviewTier,
  notesSource,
  vault,
  selectedFile,
  fileName,
  pageCount,
  extractedPages,
  extractedFullText,
  activeSnippet,
  artifactStatus,
  copiedCategory,
  schemaFields,
  parserArtifact,
  toolState,
  onHighlight,
  onCopyAll,
  onCopyType,
  onBack,
  onUnlockClick,
  onRelockClick,
  textPanelRef,
}: {
  output: ReviewerV2Report;
  reconciliationResult: ReconciliationResult | null;
  reviewTier: ReviewTier;
  notesSource: "case_notes" | "field_recovery" | null;
  vault: any;
  selectedFile: SelectedFile | null;
  fileName: string | null;
  pageCount: number;
  extractedPages: PageText[];
  extractedFullText: string;
  activeSnippet: string | null;
  artifactStatus: "loading" | "ready" | "missing" | "generating";
  copiedCategory: string | null;
  schemaFields: Phase2SchemaField[] | null;
  parserArtifact: TemplateParserArtifact | null;
  toolState: ToolState;
  onHighlight: (snippet: string) => void;
  onCopyAll: () => void;
  onCopyType: (type: ReviewIssueType) => void;
  onBack: () => void;
  onUnlockClick: () => void;
  onRelockClick: () => void;
  textPanelRef: React.RefObject<HTMLDivElement>;
}) {
  const [activeTab, setActiveTab] = useState("findings");
  const primaryIssues = output.issues.filter(i => assignFindingTrack(i.type) === "primary");
  const secondaryIssues = output.issues.filter(i => assignFindingTrack(i.type) === "secondary");
  const primaryCount = primaryIssues.length;
  const coverage = output.summary.narrative_coverage ?? "sufficient";
  const confidence = output.summary.review_confidence ?? "high";
  const isInsufficient = coverage === "insufficient";
  const isLimited = coverage === "partial" || confidence === "medium" || confidence === "low";

  const hasComparison = !!reconciliationResult;

  // Count for comparison CTA
  const secondaryTotal = secondaryIssues.length + (reconciliationResult?.total_fields ?? 0);

  return (
    <div className="flex-1 overflow-hidden flex flex-col">
      <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
        {/* Tab bar */}
        <div className="border-b border-border bg-card px-6 shrink-0">
          <TabsList className="bg-transparent h-auto p-0 gap-0 rounded-none">
            <TabsTrigger
              value="findings"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3 text-sm"
            >
              Findings
              {primaryCount > 0 && (
                <Badge variant="destructive" className="ml-2 text-[10px] px-1.5 h-4">{primaryCount}</Badge>
              )}
            </TabsTrigger>
            {hasComparison && (
              <TabsTrigger
                value="comparison"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3 text-sm"
              >
                Comparison Details
              </TabsTrigger>
            )}
            <TabsTrigger
              value="source"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3 text-sm"
            >
              Source Document
            </TabsTrigger>
            <TabsTrigger
              value="text"
              className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none px-4 py-3 text-sm"
            >
              Extracted Text
            </TabsTrigger>
          </TabsList>
        </div>

        {/* ═══ FINDINGS TAB ═══ */}
        <TabsContent value="findings" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full">
            <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">

              {/* ── 1. Review Configuration ────────────── */}
              <ReviewConfigCard
                schemaFields={schemaFields}
                parserArtifact={parserArtifact}
                artifactStatus={artifactStatus}
                vaultState={vault.vaultState}
                reviewTier={reviewTier}
                toolState={toolState}
              />

              {/* ── 2. Vault / Case Notes status ───────── */}
              {vault.vaultState !== "empty" && (
                <VaultSection
                  vaultState={vault.vaultState}
                  metadata={vault.vaultMetadata}
                  unlockTimeRemaining={vault.unlockTimeRemaining}
                  onUnlockClick={onUnlockClick}
                  onRelockClick={onRelockClick}
                  hasDocument={!!selectedFile}
                  toolState={toolState}
                />
              )}

              {/* ── 3. Top Verdict ─────────────────────── */}
              <div className={cn(
                "rounded-2xl border p-6",
                primaryCount > 0
                  ? "border-[hsl(var(--status-danger))]/20 bg-[hsl(var(--status-danger-muted))]/30"
                  : isInsufficient
                    ? "border-[hsl(var(--status-warning))]/20 bg-[hsl(var(--status-warning-muted))]/30"
                    : "border-[hsl(var(--status-success))]/20 bg-[hsl(var(--status-success-muted))]/30"
              )}>
                <div className="flex items-start gap-5">
                  <div className={cn(
                    "h-12 w-12 rounded-2xl flex items-center justify-center shrink-0",
                    primaryCount > 0
                      ? "bg-[hsl(var(--status-danger-muted))]"
                      : isInsufficient
                        ? "bg-[hsl(var(--status-warning-muted))]"
                        : "bg-[hsl(var(--status-success-muted))]"
                  )}>
                    {primaryCount > 0 ? (
                      <AlertTriangle className="h-6 w-6 text-[hsl(var(--status-danger))]" />
                    ) : isInsufficient ? (
                      <Info className="h-6 w-6 text-[hsl(var(--status-warning))]" />
                    ) : (
                      <CheckCircle2 className="h-6 w-6 text-[hsl(var(--status-success))]" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0 space-y-3">
                    {/* Headline: primary findings take priority over coverage */}
                    <h2 className="text-xl font-semibold text-foreground leading-tight">
                      {primaryCount > 0
                        ? `${primaryCount} language ${primaryCount === 1 ? "concern" : "concerns"} found`
                        : isInsufficient
                          ? "Limited review coverage"
                          : isLimited
                            ? "No high-confidence language concerns detected"
                            : "No language concerns detected"}
                    </h2>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {primaryCount > 0 && (isInsufficient || isLimited)
                        ? "Review coverage was limited. These findings were detected in the analyzed sections."
                        : primaryCount > 0
                          ? "Review the findings below for tone, bias, or policy-language concerns in the authored narrative."
                          : isInsufficient
                            ? "Limited authored narrative was found in this document. Review coverage is insufficient for a confident assessment."
                            : isLimited
                              ? "No language concerns were detected, but review coverage was limited. Consider providing more narrative text for a thorough review."
                              : "The reviewed narrative text appears professionally written and compliant with language standards."}
                    </p>
                    {/* Metadata badges */}
                    <div className="flex items-center gap-3 flex-wrap">
                      <Badge
                        variant={output.summary.overall_risk === "high" ? "destructive" : output.summary.overall_risk === "medium" ? "default" : "secondary"}
                        className="text-[11px] px-2.5 py-0.5"
                      >
                        {output.summary.overall_risk === "low" ? "Low" : output.summary.overall_risk === "medium" ? "Medium" : "High"} risk
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        Confidence: <span className="font-medium text-foreground/80 capitalize">{confidence}</span>
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Coverage: <span className="font-medium text-foreground/80 capitalize">{coverage}</span>
                      </span>
                    </div>
                    {primaryCount === 0 && hasComparison && secondaryTotal > 0 && (
                      <p className="text-xs text-muted-foreground/70">
                        {secondaryTotal} lower-priority notes-to-template {secondaryTotal === 1 ? "observation" : "observations"} available in Comparison Details.
                      </p>
                    )}
                  </div>
                </div>
              </div>

              {/* ── 4. PRIMARY LANGUAGE FINDINGS ────────── */}
              {primaryCount > 0 && (
                <section className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-foreground">Primary Language Findings</h3>
                      <p className="text-sm text-muted-foreground mt-1">
                        Tone, bias, unsupported conclusions, and policy-language concerns in authored narrative
                      </p>
                    </div>
                    <Button variant="ghost" size="sm" onClick={onCopyAll} className="h-8 px-3 text-xs gap-1.5 shrink-0">
                      {copiedCategory === "__all__" ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy all</>}
                    </Button>
                  </div>

                  {PRIMARY_ISSUE_TYPES.map((type) => {
                    const issues = primaryIssues.filter(i => i.type === type);
                    if (issues.length === 0) return null;
                    const meta = ISSUE_TYPE_META[type];
                    const Icon = meta.icon;
                    return (
                      <Collapsible key={type} defaultOpen>
                        <div className="space-y-3">
                          <div className="flex items-center justify-between">
                            <CollapsibleTrigger className="flex items-center gap-2.5 group">
                              <ChevronDown className="h-4 w-4 text-muted-foreground transition-transform group-data-[state=closed]:rotate-[-90deg]" />
                              <Icon className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm font-semibold text-foreground">{meta.label}</span>
                              <Badge variant="secondary" className="text-[10px] px-2 h-5">{issues.length}</Badge>
                            </CollapsibleTrigger>
                            <Button variant="ghost" size="sm" className="h-7 px-2 text-xs text-muted-foreground gap-1" onClick={() => onCopyType(type)}>
                              {copiedCategory === type ? <><Check className="h-3 w-3" /> Copied</> : <><Copy className="h-3 w-3" /> Copy</>}
                            </Button>
                          </div>
                          <CollapsibleContent>
                            <div className="space-y-3">
                              {issues.map((issue, i) => (
                                <IssueCard
                                  key={i}
                                  issue={issue}
                                  isActive={activeSnippet === issue.excerpt && !!issue.excerpt && issue.excerpt.length > 0}
                                  onHighlight={onHighlight}
                                  variant="primary"
                                />
                              ))}
                            </div>
                          </CollapsibleContent>
                        </div>
                      </Collapsible>
                    );
                  })}
                </section>
              )}

              {/* ── 5. Comparison CTA (replaces inline secondary) ── */}
              {hasComparison && secondaryTotal > 0 && (
                <div
                  className="rounded-xl border border-border bg-card p-5 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => setActiveTab("comparison")}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setActiveTab("comparison"); } }}
                >
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-foreground">More notes-to-template observations</p>
                      <p className="text-xs text-muted-foreground">
                        See notes-to-form comparison details in the Comparison Details tab
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className="text-[10px] px-2 h-5 text-muted-foreground">
                        {secondaryTotal}
                      </Badge>
                      <ExternalLink className="h-3.5 w-3.5 text-muted-foreground/50" />
                    </div>
                  </div>
                </div>
              )}

              {/* ── 6. What to do next ─────────────────── */}
              <section className="rounded-xl border border-border bg-card p-5 space-y-4">
                <h3 className="text-sm font-semibold text-foreground">What to do next</h3>
                <div className="grid gap-2">
                  {primaryCount > 0 && (
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      • Review highlighted language in the source document using the <span className="font-medium text-foreground">Source Document</span> or <span className="font-medium text-foreground">Extracted Text</span> tabs above.
                    </p>
                  )}
                  {hasComparison && (
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      • Check the <span className="font-medium text-foreground">Comparison Details</span> tab for notes-to-form differences.
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    • When finished reviewing, return to the dashboard to continue your workflow.
                  </p>
                </div>
                <div className="flex items-center gap-3 pt-1">
                  <Button variant="default" onClick={onBack} className="gap-2 h-10 text-sm">
                    <CheckCircle2 className="h-4 w-4" /> Done — Back to Dashboard
                  </Button>
                </div>
              </section>

              {/* Disclaimer */}
              <p className="text-[11px] text-muted-foreground/40 italic text-center pb-4">
                AI-generated language audit — focuses on authored narrative text. Does not verify every structured field.
              </p>
            </div>
          </ScrollArea>
        </TabsContent>

        {/* ═══ COMPARISON DETAILS TAB ═══ */}
        {hasComparison && (
          <TabsContent value="comparison" className="flex-1 overflow-hidden mt-0">
            <ScrollArea className="h-full">
              <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-foreground">Comparison Details</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Notes-to-template observations from narrative comparison
                  </p>
                </div>

                {reviewTier === "full" && notesSource === "case_notes" && (
                  <div className="flex items-start gap-2.5 p-4 rounded-xl bg-[hsl(var(--status-success-muted))]/40 border border-[hsl(var(--status-success))]/10">
                    <ShieldCheck className="h-4 w-4 text-[hsl(var(--status-success))] shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs text-foreground font-medium">Secure notes-to-form comparison</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Narrative comparison uses unlocked case notes as the source of truth.
                      </p>
                    </div>
                  </div>
                )}

                {/* Secondary review issues (consistency/completeness) */}
                {secondaryIssues.length > 0 && (
                  <section className="space-y-4">
                    <div>
                      <h4 className="text-sm font-semibold text-foreground">Narrative Observations</h4>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Lower-priority observations about narrative consistency and completeness
                      </p>
                    </div>
                    {SECONDARY_ISSUE_TYPES.map((type) => {
                      const issues = secondaryIssues.filter(i => i.type === type);
                      if (issues.length === 0) return null;
                      const meta = ISSUE_TYPE_META[type];
                      const Icon = meta.icon;
                      return (
                        <Collapsible key={type} defaultOpen={type !== "consistency"}>
                          <div className="space-y-2">
                            <CollapsibleTrigger className="flex items-center gap-2 group w-full">
                              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground/50 transition-transform group-data-[state=closed]:rotate-[-90deg]" />
                              <Icon className="h-3.5 w-3.5 text-muted-foreground/60" />
                              <span className="text-xs font-medium text-muted-foreground">{meta.label}</span>
                              <Badge variant="outline" className="text-[9px] px-1.5 h-4 text-muted-foreground/50 border-border/40 ml-auto">{issues.length}</Badge>
                            </CollapsibleTrigger>
                            <CollapsibleContent>
                              <div className="space-y-2 ml-6">
                                {issues.map((issue, i) => (
                                  <IssueCard
                                    key={i}
                                    issue={issue}
                                    isActive={activeSnippet === issue.excerpt && !!issue.excerpt && issue.excerpt.length > 0}
                                    onHighlight={onHighlight}
                                    variant="secondary"
                                  />
                                ))}
                              </div>
                            </CollapsibleContent>
                          </div>
                        </Collapsible>
                      );
                    })}
                    <Separator />
                  </section>
                )}

                {reconciliationResult && (
                  <ReconciliationPanel
                    result={reconciliationResult}
                    notesSource={notesSource ?? "field_recovery"}
                    artifactStatus={artifactStatus}
                  />
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        )}

        {/* ═══ COMPARISON DETAILS TAB ═══ */}
        {hasComparison && (
          <TabsContent value="comparison" className="flex-1 overflow-hidden mt-0">
            <ScrollArea className="h-full">
              <div className="max-w-3xl mx-auto px-6 py-8 space-y-6">
                <div>
                  <h3 className="text-lg font-semibold text-foreground">Comparison Details</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    Side-by-side notes-to-form observations from reconciliation
                  </p>
                </div>

                {reviewTier === "full" && notesSource === "case_notes" && (
                  <div className="flex items-start gap-2.5 p-4 rounded-xl bg-[hsl(var(--status-success-muted))]/40 border border-[hsl(var(--status-success))]/10">
                    <ShieldCheck className="h-4 w-4 text-[hsl(var(--status-success))] shrink-0 mt-0.5" />
                    <div>
                      <p className="text-xs text-foreground font-medium">Secure notes-to-form comparison</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Narrative comparison uses unlocked case notes as the source of truth.
                      </p>
                    </div>
                  </div>
                )}

                {reconciliationResult && (
                  <ReconciliationPanel
                    result={reconciliationResult}
                    notesSource={notesSource ?? "field_recovery"}
                    artifactStatus={artifactStatus}
                  />
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        )}

        {/* ═══ SOURCE DOCUMENT TAB ═══ */}
        <TabsContent value="source" className="flex-1 overflow-hidden mt-0">
          {selectedFile ? (
            <div className="h-full flex flex-col">
              <div className="px-6 py-3 border-b border-border bg-card flex items-center gap-3 shrink-0">
                <FileText className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm text-foreground font-medium">{fileName}</span>
                {pageCount > 0 && <Badge variant="secondary" className="text-[10px]">{pageCount} pages</Badge>}
              </div>
              <div className="flex-1 overflow-hidden bg-muted/20 p-2">
                <iframe src={selectedFile.objectUrl} title="PDF preview" className="w-full h-full rounded border-0" />
              </div>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-sm text-muted-foreground">Source document is no longer available. Re-upload to view.</p>
            </div>
          )}
        </TabsContent>

        {/* ═══ EXTRACTED TEXT TAB ═══ */}
        <TabsContent value="text" className="flex-1 overflow-hidden mt-0">
          <ScrollArea className="h-full">
            <div className="max-w-3xl mx-auto px-6 py-8">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-lg font-semibold text-foreground">Extracted Text</h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {extractedFullText.length.toLocaleString()} characters extracted from the document
                  </p>
                </div>
                {activeSnippet && (
                  <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => onHighlight("")}>
                    Clear highlight
                  </Button>
                )}
              </div>
              <div ref={textPanelRef} className="space-y-6 text-sm leading-relaxed">
                {extractedPages.map((page) => (
                  <div key={page.pageNumber} className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-[10px]">Page {page.pageNumber}</Badge>
                      <Separator className="flex-1" />
                    </div>
                    <p className="text-foreground whitespace-pre-wrap break-words text-[13px] leading-relaxed">
                      {page.text
                        ? renderHighlightedText(page.text, activeSnippet)
                        : <span className="text-muted-foreground italic">(no text on this page)</span>}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </ScrollArea>
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────
export default function Reviewer() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { logEvent } = useEyeLogger();

  // Session data
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [schemaFields, setSchemaFields] = useState<Phase2SchemaField[] | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  // Vault for encrypted case-note comparison
  const vault = useCaseNotesVault(sessionId);
  const [showReauthModal, setShowReauthModal] = useState(false);

  const [toolState, setToolState] = useState<ToolState>("idle");
  const [selectedFile, setSelectedFile] = useState<SelectedFile | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [output, setOutput] = useState<ReviewerV2Report | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [copiedCategory, setCopiedCategory] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [activeSnippet, setActiveSnippet] = useState<string | null>(null);
  const [recoveryStats, setRecoveryStats] = useState<{ answered: number; missing: number; humanReview: number } | null>(null);
  const [reconciliationResult, setReconciliationResult] = useState<ReconciliationResult | null>(null);
  const [templateParseResult, setTemplateParseResult] = useState<CompletedTemplateParse | null>(null);
  const [parserArtifact, setParserArtifact] = useState<TemplateParserArtifact | null>(null);
  const [artifactStatus, setArtifactStatus] = useState<"loading" | "ready" | "missing" | "generating">("loading");
  const [reviewTier, setReviewTier] = useState<ReviewTier>("basic");
  const [notesSource, setNotesSource] = useState<"case_notes" | "field_recovery" | null>(null);
  const [postProcessStats, setPostProcessStats] = useState<{ before: number; after: number; suppressed: number; reclassified: number }>({ before: 0, after: 0, suppressed: 0, reclassified: 0 });
  const [reconContextSent, setReconContextSent] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const textPanelRef = useRef<HTMLDivElement>(null);

  const {
    pages: livePages,
    fullText: liveFullText,
    pageCount: livePageCount,
    extracting,
    error: extractError,
    extractText,
    clearText,
  } = usePdfTextExtractor();

  const extractedPages = livePages;
  const extractedFullText = liveFullText;
  const pageCount = livePageCount;
  const fileName = selectedFile?.file.name ?? null;
  const fileSize = selectedFile?.file.size ?? null;
  const hasDocument = selectedFile !== null;

  // SECURITY: Purge legacy sessionStorage
  useEffect(() => {
    if (!sessionId) return;
    try { sessionStorage.removeItem(`aidmind:reviewer:${sessionId}`); } catch {}
  }, [sessionId]);

  // ─── Load session info + schema + auto-ensure artifacts ─
  useEffect(() => {
    async function fetchSession() {
      if (!sessionId) { setPageError("No session ID provided"); setPageLoading(false); return; }
      try {
        const { data, error } = await supabase
          .from("sessions")
          .select("id, case_label, interaction_type, template_id, phase2_schema_id, tenant_id")
          .eq("session_id", sessionId)
          .maybeSingle();
        if (error) throw error;
        if (!data) { setPageError("Session not found"); setPageLoading(false); return; }
        setSessionInfo({
          caseLabel: data.case_label || "Untitled session",
          interactionType: data.interaction_type,
          sessionUuid: data.id,
          templateId: data.template_id,
          phase2SchemaId: data.phase2_schema_id,
          tenantId: data.tenant_id,
        });

        if (data.phase2_schema_id) {
          const { data: schema, error: schemaErr } = await supabase
            .from("template_phase2_schemas")
            .select("schema_json")
            .eq("id", data.phase2_schema_id)
            .maybeSingle();
          if (!schemaErr && schema?.schema_json) {
            const parsed = schema.schema_json as any;
            if (parsed?.fields && Array.isArray(parsed.fields)) setSchemaFields(parsed.fields as Phase2SchemaField[]);
          }
        }

        if (data.template_id && data.tenant_id) {
          setArtifactStatus("generating");
          const artifact = await ensureParserArtifact(data.template_id, data.tenant_id);
          if (artifact && isParserArtifactValid(artifact)) {
            setParserArtifact(artifact);
            setArtifactStatus("ready");
          } else {
            setParserArtifact(null);
            setArtifactStatus("missing");
          }
        } else {
          setArtifactStatus("missing");
        }
      } catch { setPageError("Failed to load session"); }
      finally { setPageLoading(false); }
    }
    fetchSession();
  }, [sessionId]);

  useEffect(() => {
    if (!pageLoading && sessionInfo) vault.checkVaultExists();
  }, [pageLoading, sessionInfo]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => { if (selectedFile) URL.revokeObjectURL(selectedFile.objectUrl); };
  }, [selectedFile]);

  useEffect(() => {
    return () => { vault.relock("unmount"); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (vault.vaultState !== "unlocked") return;
    const resetIdle = () => vault.resetIdleTimer();
    window.addEventListener("click", resetIdle);
    window.addEventListener("keydown", resetIdle);
    window.addEventListener("scroll", resetIdle, true);
    return () => {
      window.removeEventListener("click", resetIdle);
      window.removeEventListener("keydown", resetIdle);
      window.removeEventListener("scroll", resetIdle, true);
    };
  }, [vault.vaultState, vault.resetIdleTimer]);

  const canRun = hasDocument && !fileError && !extracting && extractedFullText.length > 0 && toolState !== "running" && toolState !== "recovering";

  // ─── File handling ─────────────────────────────────────
  const validateAndSetFile = useCallback((file: File) => {
    setFileError(null);
    if (file.type !== "application/pdf") { setFileError("Please upload a PDF file."); return; }
    if (file.size > MAX_FILE_SIZE_BYTES) { setFileError(`File exceeds ${MAX_FILE_SIZE_MB}MB limit.`); return; }
    if (selectedFile) URL.revokeObjectURL(selectedFile.objectUrl);
    const objectUrl = URL.createObjectURL(file);
    setSelectedFile({ file, objectUrl });
    setToolState("ready");
    setOutput(null);
    setErrorMessage(null);
    setActiveSnippet(null);
    setRecoveryStats(null);
    setReconciliationResult(null);
    setTemplateParseResult(null);
    setNotesSource(null);
    extractText(file);
  }, [selectedFile, extractText]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) validateAndSetFile(file);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleDrop = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); const file = e.dataTransfer.files?.[0]; if (file) validateAndSetFile(file); };
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
    setReconciliationResult(null);
    setTemplateParseResult(null);
    setNotesSource(null);
    setReviewTier("basic");
  };

  const handleReplace = () => fileInputRef.current?.click();

  // ─── Run Reviewer ─────────────────────────────────────
  const handleRun = useCallback(async () => {
    if (!sessionId || !sessionInfo || !extractedFullText) return;
    const requestId = crypto.randomUUID();
    setOutput(null);
    setErrorMessage(null);
    setActiveSnippet(null);

    setToolState("recovering");
    let structured_answers: RecoveredField[] = [];
    let review_worthy_answers: RecoveredField[] = [];
    let unanswered_fields: any[] = [];
    let human_review_fields: any[] = [];
    let localReconciliation: ReconciliationResult | null = null;
    let localTemplateParse: CompletedTemplateParse | null = null;
    let tier: ReviewTier = "basic";
    let usedNotesSource: "case_notes" | "field_recovery" | null = null;

    const diagnostics: Record<string, any> = {
      has_schema: !!schemaFields, has_parser_artifact: !!parserArtifact,
      artifact_status: artifactStatus, vault_state: vault.vaultState,
      has_unlocked_packet: !!vault.unlockedPacket,
      reconciliation_used: false, fallback_path: false,
    };

    if (schemaFields && schemaFields.length > 0) {
      const eligibility = computeEligibilityDiagnostics(schemaFields);
      diagnostics.eligibility = eligibility;
      if (import.meta.env.DEV) console.log("[Reviewer] Field eligibility:", eligibility);

      try {
        const recovery = recoverFieldsFromDocument(extractedFullText, schemaFields);
        structured_answers = recovery.structured_answers;
        review_worthy_answers = filterToReviewerEligible(recovery.review_worthy_answers);
        unanswered_fields = filterUnansweredToNarrativeOnly(recovery.unanswered_fields, schemaFields);
        human_review_fields = recovery.human_review_fields;

        diagnostics.raw_review_worthy_count = recovery.review_worthy_answers.length;
        diagnostics.filtered_review_worthy_count = review_worthy_answers.length;
        diagnostics.raw_unanswered_count = recovery.unanswered_fields.length;
        diagnostics.filtered_unanswered_count = unanswered_fields.length;

        setRecoveryStats({
          answered: structured_answers.filter((a) => !a.missing && !a.requires_human_review).length,
          missing: unanswered_fields.length,
          humanReview: human_review_fields.length,
        });

        tier = "template_only";

        if (parserArtifact) {
          try {
            localTemplateParse = parseCompletedTemplate(extractedFullText, parserArtifact, schemaFields);
            setTemplateParseResult(localTemplateParse);
            diagnostics.template_parse_confidence = localTemplateParse.overall_confidence;
            diagnostics.fields_parsed = localTemplateParse.fields.length;
            diagnostics.sections_parsed = localTemplateParse.sections_parsed.length;

            let notesForReconciliation: RecoveredField[];
            if (vault.unlockedPacket) {
              notesForReconciliation = packetToRecoveredFields(vault.unlockedPacket);
              usedNotesSource = "case_notes";
              tier = "full";
              diagnostics.notes_source = "vault_packet";
              diagnostics.vault_packet_fields = vault.unlockedPacket.answers.length;
            } else {
              notesForReconciliation = structured_answers;
              usedNotesSource = "field_recovery";
              diagnostics.notes_source = "field_recovery";
            }

            localReconciliation = reconcileNotesAndTemplate(
              notesForReconciliation, localTemplateParse.fields, localTemplateParse.overall_confidence,
            );

            const rawReconFieldCount = localReconciliation.fields.length;
            localReconciliation = {
              ...localReconciliation,
              fields: filterReconciliationToNarrative(localReconciliation.fields),
            };
            diagnostics.raw_reconciliation_fields = rawReconFieldCount;
            diagnostics.narrative_reconciliation_fields = localReconciliation.fields.length;

            localReconciliation.matches = localReconciliation.fields.filter(f => f.resolution === "confirmed_match").length;
            localReconciliation.mismatches = localReconciliation.fields.filter(f => f.status === "mismatch").length;
            localReconciliation.possible_discrepancies = localReconciliation.fields.filter(f => f.resolution === "possible_discrepancy").length;
            localReconciliation.likely_omissions = localReconciliation.fields.filter(f => f.resolution === "likely_omission").length;
            localReconciliation.likely_corrections = localReconciliation.fields.filter(f => f.resolution === "likely_correction").length;
            localReconciliation.unresolved = localReconciliation.fields.filter(f => f.resolution === "unresolved").length;
            localReconciliation.total_fields = localReconciliation.fields.length;

            setReconciliationResult(localReconciliation);
            diagnostics.reconciliation_used = true;
            diagnostics.reconciliation_matches = localReconciliation.matches;
            diagnostics.reconciliation_discrepancies = localReconciliation.possible_discrepancies;
            diagnostics.reconciliation_omissions = localReconciliation.likely_omissions;
            diagnostics.reconciliation_reliable = localReconciliation.reliable_for_review;
          } catch (err) {
            console.warn("[Reviewer] Template parse/reconciliation failed:", err);
            diagnostics.reconciliation_error = err instanceof Error ? err.message : "unknown";
          }
        } else {
          diagnostics.fallback_path = true;
        }
      } catch (err) {
        console.warn("[Reviewer] Field recovery failed, proceeding with text-only:", err);
        diagnostics.recovery_error = err instanceof Error ? err.message : "unknown";
        diagnostics.fallback_path = true;
        tier = "basic";
      }
    }

    setReviewTier(tier);
    setNotesSource(usedNotesSource);
    setToolState("running");
    logEvent({
      eventType: "tool.run.started", sessionId, requestId,
      toolName: "run_reviewer_v2",
      metadata: {
        file_size_bytes: fileSize ?? 0, page_count: pageCount,
        text_length: extractedFullText.length,
        structured_answers_count: structured_answers.length,
        review_worthy_count: review_worthy_answers.length,
        unanswered_count: unanswered_fields.length,
        human_review_count: human_review_fields.length,
        review_tier: tier,
        notes_source: usedNotesSource ?? "none",
        ...diagnostics,
      },
    });

    try {
      const reconciliationContext = localReconciliation && localReconciliation.reliable_for_review ? {
        reconciliation_summary: {
          matches: localReconciliation.matches,
          mismatches: localReconciliation.mismatches,
          likely_corrections: localReconciliation.likely_corrections,
          possible_discrepancies: localReconciliation.possible_discrepancies,
          likely_omissions: localReconciliation.likely_omissions,
          unresolved: localReconciliation.unresolved,
          template_parse_confidence: localReconciliation.template_parse_confidence,
        },
        confirmed_fields: localReconciliation.fields.filter(f => f.resolution === "confirmed_match").map(f => f.field_key),
        likely_corrections: localReconciliation.fields.filter(f => f.resolution === "likely_correction").map(f => ({ field_key: f.field_key, notes: f.notes_value, form: f.template_value })),
        discrepancies: localReconciliation.fields.filter(f => f.resolution === "possible_discrepancy").map(f => ({ field_key: f.field_key, notes: f.notes_value, form: f.template_value, section: f.section })),
        omissions: localReconciliation.fields.filter(f => f.resolution === "likely_omission").map(f => ({ field_key: f.field_key, notes_value: f.notes_value, section: f.section })),
      } : undefined;

      let adjustedUnanswered = unanswered_fields;
      if (localReconciliation?.reliable_for_review) {
        const suppressedKeys = new Set(
          localReconciliation.fields
            .filter(f => f.resolution === "confirmed_match" || f.resolution === "likely_correction")
            .map(f => f.field_key)
        );
        adjustedUnanswered = unanswered_fields.filter(f => !suppressedKeys.has(f.field_key));
      }

      const eligibleStructuredAnswers = structured_answers.filter(isRecoveredFieldReviewerEligible);

      const payload = {
        session_id: sessionInfo.sessionUuid,
        template_id: sessionInfo.templateId || undefined,
        phase2_schema_id: sessionInfo.phase2SchemaId || undefined,
        document_text: extractedFullText,
        structured_answers: eligibleStructuredAnswers,
        review_worthy_answers,
        unanswered_fields: adjustedUnanswered,
        human_review_fields,
        reconciliation_context: reconciliationContext,
        // Trigger pre-scan: metadata only, run on reviewer-eligible narrative text
        language_trigger_metadata: (() => {
          const narrativeText = review_worthy_answers
            .filter(a => !a.missing && a.answer)
            .map(a => a.answer!)
            .join("\n");
          if (narrativeText.length < 20) return undefined;
          const triggers = scanForLanguageTriggers(narrativeText);
          const attribution = detectAttributionContext(narrativeText);
          return buildTriggerMetadata(triggers, attribution);
        })(),
      };
      setReconContextSent(!!reconciliationContext);

      if (import.meta.env.DEV) {
        console.info("[Reviewer][Diag] Payload shape:", {
          has_document_text: !!payload.document_text,
          text_length: payload.document_text.length,
          structured_answers_count: payload.structured_answers.length,
          review_worthy_count: payload.review_worthy_answers.length,
          unanswered_count: payload.unanswered_fields.length,
          has_reconciliation_context: !!reconciliationContext,
          has_trigger_metadata: !!payload.language_trigger_metadata,
        });
      }
      const { data, error } = await supabase.functions.invoke("run-reviewer", { body: payload });
      if (error) throw new Error(error.message || "Edge function invocation failed");
      if (data?.error) {
        const code = data.error.code || "UNKNOWN";
        const msg = data.error.message || "Review failed";
        logEvent({ eventType: "tool.run.failed", sessionId, requestId, toolName: "run_reviewer_v2", result: "failure", metadata: { error_code: code } });
        setErrorMessage(`${msg} (${code})`);
        setToolState("error");
        return;
      }
      if (!data?.review_report) throw new Error("Invalid response from reviewer");
      let report = data.review_report as ReviewerV2Report;

      const issuesBefore = report.issues.length;
      const { filtered: filteredIssues, suppressed: completenessSuppressions, reclassified: discrepancyReclassifications } =
        applyLanguageFirstFiltering(report.issues, localReconciliation, schemaFields);

      const eligibleHighCount = filteredIssues.filter(i => i.severity === "high").length;
      const eligibleMedCount = filteredIssues.filter(i => i.severity === "medium").length;
      const recalcRisk = eligibleHighCount > 0 ? "high" : eligibleMedCount > 0 ? "medium" : "low";

      report = {
        ...report,
        issues: filteredIssues,
        summary: {
          ...report.summary,
          overall_risk: recalcRisk as "low" | "medium" | "high",
          key_findings: report.summary.key_findings.filter(
            (f: string) => !isExplanationAboutBlockedField(f, "")
          ),
        },
        metrics: {
          issue_count: filteredIssues.length,
          high_severity_count: eligibleHighCount,
        },
      };

      setPostProcessStats({ before: issuesBefore, after: filteredIssues.length, suppressed: completenessSuppressions, reclassified: discrepancyReclassifications });

      logEvent({
        eventType: "tool.run.completed", sessionId, requestId, toolName: "run_reviewer_v2",
        result: "success",
        metadata: {
          issue_count: report.metrics.issue_count,
          high_severity_count: report.metrics.high_severity_count,
          overall_risk: report.summary.overall_risk,
          review_tier: tier,
          notes_source: usedNotesSource ?? "none",
          reconciliation_filtered: localReconciliation?.reliable_for_review ?? false,
        },
      });
      setOutput(report);
      setToolState("success");
    } catch (err: any) {
      console.error("[Reviewer] Run failed:", err);
      logEvent({ eventType: "tool.run.failed", sessionId, requestId, toolName: "run_reviewer_v2", result: "failure", metadata: { error_message: err?.message?.slice(0, 100) ?? "unknown" } });
      setErrorMessage(err?.message || "An unexpected error occurred.");
      setToolState("error");
    }
  }, [sessionId, sessionInfo, extractedFullText, fileSize, pageCount, schemaFields, logEvent, parserArtifact, artifactStatus, vault.vaultState, vault.unlockedPacket]);

  const handleClear = () => handleRemoveFile();

  const handleHighlight = useCallback((snippet: string) => {
    setActiveSnippet(snippet);
    setTimeout(() => {
      const mark = textPanelRef.current?.querySelector("mark");
      if (mark) mark.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }, []);

  const handleCopyAll = async () => {
    if (!output) return;
    const text = ISSUE_TYPES.map((type) => {
      const issues = output.issues.filter((i) => i.type === type);
      if (issues.length === 0) return "";
      return `## ${ISSUE_TYPE_META[type].label}\n${issues.map((i) => `- [${i.severity.toUpperCase()}] ${i.explanation}${i.excerpt ? ` — "${i.excerpt}"` : ""}`).join("\n")}`;
    }).filter(Boolean).join("\n\n");
    await navigator.clipboard.writeText(text);
    setCopiedCategory("__all__");
    setTimeout(() => setCopiedCategory(null), 2000);
  };

  const handleCopyType = async (type: ReviewIssueType) => {
    if (!output) return;
    const issues = output.issues.filter((i) => i.type === type);
    const text = issues.map((i) => `[${i.severity.toUpperCase()}] ${i.explanation}${i.excerpt ? ` — "${i.excerpt}"` : ""}`).join("\n");
    await navigator.clipboard.writeText(text);
    setCopiedCategory(type);
    setTimeout(() => setCopiedCategory(null), 2000);
  };

  const handleBack = () => {
    vault.relock("manual");
    navigate("/dashboard");
  };

  const totalIssues = output ? output.metrics.issue_count : 0;

  const issuesByType = useMemo(() => {
    if (!output) return null;
    return ISSUE_TYPES.reduce((acc, type) => {
      acc[type] = output.issues.filter((i) => i.type === type);
      return acc;
    }, {} as Record<ReviewIssueType, ReviewIssue[]>);
  }, [output]);

  const devDiagnostics: ReviewerDiagnostics = useMemo(() => ({
    reviewTier,
    notesSource: (notesSource === "case_notes" ? "vault_case_notes" : notesSource === "field_recovery" ? "field_recovery" : "none") as NotesSourceType,
    toolState,
    hasSchema: !!schemaFields,
    schemaFieldCount: schemaFields?.length ?? 0,
    hasParserArtifact: !!parserArtifact,
    artifactStatus,
    parserSectionCount: parserArtifact?.sections?.length ?? 0,
    vaultState: vault.vaultState,
    hasUnlockedPacket: !!vault.unlockedPacket,
    unlockTimeRemainingMs: vault.unlockTimeRemaining,
    lastRelockReason: vault.lastRelockReason,
    idleTimerActive: vault.idleTimerActive,
    reconciliationRan: !!reconciliationResult,
    reconciliationReliable: reconciliationResult?.reliable_for_review ?? false,
    reconciliationCounts: reconciliationResult ? {
      matches: reconciliationResult.matches,
      corrections: reconciliationResult.likely_corrections,
      discrepancies: reconciliationResult.possible_discrepancies,
      omissions: reconciliationResult.likely_omissions,
      unresolved: reconciliationResult.unresolved,
    } : null,
    reconciliationContextSent: reconContextSent,
    templateParseConfidence: reconciliationResult?.template_parse_confidence ?? null,
    recoveryFieldsTotal: recoveryStats ? (recoveryStats.answered + recoveryStats.missing + recoveryStats.humanReview) : 0,
    recoveryAnswered: recoveryStats?.answered ?? 0,
    recoveryMissing: recoveryStats?.missing ?? 0,
    recoveryHumanReview: recoveryStats?.humanReview ?? 0,
    issuesBeforeFilter: postProcessStats.before,
    issuesAfterFilter: postProcessStats.after,
    completenessSuppressions: postProcessStats.suppressed,
    discrepancyReclassifications: postProcessStats.reclassified,
  }), [reviewTier, notesSource, toolState, schemaFields, parserArtifact, artifactStatus, vault.vaultState, vault.unlockedPacket, vault.unlockTimeRemaining, vault.lastRelockReason, vault.idleTimerActive, reconciliationResult, reconContextSent, recoveryStats, postProcessStats]);

  // ─── Page-level loading/error ──────────────────────────
  if (pageLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Shield className="h-8 w-8 mx-auto text-primary animate-pulse mb-2" />
          <p className="text-muted-foreground">Loading reviewer…</p>
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
    <div className="h-screen bg-[hsl(var(--canvas))] flex flex-col overflow-hidden">
      <ReauthModal
        open={showReauthModal}
        onOpenChange={setShowReauthModal}
        onReauthenticate={vault.reauthenticate}
        onDecrypt={vault.decrypt}
      />

      {/* ─── Header ──────────────────────────────────────── */}
      <header className="border-b border-border bg-card shrink-0">
        <div className="px-6 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={handleBack} className="h-8 w-8">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Separator orientation="vertical" className="h-5" />
            <div>
              <div className="flex items-center gap-2">
                <Shield className="h-4 w-4 text-primary" />
                <h1 className="text-base font-semibold text-foreground">Reviewer</h1>
                {toolState === "success" ? (
                  <Badge variant="outline" className="text-[10px] text-[hsl(var(--status-success))] border-[hsl(var(--status-success))]/30">
                    Complete
                  </Badge>
                ) : (
                  <span className="text-xs text-muted-foreground">Step 3 of 3</span>
                )}
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">
                {sessionInfo.caseLabel}{sessionInfo.interactionType ? ` · ${sessionInfo.interactionType}` : ""}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Lock className="h-3 w-3 text-muted-foreground/40" />
            <span className="text-[10px] text-muted-foreground/50">In-memory only · Nothing stored</span>
          </div>
        </div>
      </header>

      {/* ─── Main content ────────────────────────────────── */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {!hasDocument ? (
          /* ─── Upload state ──────────────────────────────── */
          <div className="flex-1 flex items-center justify-center p-8">
            <div className="w-full max-w-lg space-y-5">
              <div className="text-center mb-2">
                <div className="h-14 w-14 rounded-2xl bg-primary/5 flex items-center justify-center mx-auto mb-4">
                  <Shield className="h-7 w-7 text-primary/40" />
                </div>
                <h2 className="text-xl font-semibold text-foreground">Review authored language</h2>
                <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto leading-relaxed">
                  Upload the completed form to check authored narrative text for tone, bias, policy language, and clarity.
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1.5">
                  Focuses on authored language quality — does not verify every checkbox or structured field.
                </p>
              </div>

              <Card className="border-border shadow-sm">
                <CardContent className="pt-6 pb-6 space-y-4">
                  <input ref={fileInputRef} type="file" accept="application/pdf" onChange={handleFileInputChange} className="sr-only" aria-label="Upload PDF file" />
                  <div
                    role="button" tabIndex={0}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInputRef.current?.click(); } }}
                    onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}
                    className={cn(
                      "border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-all",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                      isDragging ? "border-primary bg-primary/5 scale-[1.01]" : "border-muted-foreground/20 hover:border-primary/40 hover:bg-accent/5"
                    )}
                  >
                    <Upload className="h-8 w-8 mx-auto text-muted-foreground/30 mb-3" />
                    <p className="text-sm font-medium text-foreground mb-1">Drag & drop your PDF here</p>
                    <p className="text-xs text-muted-foreground mb-4">or click to choose a file</p>
                    <Button type="button" variant="outline" size="sm" className="pointer-events-none">Choose file</Button>
                    <p className="text-xs text-muted-foreground/60 mt-4">PDF only · Max {MAX_FILE_SIZE_MB}MB</p>
                  </div>
                  {fileError && (
                    <div className="flex items-center gap-2 text-destructive">
                      <FileWarning className="h-4 w-4 shrink-0" />
                      <p className="text-xs font-medium">{fileError}</p>
                    </div>
                  )}
                </CardContent>
              </Card>

              {vault.vaultState === "sealed" && (
                <VaultSection
                  vaultState={vault.vaultState}
                  metadata={vault.vaultMetadata}
                  unlockTimeRemaining={vault.unlockTimeRemaining}
                  onUnlockClick={() => setShowReauthModal(true)}
                  onRelockClick={() => vault.relock("manual")}
                  hasDocument={false}
                  toolState={toolState}
                />
              )}

              <div className="flex items-center gap-2 px-1">
                <Lock className="h-3.5 w-3.5 text-primary/40 shrink-0" />
                <p className="text-xs text-muted-foreground">
                  Files are extracted locally in your browser. <span className="text-foreground font-medium">Nothing is uploaded or stored.</span>
                </p>
              </div>
            </div>
          </div>
        ) : toolState === "success" && output ? (
          /* ─── Results mode (post-run) ────────────────── */
          <ResultsMode
            output={output}
            reconciliationResult={reconciliationResult}
            reviewTier={reviewTier}
            notesSource={notesSource}
            vault={vault}
            selectedFile={selectedFile}
            fileName={fileName}
            pageCount={pageCount}
            extractedPages={extractedPages}
            extractedFullText={extractedFullText}
            activeSnippet={activeSnippet}
            artifactStatus={artifactStatus}
            copiedCategory={copiedCategory}
            onHighlight={handleHighlight}
            onCopyAll={handleCopyAll}
            onCopyType={handleCopyType}
            onBack={handleBack}
            textPanelRef={textPanelRef}
          />
        ) : (
          /* ─── Pre-run workspace layout ─────────────────── */
          <div className="flex-1 overflow-hidden flex flex-col lg:flex-row">
            {/* ─── Left: Document workspace ──────────────── */}
            <div className="flex-1 min-w-0 flex flex-col lg:flex-row overflow-hidden lg:basis-[45%]">
              {/* PDF Preview */}
              {selectedFile && (
                <div className="lg:w-[340px] xl:w-[400px] shrink-0 border-r border-border flex flex-col overflow-hidden">
                  <div className="px-4 py-3 border-b border-border bg-card flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-2 min-w-0">
                      <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <span className="text-xs text-foreground font-medium truncate">{fileName}</span>
                      {pageCount > 0 && <Badge variant="secondary" className="text-[10px] shrink-0">{pageCount}p</Badge>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button variant="ghost" size="sm" onClick={handleReplace} className="h-7 px-2 text-xs gap-1">
                        <RefreshCw className="h-3 w-3" /> Replace
                      </Button>
                      <Button variant="ghost" size="sm" onClick={handleRemoveFile} className="h-7 px-2 text-xs gap-1 text-destructive hover:text-destructive">
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                  <div className="flex-1 overflow-hidden bg-muted/20 p-1">
                    <iframe src={selectedFile.objectUrl} title="PDF preview" className="w-full h-full rounded border-0" />
                  </div>
                  <input ref={fileInputRef} type="file" accept="application/pdf" onChange={handleFileInputChange} className="sr-only" />
                </div>
              )}

              {/* Extracted text */}
              <div className="flex-1 min-w-0 flex flex-col overflow-hidden">
                <div className="px-5 py-3 border-b border-border bg-card flex items-center justify-between shrink-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-foreground">Extracted Text</span>
                    {extractedPages.length > 0 && (
                      <span className="text-xs text-muted-foreground">
                        {extractedFullText.length.toLocaleString()} characters
                      </span>
                    )}
                  </div>
                  {activeSnippet && (
                    <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => setActiveSnippet(null)}>
                      Clear highlight
                    </Button>
                  )}
                </div>
                <ScrollArea className="flex-1">
                  <div ref={textPanelRef} className="p-5 space-y-6 text-sm leading-relaxed">
                    {extracting && (
                      <div className="flex items-center gap-2 text-muted-foreground py-12 justify-center">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm">Extracting text…</span>
                      </div>
                    )}
                    {extractError && <div className="text-destructive text-sm p-4">{extractError}</div>}
                    {!extracting && extractedPages.length === 0 && !extractError && (
                      <p className="text-sm text-muted-foreground text-center py-12">No text extracted yet.</p>
                    )}
                    {extractedPages.map((page) => (
                      <div key={page.pageNumber} className="space-y-2">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">Page {page.pageNumber}</Badge>
                          <Separator className="flex-1" />
                        </div>
                        <p className="text-foreground whitespace-pre-wrap break-words text-[13px] leading-relaxed">
                          {page.text
                            ? renderHighlightedText(page.text, activeSnippet)
                            : <span className="text-muted-foreground italic">(no text on this page)</span>}
                        </p>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            </div>

            {/* ─── Right: Insights panel ─────────────────── */}
            <div className="lg:basis-[55%] xl:basis-[50%] shrink-0 border-l border-border bg-[hsl(var(--canvas))] flex flex-col overflow-hidden">
              <ScrollArea className="flex-1">
                <div className="p-6 space-y-5 max-w-2xl">

                  {/* Review Configuration */}
                  <ReviewConfigCard
                    schemaFields={schemaFields}
                    parserArtifact={parserArtifact}
                    artifactStatus={artifactStatus}
                    vaultState={vault.vaultState}
                    reviewTier={reviewTier}
                    toolState={toolState}
                  />

                  {/* Vault section */}
                  {vault.vaultState !== "empty" && (
                    <VaultSection
                      vaultState={vault.vaultState}
                      metadata={vault.vaultMetadata}
                      unlockTimeRemaining={vault.unlockTimeRemaining}
                      onUnlockClick={() => setShowReauthModal(true)}
                      onRelockClick={() => vault.relock("manual")}
                      hasDocument={hasDocument}
                      toolState={toolState}
                    />
                  )}

                  {/* Primary CTA */}
                  <div className="space-y-3">
                    <Button
                      onClick={handleRun}
                      disabled={!canRun}
                      className="w-full gap-2 h-12 text-sm"
                      size="lg"
                    >
                      {toolState === "running" || toolState === "recovering" ? (
                        <><Loader2 className="h-4 w-4 animate-spin" /> {toolState === "recovering" ? "Recovering fields…" : "Analyzing narrative…"}</>
                      ) : (
                        <><Shield className="h-4 w-4" /> Run Reviewer</>
                      )}
                    </Button>
                    <p className="text-xs text-muted-foreground text-center">
                      Checks authored narrative text for tone, bias, and policy compliance
                    </p>
                  </div>

                  {toolState === "error" && (
                    <div className="space-y-3">
                      <div className="text-center py-4">
                        <AlertTriangle className="h-8 w-8 mx-auto text-destructive/40 mb-3" />
                        <p className="text-sm text-destructive font-medium mb-1">Review failed</p>
                        <p className="text-xs text-muted-foreground">{errorMessage}</p>
                      </div>
                      <div className="flex gap-2">
                        <Button onClick={handleRun} disabled={!canRun} className="flex-1 gap-1.5">
                          <RefreshCw className="h-3.5 w-3.5" /> Try again
                        </Button>
                        <Button variant="outline" onClick={handleClear} className="gap-1.5">
                          <RotateCcw className="h-3.5 w-3.5" /> Clear
                        </Button>
                      </div>
                    </div>
                  )}

                  {/* Idle / Ready / Loading states */}
                  {(toolState === "idle" || toolState === "ready") && !output && (
                    <div className="text-center py-8">
                      <Shield className="h-10 w-10 mx-auto text-muted-foreground/15 mb-3" />
                      <p className="text-sm text-muted-foreground">
                        {extracting ? "Waiting for extraction…" : canRun ? "Ready to review" : "Upload a document to begin"}
                      </p>
                    </div>
                  )}

                  {toolState === "recovering" && (
                    <div className="text-center py-8">
                      <Loader2 className="h-8 w-8 mx-auto text-primary animate-spin mb-3" />
                      <p className="text-sm text-muted-foreground">Recovering field structure…</p>
                    </div>
                  )}

                  {toolState === "running" && (
                    <div className="text-center py-8">
                      <Loader2 className="h-8 w-8 mx-auto text-primary animate-spin mb-3" />
                      <p className="text-sm text-muted-foreground">Analyzing authored narrative…</p>
                      <p className="text-xs text-muted-foreground/60 mt-1">Checking tone, bias, and policy language</p>
                    </div>
                  )}
                </div>
              </ScrollArea>
            </div>
          </div>
        )}
      </div>
      {import.meta.env.DEV && <ReviewerVerificationPanel diagnostics={devDiagnostics} />}
    </div>
  );
}
