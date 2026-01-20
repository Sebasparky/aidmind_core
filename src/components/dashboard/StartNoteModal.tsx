import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { Loader2 } from "lucide-react";

/**
 * Start Session Modal
 * 
 * V1 CONSTRAINTS:
 * - Creates a session card on the dashboard ONLY
 * - NEVER navigates away from the dashboard
 * - Minimal metadata collection (case label, interaction type)
 * - Session is a container for tool access, not a workflow
 */

interface StartNoteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSessionCreated?: () => void;
}

const interactionTypes = [
  { value: "phone_call", label: "Phone call" },
  { value: "visit", label: "Visit" },
  { value: "meeting", label: "Meeting" },
  { value: "other", label: "Other" },
];

export function StartNoteModal({ open, onOpenChange, onSessionCreated }: StartNoteModalProps) {
  const [caseLabel, setCaseLabel] = useState("");
  const [interactionType, setInteractionType] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!caseLabel.trim()) {
      toast({
        title: "Case name required",
        description: "Please enter a case name to create a session.",
        variant: "destructive",
      });
      return;
    }

    setIsCreating(true);

    try {
      const sessionId = crypto.randomUUID();
      const caseId = crypto.randomUUID().slice(0, 8);
      
      const { error } = await supabase.from("sessions").insert({
        session_id: sessionId,
        case_id: caseId,
        case_label: caseLabel.trim(),
        interaction_type: interactionType || null,
        state: "READY_FOR_INPUT",
      });

      if (error) throw error;

      toast({
        title: "Session created",
        description: "Your session is ready. Access Guidance or Reviewer tools from the dashboard.",
      });

      // Reset and close - DO NOT NAVIGATE
      setCaseLabel("");
      setInteractionType("");
      onOpenChange(false);
      
      // Trigger refresh of session list
      onSessionCreated?.();
    } catch (error) {
      console.error("Failed to create session:", error);
      toast({
        title: "Failed to create session",
        description: "Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleClose = () => {
    if (isCreating) return;
    setCaseLabel("");
    setInteractionType("");
    onOpenChange(false);
  };

  const isValid = caseLabel.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>New Session</DialogTitle>
          <DialogDescription>
            Create a session to access Guidance and Reviewer tools.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="case-label">Case Name <span className="text-destructive">*</span></Label>
            <Input
              id="case-label"
              type="text"
              placeholder="e.g. Smith family intake"
              value={caseLabel}
              onChange={(e) => setCaseLabel(e.target.value)}
              disabled={isCreating}
              autoFocus
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="interaction-type">Interaction Type</Label>
            <Select value={interactionType} onValueChange={setInteractionType} disabled={isCreating}>
              <SelectTrigger id="interaction-type">
                <SelectValue placeholder="Select type (optional)" />
              </SelectTrigger>
              <SelectContent>
                {interactionTypes.map((type) => (
                  <SelectItem key={type.value} value={type.value}>
                    {type.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-2 pt-4">
            <Button type="button" variant="outline" onClick={handleClose} disabled={isCreating}>
              Cancel
            </Button>
            <Button type="submit" disabled={!isValid || isCreating}>
              {isCreating ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                "Create Session"
              )}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
