/**
 * Platform Documents Page
 * 
 * Document tracker with retention labels. Read-only, no document content displayed.
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MOCK_DOCUMENTS } from "@/lib/platform/mock-data";
import { PlatformDocument, DocumentStatus } from "@/lib/platform/types";
import { formatDistanceToNow, format } from "date-fns";
import { cn } from "@/lib/utils";
import {
  Search,
  FileText,
  Clock,
  Info,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";

const STATUS_STYLES: Record<DocumentStatus, { bg: string; text: string; icon: typeof Clock }> = {
  requested: { 
    bg: "bg-[hsl(var(--badge-info-bg))]", 
    text: "text-[hsl(var(--badge-info-text))]",
    icon: Clock 
  },
  received: { 
    bg: "bg-[hsl(var(--badge-success-bg))]", 
    text: "text-[hsl(var(--badge-success-text))]",
    icon: CheckCircle2 
  },
  overdue: { 
    bg: "bg-destructive", 
    text: "text-destructive-foreground",
    icon: AlertTriangle 
  },
};

export function PlatformDocuments() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedDocument, setSelectedDocument] = useState<PlatformDocument | null>(null);

  // Filter documents
  const filteredDocuments = MOCK_DOCUMENTS.filter((doc) => {
    if (statusFilter !== "all" && doc.status !== statusFilter) return false;
    if (search && !doc.documentId.toLowerCase().includes(search.toLowerCase()) && 
        !doc.type.toLowerCase().includes(search.toLowerCase()) &&
        !doc.caseId.toLowerCase().includes(search.toLowerCase())) {
      return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search documents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>

        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-36">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="requested">Requested</SelectItem>
            <SelectItem value="received">Received</SelectItem>
            <SelectItem value="overdue">Overdue</SelectItem>
          </SelectContent>
        </Select>

        <Badge variant="secondary" className="text-xs">
          {filteredDocuments.length} documents
        </Badge>
      </div>

      {/* Documents Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Document ID</TableHead>
              <TableHead>Case ID</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Requested</TableHead>
              <TableHead>Due Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>
                <Tooltip>
                  <TooltipTrigger className="flex items-center gap-1">
                    Retention
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Document content retention policy</p>
                  </TooltipContent>
                </Tooltip>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredDocuments.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="h-32 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <FileText className="h-8 w-8" />
                    <p>No documents match the current filters</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredDocuments.map((doc) => {
                const StatusIcon = STATUS_STYLES[doc.status].icon;
                return (
                  <TableRow
                    key={doc.id}
                    className="cursor-pointer hover:bg-muted/50"
                    onClick={() => setSelectedDocument(doc)}
                  >
                    <TableCell className="font-mono text-sm">{doc.documentId}</TableCell>
                    <TableCell className="font-mono text-sm text-muted-foreground">{doc.caseId}</TableCell>
                    <TableCell>{doc.type}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {formatDistanceToNow(new Date(doc.requestedAt), { addSuffix: true })}
                    </TableCell>
                    <TableCell className="text-sm">
                      {format(new Date(doc.dueDate), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={cn(STATUS_STYLES[doc.status].bg, STATUS_STYLES[doc.status].text, "gap-1")}
                      >
                        <StatusIcon className="h-3 w-3" />
                        {doc.status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {doc.retention === "ephemeral" ? "Ephemeral" : "Configured"}
                      </Badge>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </Card>

      {/* Document Detail Panel */}
      <Sheet open={!!selectedDocument} onOpenChange={() => setSelectedDocument(null)}>
        <SheetContent className="w-full sm:max-w-md">
          {selectedDocument && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <FileText className="h-5 w-5" />
                  {selectedDocument.documentId}
                </SheetTitle>
                <p className="text-sm text-muted-foreground">{selectedDocument.type}</p>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                {/* Metadata */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Metadata</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Case ID</span>
                      <span className="font-mono text-sm">{selectedDocument.caseId}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Requested</span>
                      <span className="text-sm">{format(new Date(selectedDocument.requestedAt), "MMM d, yyyy")}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Due Date</span>
                      <span className="text-sm">{format(new Date(selectedDocument.dueDate), "MMM d, yyyy")}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-muted-foreground">Status</span>
                      <Badge
                        variant="outline"
                        className={cn(
                          STATUS_STYLES[selectedDocument.status].bg,
                          STATUS_STYLES[selectedDocument.status].text
                        )}
                      >
                        {selectedDocument.status}
                      </Badge>
                    </div>
                    {selectedDocument.receivedAt && (
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-muted-foreground">Received</span>
                        <span className="text-sm">{format(new Date(selectedDocument.receivedAt), "MMM d, yyyy")}</span>
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Retention Policy */}
                <Card className="border-dashed">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      <Info className="h-4 w-4" />
                      Retention Policy
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2">
                      <Badge variant="outline">
                        {selectedDocument.retention === "ephemeral" ? "Ephemeral" : "Program Configured"}
                      </Badge>
                      <p className="text-sm text-muted-foreground">
                        {selectedDocument.retention === "ephemeral"
                          ? "Document content expires automatically. Audit metadata is retained."
                          : "Retention configured by program policy. Content may be retained longer."}
                      </p>
                    </div>
                  </CardContent>
                </Card>

                {/* No Content Warning */}
                <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 border border-border">
                  <Info className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <p className="text-xs text-muted-foreground">
                    Document content is not displayed in this interface. Only metadata is shown to protect client privacy.
                  </p>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
