/**
 * ReviewerVerificationPanel — Dev-only diagnostic overlay for the Reviewer pipeline.
 *
 * SECURITY: This panel displays ONLY counts, statuses, and flags.
 * No raw text, excerpts, answers, or decrypted content is ever shown.
 *
 * Gated by import.meta.env.DEV — completely excluded from production builds.
 */

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { ChevronDown, Bug, ShieldCheck, Clock, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useState } from "react";
import type { ReconciliationResult } from "@/lib/tools/parser-artifact-types";
import type { VaultState } from "@/lib/security/vault-types";

// ── Types ────────────────────────────────────────────────
export type ReviewTier = "full" | "template_only" | "basic";
export type NotesSourceType = "vault_case_notes" | "field_recovery" | "none";
export type RelockReason = "idle_timeout" | "hard_timeout" | "manual" | "unmount" | null;

export interface ReviewerDiagnostics {
  // Pipeline state
  reviewTier: ReviewTier;
  notesSource: NotesSourceType;
  toolState: string;

  // Data availability
  hasSchema: boolean;
  schemaFieldCount: number;
  hasParserArtifact: boolean;
  artifactStatus: string;
  parserSectionCount: number;

  // Vault state
  vaultState: VaultState;
  hasUnlockedPacket: boolean;
  unlockTimeRemainingMs: number | null;
  lastRelockReason: RelockReason;
  idleTimerActive: boolean;

  // Reconciliation
  reconciliationRan: boolean;
  reconciliationReliable: boolean;
  reconciliationCounts: {
    matches: number;
    corrections: number;
    discrepancies: number;
    omissions: number;
    unresolved: number;
  } | null;
  reconciliationContextSent: boolean;
  templateParseConfidence: string | null;

  // Recovery
  recoveryFieldsTotal: number;
  recoveryAnswered: number;
  recoveryMissing: number;
  recoveryHumanReview: number;

  // Post-processing
  issuesBeforeFilter: number;
  issuesAfterFilter: number;
  completenessSuppressions: number;
  discrepancyReclassifications: number;
}

// ── Verification Checklist ──────────────────────────────
const VERIFICATION_CHECKLIST = [
  { id: "locked_run", label: "Run reviewer with vault locked → expect template-only tier", category: "Vault" },
  { id: "unlocked_run", label: "Unlock vault → run reviewer → expect full tier + 'vault_case_notes' source", category: "Vault" },
  { id: "wrong_account_pw", label: "Enter wrong account password → expect 'Incorrect account password'", category: "Vault" },
  { id: "wrong_vault_pw", label: "Enter correct account pw, wrong vault pw → expect 'Incorrect vault password'", category: "Vault" },
  { id: "idle_relock", label: "Unlock vault → wait 2min with no activity → expect auto-relock", category: "Timeout" },
  { id: "hard_timeout", label: "Unlock vault → stay active for 5min → expect hard relock", category: "Timeout" },
  { id: "manual_relock", label: "Click 'Relock now' → expect immediate relock", category: "Timeout" },
  { id: "nav_relock", label: "Unlock vault → navigate away → return → vault should be sealed", category: "Timeout" },
  { id: "no_vault_fallback", label: "Session with no sealed notes → expect template-only or basic tier", category: "Fallback" },
  { id: "no_schema_basic", label: "Session with no schema → expect basic tier", category: "Fallback" },
  { id: "reconciliation_payload", label: "Full run → check reconciliation_context_sent = true", category: "Payload" },
  { id: "discrepancy_handling", label: "Discrepancy field → verify reclassified to 'consistency' issue", category: "Post-Processing" },
  { id: "omission_handling", label: "Omission field → verify completeness issue retained", category: "Post-Processing" },
  { id: "no_persistence", label: "Run reviewer → close tab → reopen → no stale data restored", category: "Security" },
  { id: "no_sensitive_logs", label: "Open console → run reviewer → no raw text/excerpts in logs", category: "Security" },
];

// ── Component ───────────────────────────────────────────
interface ReviewerVerificationPanelProps {
  diagnostics: ReviewerDiagnostics;
}

