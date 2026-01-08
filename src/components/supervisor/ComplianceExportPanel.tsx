/**
 * One-Click Compliance Export Panel
 * 
 * Generates immutable compliance reports for auditors.
 */

import { useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useComplianceExport } from "@/hooks/useComplianceExport";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { FileText, Download, Loader2, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";

type TimeRange = "last7d" | "last30d" | "last90d" | "q1" | "q2" | "q3" | "q4";

function getTimeRange(range: TimeRange): { start: Date; end: Date; label: string } {
  const now = new Date();
  const year = now.getFullYear();
  
  switch (range) {
    case "last7d":
      return {
        start: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000),
        end: now,
        label: "Last 7 Days",
      };
    case "last30d":
      return {
        start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000),
        end: now,
        label: "Last 30 Days",
      };
    case "last90d":
      return {
        start: new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000),
        end: now,
        label: "Last 90 Days",
      };
    case "q1":
      return { start: new Date(year, 0, 1), end: new Date(year, 2, 31), label: `Q1 ${year}` };
    case "q2":
      return { start: new Date(year, 3, 1), end: new Date(year, 5, 30), label: `Q2 ${year}` };
    case "q3":
      return { start: new Date(year, 6, 1), end: new Date(year, 8, 30), label: `Q3 ${year}` };
    case "q4":
      return { start: new Date(year, 9, 1), end: new Date(year, 11, 31), label: `Q4 ${year}` };
    default:
      return { start: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000), end: now, label: "Last 30 Days" };
  }
}

export function ComplianceExportPanel() {
  const { currentUser } = useAuth();
  const { generating, error, lastExport, generateExport, downloadExport } = useComplianceExport();
  const [selectedRange, setSelectedRange] = useState<TimeRange>("last30d");

  const handleGenerate = async () => {
    if (!currentUser) return;
    const { start, end } = getTimeRange(selectedRange);
    await generateExport(
      currentUser.id,
      currentUser.role as "supervisor" | "auditor",
      start,
      end
    );
  };

  const handleDownload = async () => {
    if (!currentUser || !lastExport) return;
    const { start, end } = getTimeRange(selectedRange);
    await downloadExport(
      currentUser.id,
      lastExport.id,
      lastExport.export_hash,
      start,
      end
    );
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <FileText className="h-5 w-5" />
          Compliance Export
        </CardTitle>
        <CardDescription>
          Generate immutable compliance reports for auditors
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <Select value={selectedRange} onValueChange={(v) => setSelectedRange(v as TimeRange)}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select time range" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="last7d">Last 7 Days</SelectItem>
              <SelectItem value="last30d">Last 30 Days</SelectItem>
              <SelectItem value="last90d">Last 90 Days</SelectItem>
              <SelectItem value="q1">Q1 {new Date().getFullYear()}</SelectItem>
              <SelectItem value="q2">Q2 {new Date().getFullYear()}</SelectItem>
              <SelectItem value="q3">Q3 {new Date().getFullYear()}</SelectItem>
              <SelectItem value="q4">Q4 {new Date().getFullYear()}</SelectItem>
            </SelectContent>
          </Select>

          <Button onClick={handleGenerate} disabled={generating} className="gap-2">
            {generating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileText className="h-4 w-4" />
            )}
            Generate Report
          </Button>
        </div>

        {error && (
          <div className="text-sm text-destructive">{error}</div>
        )}

        {lastExport && (
          <div className="p-3 rounded-lg bg-muted/50 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-[hsl(var(--status-success))]">
              <CheckCircle2 className="h-4 w-4" />
              Report Generated
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <p>Generated: {format(new Date(lastExport.generated_at), "PPpp")}</p>
              <p className="font-mono text-[10px] break-all">
                Hash: {lastExport.export_hash.slice(0, 32)}...
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={handleDownload} className="gap-2 mt-2">
              <Download className="h-4 w-4" />
              Download Report
            </Button>
          </div>
        )}

        <p className="text-xs text-muted-foreground">
          Reports contain no PHI. Hash provides immutability proof.
        </p>
      </CardContent>
    </Card>
  );
}
