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
import { Phone, Users, Calendar, MessageSquare } from "lucide-react";

interface LogInteractionModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStartSession: (caseId: string, caseLabel: string, clientLabel: string, interactionType: string) => void;
}

const interactionTypes = [
  { value: "phone_call", label: "Phone call", icon: Phone },
  { value: "in_person", label: "In-person visit", icon: Users },
  { value: "meeting", label: "Meeting", icon: Calendar },
  { value: "other", label: "Other", icon: MessageSquare },
];

export function LogInteractionModal({ open, onOpenChange, onStartSession }: LogInteractionModalProps) {
  const [selectedCase, setSelectedCase] = useState<string>("");
  const [interactionType, setInteractionType] = useState<string>("");
  const [errors, setErrors] = useState<{ case?: string; type?: string }>({});

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const newErrors: { case?: string; type?: string } = {};
    if (!selectedCase) newErrors.case = "Please select a case";
    if (!interactionType) newErrors.type = "Please select an interaction type";
    
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const caseData = availableCases.find(c => c.id === selectedCase);
    if (caseData) {
      onStartSession(selectedCase, caseData.label, caseData.client, interactionType);
      handleClose();
    }
  };

  const handleClose = () => {
    setSelectedCase("");
    setInteractionType("");
    setErrors({});
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[440px]">
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Log Interaction</DialogTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Document an interaction you just completed
          </p>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-5 mt-4">
          {/* Case Selection */}
          <div className="space-y-2">
            <Label htmlFor="case-select" className="text-sm font-medium">
              Case <span className="text-status-danger">*</span>
            </Label>
            <Select value={selectedCase} onValueChange={(val) => {
              setSelectedCase(val);
              setErrors(prev => ({ ...prev, case: undefined }));
            }}>
              <SelectTrigger 
                id="case-select"
                className={errors.case ? "border-status-danger" : ""}
              >
                <SelectValue placeholder="Select a case" />
              </SelectTrigger>
              <SelectContent>
                {availableCases.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    <span className="font-medium">{c.client}</span>
                    <span className="text-muted-foreground ml-2">— {c.label}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {errors.case && (
              <p className="text-xs text-status-danger">{errors.case}</p>
            )}
          </div>

          {/* Interaction Type */}
          <div className="space-y-2">
            <Label className="text-sm font-medium">
              Interaction type <span className="text-status-danger">*</span>
            </Label>
            <div className="grid grid-cols-2 gap-2">
              {interactionTypes.map((type) => {
                const Icon = type.icon;
                const isSelected = interactionType === type.value;
                return (
                  <button
                    key={type.value}
                    type="button"
                    onClick={() => {
                      setInteractionType(type.value);
                      setErrors(prev => ({ ...prev, type: undefined }));
                    }}
                    className={`flex items-center gap-2 p-3 rounded-lg border text-sm font-medium transition-colors ${
                      isSelected
                        ? "border-primary bg-primary/5 text-primary"
                        : "border-border bg-card text-foreground hover:border-primary/50 hover:bg-secondary/50"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {type.label}
                  </button>
                );
              })}
            </div>
            {errors.type && (
              <p className="text-xs text-status-danger">{errors.type}</p>
            )}
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit">
              Start Documentation
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
