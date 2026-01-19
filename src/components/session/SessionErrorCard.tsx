import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { AlertTriangle, RefreshCw, Copy, Check } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface SessionErrorCardProps {
  errorMessage?: string;
  onRetry: () => void;
  onCancel: () => void;
}

export function SessionErrorCard({ errorMessage, onRetry, onCancel }: SessionErrorCardProps) {
  const [copied, setCopied] = useState(false);

  const handleCopyError = () => {
    // Create safe error text (no sensitive data)
    const safeErrorText = [
      "AidMind Session Error Report",
      `Timestamp: ${new Date().toISOString()}`,
      `Error: ${errorMessage || "Unknown error"}`,
      "---",
      "Please contact support if this issue persists.",
    ].join("\n");

    navigator.clipboard.writeText(safeErrorText);
    setCopied(true);
    toast({
      title: "Error details copied",
      description: "Share this with support if needed.",
    });
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Card>
      <CardContent className="py-12 text-center">
        <AlertTriangle className="h-12 w-12 mx-auto text-destructive mb-4" />
        <h3 className="text-lg font-medium text-foreground mb-2">
          Couldn't start session
        </h3>
        <p className="text-sm text-muted-foreground mb-4 max-w-md mx-auto">
          Session service is unavailable or permissions are missing. Try again or contact support.
        </p>
        {errorMessage && (
          <p className="text-xs text-muted-foreground mb-6 font-mono bg-muted/50 px-3 py-2 rounded inline-block max-w-md">
            {errorMessage}
          </p>
        )}
        <div className="flex gap-3 justify-center items-center flex-wrap">
          <Button variant="outline" onClick={onCancel}>
            Cancel Session
          </Button>
          <Button onClick={onRetry}>
            <RefreshCw className="h-4 w-4 mr-2" />
            Retry
          </Button>
        </div>
        <button
          onClick={handleCopyError}
          className="mt-4 text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline flex items-center gap-1 mx-auto"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3" />
              Copied
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              Copy error details
            </>
          )}
        </button>
      </CardContent>
    </Card>
  );
}
