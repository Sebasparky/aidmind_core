import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Shield, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ReviewerSection } from "@/components/session/ReviewerSection";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Standalone Reviewer Tool Page
 * 
 * IMPORTANT CONSTRAINTS:
 * - This is a tool, NOT a document creation surface
 * - User pastes their own text for review
 * - No document drafting, editing, or exporting
 * - No system-of-record storage
 * - Independent from Guidance (non-sequential)
 */

interface SessionInfo {
  caseLabel: string;
  interactionType: string | null;
}

export default function Reviewer() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [userText, setUserText] = useState("");

  useEffect(() => {
    async function fetchSession() {
      if (!sessionId) {
        setError("No session ID provided");
        setLoading(false);
        return;
      }

      try {
        const { data, error: fetchError } = await supabase
          .from("sessions")
          .select("case_label, interaction_type")
          .eq("session_id", sessionId)
          .maybeSingle();

        if (fetchError) throw fetchError;

        if (!data) {
          setError("Session not found");
        } else {
          setSessionInfo({
            caseLabel: data.case_label || "Untitled session",
            interactionType: data.interaction_type,
          });
        }
      } catch (err) {
        setError("Failed to load session");
        console.error(err);
      } finally {
        setLoading(false);
      }
    }

    fetchSession();
  }, [sessionId]);

  const handleBack = () => {
    navigate("/dashboard");
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <Shield className="h-8 w-8 mx-auto text-primary animate-pulse mb-2" />
          <p className="text-muted-foreground">Loading reviewer tool...</p>
        </div>
      </div>
    );
  }

  if (error || !sessionInfo) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center max-w-md">
          <p className="text-destructive mb-4">{error || "Session not found"}</p>
          <Button onClick={handleBack}>Back to Dashboard</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={handleBack}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <div className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-primary" />
                  <h1 className="text-xl font-semibold text-foreground">
                    Run Reviewer
                  </h1>
                </div>
                <p className="text-sm text-muted-foreground">
                  {sessionInfo.caseLabel}
                  {sessionInfo.interactionType && ` • ${sessionInfo.interactionType}`}
                </p>
              </div>
            </div>
          </div>
        </div>
      </header>

      {/* Intent Guardrail */}
      <div className="container mx-auto px-6 py-4 max-w-4xl">
        <Alert className="mb-6 border-primary/20 bg-primary/5">
          <Info className="h-4 w-4 text-primary" />
          <AlertDescription className="text-sm text-muted-foreground">
            Paste your documentation below to check for tone, policy language, and completeness.
            <strong className="block mt-1 text-foreground">
              AidMind does not store, modify, or export your text.
            </strong>
          </AlertDescription>
        </Alert>

        {/* Text Input Area */}
        <Card className="mb-6">
          <CardHeader>
            <CardTitle className="text-base">Your Documentation</CardTitle>
            <CardDescription>
              Paste the text you want reviewed. This text is not saved.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Textarea
              placeholder="Paste your documentation here for review..."
              value={userText}
              onChange={(e) => setUserText(e.target.value)}
              className="min-h-[200px] resize-y"
            />
            <p className="text-xs text-muted-foreground mt-2">
              {userText.length} characters
            </p>
          </CardContent>
        </Card>

        {/* Reviewer Section */}
        <ReviewerSection />

        {/* Footer */}
        <div className="mt-8 pt-4 border-t border-border">
          <Button variant="outline" onClick={handleBack}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
        </div>
      </div>
    </div>
  );
}
