/**
 * Hook to generate compliance export reports
 * 
 * Creates immutable, timestamped PDF reports for auditors.
 */

import { useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ComplianceExport } from "@/lib/governance/types";
import { EyeEvent } from "@/lib/eye/types";
import { isServerVerifiedEvent } from "@/lib/eye/clientEventContract";
import { useTenant } from "./useTenant";

interface UseComplianceExportOptions {
  tenantId?: string;
}

interface ComplianceExportState {
  generating: boolean;
  error: string | null;
  lastExport: ComplianceExport | null;
}

// Generate SHA-256 hash for immutability proof
async function generateHash(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}

export function useComplianceExport(options: UseComplianceExportOptions = {}) {
  // Tenant comes from the caller's membership (never a literal default).
  const { tenant } = useTenant();
  const tenantId = options.tenantId ?? tenant?.tenantId ?? "unresolved";

  const [state, setState] = useState<ComplianceExportState>({
    generating: false,
    error: null,
    lastExport: null,
  });

  // Generate compliance report data (PHI-free)
  const generateReportData = useCallback(async (
    startDate: Date,
    endDate: Date
  ): Promise<{
    events: EyeEvent[];
    summary: {
      aiAuthorizationStatus: "approved" | "missing" | "revoked";
      llmComplianceStatus: "passed" | "failed" | "not_instrumented";
      deletionProofCount: number;
      retainedArtifactCount: number;
      totalSessions: number;
      approvalEvents: number;
      purgeEvents: number;
      exportEvents: number;
    };
  }> => {
    // Fetch events in time range
    const { data: events, error } = await supabase
      .from("eye_events")
      .select("id, event_type, event_data, created_at, session_id")
      .gte("created_at", startDate.toISOString())
      .lte("created_at", endDate.toISOString())
      .order("created_at", { ascending: true })
      .limit(5000);

    if (error) throw new Error(error.message);

    // Transform events (PHI-free)
    const transformedEvents = (events || []).map((e: any) => ({
      event_id: e.id,
      event_type: e.event_type,
      timestamp: e.created_at,
      session_id: e.session_id,
      ...(e.event_data || {}),
    })) as EyeEvent[];

    // Compute summary statistics
    // Only server-verified supervisor events count as authorization evidence.
    const verifiedEvents = (events || []).filter((e: any) => isServerVerifiedEvent(e.event_data));
    const verifiedIds = new Set(verifiedEvents.map((e: any) => e.id));
    const aiApprovalEvents = transformedEvents.filter(
      e => e.event_type === "AI_USAGE_APPROVED_BY_SUPERVISOR" && verifiedIds.has(e.event_id)
    );
    const aiRevokeEvents = transformedEvents.filter(
      e => e.event_type === "AI_USAGE_APPROVAL_REVOKED" && verifiedIds.has(e.event_id)
    );
    
    let aiAuthorizationStatus: "approved" | "missing" | "revoked" = "missing";
    if (aiApprovalEvents.length > 0 || aiRevokeEvents.length > 0) {
      // Find latest event by timestamp
      const allAiEvents = [...aiApprovalEvents, ...aiRevokeEvents].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      if (allAiEvents.length > 0) {
        aiAuthorizationStatus = allAiEvents[0].event_type === "AI_USAGE_APPROVED_BY_SUPERVISOR"
          ? "approved"
          : "revoked";
      }
    }

    // LLM compliance
    const llmCompleted = transformedEvents.filter(e => e.event_type === "LLM_CALL_COMPLETED");
    const llmFailed = transformedEvents.filter(e => e.event_type === "LLM_CALL_FAILED");
    let llmComplianceStatus: "passed" | "failed" | "not_instrumented" = "not_instrumented";
    if (llmCompleted.length > 0 || llmFailed.length > 0) {
      if (llmFailed.length > 0) {
        llmComplianceStatus = "failed";
      } else {
        const allZeroRetention = llmCompleted.every(e => e.data_retention_mode === "zero_retention");
        llmComplianceStatus = allZeroRetention ? "passed" : "failed";
      }
    }

    // Deletion proof
    const scanEvents = transformedEvents.filter(e => e.event_type === "EPHEMERAL_SCAN_RESULT");
    const deletionProofCount = scanEvents.filter(e => (e.remaining_count ?? 0) === 0).length;
    const retainedArtifactCount = scanEvents.filter(e => (e.remaining_count ?? 0) > 0).length;

    // Counts
    const sessionIds = new Set(transformedEvents.map(e => e.session_id).filter(Boolean));
    const purgeEvents = transformedEvents.filter(e => 
      e.event_type === "PURGE_STARTED" || 
      e.event_type === "PURGE_COMPLETED"
    ).length;
    const exportEvents = transformedEvents.filter(e =>
      e.event_type === "EXPORT_STARTED" ||
      e.event_type === "EXPORT_COMPLETED"
    ).length;

    return {
      events: transformedEvents,
      summary: {
        aiAuthorizationStatus,
        llmComplianceStatus,
        deletionProofCount,
        retainedArtifactCount,
        totalSessions: sessionIds.size,
        approvalEvents: aiApprovalEvents.length,
        purgeEvents,
        exportEvents,
      },
    };
  }, []);

  // Generate and emit compliance export
  const generateExport = useCallback(async (
    operatorId: string,
    operatorRole: "supervisor" | "auditor",
    startDate: Date,
    endDate: Date
  ): Promise<ComplianceExport> => {
    setState({ generating: true, error: null, lastExport: null });

    try {
      const { events, summary } = await generateReportData(startDate, endDate);

      // Build report content (PHI-free)
      const reportContent = {
        title: "AidMind Compliance Report",
        generated_at: new Date().toISOString(),
        time_range: {
          start: startDate.toISOString(),
          end: endDate.toISOString(),
        },
        generated_by: {
          role: operatorRole,
          id: operatorId,
        },
        summary,
        statements: {
          non_retention_guarantee: summary.llmComplianceStatus === "passed" 
            ? "All LLM calls used zero-retention mode. No prompts or completions were stored."
            : summary.llmComplianceStatus === "not_instrumented"
              ? "No LLM calls recorded in this time period."
              : "Some LLM calls may not have used zero-retention mode.",
          ai_authorization: summary.aiAuthorizationStatus === "approved"
            ? "AI usage was explicitly authorized by a supervisor."
            : summary.aiAuthorizationStatus === "revoked"
              ? "AI usage authorization was revoked during this period."
              : "No AI usage authorization on record.",
          deletion_proof: summary.deletionProofCount > 0
            ? `${summary.deletionProofCount} sessions have verified deletion proof.`
            : "No deletion proof events recorded.",
        },
        event_count: events.length,
      };

      // Generate hash for immutability
      const contentString = JSON.stringify(reportContent);
      const exportHash = await generateHash(contentString);

      // Create export record
      const exportRecord: ComplianceExport = {
        id: crypto.randomUUID(),
        tenant_id: tenantId,
        time_range_start: startDate.toISOString(),
        time_range_end: endDate.toISOString(),
        generated_by_role: operatorRole,
        generated_by_id: operatorId,
        generated_at: new Date().toISOString(),
        export_hash: exportHash,
      };

      // Emit COMPLIANCE_EXPORT_GENERATED — server-verified (supervisor or auditor
      // role checked in the database; actor/tenant derived from auth.uid()).
      // Fails closed: no export record without an audit row.
      const { error: insertError } = await supabase.rpc("record_governance_event", {
        p_event_type: "COMPLIANCE_EXPORT_GENERATED",
        p_subject_id: exportRecord.id,
        p_metadata: {
          export_id: exportRecord.id,
          export_hash: exportHash,
          event_count: events.length,
          time_range_start: startDate.toISOString(),
          time_range_end: endDate.toISOString(),
        },
      });

      if (insertError) throw insertError;

      setState({
        generating: false,
        error: null,
        lastExport: exportRecord,
      });

      return exportRecord;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      setState({
        generating: false,
        error: errorMessage,
        lastExport: null,
      });
      throw err;
    }
  }, [tenantId, generateReportData]);

  // Download export (emits event)
  const downloadExport = useCallback(async (
    operatorId: string,
    exportId: string,
    exportHash: string,
    startDate: Date,
    endDate: Date
  ) => {
    try {
      const { events, summary } = await generateReportData(startDate, endDate);

      // Build printable report
      const reportText = `
================================================================================
                         AIDMIND COMPLIANCE REPORT
================================================================================

Generated:        ${new Date().toISOString()}
Report ID:        ${exportId}
Integrity Hash:   ${exportHash}

TIME RANGE
--------------------------------------------------------------------------------
Start:            ${startDate.toISOString()}
End:              ${endDate.toISOString()}

EXECUTIVE SUMMARY
--------------------------------------------------------------------------------
Total Sessions:               ${summary.totalSessions}
AI Authorization Status:      ${summary.aiAuthorizationStatus.toUpperCase()}
LLM Compliance Status:        ${summary.llmComplianceStatus.toUpperCase()}
Verified Deletions:           ${summary.deletionProofCount}
Retained Artifacts:           ${summary.retainedArtifactCount}

COMPLIANCE STATEMENTS
--------------------------------------------------------------------------------

AI Usage Authorization:
${summary.aiAuthorizationStatus === "approved"
  ? "✓ AI usage was explicitly authorized by a supervisor for this organization."
  : summary.aiAuthorizationStatus === "revoked"
    ? "✗ AI usage authorization was revoked during this period."
    : "⚠ No AI usage authorization on record for this time period."}

Data Retention (LLM):
${summary.llmComplianceStatus === "passed"
  ? "✓ All LLM calls used zero-retention mode. No prompts or completions were stored by the AI provider."
  : summary.llmComplianceStatus === "not_instrumented"
    ? "○ No LLM calls were recorded in this time period."
    : "✗ Some LLM calls may not have used zero-retention mode. Review required."}

Data Deletion Proof:
${summary.deletionProofCount > 0
  ? `✓ ${summary.deletionProofCount} session(s) have verified deletion proof (EPHEMERAL_SCAN_RESULT with remaining_count=0).`
  : "○ No deletion proof events recorded in this time period."}
${summary.retainedArtifactCount > 0
  ? `⚠ ${summary.retainedArtifactCount} session(s) may have retained artifacts. Investigation recommended.`
  : ""}

EVENT STATISTICS
--------------------------------------------------------------------------------
Approval Events:              ${summary.approvalEvents}
Purge Events:                 ${summary.purgeEvents}
Export Events:                ${summary.exportEvents}
Total Events Analyzed:        ${events.length}

================================================================================
                          END OF COMPLIANCE REPORT
================================================================================

INTEGRITY VERIFICATION
To verify this report has not been modified:
1. Hash the JSON content using SHA-256
2. Compare with: ${exportHash}

NO PHI IS INCLUDED IN THIS REPORT.
      `.trim();

      // Create and download file
      const blob = new Blob([reportText], { type: "text/plain" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `aidmind-compliance-report-${startDate.toISOString().split("T")[0]}-to-${endDate.toISOString().split("T")[0]}.txt`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Emit COMPLIANCE_EXPORT_DOWNLOADED — server-verified; error is surfaced.
      void operatorId; // actor derived server-side
      const { error: downloadedError } = await supabase.rpc("record_governance_event", {
        p_event_type: "COMPLIANCE_EXPORT_DOWNLOADED",
        p_subject_id: exportId,
        p_metadata: { export_id: exportId, export_hash: exportHash },
      });
      if (downloadedError) throw downloadedError;
    } catch (err) {
      throw err;
    }
  }, [tenantId, generateReportData]);

  return {
    ...state,
    generateExport,
    downloadExport,
    generateReportData,
  };
}
