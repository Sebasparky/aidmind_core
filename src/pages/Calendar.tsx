import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { DashboardLayout } from "@/components/layout/DashboardLayout";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";

const Calendar = () => {
  const [view, setView] = useState<"week" | "month">("month");
  const currentMonth = "April 2025";

  // Generate calendar grid for April 2025
  const daysOfWeek = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const calendarDays = [
    [null, null, 1, 2, 3, 4, 5],
    [6, 7, 8, 9, 10, 11, 12],
    [13, 14, 15, 16, 17, 18, 19],
    [20, 21, 22, 23, 24, 25, 26],
    [27, 28, 29, 30, null, null, null],
  ];

  const todayDate = 25;

  return (
    <DashboardLayout>
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">Calendar</h1>
            <p className="text-muted-foreground mt-1">
              Manage your schedule and appointments
            </p>
          </div>

          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            Add Event
          </Button>
        </div>

        {/* Calendar Controls */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Button variant="outline" size="icon" aria-label="Previous month">
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" aria-label="Next month">
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
            <h2 className="text-lg font-medium text-foreground">{currentMonth}</h2>
          </div>

          <Tabs value={view} onValueChange={(v) => setView(v as "week" | "month")}>
            <TabsList>
              <TabsTrigger value="week">Week</TabsTrigger>
              <TabsTrigger value="month">Month</TabsTrigger>
            </TabsList>
          </Tabs>
        </div>

        {/* Calendar Grid */}
        <div className="bg-card rounded-xl shadow-card overflow-hidden">
          {/* Days Header */}
          <div className="grid grid-cols-7 border-b border-border">
            {daysOfWeek.map((day) => (
              <div
                key={day}
                className="py-3 text-center text-sm font-medium text-muted-foreground"
              >
                {day}
              </div>
            ))}
          </div>

          {/* Calendar Days */}
          <div className="divide-y divide-border">
            {calendarDays.map((week, weekIndex) => (
              <div key={weekIndex} className="grid grid-cols-7">
                {week.map((day, dayIndex) => (
                  <div
                    key={dayIndex}
                    className={`min-h-[100px] p-2 border-r border-border last:border-r-0 ${
                      day === null ? "bg-secondary/30" : "hover:bg-secondary/50"
                    }`}
                  >
                    {day !== null && (
                      <span
                        className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm ${
                          day === todayDate
                            ? "bg-primary text-primary-foreground font-medium"
                            : "text-foreground"
                        }`}
                      >
                        {day}
                      </span>
                    )}

                    {/* Sample events for today */}
                    {day === todayDate && (
                      <div className="mt-1 space-y-1">
                        <div className="text-xs px-1.5 py-0.5 rounded bg-schedule-call/10 text-schedule-call truncate">
                          4:30 PM - Phone call
                        </div>
                        <div className="text-xs px-1.5 py-0.5 rounded bg-schedule-meeting/10 text-schedule-meeting truncate">
                          2:00 PM - Meeting
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      </div>
    </DashboardLayout>
  );
};

export default Calendar;
