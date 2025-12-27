import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, X, Trash2, AlertTriangle } from "lucide-react";
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

export type Layer2Status = 
  | "COMPLETED" 
  | "FAILED_UNREACHABLE" 
  | "FAILED_TIMEOUT" 
  | "FAILED_ERROR" 
  | "SKIPPED_CONFIG_MISSING" 
  | "SKIPPED";

interface VerificationReviewPanelProps {
  minimizedText: string | undefined;
  failedCategories: string[];
  isReverifying: boolean;
  isLoading?: boolean;
  layerStatus?: {
    layer1?: { status: string; counts?: Record<string, number> };
    layer2?: { status: string; counts?: Record<string, number>; method?: string; skipped_reason?: string };
  };
  onReverify: (editedText: string) => void;
  onCancelSession: () => void;
  onDiscardAndStartOver: () => void;
}

export function VerificationReviewPanel({
  minimizedText,
  failedCategories,
  isReverifying,
  isLoading = false,
  layerStatus,
  onReverify,
  onCancelSession,
  onDiscardAndStartOver,
}: VerificationReviewPanelProps) {
  const [editedText, setEditedText] = useState(minimizedText || "");
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);

  // Sync editedText when minimizedText prop changes
  useEffect(() => {
    if (minimizedText !== undefined && minimizedText !== editedText) {
      setEditedText(minimizedText);
    }
  }, [minimizedText]);

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
      UNKNOWN: "Unknown",
      PARSE_ERROR: "Detection error",
    };
    return labels[category] || category;
  };

  // Determine Layer 2 status for messaging
  const layer2Status = layerStatus?.layer2?.status as Layer2Status | undefined;
  const isLayer2Completed = layer2Status === "COMPLETED";
  const isLayer2Failed = layer2Status?.startsWith("FAILED_") || layer2Status === "SKIPPED_CONFIG_MISSING";

  // Show loading state if minimizedText is not ready
  const isTextReady = minimizedText !== undefined && minimizedText !== null && minimizedText.length > 0;

  // Dev mode indicator
  const isDev = import.meta.env.DEV;

  // Get the appropriate message based on Layer 2 status
  const getDescriptionMessage = () => {
    if (isLayer2Completed) {
      return "Names and locations were automatically generalized. Please review the text below and remove or generalize any remaining identifiers.";
    } else if (isLayer2Failed) {
      return "Automatic name/location redaction is temporarily unavailable. Please manually generalize names and locations below (e.g., replace 'Grace' → 'the client', 'Chelsea' → 'the caseworker').";
    } else {
      return "AidMind detected identifying information that must be removed before a note can be generated. Please review the text below and remove or generalize any remaining names, locations, or identifiers.";
    }
  };

  // Get layer 2 status badge color and label
  const getLayer2Badge = () => {
    if (!layer2Status) return null;
    
    const statusConfig: Record<string, { label: string; className: string }> = {
      "COMPLETED": { 
        label: "Layer 2: COMPLETED", 
        className: "text-green-600 border-green-600 bg-green-50 dark:bg-green-950/30 dark:text-green-400" 
      },
      "FAILED_UNREACHABLE": { 
        label: "Layer 2: FAILED (unreachable)", 
        className: "text-red-600 border-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400" 
      },
      "FAILED_TIMEOUT": { 
        label: "Layer 2: FAILED (timeout)", 
        className: "text-red-600 border-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400" 
      },
      "FAILED_ERROR": { 
        label: "Layer 2: FAILED (error)", 
        className: "text-red-600 border-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400" 
      },
      "SKIPPED_CONFIG_MISSING": { 
        label: "Layer 2: SKIPPED (not configured)", 
        className: "text-amber-600 border-amber-600 bg-amber-50 dark:bg-amber-950/30 dark:text-amber-400" 
      },
      "SKIPPED": { 
        label: "Layer 2: SKIPPED", 
        className: "text-muted-foreground border-muted bg-muted/30" 
      },
    };
    
    return statusConfig[layer2Status] || { label: `Layer 2: ${layer2Status}`, className: "text-muted-foreground border-muted bg-muted/30" };
  };

  const layer2Badge = getLayer2Badge();

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
            {getDescriptionMessage()}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Layer status indicators */}
          <div className="flex flex-wrap gap-2">
            {layerStatus?.layer1 && (
              <Badge variant="outline" className="text-green-600 border-green-600 bg-green-50 dark:bg-green-950/30 dark:text-green-400">
                Layer 1: {layerStatus.layer1.status}
              </Badge>
            )}
            {layer2Badge && (
              <Badge variant="outline" className={layer2Badge.className}>
                {layer2Badge.label}
              </Badge>
            )}
            <Badge variant="outline" className="text-red-600 border-red-600 bg-red-50 dark:bg-red-950/30 dark:text-red-400">
              Layer 3: FAILED
            </Badge>
          </div>

          {/* Warning for manual redaction required */}
          {isLayer2Failed && (
            <div className="flex items-start gap-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="text-sm text-amber-800 dark:text-amber-200">
                <p className="font-medium mb-1">Manual redaction required</p>
                <p className="text-amber-700 dark:text-amber-300">
                  Replace all names with roles (e.g., "the client", "the caseworker", "the supervisor") 
                  and generalize locations (e.g., "the office", "the shelter").
                </p>
              </div>
            </div>
          )}

          {/* Detected Categories */}
          {failedCategories.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground">Detected categories requiring attention:</p>
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

          {/* Editable Text Area or Loading State */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-foreground">
              Minimized session notes (editable)
            </label>
            <p className="text-xs text-muted-foreground">
              {isLayer2Completed 
                ? "Review and edit any remaining identifying information."
                : "Replace names with roles (e.g., \"the client\", \"the provider\") and generalize locations or identifiers."}
            </p>
            
            {isLoading || !isTextReady ? (
              <div className="min-h-[240px] border rounded-md flex items-center justify-center bg-muted/30">
                <div className="text-center">
                  <Loader2 className="h-8 w-8 mx-auto text-muted-foreground animate-spin mb-2" />
                  <p className="text-sm text-muted-foreground">Preparing minimized notes…</p>
                </div>
              </div>
            ) : (
              <Textarea
                value={editedText}
                onChange={(e) => setEditedText(e.target.value)}
                className="min-h-[240px] font-mono text-sm resize-y"
                disabled={isReverifying}
                placeholder="Minimized text will appear here..."
              />
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 pt-2">
            {/* Primary: Re-check */}
            <Button
              onClick={handleReverify}
              disabled={isReverifying || !isTextReady || !editedText.trim()}
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