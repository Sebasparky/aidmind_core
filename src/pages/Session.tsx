import { useEffect, useState, useCallback } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSessionMachine, SessionState } from "@/hooks/useSessionMachine";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { 
  Upload, 
  FileAudio, 
  Loader2, 
  CheckCircle2, 
  XCircle, 
  FileText,
  ArrowRight,
  Edit3,
  RefreshCw,
  Download,
  Trash2,
  AlertTriangle,
  ChevronLeft
} from "lucide-react";
import { toast } from "@/hooks/use-toast";

export default function Session() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  
  const caseId = searchParams.get("caseId") || "1";
  const caseLabel = searchParams.get("caseLabel") || "Housing assistance — intake";
  const clientLabel = searchParams.get("clientLabel") || "A. J.";
  const interactionType = searchParams.get("interactionType") || "phone_call";
  
  const { state, data, actions } = useSessionMachine({
    caseId,
    caseLabel,
    clientLabel,
    interactionType,
  });

  const [editedDraft, setEditedDraft] = useState("");
  const [showTextInput, setShowTextInput] = useState(false);
  const [textInput, setTextInput] = useState("");

  // Auto-start session on mount
  useEffect(() => {
    if (state === "NEW") {
      actions.startSession();
    }
  }, [state, actions]);

  // Auto-progress through transcription and redaction
  useEffect(() => {
    if (state === "AUDIO_UPLOADED") {
      actions.startTranscription();
    } else if (state === "TRANSCRIBED") {
      actions.startRedaction();
    } else if (state === "TEXT_PROVIDED") {
      actions.startRedaction();
    }
  }, [state, actions]);

  // Navigate to dashboard when purged
  useEffect(() => {
    if (state === "PURGED") {
      toast({
        title: "Session completed",
        description: "All session data has been securely purged.",
      });
      navigate("/dashboard");
    }
  }, [state, navigate]);

  // Auto-complete purge when closing
  useEffect(() => {
    if (state === "CLOSING") {
      actions.completePurge();
    }
  }, [state, actions]);

  // Initialize edited draft
  useEffect(() => {
    if (data.generatedDraft) {
      setEditedDraft(data.generatedDraft);
    }
  }, [data.generatedDraft]);

  const handleFileUpload = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        // Basic audio file validation
        if (!file.type.startsWith("audio/")) {
          toast({
            title: "Invalid file type",
            description: "Please upload an audio file.",
            variant: "destructive",
          });
          return;
        }
        actions.uploadAudio(file);
      }
    },
    [actions]
  );

  const handleTextSubmit = useCallback(() => {
    if (textInput.trim()) {
      actions.pasteTextNotes(textInput);
    }
  }, [textInput, actions]);

  const handleSaveEdit = useCallback(() => {
    actions.saveEdit(editedDraft);
    toast({
      title: "Draft saved",
      description: "Your changes have been saved.",
    });
  }, [actions, editedDraft]);

  const handleExport = useCallback(() => {
    actions.exportDraft();
    toast({
      title: "Exporting...",
      description: "Your note is being exported to the system of record.",
    });
  }, [actions]);

  const getInteractionTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      phone_call: "Phone Call",
      visit: "Visit",
      meeting: "Meeting",
      other: "Other",
    };
    return labels[type] || type;
  };

  const getProgressValue = (currentState: SessionState): number => {
    const progressMap: Record<SessionState, number> = {
      NEW: 0,
      READY_FOR_INPUT: 10,
      AUDIO_UPLOADED: 20,
      TEXT_PROVIDED: 20,
      TRANSCRIBING: 30,
      TRANSCRIBED: 40,
      REDACTING: 50,
      INPUT_READY: 60,
      RETRIEVING_CONTEXT: 70,
      GENERATING: 80,
      VALIDATING_OUTPUT: 85,
      DRAFT_READY: 90,
      EDITING: 90,
      APPROVED: 95,
      EXPORTING: 98,
      CLOSING: 99,
      PURGED: 100,
      ERROR: 0,
    };
    return progressMap[currentState] || 0;
  };

  const getStateLabel = (currentState: SessionState): string => {
    const labels: Record<SessionState, string> = {
      NEW: "Initializing session...",
      READY_FOR_INPUT: "Ready for input",
      AUDIO_UPLOADED: "Audio uploaded",
      TEXT_PROVIDED: "Text provided",
      TRANSCRIBING: "Transcribing audio...",
      TRANSCRIBED: "Transcription complete",
      REDACTING: "Minimizing and redacting sensitive details...",
      INPUT_READY: "Input ready for processing",
      RETRIEVING_CONTEXT: "Retrieving templates and policies...",
      GENERATING: "Generating draft note...",
      VALIDATING_OUTPUT: "Validating output...",
      DRAFT_READY: "Draft ready for review",
      EDITING: "Editing draft",
      APPROVED: "Draft approved",
      EXPORTING: "Exporting to system of record...",
      CLOSING: "Cleaning up session data...",
      PURGED: "Session completed",
      ERROR: "Error occurred",
    };
    return labels[currentState] || currentState;
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => {
                  if (state !== "PURGED" && state !== "NEW") {
                    actions.cancelSession();
                  } else {
                    navigate("/dashboard");
                  }
                }}
              >
                <ChevronLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
              <div>
                <h1 className="text-xl font-semibold text-foreground">New Note Session</h1>
                <p className="text-sm text-muted-foreground">
                  {clientLabel} • {caseLabel} • {getInteractionTypeLabel(interactionType)}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Badge variant="outline" className="text-xs">
                Session: {data.sessionId.slice(0, 8)}...
              </Badge>
              {state !== "ERROR" && state !== "PURGED" && (
                <Button 
                  variant="destructive" 
                  size="sm"
                  onClick={actions.cancelSession}
                >
                  <XCircle className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
              )}
            </div>
          </div>
          
          {/* Progress bar */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-muted-foreground">{getStateLabel(state)}</span>
              <span className="text-muted-foreground">{getProgressValue(state)}%</span>
            </div>
            <Progress value={getProgressValue(state)} className="h-2" />
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="container mx-auto px-6 py-8 max-w-4xl">
        
        {/* READY_FOR_INPUT: Upload audio or paste text */}
        {state === "READY_FOR_INPUT" && (
          <Card>
            <CardHeader className="text-center">
              <CardTitle className="text-2xl">Start a New Note</CardTitle>
              <CardDescription>
                Upload an audio recording to begin documentation
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {!showTextInput ? (
                <>
                  {/* Audio upload */}
                  <label className="block">
                    <div className="border-2 border-dashed border-border rounded-lg p-12 text-center cursor-pointer hover:border-primary/50 hover:bg-accent/50 transition-colors">
                      <Upload className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                      <p className="text-lg font-medium text-foreground mb-2">
                        Click to upload audio
                      </p>
                      <p className="text-sm text-muted-foreground">
                        Supports MP3, WAV, M4A, and other audio formats
                      </p>
                    </div>
                    <input
                      type="file"
                      accept="audio/*"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                  </label>
                  
                  <div className="relative">
                    <div className="absolute inset-0 flex items-center">
                      <span className="w-full border-t" />
                    </div>
                    <div className="relative flex justify-center text-xs uppercase">
                      <span className="bg-background px-2 text-muted-foreground">
                        or
                      </span>
                    </div>
                  </div>
                  
                  <Button 
                    variant="outline" 
                    className="w-full"
                    onClick={() => setShowTextInput(true)}
                  >
                    <FileText className="h-4 w-4 mr-2" />
                    Paste text notes instead
                  </Button>
                </>
              ) : (
                <>
                  <Textarea
                    placeholder="Paste your notes here..."
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    className="min-h-[200px]"
                  />
                  <div className="flex gap-3">
                    <Button 
                      variant="outline" 
                      onClick={() => setShowTextInput(false)}
                    >
                      Back to audio upload
                    </Button>
                    <Button 
                      onClick={handleTextSubmit}
                      disabled={!textInput.trim()}
                    >
                      Continue
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* Processing states */}
        {(state === "AUDIO_UPLOADED" || 
          state === "TRANSCRIBING" || 
          state === "TRANSCRIBED" || 
          state === "TEXT_PROVIDED" ||
          state === "REDACTING") && (
          <Card>
            <CardContent className="py-12 text-center">
              <Loader2 className="h-12 w-12 mx-auto text-primary animate-spin mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                {getStateLabel(state)}
              </h3>
              <p className="text-sm text-muted-foreground">
                {state === "TRANSCRIBING" && "Converting speech to text..."}
                {state === "REDACTING" && "Removing sensitive information and minimizing data..."}
                {(state === "AUDIO_UPLOADED" || state === "TRANSCRIBED" || state === "TEXT_PROVIDED") && 
                  "Processing your input..."}
              </p>
              {data.audioFile && (
                <div className="mt-6 inline-flex items-center gap-2 px-4 py-2 bg-accent rounded-lg">
                  <FileAudio className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm text-foreground">{data.audioFile.name}</span>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        {/* INPUT_READY: Show minimized input and generate button */}
        {state === "INPUT_READY" && (
          <Card>
            <CardHeader>
              <CardTitle>Input Ready</CardTitle>
              <CardDescription>
                Your input has been processed and minimized. Ready to generate the draft note.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="bg-accent/50 rounded-lg p-4">
                <h4 className="text-sm font-medium text-muted-foreground mb-2">
                  Minimized Transcript Preview
                </h4>
                <p className="text-foreground">{data.minimizedTranscript}</p>
              </div>
              
              <div className="flex gap-3">
                <Button variant="outline" onClick={actions.cancelSession}>
                  Cancel Session
                </Button>
                <Button onClick={actions.generateDraft} className="flex-1">
                  Generate Draft
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Generating states */}
        {(state === "RETRIEVING_CONTEXT" || 
          state === "GENERATING" || 
          state === "VALIDATING_OUTPUT") && (
          <Card>
            <CardContent className="py-12 text-center">
              <Loader2 className="h-12 w-12 mx-auto text-primary animate-spin mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                {getStateLabel(state)}
              </h3>
              <p className="text-sm text-muted-foreground">
                {state === "RETRIEVING_CONTEXT" && "Loading templates, policies, and timeline rules..."}
                {state === "GENERATING" && "Creating structured case note from your input..."}
                {state === "VALIDATING_OUTPUT" && "Checking for compliance and data integrity..."}
              </p>
              <div className="mt-4 text-xs text-muted-foreground">
                LLM Request Count: {data.llmRequestCount}
              </div>
            </CardContent>
          </Card>
        )}

        {/* DRAFT_READY: Review and edit */}
        {(state === "DRAFT_READY" || state === "EDITING") && (
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Generated Draft</CardTitle>
                    <CardDescription>
                      Review and edit your case note before approval
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    {state === "DRAFT_READY" && (
                      <Button 
                        variant="outline" 
                        size="sm"
                        onClick={actions.startEditing}
                      >
                        <Edit3 className="h-4 w-4 mr-1" />
                        Edit
                      </Button>
                    )}
                    <Button 
                      variant="outline" 
                      size="sm"
                      onClick={actions.regenerateDraft}
                      disabled={data.llmRequestCount >= 3}
                    >
                      <RefreshCw className="h-4 w-4 mr-1" />
                      Regenerate ({3 - data.llmRequestCount} left)
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {state === "EDITING" ? (
                  <div className="space-y-4">
                    <Textarea
                      value={editedDraft}
                      onChange={(e) => setEditedDraft(e.target.value)}
                      className="min-h-[400px] font-mono text-sm"
                    />
                    <div className="flex gap-2 justify-end">
                      <Button 
                        variant="outline" 
                        onClick={() => {
                          setEditedDraft(data.generatedDraft || "");
                          actions.saveEdit(data.generatedDraft || "");
                        }}
                      >
                        Cancel
                      </Button>
                      <Button onClick={handleSaveEdit}>
                        Save Changes
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="prose prose-sm max-w-none dark:prose-invert bg-accent/30 rounded-lg p-6">
                    <pre className="whitespace-pre-wrap font-sans text-foreground">
                      {data.generatedDraft}
                    </pre>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Timelines */}
            {data.timelines && data.timelines.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Timeline Events</CardTitle>
                  <CardDescription>
                    Confirm the applicability of detected timeline events
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {data.timelines.map((timeline) => (
                      <div 
                        key={timeline.id}
                        className="flex items-center gap-3 p-3 bg-accent/50 rounded-lg"
                      >
                        <Checkbox
                          checked={timeline.confirmed}
                          onCheckedChange={() => actions.confirmTimeline(timeline.id)}
                        />
                        <div className="flex-1">
                          <p className="text-sm font-medium text-foreground">
                            {timeline.description}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {timeline.date}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Follow-ups */}
            {data.followUps && data.followUps.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-lg">Follow-Up Tasks</CardTitle>
                  <CardDescription>
                    Suggested follow-up actions from this session
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-3">
                    {data.followUps.map((followUp) => (
                      <div 
                        key={followUp.id}
                        className="flex items-center justify-between p-3 bg-accent/50 rounded-lg"
                      >
                        <div>
                          <p className="text-sm font-medium text-foreground">
                            {followUp.title}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Due: {followUp.dueDate}
                          </p>
                        </div>
                        <Badge 
                          variant={
                            followUp.priority === "HIGH" ? "destructive" : 
                            followUp.priority === "MEDIUM" ? "default" : 
                            "secondary"
                          }
                        >
                          {followUp.priority}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Action buttons */}
            {state === "DRAFT_READY" && (
              <div className="flex gap-3 justify-end">
                <Button variant="outline" onClick={actions.cancelSession}>
                  Cancel Session
                </Button>
                <Button onClick={actions.approveDraft}>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Approve Draft
                </Button>
              </div>
            )}
          </div>
        )}

        {/* APPROVED: Export options */}
        {state === "APPROVED" && (
          <Card>
            <CardHeader className="text-center">
              <CheckCircle2 className="h-16 w-16 mx-auto text-green-500 mb-4" />
              <CardTitle className="text-2xl">Draft Approved</CardTitle>
              <CardDescription>
                Your case note has been approved and is ready for export.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-3 justify-center">
                <Button variant="outline" onClick={actions.skipExport}>
                  Skip Export
                </Button>
                <Button onClick={handleExport}>
                  <Download className="h-4 w-4 mr-2" />
                  Export to System of Record
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* EXPORTING */}
        {state === "EXPORTING" && (
          <Card>
            <CardContent className="py-12 text-center">
              <Loader2 className="h-12 w-12 mx-auto text-primary animate-spin mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                Exporting...
              </h3>
              <p className="text-sm text-muted-foreground">
                Sending your approved note to the system of record.
              </p>
            </CardContent>
          </Card>
        )}

        {/* CLOSING */}
        {state === "CLOSING" && (
          <Card>
            <CardContent className="py-12 text-center">
              <Trash2 className="h-12 w-12 mx-auto text-muted-foreground animate-pulse mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                Cleaning up session data...
              </h3>
              <p className="text-sm text-muted-foreground">
                Securely purging all temporary session artifacts.
              </p>
            </CardContent>
          </Card>
        )}

        {/* ERROR */}
        {state === "ERROR" && (
          <Card>
            <CardContent className="py-12 text-center">
              <AlertTriangle className="h-12 w-12 mx-auto text-destructive mb-4" />
              <h3 className="text-lg font-medium text-foreground mb-2">
                An error occurred
              </h3>
              <p className="text-sm text-muted-foreground mb-6">
                {data.errorMessage || "Something went wrong. Please try again."}
              </p>
              <div className="flex gap-3 justify-center">
                <Button variant="outline" onClick={actions.cancelSession}>
                  Cancel Session
                </Button>
                <Button onClick={actions.retryFromError}>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry
                </Button>
              </div>
            </CardContent>
          </Card>
        )}
      </main>
    </div>
  );
}
