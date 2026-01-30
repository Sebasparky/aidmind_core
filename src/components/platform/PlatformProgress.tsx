/**
 * Platform Progress Overview - Internal development status page
 * 
 * Meta-view for stakeholders to understand prototype state.
 * NOT a product surface - temporary and internal-facing only.
 */

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Circle,
  Info,
  XCircle,
} from "lucide-react";

// Status badge component
function StatusBadge({ status }: { status: "implemented" | "partial" | "not-started" }) {
  const config = {
    implemented: { label: "Implemented", className: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400" },
    partial: { label: "Partial", className: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400" },
    "not-started": { label: "Not Started", className: "bg-muted text-muted-foreground" },
  };
  const { label, className } = config[status];
  return <Badge variant="outline" className={className}>{label}</Badge>;
}

// Checklist item component
function ChecklistItem({ checked, label }: { checked: boolean; label: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      {checked ? (
        <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
      ) : (
        <XCircle className="h-5 w-5 text-destructive flex-shrink-0" />
      )}
      <span className="text-sm text-foreground">{label}</span>
    </div>
  );
}

// Platform routes data
const platformRoutes = [
  { surface: "Overview", status: "implemented" as const, description: "Coordination Health cards, throughput stats", dataSource: "Static JSON" },
  { surface: "Cases", status: "implemented" as const, description: "Case list with Timeline/Referrals/Documents tabs", dataSource: "Static JSON" },
  { surface: "Referrals", status: "implemented" as const, description: "Referral list with lifecycle stepper, SLA timer", dataSource: "Static JSON" },
  { surface: "Providers (CBOs)", status: "implemented" as const, description: "CBO directory with responsiveness metrics", dataSource: "Static JSON" },
  { surface: "Documents", status: "implemented" as const, description: "Document tracker with retention labels", dataSource: "Static JSON" },
  { surface: "Events & Audit", status: "implemented" as const, description: "Event explorer with retention model panel", dataSource: "Static JSON" },
];

// Supervisor integration data
const supervisorIntegration = [
  { feature: "Coordination event category", status: "implemented" as const, notes: "Added to EventCategory type" },
  { feature: "Coordination filter pill", status: "implemented" as const, notes: "In filters panel" },
  { feature: "Source badges", status: "implemented" as const, notes: "System / Policy / Legacy / Coordination" },
  { feature: "Event detail drawer", status: "implemented" as const, notes: 'Includes "View in Platform" link' },
  { feature: "Mock coordination events", status: "implemented" as const, notes: "4 event types injected" },
];

// PRD feature coverage
const prdFeatures: Array<{ feature: string; exists: "Yes" | "Partial" | "No"; notes: string }> = [
  { feature: "Unified Case Timeline", exists: "Yes", notes: "Read-only timeline tab in case detail drawer" },
  { feature: "Referral Lifecycle Engine (UI)", exists: "Yes", notes: "Visual lifecycle stepper, state history" },
  { feature: "Lightweight CBO Interaction (UI)", exists: "Partial", notes: "CBO directory exists; no secure link/action flow" },
  { feature: "Eye Event Emission (UI representation)", exists: "Yes", notes: "Coordination events appear in Supervisor feed" },
  { feature: "Audit / Event Explorer", exists: "Yes", notes: "Events & Audit page with filters" },
  { feature: "Policy & Permission indicators (UI only)", exists: "Partial", notes: "Retention labels shown; no permission UI" },
  { feature: "SLA Timers & Breach Detection", exists: "Yes", notes: "SLA status and timer displayed per referral" },
  { feature: "Document Flow Tracking", exists: "Yes", notes: "Document status with due dates shown" },
];

// Mocked vs Real breakdown
const mockedVsReal = [
  { layer: "Data source", state: "Fully mocked (static JSON in mock-data.ts)" },
  { layer: "State management", state: "Client-side only (useState)" },
  { layer: "Filters/search", state: "UI-only logic" },
  { layer: "Event injection", state: "Mock coordination events merged with real DB events" },
  { layer: "Referral SLA logic", state: "Display-only (no real calculation)" },
  { layer: "CBO acknowledgment", state: "UI representation only (no backend action)" },
  { layer: "Document content", state: "Never displayed (metadata only by design)" },
];

// Known gaps
const knownGaps = [
  "Real-time updates / subscriptions",
  "Backend persistence for Platform entities",
  "Authentication / role-based access",
  "Real SLA calculations (backend logic)",
  "Backend event ingestion from external systems",
  "Cross-agency routing logic",
  "Secure CBO participation links",
  "Document upload/download functionality",
  "Supervisor annotation persistence",
];

// Alignment checklist
const alignmentChecks = [
  { checked: true, label: "No new supervisor tabs were created" },
  { checked: true, label: "Coordination signals appear inside existing event feed" },
  { checked: true, label: "Read-only guarantees are preserved" },
  { checked: true, label: "No PHI or case content exposed" },
  { checked: true, label: '"View in Platform" links to case timeline' },
  { checked: true, label: "Source badges distinguish event origins" },
];

export function PlatformProgress() {
  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header */}
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-foreground">
            Platform Development Progress
          </h1>
          <Badge variant="outline" className="bg-muted text-muted-foreground">
            Internal
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">Prototype Overview</p>
      </div>

      {/* Disclaimer Banner */}
      <Alert variant="default" className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
        <AlertTitle className="text-amber-800 dark:text-amber-200">Frontend Prototype Only</AlertTitle>
        <AlertDescription className="text-amber-700 dark:text-amber-300">
          This page summarizes frontend prototype state only. No backend logic is implemented.
          All data is mocked. Do not confuse this with production-ready functionality.
        </AlertDescription>
      </Alert>

      {/* Section: Implemented Surfaces */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Implemented Surfaces</CardTitle>
          <CardDescription>
            Current frontend pages and components that exist in the prototype
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Platform Routes */}
          <div>
            <h4 className="text-sm font-medium text-foreground mb-3">Platform Routes</h4>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-[140px]">Surface</TableHead>
                    <TableHead className="w-[120px]">Status</TableHead>
                    <TableHead>Description</TableHead>
                    <TableHead className="w-[100px]">Data Source</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {platformRoutes.map((route) => (
                    <TableRow key={route.surface}>
                      <TableCell className="font-medium">{route.surface}</TableCell>
                      <TableCell><StatusBadge status={route.status} /></TableCell>
                      <TableCell className="text-muted-foreground">{route.description}</TableCell>
                      <TableCell>
                        <Badge variant="secondary" className="text-xs">{route.dataSource}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>

          <Separator />

          {/* Supervisor Integration */}
          <div>
            <h4 className="text-sm font-medium text-foreground mb-3">Supervisor Integration ("The Eye")</h4>
            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/50">
                    <TableHead className="w-[220px]">Feature</TableHead>
                    <TableHead className="w-[120px]">Status</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {supervisorIntegration.map((item) => (
                    <TableRow key={item.feature}>
                      <TableCell className="font-medium">{item.feature}</TableCell>
                      <TableCell><StatusBadge status={item.status} /></TableCell>
                      <TableCell className="text-muted-foreground">{item.notes}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section: Feature Coverage vs PRD */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Feature Coverage vs PRD</CardTitle>
          <CardDescription>
            Mapping PRD requirements to current UI implementation state
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-[280px]">PRD Feature</TableHead>
                  <TableHead className="w-[100px]">UI Exists?</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {prdFeatures.map((item) => (
                  <TableRow key={item.feature}>
                    <TableCell className="font-medium">{item.feature}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {item.exists === "Yes" && <Check className="h-4 w-4 text-emerald-600" />}
                        {item.exists === "Partial" && <Circle className="h-4 w-4 text-amber-500" />}
                        {item.exists === "No" && <XCircle className="h-4 w-4 text-muted-foreground" />}
                        <span className={
                          item.exists === "Yes" ? "text-emerald-700 dark:text-emerald-400" :
                          item.exists === "Partial" ? "text-amber-700 dark:text-amber-400" :
                          "text-muted-foreground"
                        }>{item.exists}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{item.notes}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Section: Supervisor Alignment Check */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Supervisor ("The Eye") Alignment Check</CardTitle>
          <CardDescription>
            Verification that integration preserves existing UI patterns and constraints
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-muted/30 rounded-lg p-4 divide-y divide-border">
            {alignmentChecks.map((item, index) => (
              <ChecklistItem key={index} checked={item.checked} label={item.label} />
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Section: Mocked vs Real */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Mocked vs Real</CardTitle>
          <CardDescription>
            Clear breakdown of what is simulated in this prototype
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Alert variant="default" className="mb-4 border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950/30">
            <Info className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            <AlertDescription className="text-blue-700 dark:text-blue-300">
              This prototype contains no production integrations. All functionality is simulated for demonstration purposes.
            </AlertDescription>
          </Alert>
          <div className="border rounded-lg overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/50">
                  <TableHead className="w-[180px]">Layer</TableHead>
                  <TableHead>Current State</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {mockedVsReal.map((item) => (
                  <TableRow key={item.layer}>
                    <TableCell className="font-medium">{item.layer}</TableCell>
                    <TableCell className="text-muted-foreground">{item.state}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Section: Known Gaps */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Known Gaps (Frontend Only)</CardTitle>
          <CardDescription>
            Functionality intentionally not built in this prototype
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="bg-muted/30 rounded-lg p-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-4">
              Out of scope for current prototype by design
            </p>
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {knownGaps.map((gap, index) => (
                <li key={index} className="flex items-center gap-2 text-sm text-foreground">
                  <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground flex-shrink-0" />
                  {gap}
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      {/* Footer note */}
      <div className="text-center py-4 text-xs text-muted-foreground">
        This page is temporary and internal. It will be removed before production deployment.
      </div>
    </div>
  );
}
