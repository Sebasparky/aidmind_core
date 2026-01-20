import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Sparkles, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { GuidanceSection } from "@/components/session/GuidanceSection";
import { SetupSection } from "@/components/session/SetupSection";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Standalone Guidance Tool Page
 * 
 * IMPORTANT CONSTRAINTS:
 * - This is a tool, NOT a document creation surface
 * - No document drafting, editing, or exporting
 * - No system-of-record storage
 * - Independent from Reviewer (non-sequential)
 */

interface SessionInfo {
  caseLabel: string;
  interactionType: string | null;
}

export default function Guidance() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState("");
  const [policyPackUploaded, setPolicyPackUploaded] = useState(false);

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
          <Sparkles className="h-8 w-8 mx-auto text-primary animate-pulse mb-2" />
          <p className="text-muted-foreground">Loading guidance tool...</p>
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
                  <Sparkles className="h-5 w-5 text-primary" />
                  <h1 className="text-xl font-semibold text-foreground">
                    Generate Guidance
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
            This tool generates questions, timeline suggestions, and identifies missing fields.
            <strong className="block mt-1 text-foreground">
              AidMind does not create, store, or export documentation.
            </strong>
          </AlertDescription>
        </Alert>

        {/* Setup Section */}
        <div className="space-y-6">
          <SetupSection
            selectedTemplate={selectedTemplate}
            onTemplateChange={setSelectedTemplate}
            policyPackUploaded={policyPackUploaded}
            onPolicyPackUpload={() => setPolicyPackUploaded(true)}
          />

          {/* Guidance Section */}
          <GuidanceSection isTemplateSelected={selectedTemplate !== ""} />
        </div>

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
