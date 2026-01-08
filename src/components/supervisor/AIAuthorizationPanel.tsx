/**
 * Generative AI Authorization Panel
 * 
 * Allows supervisors to approve/revoke generative AI usage (chat/reasoning models)
 * for the organization. This does NOT apply to transcription or redaction,
 * which are non-generative processing steps.
 */

import { useAuth } from "@/contexts/AuthContext";
import { useAIAuthorization } from "@/hooks/useAIAuthorization";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShieldCheck, ShieldAlert, ShieldOff, Loader2, Info } from "lucide-react";
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
            <CardTitle className="text-lg">Generative AI Authorization</CardTitle>
            <CardDescription>
              Controls whether chat-based AI reasoning is permitted
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
              This organization has authorized generative AI (chat/reasoning models).
            </p>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              <span>Approved: {format(new Date(approval.approved_at), "PPpp")}</span>
              <span>Policy: {approval.approval_policy_id}</span>
            </div>
            <Button variant="outline" size="sm" onClick={handleRevoke} className="mt-2">
              Revoke Generative AI Authorization
            </Button>
          </div>
        )}

        {!loading && status === "missing" && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              Generative AI has not been authorized. Caseworkers cannot use chat-based AI features.
            </p>
            <Button onClick={handleApprove} size="sm" className="gap-2">
              <ShieldCheck className="h-4 w-4" />
              Authorize Generative AI
            </Button>
          </div>
        )}

        {!loading && status === "revoked" && (
          <div className="space-y-2">
            <p className="text-sm text-destructive">
              Generative AI authorization was revoked. Chat-based AI features are blocked.
            </p>
            <Button onClick={handleApprove} size="sm" className="gap-2">
              <ShieldCheck className="h-4 w-4" />
              Re-Authorize Generative AI
            </Button>
          </div>
        )}

        {/* Scope clarification note */}
        <div className="flex items-start gap-2 pt-3 border-t text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <p>
            This does not apply to transcription or redaction, which are non-generative 
            processing steps that operate independently.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
