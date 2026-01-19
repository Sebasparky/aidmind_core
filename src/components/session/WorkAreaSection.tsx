import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { FileText, StickyNote, HelpCircle } from "lucide-react";

interface TemplateFields {
  summary: string;
  presentingConcern: string;
  actionsTaken: string;
  plan: string;
}

interface WorkAreaSectionProps {
  templateFields: TemplateFields;
  onTemplateFieldChange: (field: keyof TemplateFields, value: string) => void;
  scratchpadNotes: string;
  onScratchpadChange: (value: string) => void;
}

export function WorkAreaSection({
  templateFields,
  onTemplateFieldChange,
  scratchpadNotes,
  onScratchpadChange,
}: WorkAreaSectionProps) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          Work Area
        </CardTitle>
        <CardDescription className="flex items-center gap-1">
          <HelpCircle className="h-3.5 w-3.5" />
          AidMind does not finalize your documentation. You stay in control.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="template" className="w-full">
          <TabsList className="grid w-full grid-cols-2 mb-4">
            <TabsTrigger value="template" className="flex items-center gap-2">
              <FileText className="h-4 w-4" />
              Template Preview
            </TabsTrigger>
            <TabsTrigger value="scratchpad" className="flex items-center gap-2">
              <StickyNote className="h-4 w-4" />
              Notes Scratchpad
            </TabsTrigger>
          </TabsList>

          <TabsContent value="template" className="space-y-4">
            {/* Summary */}
            <div className="space-y-2">
              <Label htmlFor="summary" className="text-sm font-medium">
                Summary
              </Label>
              <Textarea
                id="summary"
                placeholder="Brief overview of the case interaction..."
                value={templateFields.summary}
                onChange={(e) => onTemplateFieldChange("summary", e.target.value)}
                className="min-h-[80px]"
              />
            </div>

            {/* Presenting Concern */}
            <div className="space-y-2">
              <Label htmlFor="presentingConcern" className="text-sm font-medium">
                Presenting Concern
              </Label>
              <Textarea
                id="presentingConcern"
                placeholder="What issue or need brought the client to this interaction..."
                value={templateFields.presentingConcern}
                onChange={(e) => onTemplateFieldChange("presentingConcern", e.target.value)}
                className="min-h-[100px]"
              />
            </div>

            {/* Actions Taken */}
            <div className="space-y-2">
              <Label htmlFor="actionsTaken" className="text-sm font-medium">
                Actions Taken
              </Label>
              <Textarea
                id="actionsTaken"
                placeholder="Steps taken during this interaction..."
                value={templateFields.actionsTaken}
                onChange={(e) => onTemplateFieldChange("actionsTaken", e.target.value)}
                className="min-h-[100px]"
              />
            </div>

            {/* Plan */}
            <div className="space-y-2">
              <Label htmlFor="plan" className="text-sm font-medium">
                Plan
              </Label>
              <Textarea
                id="plan"
                placeholder="Next steps and follow-up actions..."
                value={templateFields.plan}
                onChange={(e) => onTemplateFieldChange("plan", e.target.value)}
                className="min-h-[100px]"
              />
            </div>
          </TabsContent>

          <TabsContent value="scratchpad">
            <Textarea
              placeholder="Use this space for quick notes, reminders, or draft ideas..."
              value={scratchpadNotes}
              onChange={(e) => onScratchpadChange(e.target.value)}
              className="min-h-[400px] font-mono text-sm"
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
