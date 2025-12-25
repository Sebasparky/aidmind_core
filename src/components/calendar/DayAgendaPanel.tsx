import { format } from "date-fns";
import { Phone, Users, AlertCircle, FileText, Plus, X, CalendarDays } from "lucide-react";
import { CalendarEvent, EventType } from "./AddEventModal";
import { Button } from "@/components/ui/button";

interface DayAgendaPanelProps {
  selectedDate: Date;
  events: CalendarEvent[];
  onAddEvent: () => void;
  onClose: () => void;
}

const eventTypeIcons: Record<EventType, React.ElementType> = {
  phone_call: Phone,
  meeting: Users,
  deadline: AlertCircle,
  document_review: FileText,
};

const eventTypeColors: Record<EventType, string> = {
  phone_call: "text-[hsl(var(--schedule-call))]",
  meeting: "text-[hsl(var(--schedule-meeting))]",
  deadline: "text-[hsl(var(--schedule-deadline))]",
  document_review: "text-[hsl(var(--schedule-document))]",
};

const eventTypeBgColors: Record<EventType, string> = {
  phone_call: "bg-[hsl(var(--schedule-call))/0.1]",
  meeting: "bg-[hsl(var(--schedule-meeting))/0.1]",
  deadline: "bg-[hsl(var(--schedule-deadline))/0.1]",
  document_review: "bg-[hsl(var(--schedule-document))/0.1]",
};

const eventTypeLabels: Record<EventType, string> = {
  phone_call: "Phone call",
  meeting: "Meeting",
  deadline: "Deadline",
  document_review: "Document review",
};

// Format time for display
const formatEventTime = (event: CalendarEvent) => {
  if (event.startTime && event.endTime) {
    return `${formatTime(event.startTime)} - ${formatTime(event.endTime)}`;
  }
  if (event.startTime) {
    return formatTime(event.startTime);
  }
  if (event.type === "deadline") {
    return "Due today";
  }
  return "All day";
};

const formatTime = (time: string) => {
  const [hours, minutes] = time.split(":").map(Number);
  const period = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${minutes.toString().padStart(2, "0")} ${period}`;
};

// Sort events by time
const sortEventsByTime = (events: CalendarEvent[]) => {
  return [...events].sort((a, b) => {
    if (!a.startTime && !b.startTime) return 0;
    if (!a.startTime) return 1;
    if (!b.startTime) return -1;
    return a.startTime.localeCompare(b.startTime);
  });
};

export function DayAgendaPanel({
  selectedDate,
  events,
  onAddEvent,
  onClose,
}: DayAgendaPanelProps) {
  const sortedEvents = sortEventsByTime(events);

  return (
    <div className="w-72 bg-card border-l border-border flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-border flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {format(selectedDate, "EEEE")}
          </p>
          <p className="font-semibold text-foreground">
            {format(selectedDate, "MMMM d, yyyy")}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          onClick={onClose}
          className="h-8 w-8"
          aria-label="Close agenda"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* Events list */}
      <div className="flex-1 overflow-y-auto p-4">
        {sortedEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center mb-3">
              <CalendarDays className="h-6 w-6 text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground mb-4">
              No events scheduled
            </p>
            <Button variant="outline" size="sm" onClick={onAddEvent} className="gap-1.5">
              <Plus className="h-3.5 w-3.5" />
              Add event
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {sortedEvents.map((event) => {
              const Icon = eventTypeIcons[event.type];
              const colorClass = eventTypeColors[event.type];
              const bgClass = eventTypeBgColors[event.type];

              return (
                <div
                  key={event.id}
                  className="p-3 rounded-lg border border-border bg-background hover:bg-secondary/30 transition-colors cursor-pointer"
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${bgClass}`}
                    >
                      <Icon className={`h-4 w-4 ${colorClass}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-foreground truncate">
                        {event.title}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {formatEventTime(event)}
                      </p>
                      <p className={`text-xs mt-1 ${colorClass}`}>
                        {eventTypeLabels[event.type]}
                      </p>
                    </div>
                  </div>
                  {event.notes && (
                    <p className="text-xs text-muted-foreground mt-2 line-clamp-2">
                      {event.notes}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Footer with Add Event */}
      {sortedEvents.length > 0 && (
        <div className="p-4 border-t border-border">
          <Button
            variant="outline"
            size="sm"
            onClick={onAddEvent}
            className="w-full gap-1.5"
          >
            <Plus className="h-3.5 w-3.5" />
            Add event
          </Button>
        </div>
      )}
    </div>
  );
}
