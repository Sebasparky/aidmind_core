import type { TourConfig } from "./types";

export const caseworkerTour: TourConfig = {
  role: "caseworker",
  steps: [
    {
      anchor: "create-session",
      title: "Start a new session",
      description: "Opens a form to create a session container for your documentation tools.",
      usage: "When you begin preparing for a client interaction or need to generate guidance.",
      placement: "bottom",
    },
    {
      anchor: "guidance-button",
      title: "Generate Guidance",
      description: "Opens the Guidance tool for the selected session to surface policy-based considerations.",
      usage: "Before or during a session when you want contextual readiness support.",
      boundaryNote: "AidMind does not write documentation for you.",
      placement: "bottom",
    },
    {
      anchor: "reviewer-button",
      title: "Run Reviewer",
      description: "Opens the Reviewer tool to check documentation completeness against policy.",
      usage: "After drafting documentation, to identify any gaps or missing elements.",
      placement: "bottom",
    },
    {
      anchor: "close-session",
      title: "Close a session",
      description: "Moves the session to history once you are finished using both tools.",
      usage: "When you have completed your documentation preparation for this interaction.",
      placement: "bottom",
    },
    {
      anchor: "derived-signals",
      title: "Derived Signals",
      description: "Informational indicators derived from policy and session context.",
      usage: "Review these to understand outstanding documentation considerations.",
      boundaryNote: "Signals are informational only and do not replace professional judgment.",
      placement: "bottom",
    },
    {
      anchor: "session-history",
      title: "Session History",
      description: "Read-only list of previously closed sessions with summary information.",
      usage: "To reference past session details. No actions can be taken on closed sessions.",
      placement: "bottom",
    },
  ],
};

export const supervisorTour: TourConfig = {
  role: "supervisor",
  steps: [
    {
      anchor: "sup-tab-daily-assurance",
      title: "Daily Assurance",
      description: "Summary view of system health and activity metrics for the current period.",
      usage: "At the start of your day or shift to confirm system status.",
      placement: "bottom",
      activateTab: "daily-assurance",
    },
    {
      anchor: "sup-tab-sessions",
      title: "Active Sessions",
      description: "Lists all current and recent sessions with status and timing details.",
      usage: "To monitor session activity and identify any that may need attention.",
      placement: "bottom",
      activateTab: "sessions",
    },
    {
      anchor: "sup-tab-system-issues",
      title: "System Issues",
      description: "Lists errors and warnings detected by the system that may require attention.",
      usage: "When notified of new issues, or during routine monitoring.",
      placement: "bottom",
      activateTab: "issues",
    },
    {
      anchor: "sup-filters-button",
      title: "Filter events",
      description: "Opens a sidebar to narrow events by category, severity, or session.",
      usage: "When reviewing a specific type of event or investigating a particular session.",
      placement: "right",
    },
    {
      anchor: "sup-seen-toggle",
      fallbackAnchor: "sup-issues-header",
      title: "Mark as seen",
      description: "Local-only acknowledgment that you have reviewed an issue. This does not persist across sessions or affect system records.",
      usage: "To track your personal review progress during a monitoring session.",
    },
    {
      anchor: "sup-tab-data-deletion",
      title: "Data Deletion Proof",
      description: "Immutable records confirming that ephemeral data was properly purged.",
      usage: "During audits or when verifying data lifecycle compliance.",
      placement: "bottom",
      activateTab: "deletion-proof",
    },
    {
      anchor: "sup-tab-governance",
      title: "Governance",
      description: "AI authorization status, compliance exports, and security overview.",
      usage: "To review governance controls and generate compliance reports.",
      placement: "bottom",
      activateTab: "governance",
    },
  ],
};

export const auditorTour: TourConfig = {
  role: "auditor",
  steps: [
    {
      anchor: "aud-banner",
      title: "Auditor Mode boundary",
      description: "This banner confirms you are in read-only mode with no access to case data.",
      usage: "Always visible as a reminder of your access boundaries.",
      boundaryNote: "No PHI or case content is accessible in this view.",
      placement: "bottom",
    },
    {
      anchor: "aud-card-ai-auth",
      title: "AI Authorization status",
      description: "Shows whether AI-assisted features have been formally authorized.",
      usage: "To verify that AI usage has proper governance approval.",
      placement: "bottom",
    },
    {
      anchor: "aud-card-llm-compliance",
      title: "LLM Compliance status",
      description: "Indicates whether language model interactions meet compliance requirements.",
      usage: "To confirm that AI interactions follow established policies.",
      placement: "bottom",
    },
    {
      anchor: "aud-card-deletion-proof",
      title: "Deletion Proof summary",
      description: "Counts the number of verified data purge events in the audit window.",
      usage: "To confirm that ephemeral data is being properly destroyed.",
      placement: "bottom",
    },
    {
      anchor: "aud-tab-timeline",
      title: "Event Timeline",
      description: "Chronological feed of all system events within the 7-day audit window.",
      usage: "For reviewing the sequence and timing of system activity.",
      placement: "bottom",
    },
    {
      anchor: "aud-tab-deletion-proof",
      title: "Deletion Proof details",
      description: "Detailed view of purge events with verification timestamps.",
      usage: "When you need to inspect individual deletion records for audit evidence.",
      placement: "bottom",
    },
  ],
};

export const tourConfigs: Record<string, TourConfig> = {
  caseworker: caseworkerTour,
  supervisor: supervisorTour,
  auditor: auditorTour,
};
