import { useState, useMemo, useCallback } from "react";
import {
  format,
  startOfMonth,
  endOfMonth,
  startOfWeek,
  endOfWeek,
  addDays,
  addMonths,
  addWeeks,
  isSameMonth,
  isSameDay,
  isToday,
} from "date-fns";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AddEventModal,
  CalendarEvent,
  EventType,
} from "@/components/calendar/AddEventModal";
import { DayEventsPopover } from "@/components/calendar/DayEventsPopover";
import { DayAgendaPanel } from "@/components/calendar/DayAgendaPanel";

const eventTypeColors: Record<EventType, { bg: string; text: string }> = {
  phone_call: { bg: "bg-[hsl(var(--schedule-call))/0.1]", text: "text-[hsl(var(--schedule-call))]" },
  meeting: { bg: "bg-[hsl(var(--schedule-meeting))/0.1]", text: "text-[hsl(var(--schedule-meeting))]" },
  deadline: { bg: "bg-[hsl(var(--schedule-deadline))/0.1]", text: "text-[hsl(var(--schedule-deadline))]" },
  document_review: { bg: "bg-[hsl(var(--schedule-document))/0.1]", text: "text-[hsl(var(--schedule-document))]" },
};

const Calendar = () => {
  const [view, setView] = useState<"week" | "month">("month");
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);
  const [events, setEvents] = useState<CalendarEvent[]>([
    // Sample events
    {
      id: "1",
      title: "Phone call with client",
      type: "phone_call",
      date: new Date(),
      startTime: "16:30",
    },
    {
      id: "2",
      title: "Team meeting",
      type: "meeting",
      date: new Date(),
      startTime: "14:00",
    },
  ]);
  const [modalOpen, setModalOpen] = useState(false);
  const [prefillDate, setPrefillDate] = useState<Date | undefined>(undefined);

  const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  // Generate calendar grid based on view
  const calendarDays = useMemo(() => {
    if (view === "month") {
      const monthStart = startOfMonth(currentDate);
      const monthEnd = endOfMonth(currentDate);
      const startDate = startOfWeek(monthStart);
      const endDate = endOfWeek(monthEnd);

      const days: Date[] = [];
      let day = startDate;
      while (day <= endDate) {
        days.push(day);
        day = addDays(day, 1);
      }
      return days;
    } else {
      // Week view
      const weekStart = startOfWeek(currentDate);
      const days: Date[] = [];
      for (let i = 0; i < 7; i++) {
        days.push(addDays(weekStart, i));
      }
      return days;
    }
  }, [view, currentDate]);

  // Group days into weeks for month view grid
  const weeks = useMemo(() => {
    if (view === "week") return [calendarDays];
    const result: Date[][] = [];
    for (let i = 0; i < calendarDays.length; i += 7) {
      result.push(calendarDays.slice(i, i + 7));
    }
    return result;
  }, [calendarDays, view]);

  // Get events for a specific day
  const getEventsForDay = useCallback(
    (date: Date) => {
      return events.filter((event) => isSameDay(event.date, date));
    },
    [events]
  );

  // Get events for selected day
  const selectedDayEvents = useMemo(() => {
    if (!selectedDate) return [];
    return getEventsForDay(selectedDate);
  }, [selectedDate, getEventsForDay]);

  // Navigation handlers
  const handlePrev = () => {
    if (view === "month") {
      setCurrentDate(addMonths(currentDate, -1));
    } else {
      setCurrentDate(addWeeks(currentDate, -1));
    }
  };

  const handleNext = () => {
    if (view === "month") {
      setCurrentDate(addMonths(currentDate, 1));
    } else {
      setCurrentDate(addWeeks(currentDate, 1));
    }
  };

  // Header label based on view
  const headerLabel = useMemo(() => {
    if (view === "month") {
      return format(currentDate, "MMMM yyyy");
    } else {
      const weekStart = startOfWeek(currentDate);
      return `Week of ${format(weekStart, "MMM d, yyyy")}`;
    }
  }, [view, currentDate]);

  // Handle add event from header
  const handleAddEvent = () => {
    setPrefillDate(undefined);
    setModalOpen(true);
  };

  // Handle add event from agenda panel
  const handleAddEventForSelectedDay = () => {
    setPrefillDate(selectedDate || undefined);
    setModalOpen(true);
  };

  // Handle single click on day - select it
  const handleDayClick = (date: Date) => {
    // Toggle selection if clicking the same day
    if (selectedDate && isSameDay(selectedDate, date)) {
      setSelectedDate(null);
    } else {
      setSelectedDate(date);
    }
  };

  // Close agenda panel
  const handleCloseAgenda = () => {
    setSelectedDate(null);
  };

  // Create event handler
  const handleCreateEvent = (eventData: Omit<CalendarEvent, "id">) => {
    const newEvent: CalendarEvent = {
      ...eventData,
      id: crypto.randomUUID(),
    };
    setEvents((prev) => [...prev, newEvent]);
  };

  // Format time for display
  const formatEventTime = (event: CalendarEvent) => {
    if (event.startTime) {
      const [hours, minutes] = event.startTime.split(":").map(Number);
      const period = hours >= 12 ? "PM" : "AM";
      const displayHour = hours % 12 || 12;
      return `${displayHour}:${minutes.toString().padStart(2, "0")} ${period}`;
    }
    return "";
  };

  const eventTypeLabels: Record<EventType, string> = {
    phone_call: "Phone call",
    meeting: "Meeting",
    deadline: "Deadline",
    document_review: "Document",
  };

  const MAX_VISIBLE_EVENTS = 2;

  return (
    <DashboardLayout>
      <div className="flex h-full">
        {/* Main calendar area */}
        <div className={`flex-1 ${selectedDate ? "mr-0" : ""}`}>
          <div className="max-w-4xl mx-auto">
            {/* Header */}
            <div className="flex items-center justify-between mb-8">
              <div>
                <h1 className="text-2xl font-semibold text-foreground">Calendar</h1>
                <p className="text-muted-foreground mt-1">
                  Manage your schedule and appointments
                </p>
              </div>

              <Button className="gap-2" onClick={handleAddEvent}>
                <Plus className="h-4 w-4" />
                Add Event
              </Button>
            </div>

            {/* Calendar Controls */}
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={view === "month" ? "Previous month" : "Previous week"}
                    onClick={handlePrev}
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="outline"
                    size="icon"
                    aria-label={view === "month" ? "Next month" : "Next week"}
                    onClick={handleNext}
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
                <h2 className="text-lg font-medium text-foreground">{headerLabel}</h2>
              </div>

              <Tabs value={view} onValueChange={(v) => setView(v as "week" | "month")}>
                <TabsList>
                  <TabsTrigger value="week">Week</TabsTrigger>
                  <TabsTrigger value="month">Month</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>

            {/* Calendar Grid */}
            <div className="bg-card rounded-xl shadow-card overflow-hidden border border-border">
              {/* Days Header */}
              <div className="grid grid-cols-7 border-b border-border">
                {daysOfWeek.map((day, index) => {
                  // In week view, make day headers clickable
                  const dayDate = view === "week" ? calendarDays[index] : null;
                  return (
                    <div
                      key={day}
                      className={`py-3 text-center text-sm font-medium text-muted-foreground ${
                        view === "week" ? "cursor-pointer hover:bg-secondary/30 transition-colors" : ""
                      }`}
                      onClick={dayDate ? () => handleDayClick(dayDate) : undefined}
                    >
                      {day}
                      {view === "week" && dayDate && (
                        <span className="block text-xs mt-0.5">
                          {format(dayDate, "d")}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Calendar Days */}
              <div className="divide-y divide-border">
                {weeks.map((week, weekIndex) => (
                  <div key={weekIndex} className="grid grid-cols-7">
                    {week.map((day, dayIndex) => {
                      const dayEvents = getEventsForDay(day);
                      const isCurrentMonth = isSameMonth(day, currentDate);
                      const isTodayDate = isToday(day);
                      const isSelected = selectedDate && isSameDay(selectedDate, day);
                      const visibleEvents = dayEvents.slice(0, MAX_VISIBLE_EVENTS);
                      const hiddenCount = dayEvents.length - MAX_VISIBLE_EVENTS;

                      return (
                        <div
                          key={dayIndex}
                          className={`min-h-[100px] p-2 border-r border-border last:border-r-0 cursor-pointer transition-colors ${
                            !isCurrentMonth && view === "month"
                              ? "bg-secondary/30 text-muted-foreground"
                              : "hover:bg-secondary/50"
                          } ${
                            isSelected
                              ? "bg-primary/5 ring-2 ring-primary ring-inset"
                              : ""
                          }`}
                          onClick={() => handleDayClick(day)}
                        >
                          <span
                            className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm ${
                              isTodayDate
                                ? "bg-primary text-primary-foreground font-medium"
                                : isCurrentMonth || view === "week"
                                ? "text-foreground"
                                : "text-muted-foreground"
                            }`}
                          >
                            {format(day, "d")}
                          </span>

                          {/* Events */}
                          <div className="mt-1 space-y-1">
                            {visibleEvents.map((event) => {
                              const colors = eventTypeColors[event.type];
                              return (
                                <div
                                  key={event.id}
                                  className={`text-xs px-1.5 py-0.5 rounded truncate ${colors.bg} ${colors.text}`}
                                >
                                  {formatEventTime(event)} - {eventTypeLabels[event.type]}
                                </div>
                              );
                            })}

                            {hiddenCount > 0 && (
                              <DayEventsPopover date={day} events={dayEvents}>
                                <button 
                                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  +{hiddenCount} more
                                </button>
                              </DayEventsPopover>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Day Agenda Panel */}
        {selectedDate && (
          <DayAgendaPanel
            selectedDate={selectedDate}
            events={selectedDayEvents}
            onAddEvent={handleAddEventForSelectedDay}
            onClose={handleCloseAgenda}
          />
        )}
      </div>

      {/* Add Event Modal */}
      <AddEventModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        onCreateEvent={handleCreateEvent}
        prefillDate={prefillDate}
      />
    </DashboardLayout>
  );
};

export default Calendar;