export function ReviewerVerificationPanel({ diagnostics }: ReviewerVerificationPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showChecklist, setShowChecklist] = useState(false);

  // Don't render in production
  if (!import.meta.env.DEV) return null;

  const d = diagnostics;

  const tierColor = d.reviewTier === "full"
    ? "text-[hsl(var(--status-success))]"
    : d.reviewTier === "template_only"
      ? "text-[hsl(var(--status-warning))]"
      : "text-muted-foreground";

  const sourceColor = d.notesSource === "vault_case_notes"
    ? "text-[hsl(var(--status-success))]"
    : d.notesSource === "field_recovery"
      ? "text-[hsl(var(--status-warning))]"
      : "text-muted-foreground";

  return (
    <div className="fixed bottom-4 right-4 z-50 max-w-sm">
      <Collapsible open={isOpen} onOpenChange={setIsOpen}>
        <CollapsibleTrigger asChild>
          <button
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-mono",
              "bg-card border border-border shadow-lg hover:bg-muted/50 transition-colors",
              d.reviewTier === "full" && d.notesSource === "vault_case_notes"
                ? "border-[hsl(var(--status-success))]/30"
                : "border-border",
            )}
          >
            <Bug className="h-3 w-3 text-muted-foreground" />
            <span className={tierColor}>{d.reviewTier}</span>
            <span className="text-muted-foreground/50">|</span>
            <span className={sourceColor}>{d.notesSource}</span>
            <span className="text-muted-foreground/50">|</span>
            <VaultBadge state={d.vaultState} />
            <ChevronDown className={cn("h-3 w-3 text-muted-foreground transition-transform", isOpen && "rotate-180")} />
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent>
          <Card className="mt-1 shadow-xl border-border">
            <CardHeader className="py-2 px-3">
              <CardTitle className="text-[11px] font-mono flex items-center gap-1.5">
                <Bug className="h-3 w-3" /> Reviewer Pipeline Diagnostics
              </CardTitle>
            </CardHeader>
            <CardContent className="px-3 pb-3 space-y-2.5 text-[10px] font-mono">
              {/* Pipeline */}
              <Section title="Pipeline">
                <Row label="tier" value={d.reviewTier} className={tierColor} />
                <Row label="notes_source" value={d.notesSource} className={sourceColor} />
                <Row label="tool_state" value={d.toolState} />
              </Section>

              {/* Data */}
              <Section title="Data">
                <Row label="schema" value={d.hasSchema ? `✓ ${d.schemaFieldCount} fields` : "✗ none"} />
                <Row label="parser_artifact" value={d.hasParserArtifact ? `✓ ${d.parserSectionCount} sections` : `✗ ${d.artifactStatus}`} />
              </Section>

              {/* Vault */}
              <Section title="Vault">
                <Row label="state" value={d.vaultState} />
                <Row label="has_packet" value={d.hasUnlockedPacket ? "✓ yes" : "✗ no"} />
                <Row label="time_remaining" value={d.unlockTimeRemainingMs !== null ? `${Math.ceil(d.unlockTimeRemainingMs / 1000)}s` : "n/a"} />
                <Row label="idle_timer" value={d.idleTimerActive ? "active" : "inactive"} />
                <Row label="last_relock" value={d.lastRelockReason ?? "none"} />
              </Section>

              {/* Reconciliation */}
              <Section title="Reconciliation">
                <Row label="ran" value={d.reconciliationRan ? "✓ yes" : "✗ no"} />
                <Row label="reliable" value={d.reconciliationReliable ? "✓ yes" : "✗ no"} />
                <Row label="context_sent" value={d.reconciliationContextSent ? "✓ yes" : "✗ no"} />
                <Row label="parse_confidence" value={d.templateParseConfidence ?? "n/a"} />
                {d.reconciliationCounts && (
                  <>
                    <Row label="matches" value={String(d.reconciliationCounts.matches)} />
                    <Row label="corrections" value={String(d.reconciliationCounts.corrections)} />
                    <Row label="discrepancies" value={String(d.reconciliationCounts.discrepancies)} />
                    <Row label="omissions" value={String(d.reconciliationCounts.omissions)} />
                    <Row label="unresolved" value={String(d.reconciliationCounts.unresolved)} />
                  </>
                )}
              </Section>

              {/* Recovery */}
              <Section title="Recovery">
                <Row label="total" value={String(d.recoveryFieldsTotal)} />
                <Row label="answered" value={String(d.recoveryAnswered)} />
                <Row label="missing" value={String(d.recoveryMissing)} />
                <Row label="human_review" value={String(d.recoveryHumanReview)} />
              </Section>

              {/* Post-processing */}
              <Section title="Post-Processing">
                <Row label="issues_before" value={String(d.issuesBeforeFilter)} />
                <Row label="issues_after" value={String(d.issuesAfterFilter)} />
                <Row label="completeness_suppressed" value={String(d.completenessSuppressions)} />
                <Row label="discrepancy_reclassified" value={String(d.discrepancyReclassifications)} />
              </Section>

              {/* Checklist toggle */}
              <button
                onClick={() => setShowChecklist(!showChecklist)}
                className="text-[10px] text-primary underline"
              >
                {showChecklist ? "Hide" : "Show"} verification checklist
              </button>

              {showChecklist && (
                <div className="space-y-1.5 border-t border-border pt-2">
                  {VERIFICATION_CHECKLIST.map((item) => (
                    <div key={item.id} className="flex items-start gap-1.5">
                      <input type="checkbox" className="mt-0.5 h-3 w-3 rounded border-border" />
                      <div>
                        <span className="text-[9px] text-muted-foreground/60">[{item.category}]</span>{" "}
                        <span className="text-[10px] text-foreground">{item.label}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

// ── Sub-components ──────────────────────────────────────
function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-wider text-muted-foreground/60 mb-0.5">{title}</p>
      <div className="space-y-0.5 pl-1 border-l border-border/50">{children}</div>
    </div>
  );
}

function Row({ label, value, className }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted-foreground">{label}:</span>
      <span className={cn("text-foreground", className)}>{value}</span>
    </div>
  );
}

function VaultBadge({ state }: { state: VaultState }) {
  const colors: Record<VaultState, string> = {
    empty: "text-muted-foreground",
    sealed: "text-[hsl(var(--status-warning))]",
    unlocking: "text-[hsl(var(--status-info))]",
    unlocked: "text-[hsl(var(--status-success))]",
    relock_pending: "text-[hsl(var(--status-danger))]",
    error: "text-destructive",
  };
  return <span className={colors[state]}>{state}</span>;
}
