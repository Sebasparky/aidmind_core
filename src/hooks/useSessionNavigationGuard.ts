import { useEffect, useCallback, useRef } from "react";
import { useNavigate, useBlocker } from "react-router-dom";

interface UseSessionNavigationGuardProps {
  /** Whether the session is in a "dirty" state that should block navigation */
  isDirtySession: boolean;
  /** Callback when user confirms cancel from the dialog */
  onCancel: () => Promise<void> | void;
  /** Optional callback for "Save for later" action */
  onSave?: () => void;
  /** Whether save functionality is available */
  saveEnabled?: boolean;
}

interface UseSessionNavigationGuardReturn {
  /** Whether the leave dialog should be shown */
  showLeaveDialog: boolean;
  /** Call this when user chooses to stay */
  handleStay: () => void;
  /** Call this when user confirms cancel and leave */
  handleCancelAndLeave: () => Promise<void>;
  /** Call this when user saves for later */
  handleSaveForLater: () => void;
  /** Whether save is enabled */
  isSaveEnabled: boolean;
  /** Pending navigation path (for after cancel/save completes) */
  pendingPath: string | null;
}

/**
 * Hook to guard against accidental navigation away from an active session.
 * 
 * Features:
 * - Blocks internal React Router navigation with a confirmation
 * - Shows browser beforeunload warning for refresh/tab close
 * - Handles browser back button
 * 
 * Stable across React StrictMode double renders.
 */
export function useSessionNavigationGuard({
  isDirtySession,
  onCancel,
  onSave,
  saveEnabled = false,
}: UseSessionNavigationGuardProps): UseSessionNavigationGuardReturn {
  const navigate = useNavigate();
  const pendingPathRef = useRef<string | null>(null);
  const isCancellingRef = useRef(false);

  // Use React Router's blocker for internal navigation
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isDirtySession && 
      !isCancellingRef.current &&
      currentLocation.pathname !== nextLocation.pathname
  );

  // Handle browser refresh/tab close
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirtySession && !isCancellingRef.current) {
        e.preventDefault();
        // Modern browsers ignore custom messages, but we set it anyway
        e.returnValue = "You have an active session. Changes may be lost.";
        return e.returnValue;
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirtySession]);

  // Store pending path when blocked
  useEffect(() => {
    if (blocker.state === "blocked" && blocker.location) {
      pendingPathRef.current = blocker.location.pathname;
    }
  }, [blocker.state, blocker.location]);

  const handleStay = useCallback(() => {
    if (blocker.state === "blocked") {
      blocker.reset();
    }
    pendingPathRef.current = null;
  }, [blocker]);

  const handleCancelAndLeave = useCallback(async () => {
    isCancellingRef.current = true;
    const targetPath = pendingPathRef.current || "/dashboard";
    
    try {
      // Call the cancel handler
      await onCancel();
      
      // Proceed with navigation
      if (blocker.state === "blocked") {
        blocker.proceed();
      } else {
        navigate(targetPath);
      }
    } finally {
      isCancellingRef.current = false;
      pendingPathRef.current = null;
    }
  }, [onCancel, blocker, navigate]);

  const handleSaveForLater = useCallback(() => {
    if (onSave) {
      onSave();
      // Navigation will happen after save completes (handled by the session machine)
    }
  }, [onSave]);

  return {
    showLeaveDialog: blocker.state === "blocked",
    handleStay,
    handleCancelAndLeave,
    handleSaveForLater,
    isSaveEnabled: saveEnabled && !!onSave,
    pendingPath: pendingPathRef.current,
  };
}
