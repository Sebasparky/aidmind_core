/**
 * KbBulkUploadPage — Minimal UI for bulk-uploading PDFs to Knowledge Base.
 */

import { useRef } from "react";
import { useKbBulkUploader } from "@/hooks/useKbBulkUploader";
import { useTenant } from "@/hooks/useTenant";
import { Button } from "@/components/ui/button";

const STATUS_LABELS: Record<string, string> = {
  queued: "⏳ Queued",
  uploading: "⬆️ Uploading…",
  uploaded: "✅ Done",
  failed: "❌ Failed",
};

export default function KbBulkUploadPage() {
  const { tenant, loading: tenantLoading } = useTenant();
  const { tasks, enqueueFiles, cancel, isRunning, stats } = useKbBulkUploader(
    tenant?.tenantId ?? null
  );
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    enqueueFiles(files);
    // Reset input so user can re-select
    if (inputRef.current) inputRef.current.value = "";
  };

  if (tenantLoading) {
    return <div className="p-8 text-muted-foreground">Loading tenant…</div>;
  }

  if (!tenant) {
    return (
      <div className="p-8 text-destructive">
        No tenant found. You must be assigned to a tenant to upload documents.
      </div>
    );
  }

  return (
    <div className="p-8 max-w-3xl mx-auto space-y-6">
      <h1 className="text-xl font-semibold">Bulk Upload KB PDFs</h1>
      <p className="text-sm text-muted-foreground">
        Tenant: {tenant.tenantName} ({tenant.tenantId.slice(0, 8)}…)
      </p>

      <div className="flex items-center gap-3">
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="application/pdf"
          onChange={handleFiles}
          disabled={isRunning}
          className="text-sm"
        />
        {isRunning && (
          <Button variant="destructive" size="sm" onClick={cancel}>
            Cancel
          </Button>
        )}
      </div>

      {tasks.length > 0 && (
        <div className="text-sm text-muted-foreground">
          Total: {stats.total} | Uploaded: {stats.uploaded} | Failed:{" "}
          {stats.failed} | Uploading: {stats.uploading} | Queued: {stats.queued}
        </div>
      )}

      {tasks.length > 0 && (
        <div className="border rounded max-h-[60vh] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted sticky top-0">
              <tr>
                <th className="text-left p-2">File</th>
                <th className="text-left p-2 w-32">Status</th>
                <th className="text-left p-2">Error</th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.localId} className="border-t">
                  <td className="p-2 truncate max-w-xs" title={t.file.name}>
                    {t.file.name}
                  </td>
                  <td className="p-2">{STATUS_LABELS[t.status] ?? t.status}</td>
                  <td className="p-2 text-destructive text-xs truncate max-w-xs" title={t.error}>
                    {t.error ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
