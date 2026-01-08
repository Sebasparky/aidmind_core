/**
 * AI Usage Authorization Panel
 * 
 * Allows supervisors to approve/revoke AI usage for the organization.
 */

import { useAuth } from "@/contexts/AuthContext";
import { useAIAuthorization } from "@/hooks/useAIAuthorization";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, ShieldAlert, ShieldOff, Loader2 } from "lucide-react";
import { format } from "date-fns";

export function AIAuthorizationPanel() {
  const { currentUser } = useAuth();
  const { status, approval, loading, error, approve, revoke } = useAIAuthorization();

  const handleApprove = async () => {
    if (!currentUser) return;
    await approve(currentUser.id, "default_policy");
  };

  const handleRevoke = async () => {
    if (!currentUser) return;
    await revoke(currentUser.id);
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-lg">AI Usage Authorization</CardTitle>
            <CardDescription>
              Organizational approval for AI-assisted workflows
            </CardDescription>
          </div>
          {status === "approved" && (
            <Badge variant="default" className="bg-[hsl(var(--status-success))] text-white gap-1">
              <ShieldCheck className="h-3 w-3" />
              Approved
            </Badge>
          )}
          {status === "missing" && (
            <Badge variant="secondary" className="gap-1">
              <ShieldOff className="h-3 w-3" />
              Not Authorized
            </Badge>
          )}
          {status === "revoked" && (
            <Badge variant="destructive" className="gap-1">
              <ShieldAlert className="h-3 w-3" />
              Revoked
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading authorization status...
          </div>
        )}

        {error && (
          <div className="text-sm text-destructive">{error}</div>
        )}

        {!loading && status === "approved" && approval && (
          <div className="space-y-2 text-sm">
            <p className="text-muted-foreground">
              This organization has authorized AI-assisted workflows.
            </p>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>Approved: {format(new Date(approval.approved_at), "PPpp")}</span>
              <span>Policy: {approval.approval_policy_id}</span>
            </div>
            <Button variant="outline" size="sm" onClick={handleRevoke} className="mt-2">
              Revoke Authorization
            </Button>
          </div>
        )}

        {!loading && status === "missing" && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              AI usage has not been authorized. Caseworkers cannot use AI-assisted features.
            </p>
            <Button onClick={handleApprove} size="sm" className="gap-2">
              <ShieldCheck className="h-4 w-4" />
              Authorize AI Usage
            </Button>
          </div>
        )}

        {!loading && status === "revoked" && (
          <div className="space-y-2">
            <p className="text-sm text-destructive">
              AI usage authorization was revoked. AI-assisted features are blocked.
            </p>
            <Button onClick={handleApprove} size="sm" className="gap-2">
              <ShieldCheck className="h-4 w-4" />
              Re-Authorize AI Usage
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
