import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { X, Save, Phone, Users, Calendar, MessageSquare, Clock } from "lucide-react";
import { format } from "date-fns";

interface MindSessionProps {
  caseLabel: string;
  clientLabel: string;
  interactionType: string;
  timestamp: Date;
  onClose: () => void;
  onSave: (notes: string) => void;
}

const interactionIcons: Record<string, React.ElementType> = {
  phone_call: Phone,
  in_person: Users,
  meeting: Calendar,
  other: MessageSquare,
};

const interactionLabels: Record<string, string> = {
  phone_call: "Phone Call",
  in_person: "In-Person Visit",
  meeting: "Meeting",
  other: "Other Interaction",
};

export function MindSession({ 
  caseLabel, 
  clientLabel, 
  interactionType, 
  timestamp,
  onClose,
  onSave,
}: MindSessionProps) {
  const [notes, setNotes] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  
  const Icon = interactionIcons[interactionType] || MessageSquare;

  const handleSave = async () => {
    if (!notes.trim()) return;
    
    setIsSaving(true);
    // Simulate save delay
    await new Promise(resolve => setTimeout(resolve, 500));
    onSave(notes);
    setIsSaving(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-background flex flex-col">
      {/* Header */}
      <div className="h-16 border-b border-border px-6 flex items-center justify-between bg-card">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Icon className="h-4 w-4 text-primary" />
            </div>
            <div>
              <h1 className="text-sm font-semibold text-foreground">
                {interactionLabels[interactionType]}
              </h1>
              <p className="text-xs text-muted-foreground">
                {clientLabel} — {caseLabel}
              </p>
            </div>
          </div>
          
          <Badge variant="secondary" className="gap-1.5">
            <Clock className="h-3 w-3" />
            {format(timestamp, "h:mm a")}
          </Badge>
        </div>

        <div className="flex items-center gap-3">
          <Button 
            variant="outline" 
            onClick={onClose}
            className="gap-2"
          >
            <X className="h-4 w-4" />
            Discard
          </Button>
          <Button 
            onClick={handleSave} 
            disabled={!notes.trim() || isSaving}
            className="gap-2"
          >
            <Save className="h-4 w-4" />
            {isSaving ? "Saving..." : "Save Note"}
          </Button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {/* Context Card */}
          <div className="bg-card border border-border rounded-lg p-4">
            <h2 className="text-sm font-medium text-foreground mb-3">Interaction Context</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Client:</span>
                <span className="ml-2 text-foreground font-medium">{clientLabel}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Case:</span>
                <span className="ml-2 text-foreground">{caseLabel}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Type:</span>
                <span className="ml-2 text-foreground">{interactionLabels[interactionType]}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Started:</span>
                <span className="ml-2 text-foreground">{format(timestamp, "MMM d, yyyy 'at' h:mm a")}</span>
              </div>
            </div>
          </div>

          {/* Notes Area */}
          <div className="space-y-3">
            <label htmlFor="notes" className="text-sm font-medium text-foreground">
              Documentation Notes
            </label>
            <Textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Document the key points from this interaction..."
              className="min-h-[300px] resize-none text-base leading-relaxed"
              autoFocus
            />
            <p className="text-xs text-muted-foreground">
              Tip: Include key outcomes, next steps, and any follow-up actions needed.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
