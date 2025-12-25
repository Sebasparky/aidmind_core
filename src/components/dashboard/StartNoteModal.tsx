import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { availableCases } from "@/contexts/DashboardContext";
import { toast } from "@/hooks/use-toast";

interface StartNoteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const interactionTypes = [
  { value: "phone_call", label: "Phone call" },
  { value: "visit", label: "Visit" },
  { value: "meeting", label: "Meeting" },
  { value: "other", label: "Other" },
];

export function StartNoteModal({ open, onOpenChange }: StartNoteModalProps) {
  const [selectedCase, setSelectedCase] = useState("");
  const [interactionType, setInteractionType] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedCase || !interactionType) {
      return;
    }

    const caseInfo = availableCases.find((c) => c.id === selectedCase);
    const interactionInfo = interactionTypes.find((t) => t.value === interactionType);

    // For now, show toast indicating the session would start
    // In a real app, this would navigate to The Mind session
    toast({
      title: "Starting note session",
      description: `${interactionInfo?.label} for ${caseInfo?.label}`,
    });

    // Reset and close
    setSelectedCase("");
    setInteractionType("");
    onOpenChange(false);
  };

  const handleClose = () => {
    setSelectedCase("");
    setInteractionType("");
    onOpenChange(false);
  };

  const isValid = selectedCase && interactionType;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[400px]">
        <DialogHeader>
          <DialogTitle>Start Note</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-2">
            <Label htmlFor="case">Case</Label>
            <Select value={selectedCase} onValueChange={setSelectedCase}>
              <SelectTrigger id="case">
                <SelectValue placeholder="Select a case" />
              </SelectTrigger>
              <SelectContent>
                {availableCases.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.client} — {c.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="interaction-type">Interaction type</Label>
            <Select value={interactionType} onValueChange={setInteractionType}>
              <SelectTrigger id="interaction-type">
                <SelectValue placeholder="Select type" />
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
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={!isValid}>
              Start Session
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
