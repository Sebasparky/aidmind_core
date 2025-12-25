import { format } from "date-fns";
import { CalendarEvent, EventType } from "./AddEventModal";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface DayEventsPopoverProps {
  date: Date;
  events: CalendarEvent[];
  children: React.ReactNode;
}

const eventTypeColors: Record<EventType, { bg: string; text: string }> = {
  phone_call: { bg: "bg-[hsl(var(--schedule-call))/0.1]", text: "text-[hsl(var(--schedule-call))]" },
  meeting: { bg: "bg-[hsl(var(--schedule-meeting))/0.1]", text: "text-[hsl(var(--schedule-meeting))]" },
  deadline: { bg: "bg-[hsl(var(--schedule-deadline))/0.1]", text: "text-[hsl(var(--schedule-deadline))]" },
  document_review: { bg: "bg-[hsl(var(--schedule-document))/0.1]", text: "text-[hsl(var(--schedule-document))]" },
};

const eventTypeLabels: Record<EventType, string> = {
  phone_call: "Phone call",
  meeting: "Meeting",
  deadline: "Deadline",
  document_review: "Document review",
};

export function DayEventsPopover({ date, events, children }: DayEventsPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start">
        <div className="space-y-2">
          <p className="font-medium text-sm text-foreground">
            {format(date, "EEEE, MMMM d")}
          </p>
          <div className="space-y-1.5">
            {events.map((event) => {
              const colors = eventTypeColors[event.type];
              return (
                <div
                  key={event.id}
                  className={`text-xs px-2 py-1.5 rounded ${colors.bg} ${colors.text}`}
                >
                  <p className="font-medium truncate">{event.title}</p>
                  <p className="opacity-75">
                    {event.startTime || eventTypeLabels[event.type]}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
