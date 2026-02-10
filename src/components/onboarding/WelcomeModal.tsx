/**
 * WelcomeModal — First-login onboarding.
 *
 * Shows once (localStorage flag). Can be replayed via settings.
 * Non-blocking, informational, gentle.
 */

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { CheckCircle2 } from "lucide-react";

const ONBOARDED_KEY = "aidmind_onboarded";

export function useOnboardingState() {
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    if (localStorage.getItem(ONBOARDED_KEY) !== "true") {
      setShowWelcome(true);
    }
  }, []);

  const dismiss = () => {
    localStorage.setItem(ONBOARDED_KEY, "true");
    setShowWelcome(false);
  };

  const replay = () => {
    localStorage.removeItem(ONBOARDED_KEY);
    setShowWelcome(true);
  };

  return { showWelcome, dismiss, replay };
}

interface WelcomeModalProps {
  open: boolean;
  onDismiss: () => void;
}

export function WelcomeModal({ open, onDismiss }: WelcomeModalProps) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onDismiss()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl">Welcome to AidMind</DialogTitle>
        </DialogHeader>
        <ul className="space-y-3 py-4">
          {[
            "AidMind shows derived signals, not documentation",
            "AidMind does not store case notes",
            "Your system of record remains unchanged",
            "Everything you see has a source",
          ].map((item) => (
            <li key={item} className="flex items-start gap-3 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0 text-[hsl(var(--status-success))]" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button onClick={onDismiss} className="w-full">
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
