/**
 * useKbStatus — KB health indicator for the dashboard.
 *
 * Returns the most recent kb_documents.updated_at for the active tenant,
 * plus the document count. Used to show "KB last updated" on the dashboard.
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useTenant } from "./useTenant";

export interface KbStatus {
  lastUpdated: Date | null;
  documentCount: number;
  templateCount: number;
}

interface UseKbStatusReturn {
  kbStatus: KbStatus;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useKbStatus(): UseKbStatusReturn {
  const { tenant } = useTenant();
  const [kbStatus, setKbStatus] = useState<KbStatus>({
    lastUpdated: null,
    documentCount: 0,
    templateCount: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    if (!tenant?.tenantId) {
      setLoading(false);
      return;
    }

    try {
      setError(null);

      // Fetch latest document and count
      const [docsResult, templatesResult] = await Promise.all([
        supabase
          .from("kb_documents")
          .select("updated_at", { count: "exact" })
          .eq("tenant_id", tenant.tenantId)
          .order("updated_at", { ascending: false })
          .limit(1),
        supabase
          .from("kb_templates")
          .select("id", { count: "exact", head: true })
          .eq("tenant_id", tenant.tenantId)
          .eq("is_active", true),
      ]);

      if (docsResult.error) throw docsResult.error;
      if (templatesResult.error) throw templatesResult.error;

      const latestDoc = docsResult.data?.[0];

      setKbStatus({
        lastUpdated: latestDoc ? new Date(latestDoc.updated_at) : null,
        documentCount: docsResult.count ?? 0,
        templateCount: templatesResult.count ?? 0,
      });
    } catch (err) {
      console.error("[useKbStatus] Fetch error:", err);
      setError(err instanceof Error ? err.message : "Failed to load KB status");
    } finally {
      setLoading(false);
    }
  }, [tenant?.tenantId]);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  return { kbStatus, loading, error, refresh: fetchStatus };
}
