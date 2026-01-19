import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Shield, SkipForward, ArrowRight, MessageSquare, Scale, CheckSquare } from "lucide-react";

interface ReviewerFlag {
  id: string;
  category: "tone" | "policy" | "completeness";
  severity: "Low" | "Medium" | "High";
  message: string;
  sectionRef: string;
}

const PLACEHOLDER_FLAGS: ReviewerFlag[] = [
  // Tone & clarity
  { id: "f1", category: "tone", severity: "Low", message: "Consider softening language in 'Actions Taken' section", sectionRef: "actionsTaken" },
  { id: "f2", category: "tone", severity: "Medium", message: "Technical jargon may be unclear to client-facing documentation", sectionRef: "summary" },
  // Policy alignment
  { id: "f3", category: "policy", severity: "High", message: "Missing required consent documentation reference", sectionRef: "presentingConcern" },
  { id: "f4", category: "policy", severity: "Medium", message: "Timeline does not match standard follow-up protocol", sectionRef: "plan" },
  // Completeness
  { id: "f5", category: "completeness", severity: "Low", message: "Plan section could include specific dates", sectionRef: "plan" },
  { id: "f6", category: "completeness", severity: "Medium", message: "Consider adding referral source in summary", sectionRef: "summary" },
];

interface ReviewerSectionProps {
  onJumpToSection?: (sectionRef: string) => void;
}

export function ReviewerSection({ onJumpToSection }: ReviewerSectionProps) {
  const [isRunning, setIsRunning] = useState(false);
  const [reviewComplete, setReviewComplete] = useState(false);
  const [flags, setFlags] = useState<ReviewerFlag[]>([]);

  const handleRunReviewer = async () => {
    setIsRunning(true);
    // Simulate async review (1.2s)
    await new Promise((resolve) => setTimeout(resolve, 1200));
    setFlags(PLACEHOLDER_FLAGS);
    setReviewComplete(true);
    setIsRunning(false);
  };

  const handleSkip = () => {
    setReviewComplete(true);
    setFlags([]);
  };

  const getSeverityVariant = (severity: string) => {
    switch (severity) {
      case "High":
        return "destructive";
      case "Medium":
        return "default";
      default:
        return "secondary";
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case "tone":
        return <MessageSquare className="h-4 w-4" />;
      case "policy":
        return <Scale className="h-4 w-4" />;
      case "completeness":
        return <CheckSquare className="h-4 w-4" />;
      default:
        return null;
    }
  };

  const getCategoryLabel = (category: string) => {
    switch (category) {
      case "tone":
        return "Tone & clarity";
      case "policy":
        return "Policy alignment";
      case "completeness":
        return "Completeness";
      default:
        return category;
    }
  };

  const groupedFlags = flags.reduce((acc, flag) => {
    if (!acc[flag.category]) acc[flag.category] = [];
    acc[flag.category].push(flag);
    return acc;
  }, {} as Record<string, ReviewerFlag[]>);

  return (
    <Card className="border-2 border-dashed border-primary/20">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-primary" />
              Reviewer
            </CardTitle>
            <CardDescription>
              Checks tone, policy language, and completeness. Suggests flags only — you decide what to change.
            </CardDescription>
          </div>
          {!reviewComplete && (
            <div className="flex gap-2">
              <Button
                onClick={handleRunReviewer}
                disabled={isRunning}
              >
                {isRunning ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Running...
                  </>
                ) : (
                  <>
                    <Shield className="h-4 w-4 mr-2" />
                    Run Reviewer
                  </>
                )}
              </Button>
              <Button variant="outline" onClick={handleSkip} disabled={isRunning}>
                <SkipForward className="h-4 w-4 mr-2" />
                Skip for now
              </Button>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {!reviewComplete && !isRunning && (
          <div className="text-center py-6 text-muted-foreground">
            <p>Run the Reviewer to check your documentation for tone, policy alignment, and completeness.</p>
          </div>
        )}

        {isRunning && (
          <div className="text-center py-10">
            <Loader2 className="h-10 w-10 mx-auto text-primary animate-spin mb-4" />
            <p className="text-muted-foreground">Analyzing your documentation...</p>
          </div>
        )}

        {reviewComplete && flags.length === 0 && (
          <div className="text-center py-6">
            <Badge variant="outline" className="text-green-600 border-green-300 px-4 py-2">
              No flags found — documentation looks good!
            </Badge>
          </div>
        )}

        {reviewComplete && flags.length > 0 && (
          <div className="space-y-6">
            {(["tone", "policy", "completeness"] as const).map((category) => {
              const categoryFlags = groupedFlags[category] || [];
              if (categoryFlags.length === 0) return null;

              return (
                <div key={category}>
                  <div className="flex items-center gap-2 mb-3">
                    {getCategoryIcon(category)}
                    <h4 className="font-medium">{getCategoryLabel(category)}</h4>
                    <Badge variant="secondary" className="text-xs">
                      {categoryFlags.length} flags
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    {categoryFlags.map((flag) => (
                      <div
                        key={flag.id}
                        className="flex items-center justify-between p-3 rounded-lg border bg-accent/30"
                      >
                        <div className="flex items-center gap-3">
                          <Badge variant={getSeverityVariant(flag.severity)} className="text-xs">
                            {flag.severity}
                          </Badge>
                          <p className="text-sm">{flag.message}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => onJumpToSection?.(flag.sectionRef)}
                          className="text-xs shrink-0"
                        >
                          Jump to section
                          <ArrowRight className="h-3 w-3 ml-1" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
