import { useState } from "react";
import { useNavigate } from "react-router-dom";
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
  const navigate = useNavigate();
  const [selectedCase, setSelectedCase] = useState("");
  const [interactionType, setInteractionType] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedCase || !interactionType) {
      return;
    }

    const caseInfo = availableCases.find((c) => c.id === selectedCase);

    // Navigate to session page with prefilled data
    const params = new URLSearchParams({
      caseId: selectedCase,
      caseLabel: caseInfo?.label || "",
      clientLabel: caseInfo?.client || "",
      interactionType: interactionType,
    });

    // Reset and close
    setSelectedCase("");
    setInteractionType("");
    onOpenChange(false);

    // Navigate to session page
    navigate(`/session?${params.toString()}`);
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
