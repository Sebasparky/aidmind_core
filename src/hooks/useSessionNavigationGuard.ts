import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useLocation } from "react-router-dom";

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
  /** Navigate with guard - use this instead of navigate() for internal links */
  guardedNavigate: (path: string) => void;
}

/**
 * Hook to guard against accidental navigation away from an active session.
 * 
 * Features:
 * - Blocks internal navigation via guardedNavigate with a confirmation
 * - Shows browser beforeunload warning for refresh/tab close
 * - Handles browser back button via popstate
 * 
 * Note: This implementation works with BrowserRouter (non-data router).
 * For internal navigation blocking, use guardedNavigate() instead of navigate().
 */
export function useSessionNavigationGuard({
  isDirtySession,
  onCancel,
  onSave,
  saveEnabled = false,
}: UseSessionNavigationGuardProps): UseSessionNavigationGuardReturn {
  const navigate = useNavigate();
  const location = useLocation();
  const [showLeaveDialog, setShowLeaveDialog] = useState(false);
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const isCancellingRef = useRef(false);
  const isHandlingPopstateRef = useRef(false);

  // Handle browser refresh/tab close
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isDirtySession && !isCancellingRef.current) {
        e.preventDefault();
        e.returnValue = "You have an active session. Changes may be lost.";
        return e.returnValue;
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirtySession]);

  // Handle browser back/forward buttons
  useEffect(() => {
    const handlePopstate = () => {
      if (isDirtySession && !isCancellingRef.current && !isHandlingPopstateRef.current) {
        isHandlingPopstateRef.current = true;
        // Push the current location back to prevent navigation
        window.history.pushState(null, "", location.pathname + location.search);
        // Show dialog and store that user tried to go back
        setPendingPath("/dashboard"); // Default to dashboard for back button
        setShowLeaveDialog(true);
        isHandlingPopstateRef.current = false;
      }
    };

    // Push initial state so we can intercept back button
    if (isDirtySession) {
      window.history.pushState(null, "", location.pathname + location.search);
    }

    window.addEventListener("popstate", handlePopstate);
    return () => window.removeEventListener("popstate", handlePopstate);
  }, [isDirtySession, location.pathname, location.search]);

  // Guarded navigate function - use this for internal links
  const guardedNavigate = useCallback((path: string) => {
    if (isDirtySession && !isCancellingRef.current) {
      setPendingPath(path);
      setShowLeaveDialog(true);
    } else {
      navigate(path);
    }
  }, [isDirtySession, navigate]);

  const handleStay = useCallback(() => {
    setShowLeaveDialog(false);
    setPendingPath(null);
  }, []);

  const handleCancelAndLeave = useCallback(async () => {
    isCancellingRef.current = true;
    const targetPath = pendingPath || "/dashboard";
    
    try {
      await onCancel();
      setShowLeaveDialog(false);
      setPendingPath(null);
      navigate(targetPath);
    } finally {
      isCancellingRef.current = false;
    }
  }, [onCancel, pendingPath, navigate]);

  const handleSaveForLater = useCallback(() => {
    if (onSave) {
      onSave();
    }
  }, [onSave]);

  return {
    showLeaveDialog,
    handleStay,
    handleCancelAndLeave,
    handleSaveForLater,
    isSaveEnabled: saveEnabled && !!onSave,
    pendingPath,
    guardedNavigate,
  };
}
