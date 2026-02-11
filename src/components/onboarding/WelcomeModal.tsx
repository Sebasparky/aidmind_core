/**
 * WelcomeModal — First-login onboarding.
 *
 * Shows once (localStorage flag). The guided tour only starts
 * after the user explicitly clicks "Got it". Closing via X
 * dismisses the modal without triggering the tour.
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

export const WELCOME_ACK_KEY = "aidmind_welcome_ack_v1";

export function useOnboardingState() {
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    const ack = localStorage.getItem(WELCOME_ACK_KEY);
    if (ack !== "true" && ack !== "dismissed") {
      setShowWelcome(true);
    }
  }, []);

  /** User clicked "Got it" — acknowledge and allow tour to start */
  const acknowledge = () => {
    localStorage.setItem(WELCOME_ACK_KEY, "true");
    setShowWelcome(false);
  };

  /** User closed via X — dismiss without enabling tour auto-start */
  const dismissViaX = () => {
    localStorage.setItem(WELCOME_ACK_KEY, "dismissed");
    setShowWelcome(false);
  };

  return { showWelcome, acknowledge, dismissViaX };
}

interface WelcomeModalProps {
  open: boolean;
  onAcknowledge: () => void;
  onDismissViaX: () => void;
}

export function WelcomeModal({ open, onAcknowledge, onDismissViaX }: WelcomeModalProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onDismissViaX();
      }}
    >
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
          <Button onClick={onAcknowledge} className="w-full">
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
