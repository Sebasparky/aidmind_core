/**
 * Platform Cases Page
 * 
 * Case list with read-only details. No PHI exposed.
 * Shows: Case ID, Program, Status, Active Referrals, Stalled Items, Last Event
 */

import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  MOCK_CASES,
  PROGRAMS,
  getEventsForCase,
  getReferralsForCase,
  getDocumentsForCase,
  filterCases,
} from "@/lib/platform/mock-data";
import { PlatformCase, PlatformEvent, EventSource } from "@/lib/platform/types";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Search,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileText,
  ArrowLeftRight,
  Filter,
  Briefcase,
} from "lucide-react";

const STATUS_STYLES: Record<string, { bg: string; text: string }> = {
  open: { bg: "bg-[hsl(var(--badge-success-bg))]", text: "text-[hsl(var(--badge-success-text))]" },
  pending: { bg: "bg-[hsl(var(--badge-warning-bg))]", text: "text-[hsl(var(--badge-warning-text))]" },
  closed: { bg: "bg-[hsl(var(--badge-neutral-bg))]", text: "text-[hsl(var(--badge-neutral-text))]" },
};

const SOURCE_ICONS: Record<EventSource, typeof Clock> = {
  system: Clock,
  caseworker: Briefcase,
  cbo: FileText,
  supervisor: AlertTriangle,
};

