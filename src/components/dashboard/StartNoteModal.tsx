import { useState, useRef } from "react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { availableCases } from "@/contexts/DashboardContext";
import { ResumeBundle } from "@/hooks/useSessionMachine";
import { toast } from "@/hooks/use-toast";
import { ChevronDown, Plus, FileUp } from "lucide-react";

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
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleResumeClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.name.endsWith('.json')) {
      toast({
        title: "Invalid file type",
        description: "Please upload a .json resume bundle file.",
        variant: "destructive",
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const bundle: ResumeBundle = JSON.parse(content);

        // Validate bundle structure
        if (!bundle.version || !bundle.resume_bundle_id || !bundle.case_reference || !bundle.draft_content) {
          throw new Error("Invalid bundle structure");
        }

        // Navigate to session with resume bundle
        const params = new URLSearchParams({
          resumeBundle: encodeURIComponent(JSON.stringify(bundle)),
        });

        // Reset and close
        setSelectedCase("");
        setInteractionType("");
        onOpenChange(false);

        // Navigate to session page
        navigate(`/session?${params.toString()}`);

      } catch (error) {
        toast({
          title: "Invalid resume bundle",
          description: "The file could not be parsed as a valid AidMind resume bundle.",
          variant: "destructive",
        });
      }
    };

    reader.onerror = () => {
      toast({
        title: "Error reading file",
        description: "Could not read the selected file.",
        variant: "destructive",
      });
    };

    reader.readAsText(file);

    // Reset the input so the same file can be selected again
    e.target.value = "";
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

        {/* Divider */}
        <div className="relative mt-2">
          <div className="absolute inset-0 flex items-center">
            <span className="w-full border-t" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-background px-2 text-muted-foreground">
              or
            </span>
          </div>
        </div>

        {/* Resume Draft Option */}
        <div className="pt-2">
          <Button 
            type="button" 
            variant="outline" 
            className="w-full"
            onClick={handleResumeClick}
          >
            <FileUp className="h-4 w-4 mr-2" />
            Resume draft from file
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json"
            onChange={handleFileChange}
            className="hidden"
          />
          <p className="text-xs text-muted-foreground text-center mt-2">
            Upload a previously saved draft bundle (.json)
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Dropdown button component for the dashboard
interface StartNoteDropdownProps {
  onNewNote: () => void;
}

export function StartNoteDropdown({ onNewNote }: StartNoteDropdownProps) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleResumeClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.name.endsWith('.json')) {
      toast({
        title: "Invalid file type",
        description: "Please upload a .json resume bundle file.",
        variant: "destructive",
      });
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const bundle: ResumeBundle = JSON.parse(content);

        // Validate bundle structure
        if (!bundle.version || !bundle.resume_bundle_id || !bundle.case_reference || !bundle.draft_content) {
          throw new Error("Invalid bundle structure");
        }

        // Navigate to session with resume bundle
        const params = new URLSearchParams({
          resumeBundle: encodeURIComponent(JSON.stringify(bundle)),
        });

        // Navigate to session page
        navigate(`/session?${params.toString()}`);

      } catch (error) {
        toast({
          title: "Invalid resume bundle",
          description: "The file could not be parsed as a valid AidMind resume bundle.",
          variant: "destructive",
        });
      }
    };

    reader.onerror = () => {
      toast({
        title: "Error reading file",
        description: "Could not read the selected file.",
        variant: "destructive",
      });
    };

    reader.readAsText(file);

    // Reset the input so the same file can be selected again
    e.target.value = "";
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            Start Note
            <ChevronDown className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onNewNote}>
            <Plus className="h-4 w-4 mr-2" />
            Start new note
          </DropdownMenuItem>
          <DropdownMenuItem onClick={handleResumeClick}>
            <FileUp className="h-4 w-4 mr-2" />
            Resume draft
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <input
        ref={fileInputRef}
        type="file"
        accept=".json"
        onChange={handleFileChange}
        className="hidden"
      />
    </>
  );
}
