/**
 * useUnreadActivity — Tracks whether the activity bell should show an unread dot.
 *
 * Uses localStorage to persist a per-tenant "last seen activity" timestamp.
 * Compares against the latest eye_event created_at to derive `hasUnread`.
 *
 * Zero-retention safe: only stores a timestamp string in localStorage.
 */

import { useState, useCallback, useEffect } from "react";

const STORAGE_PREFIX = "aidmind:lastSeenActivityAt:";

function getStorageKey(tenantId: string | null): string {
  return `${STORAGE_PREFIX}${tenantId ?? "default"}`;
}

function readLastSeen(tenantId: string | null): Date | null {
  try {
    const raw = localStorage.getItem(getStorageKey(tenantId));
    if (!raw) return null;
    const d = new Date(raw);
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

function writeLastSeen(tenantId: string | null, date: Date): void {
  try {
    localStorage.setItem(getStorageKey(tenantId), date.toISOString());
  } catch {
    // localStorage full or unavailable — silently ignore
  }
}

interface UseUnreadActivityOptions {
  tenantId: string | null;
  latestActivityAt: Date | null;
}

interface UseUnreadActivityReturn {
  hasUnread: boolean;
  markSeen: () => void;
  lastSeenAt: Date | null;
}

export function useUnreadActivity({
  tenantId,
  latestActivityAt,
}: UseUnreadActivityOptions): UseUnreadActivityReturn {
  const [lastSeenAt, setLastSeenAt] = useState<Date | null>(() =>
    readLastSeen(tenantId)
  );

  // Re-read from localStorage when tenant changes
  useEffect(() => {
    setLastSeenAt(readLastSeen(tenantId));
  }, [tenantId]);

  const hasUnread =
    latestActivityAt !== null &&
    (lastSeenAt === null || latestActivityAt.getTime() > lastSeenAt.getTime());

  const markSeen = useCallback(() => {
    const now = new Date();
    writeLastSeen(tenantId, now);
    setLastSeenAt(now);
  }, [tenantId]);

  return { hasUnread, markSeen, lastSeenAt };
}
