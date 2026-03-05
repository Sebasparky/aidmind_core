import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { BookOpen } from "lucide-react";

interface SnippetCitation {
  snippetId: string;
}

interface CitationsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  citations: string[];
  questionText: string;
}

export function CitationsModal({ open, onOpenChange, citations, questionText }: CitationsModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle className="text-base flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-primary" />
            Source Citations
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Question</p>
            <p className="text-sm text-foreground leading-relaxed">{questionText}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-2">
              Referenced Snippets ({citations.length})
            </p>
            <div className="space-y-2">
              {citations.map((cit) => (
                <div key={cit} className="flex items-center gap-2 p-2.5 rounded-md border border-border bg-accent/20">
                  <BookOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <Badge variant="outline" className="text-xs font-mono">
                    {cit}
                  </Badge>
                  <span className="text-xs text-muted-foreground ml-auto">
                    Policy snippet
                  </span>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground mt-3">
              Snippet IDs reference policy excerpts from the session's compiled policy pack.
              Full text is available in the policy pack view.
            </p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
