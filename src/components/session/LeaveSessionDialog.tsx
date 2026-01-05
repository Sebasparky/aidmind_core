import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { AlertTriangle, Save } from "lucide-react";

interface LeaveSessionDialogProps {
  open: boolean;
  onStay: () => void;
  onCancel: () => void;
  onSave?: () => void;
  saveEnabled?: boolean;
  isLoading?: boolean;
}

/**
 * A calm, supervisory-grade dialog for when users try to leave an active session.
 * 
 * Offers three choices:
 * - Return to session (primary)
 * - Cancel session (destructive) 
 * - Save for later (secondary, if enabled)
 */
export function LeaveSessionDialog({
  open,
  onStay,
  onCancel,
  onSave,
  saveEnabled = false,
  isLoading = false,
}: LeaveSessionDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={(isOpen) => !isOpen && onStay()}>
      <AlertDialogContent className="max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-3 mb-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <AlertDialogTitle className="text-lg">
              Active session in progress
            </AlertDialogTitle>
          </div>
          <AlertDialogDescription className="text-muted-foreground">
            You have an active session. Please cancel or save for later before leaving.
            <span className="block mt-2 text-xs text-muted-foreground/70">
              This prevents partial sessions from being recorded as active.
            </span>
          </AlertDialogDescription>
        </AlertDialogHeader>

        <AlertDialogFooter className="flex-col gap-2 sm:flex-row sm:gap-2">
          {/* Save for Later - secondary action */}
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <div className="w-full sm:w-auto">
                  <Button
                    variant="outline"
                    onClick={onSave}
                    disabled={!saveEnabled || isLoading}
                    className="w-full gap-2"
                  >
                    <Save className="h-4 w-4" />
                    Save for later
                  </Button>
                </div>
              </TooltipTrigger>
              {!saveEnabled && (
                <TooltipContent>
                  <p>Save is only available after draft is ready</p>
                </TooltipContent>
              )}
            </Tooltip>
          </TooltipProvider>

          {/* Cancel session - destructive */}
          <Button
            variant="destructive"
            onClick={onCancel}
            disabled={isLoading}
            className="w-full sm:w-auto"
          >
            {isLoading ? "Cancelling..." : "Cancel session"}
          </Button>

          {/* Return to session - primary */}
          <Button
            onClick={onStay}
            disabled={isLoading}
            className="w-full sm:w-auto"
          >
            Return to session
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
