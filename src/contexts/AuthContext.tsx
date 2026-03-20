/**
 * AuthContext — Real Supabase Auth + Profile Resolution
 *
 * Handles:
 * - Supabase session lifecycle (onAuthStateChange → getSession)
 * - Profile + role resolution via get_my_profile() RPC
 * - Dev-mode role override (no backend writes)
 * - Loading state gating (nothing renders before profile resolves)
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";

export type AppRole = "caseworker" | "supervisor" | "auditor";
export type ProfileStatus = "active" | "pending" | "disabled";

export interface UserProfile {
  user_id: string;
  display_name: string;
  status: ProfileStatus;
  role: AppRole | null;
}

interface AuthContextType {
  /** Supabase user object (null if not authenticated) */
  user: User | null;
  /** Resolved profile from get_my_profile RPC */
  profile: UserProfile | null;
  /** Effective role (may be overridden in dev mode) */
  role: AppRole | null;
  /** Profile status */
  status: ProfileStatus | null;
  /** True while initial auth/profile check is in progress */
  loading: boolean;
  /** Whether a real Supabase session exists */
  isAuthenticated: boolean;
  /** Sign out and clear state */
  signOut: () => Promise<void>;
  /** Dev-only: override displayed role without touching backend */
  devRoleOverride: AppRole | null;
  setDevRoleOverride: (role: AppRole | null) => void;
  /** Re-fetch profile from backend */
  refreshProfile: () => Promise<void>;
  /**
   * Suppress the next auth state change from triggering a loading/remount cycle.
   * Used by vault reauth to prevent signInWithPassword() from destroying page state.
   * Call before the reauth signIn, and it auto-resets after the next auth event.
   */
  suppressNextAuthReload: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [devRoleOverride, setDevRoleOverride] = useState<AppRole | null>(null);

  /**
   * When true, the next onAuthStateChange event for the SAME user
   * will not set loading=true or re-fetch profile. This prevents
   * signInWithPassword() reauth from causing a full app remount.
   * Auto-resets after consumption.
   */
  const suppressAuthReloadRef = useRef(false);
  const currentUserIdRef = useRef<string | null>(null);

  const suppressNextAuthReload = useCallback(() => {
    suppressAuthReloadRef.current = true;
    if (import.meta.env.DEV) {
      console.info("[AuthContext] Auth reload suppression armed for next auth event");
    }
  }, []);

  const fetchProfile = useCallback(async () => {
    try {
      const { data, error } = await supabase.rpc("get_my_profile");
      if (error) {
        console.error("[AuthContext] get_my_profile error:", error.message);
        setProfile(null);
        return;
      }
      if (data) {
        // RPC returns JSON — parse if string
        const parsed = typeof data === "string" ? JSON.parse(data) : data;
        setProfile({
          user_id: parsed.user_id,
          display_name: parsed.display_name ?? "",
          status: parsed.status ?? "pending",
          role: parsed.role ?? null,
        });
      } else {
        setProfile(null);
      }
    } catch (err) {
      console.error("[AuthContext] Profile fetch failed:", err);
      setProfile(null);
    }
  }, []);

  useEffect(() => {
    // 1. Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (session?.user) {
          /**
           * REAUTH SUPPRESSION: If suppressAuthReloadRef is armed AND the
           * incoming user is the same as the current user, this is a vault
           * reauth — skip the loading cycle to prevent page remount.
           */
          if (suppressAuthReloadRef.current && user?.id === session.user.id) {
            suppressAuthReloadRef.current = false;
            if (import.meta.env.DEV) {
              console.info("[AuthContext] Suppressed auth reload for same-user reauth");
            }
            // Update the user object (token may have refreshed) but do NOT set loading
            setUser(session.user);
            return;
          }
          suppressAuthReloadRef.current = false;

          setUser(session.user);
          // Immediately gate routing while profile resolves
          setLoading(true);
          // Defer profile fetch to avoid Supabase client deadlock
          setTimeout(() => fetchProfile().finally(() => setLoading(false)), 0);
        } else {
          suppressAuthReloadRef.current = false;
          setUser(null);
          setProfile(null);
          setLoading(false);
        }
      }
    );

    // 2. Then check existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUser(session.user);
        fetchProfile().finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    return () => subscription.unsubscribe();
  }, [fetchProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setUser(null);
    setProfile(null);
    setDevRoleOverride(null);
  }, []);

  const effectiveRole = import.meta.env.DEV && devRoleOverride
    ? devRoleOverride
    : profile?.role ?? null;

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        role: effectiveRole,
        status: profile?.status ?? null,
        loading,
        isAuthenticated: user !== null,
        signOut,
        devRoleOverride,
        setDevRoleOverride,
        refreshProfile: fetchProfile,
        suppressNextAuthReload,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}

/** Convenience: get effective role */
export function useRole(): AppRole | null {
  const { role } = useAuth();
  return role;
}
