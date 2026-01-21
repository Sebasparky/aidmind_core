/**
 * Platform Providers (CBO Directory) Page
 * 
 * CBO directory with responsiveness stats. Read-only, no real contact functionality.
 */

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { MOCK_CBOS, MOCK_REFERRALS } from "@/lib/platform/mock-data";
import { CBO } from "@/lib/platform/types";
import { cn } from "@/lib/utils";
import {
  Search,
  Building2,
  Clock,
  Phone,
  Mail,
  MapPin,
  ArrowLeftRight,
  Info,
} from "lucide-react";

export function PlatformProviders() {
  const [search, setSearch] = useState("");
  const [selectedCBO, setSelectedCBO] = useState<CBO | null>(null);

  // Filter CBOs
  const filteredCBOs = MOCK_CBOS.filter((cbo) =>
    search === "" ||
    cbo.name.toLowerCase().includes(search.toLowerCase()) ||
    cbo.serviceCategories.some((cat) => cat.toLowerCase().includes(search.toLowerCase()))
  );

  // Get referrals for selected CBO
  const cboReferrals = selectedCBO
    ? MOCK_REFERRALS.filter((r) => r.cboId === selectedCBO.id)
    : [];

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search providers..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        
        <Badge variant="secondary" className="text-xs">
          {filteredCBOs.length} providers
        </Badge>
      </div>

      {/* CBOs Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>CBO Name</TableHead>
              <TableHead>Service Categories</TableHead>
              <TableHead>
                <Tooltip>
                  <TooltipTrigger className="flex items-center gap-1">
                    Avg Ack Time
                    <Info className="h-3 w-3 text-muted-foreground" />
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs">Average time to acknowledge referrals</p>
                  </TooltipContent>
                </Tooltip>
              </TableHead>
              <TableHead>Last 30d Referrals</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCBOs.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-32 text-center">
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Building2 className="h-8 w-8" />
                    <p>No providers match the search</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              filteredCBOs.map((cbo) => (
                <TableRow
                  key={cbo.id}
                  className="cursor-pointer hover:bg-muted/50"
                  onClick={() => setSelectedCBO(cbo)}
                >
                  <TableCell className="font-medium">{cbo.name}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {cbo.serviceCategories.map((cat) => (
                        <Badge key={cat} variant="outline" className="text-xs">
                          {cat}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Clock className="h-3 w-3 text-muted-foreground" />
                      <span className="text-sm">{cbo.avgAcknowledgeTime}</span>
                    </div>
                  </TableCell>
                  <TableCell className="text-sm">{cbo.last30dReferrals}</TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </Card>

      {/* CBO Detail Panel */}
      <Sheet open={!!selectedCBO} onOpenChange={() => setSelectedCBO(null)}>
        <SheetContent className="w-full sm:max-w-xl">
          {selectedCBO && (
            <>
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  {selectedCBO.name}
                </SheetTitle>
              </SheetHeader>

              <div className="mt-6 space-y-6">
                {/* Service Categories */}
                <div>
                  <h4 className="text-sm font-medium mb-2">Service Categories</h4>
                  <div className="flex flex-wrap gap-2">
                    {selectedCBO.serviceCategories.map((cat) => (
                      <Badge key={cat} variant="secondary">
                        {cat}
                      </Badge>
                    ))}
                  </div>
                </div>

                {/* Responsiveness Stats */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium">Responsiveness</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Clock className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Avg Acknowledge Time</span>
                      </div>
                      <span className="font-medium">{selectedCBO.avgAcknowledgeTime}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
                        <span className="text-sm text-muted-foreground">Referrals (30 days)</span>
                      </div>
                      <span className="font-medium">{selectedCBO.last30dReferrals}</span>
                    </div>
                  </CardContent>
                </Card>

                {/* Contact Methods (Mock) */}
                <Card className="border-dashed">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm font-medium flex items-center gap-2">
                      Contact Methods
                      <Badge variant="outline" className="text-xs">Mock Data</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex items-center gap-3 text-sm">
                      <Mail className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">{selectedCBO.contactEmail}</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <Phone className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">{selectedCBO.contactPhone}</span>
                    </div>
                    <div className="flex items-center gap-3 text-sm">
                      <MapPin className="h-4 w-4 text-muted-foreground" />
                      <span className="text-muted-foreground">{selectedCBO.address}</span>
                    </div>
                    <p className="text-xs text-muted-foreground italic mt-2">
                      Contact functionality is disabled in this prototype
                    </p>
                  </CardContent>
                </Card>

                {/* Recent Referrals */}
                <div>
                  <h4 className="text-sm font-medium mb-3">Recent Referrals</h4>
                  <ScrollArea className="h-48">
                    {cboReferrals.length === 0 ? (
                      <div className="text-center py-8 text-muted-foreground">
                        <ArrowLeftRight className="h-6 w-6 mx-auto mb-2" />
                        <p className="text-sm">No recent referrals</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {cboReferrals.map((ref) => (
                          <div key={ref.id} className="flex items-center justify-between p-3 rounded-lg border">
                            <div>
                              <p className="font-mono text-sm">{ref.referralId}</p>
                              <p className="text-xs text-muted-foreground">{ref.serviceType}</p>
                            </div>
                            <Badge
                              variant="outline"
                              className={cn(
                                ref.state === "completed" && "bg-[hsl(var(--badge-success-bg))] text-[hsl(var(--badge-success-text))]",
                                ref.state === "stalled" && "bg-destructive text-destructive-foreground"
                              )}
                            >
                              {ref.state.replace(/_/g, " ")}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </div>
              </div>
            </>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
