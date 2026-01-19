import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Sparkles, Eye, Check, X, HelpCircle, Calendar, AlertCircle } from "lucide-react";

// Placeholder data for guidance output
const PLACEHOLDER_QUESTIONS = [
  "What is the client's current housing situation?",
  "Has the client applied for any assistance programs before?",
  "Are there any dependents living with the client?",
  "What is the client's current employment status?",
  "Does the client have any immediate safety concerns?",
  "What is the client's preferred contact method?",
  "Are there any language or accessibility needs?",
  "Has the client been referred by another agency?",
];

const PLACEHOLDER_TIMELINE_CANDIDATES = [
  { id: "t1", title: "Follow-up call scheduled", date: "2024-01-25", status: "PENDING" as const },
  { id: "t2", title: "Benefits application deadline", date: "2024-02-01", status: "PENDING" as const },
  { id: "t3", title: "Housing voucher review", date: "2024-02-15", status: "PENDING" as const },
  { id: "t4", title: "Case manager check-in", date: "2024-01-30", status: "PENDING" as const },
  { id: "t5", title: "Document submission deadline", date: "2024-02-10", status: "PENDING" as const },
];

const PLACEHOLDER_MISSING_FIELDS = [
  "Supervisor signature",
  "Service date",
  "Client consent status",
  "Program eligibility verification",
  "Contact information confirmed",
  "Case priority level",
  "Next steps documented",
  "Referral source noted",
];

interface TimelineCandidate {
  id: string;
  title: string;
  date: string;
  status: "PENDING" | "CONFIRMED" | "DENIED";
}

interface GuidanceSectionProps {
  isTemplateSelected: boolean;
}

export function GuidanceSection({ isTemplateSelected }: GuidanceSectionProps) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [guidanceGenerated, setGuidanceGenerated] = useState(false);
  const [timelineCandidates, setTimelineCandidates] = useState<TimelineCandidate[]>([]);

  const handleGenerateGuidance = async () => {
    setIsGenerating(true);
    // Simulate async generation (1.2s)
    await new Promise((resolve) => setTimeout(resolve, 1200));
    setTimelineCandidates(PLACEHOLDER_TIMELINE_CANDIDATES);
    setGuidanceGenerated(true);
    setIsGenerating(false);
  };

  const handleTimelineAction = (id: string, action: "CONFIRMED" | "DENIED") => {
    setTimelineCandidates((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, status: action } : item
      )
    );
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-primary" />
              Guidance
            </CardTitle>
            <CardDescription>
              Generate questions, timeline candidates, and missing fields for this template.
            </CardDescription>
          </div>
          <div className="flex gap-2">
            <Button
              onClick={handleGenerateGuidance}
              disabled={!isTemplateSelected || isGenerating}
            >
              {isGenerating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4 mr-2" />
                  Generate Guidance
                </>
              )}
            </Button>
            <Button
              variant="outline"
              disabled={!guidanceGenerated}
            >
              <Eye className="h-4 w-4 mr-2" />
              View last guidance
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {!guidanceGenerated && !isGenerating && (
          <div className="text-center py-8 text-muted-foreground">
            {isTemplateSelected ? (
              <p>Click "Generate Guidance" to get questions, timeline candidates, and missing fields.</p>
            ) : (
              <p>Select a template above to enable guidance generation.</p>
            )}
          </div>
        )}

        {isGenerating && (
          <div className="text-center py-12">
            <Loader2 className="h-10 w-10 mx-auto text-primary animate-spin mb-4" />
            <p className="text-muted-foreground">Generating guidance from The Mind...</p>
          </div>
        )}

        {guidanceGenerated && !isGenerating && (
          <div className="space-y-6">
            {/* Questions to Ask */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <HelpCircle className="h-4 w-4 text-primary" />
                <h4 className="font-medium">Questions to ask</h4>
                <Badge variant="secondary" className="text-xs">
                  {PLACEHOLDER_QUESTIONS.length} items
                </Badge>
              </div>
              <ul className="space-y-2 ml-6">
                {PLACEHOLDER_QUESTIONS.map((question, idx) => (
                  <li key={idx} className="text-sm text-muted-foreground list-disc">
                    {question}
                  </li>
                ))}
              </ul>
            </div>

            {/* Timeline Candidates */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <Calendar className="h-4 w-4 text-primary" />
                <h4 className="font-medium">Timeline candidates</h4>
                <Badge variant="secondary" className="text-xs">
                  {timelineCandidates.length} items
                </Badge>
              </div>
              <div className="space-y-2">
                {timelineCandidates.map((item) => (
                  <div
                    key={item.id}
                    className={`flex items-center justify-between p-3 rounded-lg border ${
                      item.status === "CONFIRMED"
                        ? "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800"
                        : item.status === "DENIED"
                        ? "bg-muted/50 border-muted"
                        : "bg-accent/50 border-transparent"
                    }`}
                  >
                    <div>
                      <p className="text-sm font-medium">{item.title}</p>
                      <p className="text-xs text-muted-foreground">{item.date}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {item.status === "PENDING" ? (
                        <>
                          <Button
                            size="sm"
                            variant="default"
                            onClick={() => handleTimelineAction(item.id, "CONFIRMED")}
                            className="h-7 px-2"
                          >
                            <Check className="h-3.5 w-3.5 mr-1" />
                            Confirm
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleTimelineAction(item.id, "DENIED")}
                            className="h-7 px-2"
                          >
                            <X className="h-3.5 w-3.5 mr-1" />
                            Deny
                          </Button>
                        </>
                      ) : (
                        <Badge
                          variant="outline"
                          className={
                            item.status === "CONFIRMED"
                              ? "text-green-600 border-green-300"
                              : "text-muted-foreground"
                          }
                        >
                          {item.status === "CONFIRMED" ? "Confirmed" : "Denied"}
                        </Badge>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Missing Fields */}
            <div>
              <div className="flex items-center gap-2 mb-3">
                <AlertCircle className="h-4 w-4 text-amber-500" />
                <h4 className="font-medium">Missing fields</h4>
                <Badge variant="secondary" className="text-xs">
                  {PLACEHOLDER_MISSING_FIELDS.length} items
                </Badge>
              </div>
              <div className="flex flex-wrap gap-2">
                {PLACEHOLDER_MISSING_FIELDS.map((field, idx) => (
                  <Badge key={idx} variant="outline" className="text-sm">
                    {field}
                  </Badge>
                ))}
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
