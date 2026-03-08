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
import { useAuth } from "@/contexts/AuthContext";
import { useTenant } from "@/hooks/useTenant";

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

const SCOPE_OPTIONS = [
  { value: "social_welfare", label: "Social welfare" },
  { value: "substance_use", label: "Substance use" },
  { value: "housing_homelessness", label: "Housing / homelessness" },
  { value: "domestic_violence", label: "Domestic violence" },
  { value: "child_welfare", label: "Child welfare" },
  { value: "mental_health", label: "Mental health" },
  { value: "immigration_refugee", label: "Immigration / refugee" },
  { value: "employment_income", label: "Employment / income" },
  { value: "disability_services", label: "Disability services" },
  { value: "elder_services", label: "Elder services" },
  { value: "reentry_justice", label: "Reentry / justice" },
  { value: "other", label: "Other" },
] as const;

export function StartNoteModal({ open, onOpenChange, onSessionCreated }: StartNoteModalProps) {
  const { user } = useAuth();
  const { tenant } = useTenant();

  const [caseLabel, setCaseLabel] = useState("");
  const [interactionType, setInteractionType] = useState("");
  const [guidanceScope, setGuidanceScope] = useState("");
  const [guidanceScopeOther, setGuidanceScopeOther] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const markTouched = (field: string) =>
    setTouched((prev) => ({ ...prev, [field]: true }));

  const scopeOtherValid =
    guidanceScope !== "other" || guidanceScopeOther.trim().length >= 3;

  const isValid =
    caseLabel.trim().length > 0 && guidanceScope.length > 0 && scopeOtherValid && !!tenant?.tenantId;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!isValid) return;

    setIsCreating(true);

    try {
      const sessionId = crypto.randomUUID();
      const caseId = crypto.randomUUID().slice(0, 8);

      const { error } = await supabase.from("sessions").insert({
        session_id: sessionId,
        case_id: caseId,
        case_label: caseLabel.trim(),
        interaction_type: interactionType || null,
        guidance_scope: guidanceScope,
        guidance_scope_other:
          guidanceScope === "other" ? guidanceScopeOther.trim() : null,
        state: "READY_FOR_INPUT",
        tenant_id: tenant!.tenantId,
        user_id: user!.id,
      });

      if (error) throw error;

      toast({
        title: "Session created",
        description:
          "Your session is ready. Access Guidance or Reviewer tools from the dashboard.",
      });

      // Reset and close
      resetForm();
      onOpenChange(false);
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

  const resetForm = () => {
    setCaseLabel("");
    setInteractionType("");
    setGuidanceScope("");
    setGuidanceScopeOther("");
    setTouched({});
  };

  const handleClose = () => {
    if (isCreating) return;
    resetForm();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-[420px]">
        <DialogHeader>
          <DialogTitle>New Session</DialogTitle>
          <DialogDescription>
            Create a session to access Guidance and Reviewer tools.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          {/* Case Name */}
          <div className="space-y-2">
            <Label htmlFor="case-label">
              Case Name <span className="text-destructive">*</span>
            </Label>
            <Input
              id="case-label"
              type="text"
              placeholder="e.g. Smith family intake"
              value={caseLabel}
              onChange={(e) => setCaseLabel(e.target.value)}
              onBlur={() => markTouched("caseLabel")}
              disabled={isCreating}
              autoFocus
            />
            {touched.caseLabel && !caseLabel.trim() && (
              <p className="text-xs text-destructive">Case name is required.</p>
            )}
          </div>

          {/* Interaction Type */}
          <div className="space-y-2">
            <Label htmlFor="interaction-type">Interaction Type</Label>
            <Select
              value={interactionType}
              onValueChange={setInteractionType}
              disabled={isCreating}
            >
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

          {/* Scope / Case Type */}
          <div className="space-y-2">
            <Label htmlFor="guidance-scope">
              Scope / Case Type <span className="text-destructive">*</span>
            </Label>
            <Select
              value={guidanceScope}
              onValueChange={(v) => {
                setGuidanceScope(v);
                if (v !== "other") setGuidanceScopeOther("");
                markTouched("scope");
              }}
              disabled={isCreating}
            >
              <SelectTrigger id="guidance-scope">
                <SelectValue placeholder="Select scope…" />
              </SelectTrigger>
              <SelectContent>
                {SCOPE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[11px] text-muted-foreground">
              This helps AidMind narrow policy guidance. Not client info.
            </p>
            {touched.scope && !guidanceScope && (
              <p className="text-xs text-destructive">Scope is required.</p>
            )}
          </div>

          {/* Other scope text */}
          {guidanceScope === "other" && (
            <div className="space-y-2">
              <Label htmlFor="scope-other">
                Describe the scope <span className="text-destructive">*</span>
              </Label>
              <Input
                id="scope-other"
                type="text"
                placeholder="e.g., 'school truancy support' or 'family stabilization'…"
                value={guidanceScopeOther}
                onChange={(e) => setGuidanceScopeOther(e.target.value)}
                onBlur={() => markTouched("scopeOther")}
                disabled={isCreating}
              />
              {touched.scopeOther &&
                guidanceScopeOther.trim().length < 3 && (
                  <p className="text-xs text-destructive">
                    Please provide at least 3 characters.
                  </p>
                )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              disabled={isCreating}
            >
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