export function PlatformCases() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [programFilter, setProgramFilter] = useState<string>("all");
  const [selectedCase, setSelectedCase] = useState<PlatformCase | null>(null);
  const [isLoading] = useState(false);

  // Filter cases
  const filteredCases = useMemo(() => {
    let cases = MOCK_CASES;
    
    // Apply filters
    cases = filterCases(cases, {
      status: statusFilter !== "all" ? statusFilter : undefined,
      program: programFilter !== "all" ? programFilter : undefined,
    });

    // Apply search
    if (search) {
      cases = cases.filter((c) =>
        c.caseId.toLowerCase().includes(search.toLowerCase()) ||
        c.program.toLowerCase().includes(search.toLowerCase())
      );
    }

    return cases;
  }, [search, statusFilter, programFilter]);

  // Get case details
  const caseEvents = selectedCase ? getEventsForCase(selectedCase.caseId) : [];
  const caseReferrals = selectedCase ? getReferralsForCase(selectedCase.caseId) : [];
  const caseDocuments = selectedCase ? getDocumentsForCase(selectedCase.caseId) : [];

  return (
    <div className="space-y-4">
      {/* Filters Row */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search cases..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>

        <Select value={programFilter} onValueChange={setProgramFilter}>
          <SelectTrigger className="w-48">
            <SelectValue placeholder="Program" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Programs</SelectItem>
            {PROGRAMS.map((p) => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Badge variant="secondary" className="text-xs">
          {filteredCases.length} cases
        </Badge>
      </div>

      {/* Cases Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Case ID</TableHead>
              <TableHead>Program</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-center">Active Referrals</TableHead>
              <TableHead className="text-center">Stalled</TableHead>
              <TableHead>Last Event</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell><Skeleton className="h-4 w-28" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-20" /></TableCell>
                  <TableCell><Skeleton className="h-5 w-16" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-8 mx-auto" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-8 mx-auto" /></TableCell>
                  <TableCell><Skeleton className="h-4 w-24" /></TableCell>
                </TableRow>
              ))
            ) : filteredCases.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="h-32 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Briefcase className="h-8 w-8" />
                    <p>No cases match the current filters</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredCases.map((c) => (
                <TableRow
                  key={c.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setSelectedCase(c)}
                >
                  <TableCell className="font-mono text-sm">{c.caseId}</TableCell>
                  <TableCell>{c.program}</TableCell>
                  <TableCell>
                    <Badge
                      variant="outline"
                      className={cn(STATUS_STYLES[c.status].bg, STATUS_STYLES[c.status].text)}
                    >
                      {c.status}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">{c.activeReferrals}</TableCell>
                  <TableCell className="text-center">
                    {c.stalledItems > 0 ? (
                      <Badge variant="destructive" className="text-xs">
                        {c.stalledItems}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {formatDistanceToNow(new Date(c.lastEventAt), { addSuffix: true })}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Case Detail Drawer */}
      <Sheet open={!!selectedCase} onOpenChange={() => setSelectedCase(null)}>
        <SheetContent className="w-full sm:max-w-xl">
          {selectedCase && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-3">
                  <span className="font-mono">{selectedCase.caseId}</span>
                  <Badge
                    variant="outline"
                    className={cn(
                      STATUS_STYLES[selectedCase.status].bg,
                      STATUS_STYLES[selectedCase.status].text
                    )}
                  >
                    {selectedCase.status}
                  </Badge>
                </SheetTitle>
                <p className="text-sm text-muted-foreground">{selectedCase.program}</p>
              </SheetHeader>

              <Tabs defaultValue="timeline" className="mt-6">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="timeline">Timeline</TabsTrigger>
                  <TabsTrigger value="referrals">Referrals</TabsTrigger>
                  <TabsTrigger value="documents">Documents</TabsTrigger>
                  <TabsTrigger value="audit">Audit</TabsTrigger>
                </TabsList>

                <TabsContent value="timeline" className="mt-4">
                  <ScrollArea className="h-[60vh]">
                    <div className="space-y-3">
                      {caseEvents.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          <Clock className="h-8 w-8 mx-auto mb-2" />
                          <p>No events for this case</p>
                        </div>
                      ) : (
                        caseEvents.map((event) => {
                          const SourceIcon = SOURCE_ICONS[event.source];
                          return (
                            <div
                              key={event.id}
                              className={cn(
                                "p-3 rounded-lg border",
                                event.severity === "error" && "border-l-4 border-l-destructive",
                                event.severity === "warn" && "border-l-4 border-l-[hsl(var(--status-warning))]"
                              )}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-start gap-2">
                                  <SourceIcon className="h-4 w-4 mt-0.5 text-muted-foreground" />
                                  <div>
                                    <p className="text-sm">{event.description}</p>
                                    <div className="flex items-center gap-2 mt-1">
                                      <Badge variant="outline" className="text-xs">
                                        {event.source}
                                      </Badge>
                                      <span className="text-xs text-muted-foreground">
                                        {formatDistanceToNow(new Date(event.timestamp), { addSuffix: true })}
                                      </span>
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="referrals" className="mt-4">
                  <ScrollArea className="h-[60vh]">
                    <div className="space-y-3">
                      {caseReferrals.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          <ArrowLeftRight className="h-8 w-8 mx-auto mb-2" />
                          <p>No referrals for this case</p>
                        </div>
                      ) : (
                        caseReferrals.map((ref) => (
                          <Card key={ref.id}>
                            <CardContent className="p-4">
                              <div className="flex items-start justify-between">
                                <div>
                                  <p className="font-mono text-sm">{ref.referralId}</p>
                                  <p className="text-sm text-muted-foreground">{ref.cboName}</p>
                                  <p className="text-xs text-muted-foreground mt-1">{ref.serviceType}</p>
                                </div>
                                <div className="text-right">
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      ref.state === "stalled" && "bg-destructive text-destructive-foreground",
                                      ref.state === "completed" && "bg-[hsl(var(--badge-success-bg))] text-[hsl(var(--badge-success-text))]"
                                    )}
                                  >
                                    {ref.state.replace(/_/g, " ")}
                                  </Badge>
                                  <p className={cn(
                                    "text-xs mt-1",
                                    ref.slaStatus === "breached" && "text-destructive",
                                    ref.slaStatus === "at_risk" && "text-[hsl(var(--status-warning))]"
                                  )}>
                                    {ref.slaRemaining}
                                  </p>
                                </div>
                              </div>
                            </CardContent>
                          </Card>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="documents" className="mt-4">
                  <ScrollArea className="h-[60vh]">
                    <div className="space-y-3">
                      {caseDocuments.length === 0 ? (
                        <div className="text-center py-8 text-muted-foreground">
                          <FileText className="h-8 w-8 mx-auto mb-2" />
                          <p>No documents for this case</p>
                        </div>
                      ) : (
                        caseDocuments.map((doc) => (
                          <Card key={doc.id}>
                            <CardContent className="p-4">
                              <div className="flex items-start justify-between">
                                <div>
                                  <p className="font-mono text-sm">{doc.documentId}</p>
                                  <p className="text-sm">{doc.type}</p>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    Due: {new Date(doc.dueDate).toLocaleDateString()}
                                  </p>
                                </div>
                                <Badge
                                  variant="outline"
                                  className={cn(
                                    doc.status === "overdue" && "bg-destructive text-destructive-foreground",
                                    doc.status === "received" && "bg-[hsl(var(--badge-success-bg))] text-[hsl(var(--badge-success-text))]"
                                  )}
                                >
                                  {doc.status}
                                </Badge>
                              </div>
                            </CardContent>
                          </Card>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="audit" className="mt-4">
                  <div className="text-center py-8 text-muted-foreground">
                    <ScrollText className="h-8 w-8 mx-auto mb-2" />
                    <p>Audit log for this case</p>
                    <p className="text-xs mt-2">All events are immutable and timestamped</p>
                  </div>
                </TabsContent>
              </Tabs>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}

import { ScrollText } from "lucide-react";
