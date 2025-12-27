import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, X, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface VerificationReviewPanelProps {
  minimizedText: string;
  failedCategories: string[];
  isReverifying: boolean;
  onReverify: (editedText: string) => void;
  onCancelSession: () => void;
  onDiscardAndStartOver: () => void;
}

export function VerificationReviewPanel({
  minimizedText,
  failedCategories,
  isReverifying,
  onReverify,
  onCancelSession,
  onDiscardAndStartOver,
}: VerificationReviewPanelProps) {
  const [editedText, setEditedText] = useState(minimizedText);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);

  const handleReverify = useCallback(() => {
    onReverify(editedText);
  }, [editedText, onReverify]);

  const handleConfirmCancel = useCallback(() => {
    setShowCancelDialog(false);
    onCancelSession();
  }, [onCancelSession]);

  const handleConfirmDiscard = useCallback(() => {
    setShowDiscardDialog(false);
    onDiscardAndStartOver();
  }, [onDiscardAndStartOver]);

  // Map category codes to friendly labels
  const getCategoryLabel = (category: string): string => {
    const labels: Record<string, string> = {
      PERSON: "Person",
      LOCATION: "Location",
      CONTACT: "Contact info",
      DATE: "Date",
      MEDICAL_ID: "Medical ID",
      ID: "Identifier",
      ORGANIZATION: "Organization",
      ADDRESS: "Address",
      SSN: "SSN",
    };
    return labels[category] || category;
  };

  return (
    <>
      {/* Cancel Session Dialog */}
      <AlertDialog open={showCancelDialog} onOpenChange={setShowCancelDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Cancel this session?</AlertDialogTitle>
            <AlertDialogDescription>
              This will close the session and securely purge all temporary data.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep working</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmCancel}
              className="bg-muted text-muted-foreground hover:bg-muted/80"
            >
              Cancel session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Discard and Start Over Dialog */}
      <AlertDialog open={showDiscardDialog} onOpenChange={setShowDiscardDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard and start over?</AlertDialogTitle>
            <AlertDialogDescription>
              This will end the current session, purge all temporary data, and return you to the start screen.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep working</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmDiscard}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Discard and start over
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card className="border-amber-200/50 dark:border-amber-800/50">
        <CardHeader className="pb-4">
          <CardTitle className="text-xl font-medium text-foreground">
            Review required before continuing
          </CardTitle>
          <CardDescription className="text-base text-muted-foreground leading-relaxed">
            AidMind detected identifying information that must be removed before a note can be generated.
            Please review the text below and remove or generalize any remaining names, locations, or identifiers.
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Detected Categories */}
          {failedCategories.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Detected categories:</p>
              <div className="flex flex-wrap gap-2">
                {failedCategories.map((category) => (
                  <Badge
                    key={category}
                    variant="outline"
                    className="bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800"
                  >
                    {getCategoryLabel(category)}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Editable Text Area */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Minimized session notes (editable)
            </label>
            <p className="text-xs text-muted-foreground">
              Replace names with roles (e.g., "the client", "the provider") and generalize locations or identifiers.
            </p>
            <Textarea
              value={editedText}
              onChange={(e) => setEditedText(e.target.value)}
              className="min-h-[240px] font-mono text-sm resize-y"
              disabled={isReverifying}
              placeholder="Minimized text will appear here..."
            />
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            {/* Primary: Re-check */}
            <Button
              onClick={handleReverify}
              disabled={isReverifying || !editedText.trim()}
              className="flex-1 sm:flex-none"
            >
              {isReverifying ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Checking...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Re-check for identifiers
                </>
              )}
            </Button>

            {/* Secondary: Cancel session */}
            <Button
              variant="outline"
              onClick={() => setShowCancelDialog(true)}
              disabled={isReverifying}
              className="flex-1 sm:flex-none"
            >
              <X className="h-4 w-4 mr-2" />
              Cancel session
            </Button>

            {/* Tertiary: Discard and start over */}
            <Button
              variant="ghost"
              onClick={() => setShowDiscardDialog(true)}
              disabled={isReverifying}
              className="flex-1 sm:flex-none text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Discard and start over
            </Button>
          </div>
        </CardContent>
      </Card>
    </>
  );
}
