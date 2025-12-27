import { useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";

interface SessionData {
  case_id: string;
  case_label?: string;
  client_label?: string;
  interaction_type?: string;
}

interface Session {
  id: string;
  session_id: string;
  case_id: string;
  case_label: string | null;
  client_label: string | null;
  interaction_type: string | null;
  state: string;
  ttl_expires_at: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
  cancelled_at: string | null;
}

interface Artifact {
  artifact_type: string;
  content: string;
}

export function useSessionApi() {
  // Create a new session
  const createSession = useCallback(async (data: SessionData): Promise<Session | null> => {
    try {
      const { data: response, error } = await supabase.functions.invoke("session-manager", {
        body: {
          action: "create",
          data,
        },
      });

      if (error) {
        console.error("Failed to create session:", error);
        return null;
      }

      if (!response.success) {
        console.error("Session creation failed:", response.error);
        return null;
      }

      return response.session;
    } catch (error) {
      console.error("Error creating session:", error);
      return null;
    }
  }, []);

  // Get session with artifacts
  const getSession = useCallback(
    async (sessionId: string): Promise<{ session: Session | null; artifacts: Artifact[] }> => {
      try {
        const { data: response, error } = await supabase.functions.invoke("session-manager", {
          body: {
            action: "get",
            session_id: sessionId,
          },
        });

        if (error) {
          console.error("Failed to get session:", error);
          return { session: null, artifacts: [] };
        }

        return {
          session: response.session,
          artifacts: response.artifacts || [],
        };
      } catch (error) {
        console.error("Error getting session:", error);
        return { session: null, artifacts: [] };
      }
    },
    []
  );

  // Update session state
  const updateSessionState = useCallback(async (sessionId: string, state: string): Promise<boolean> => {
    try {
      const { data: response, error } = await supabase.functions.invoke("session-manager", {
        body: {
          action: "update",
          session_id: sessionId,
          data: { state },
        },
      });

      if (error) {
        console.error("Failed to update session:", error);
        return false;
      }

      return response.success;
    } catch (error) {
      console.error("Error updating session:", error);
      return false;
    }
  }, []);

  // Close session (purges ephemeral data)
  const closeSession = useCallback(async (sessionId: string): Promise<boolean> => {
    try {
      const { data: response, error } = await supabase.functions.invoke("session-manager", {
        body: {
          action: "close",
          session_id: sessionId,
        },
      });

      if (error) {
        console.error("Failed to close session:", error);
        return false;
      }

      return response.success;
    } catch (error) {
      console.error("Error closing session:", error);
      return false;
    }
  }, []);

  // Cancel session (purges ephemeral data)
  const cancelSession = useCallback(async (sessionId: string): Promise<boolean> => {
    try {
      const { data: response, error } = await supabase.functions.invoke("session-manager", {
        body: {
          action: "cancel",
          session_id: sessionId,
        },
      });

      if (error) {
        console.error("Failed to cancel session:", error);
        return false;
      }

      return response.success;
    } catch (error) {
      console.error("Error cancelling session:", error);
      return false;
    }
  }, []);

  // Purge session data only (without changing state)
  const purgeSessionData = useCallback(async (sessionId: string): Promise<boolean> => {
    try {
      const { data: response, error } = await supabase.functions.invoke("session-manager", {
        body: {
          action: "purge",
          session_id: sessionId,
        },
      });

      if (error) {
        console.error("Failed to purge session:", error);
        return false;
      }

      return response.success;
    } catch (error) {
      console.error("Error purging session:", error);
      return false;
    }
  }, []);

  return {
    createSession,
    getSession,
    updateSessionState,
    closeSession,
    cancelSession,
    purgeSessionData,
  };
}
