/**
 * useTenant — Resolve the active tenant for the signed-in user.
 *
 * Queries tenant_users where user_id = auth.uid().
 * If multiple memberships exist, picks the most recent one.
 * Stores active tenant_id in React state only (never persisted).
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface TenantInfo {
  tenantId: string;
  tenantName: string;
  tenantSlug: string | null;
}

interface UseTenantReturn {
  tenant: TenantInfo | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

export function useTenant(): UseTenantReturn {
  const { user } = useAuth();
  const [tenant, setTenant] = useState<TenantInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchTenant = useCallback(async () => {
    if (!user) {
      setTenant(null);
      setLoading(false);
      return;
    }

    try {
      setError(null);

      // Query tenant_users → tenants join for this user
      const { data, error: fetchErr } = await supabase
        .from("tenant_users")
        .select("tenant_id, tenants(id, name, slug)")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (fetchErr) throw fetchErr;

      if (data && data.tenants) {
        const t = data.tenants as unknown as { id: string; name: string; slug: string | null };
        setTenant({
          tenantId: t.id,
          tenantName: t.name,
          tenantSlug: t.slug,
        });
      } else {
        // User has no tenant membership — may be a new user
        setTenant(null);
      }
    } catch (err) {
      console.error("[useTenant] Fetch error:", err);
      setError(err instanceof Error ? err.message : "Failed to resolve tenant");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchTenant();
  }, [fetchTenant]);

  return { tenant, loading, error, refresh: fetchTenant };
}
