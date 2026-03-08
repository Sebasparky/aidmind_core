import { useState } from "react";
import { FileText, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";

interface SaveTemplateModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultName: string;
  onConfirm: (name: string) => void;
  saving?: boolean;
}

export function SaveTemplateModal({
  open,
  onOpenChange,
  defaultName,
  onConfirm,
  saving = false,
}: SaveTemplateModalProps) {
  const [name, setName] = useState(defaultName);

  // Sync when modal opens with new default
  useEffect(() => {
    if (open) setName(defaultName);
  }, [open, defaultName]);

  const handleConfirm = () => {
    const trimmed = name.trim();
    if (trimmed.length === 0) return;
    onConfirm(trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Save template
          </DialogTitle>
          <DialogDescription>
            This template will be saved to your organization and used for guidance generation in the current session.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2">
          <div>
            <label htmlFor="template-name" className="text-sm font-medium text-foreground mb-1.5 block">
              Template name
            </label>
            <Input
              id="template-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter template name"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter" && !saving) handleConfirm();
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            You can edit the name before saving. Only template metadata is stored — no client data is retained.
          </p>
        </div>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={saving || name.trim().length === 0}>
            {saving ? (
              <>Saving…</>
            ) : (
              <>
                <Check className="h-4 w-4 mr-2" />
                Save Template
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
