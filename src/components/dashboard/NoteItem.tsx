import { Upload, Save, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export type NoteStatus = "exported" | "saved" | "cancelled";

export interface Note {
  id: string;
  title: string;
  interactionType: string;
  status: NoteStatus;
  updatedAt: string;
}

interface NoteItemProps {
  note: Note;
}

const statusConfig: Record<NoteStatus, {
  icon: typeof Upload;
  iconClass: string;
  bgClass: string;
  badgeVariant: "success" | "warning" | "neutral";
  label: string;
}> = {
  exported: {
    icon: Upload,
    iconClass: "text-status-success",
    bgClass: "bg-[hsl(var(--status-success-muted))]",
    badgeVariant: "success",
    label: "Exported",
  },
  saved: {
    icon: Save,
    iconClass: "text-status-warning",
    bgClass: "bg-[hsl(var(--status-warning-muted))]",
    badgeVariant: "warning",
    label: "Saved for later",
  },
  cancelled: {
    icon: XCircle,
    iconClass: "text-status-neutral",
    bgClass: "bg-[hsl(var(--status-neutral-muted))]",
    badgeVariant: "neutral",
    label: "Cancelled",
  },
};

const interactionTypeLabels: Record<string, string> = {
  "phone-call": "Phone Call",
  "in-person": "In-Person",
  "video-call": "Video Call",
  "text-sms": "Text/SMS",
  "collateral-contact": "Collateral Contact",
  "case-conference": "Case Conference",
  "other": "Other",
};

export function NoteItem({ note }: NoteItemProps) {
  const config = statusConfig[note.status] || statusConfig.saved;
  const Icon = config.icon;
  const interactionLabel = interactionTypeLabels[note.interactionType] || note.interactionType;

  return (
    <div className="flex items-start gap-3 p-3 hover:bg-secondary/50 rounded-lg transition-colors cursor-pointer">
      {/* Status icon */}
      <div
        className={cn(
          "w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0",
          config.bgClass
        )}
      >
        <Icon className={cn("h-4 w-4", config.iconClass)} />
      </div>

      <div className="flex-1 min-w-0">
        {/* Note title */}
        <p className="text-sm font-medium text-foreground truncate">
          {note.title}
        </p>
        
        {/* Interaction type tag */}
        <div className="flex items-center gap-2 mt-1">
          <Badge variant="secondary" className="text-xs px-2 py-0">
            {interactionLabel}
          </Badge>
        </div>
        
        {/* Status and timestamp */}
        <div className="flex items-center gap-2 mt-1.5">
          <Badge variant={config.badgeVariant} className="text-xs px-2 py-0">
            {config.label}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {note.updatedAt}
          </span>
        </div>
      </div>
    </div>
  );
}
