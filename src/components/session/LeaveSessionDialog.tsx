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
import { AlertTriangle, Loader2, Save } from "lucide-react";

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
    <AlertDialog 
      open={open} 
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onStay();
      }}
    >
      <AlertDialogContent 
        className="w-[calc(100vw-2rem)] max-w-[520px] sm:max-w-lg max-h-[85vh] overflow-y-auto overflow-x-hidden rounded-2xl"
        onEscapeKeyDown={(e) => {
          e.preventDefault();
          onStay();
        }}
      >
        <AlertDialogHeader className="space-y-2">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
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

        <AlertDialogFooter className="flex flex-col gap-2 pt-4 sm:flex-row sm:justify-between">
          {/* Left side: Save for Later */}
          <div className="order-last sm:order-first">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex w-full sm:w-auto">
                    <Button
                      variant="outline"
                      onClick={onSave}
                      disabled={!saveEnabled || isLoading}
                      className="w-full gap-2"
                    >
                      <Save className="h-4 w-4" />
                      Save for later
                    </Button>
                  </span>
                </TooltipTrigger>
                {!saveEnabled && (
                  <TooltipContent side="top" className="max-w-[200px]">
                    <p>Coming soon</p>
                  </TooltipContent>
                )}
              </Tooltip>
            </TooltipProvider>
          </div>

          {/* Right side: Cancel + Return grouped */}
          <div className="flex flex-col gap-2 sm:flex-row sm:gap-2">
            {/* Cancel session - destructive */}
            <Button
              variant="destructive"
              onClick={onCancel}
              disabled={isLoading}
              className="w-full sm:w-auto gap-2"
            >
              {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
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
          </div>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
