import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Upload, FileText, CheckCircle2, AlertCircle } from "lucide-react";

const PLACEHOLDER_TEMPLATES = [
  { value: "housing_intake", label: "Housing intake" },
  { value: "benefits_followup", label: "Benefits follow-up" },
  { value: "general_case_note", label: "General case note" },
];

interface SetupSectionProps {
  selectedTemplate: string;
  onTemplateChange: (value: string) => void;
  policyPackUploaded: boolean;
  onPolicyPackUpload: () => void;
}

export function SetupSection({
  selectedTemplate,
  onTemplateChange,
  policyPackUploaded,
  onPolicyPackUpload,
}: SetupSectionProps) {
  const isConfigured = selectedTemplate !== "";

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg">Setup</CardTitle>
          <Badge 
            variant={isConfigured ? "default" : "secondary"}
            className={isConfigured 
              ? "bg-green-100 text-green-800 border-green-200 dark:bg-green-950 dark:text-green-200 dark:border-green-800" 
              : "bg-muted text-muted-foreground"
            }
          >
            {isConfigured ? (
              <>
                <CheckCircle2 className="h-3 w-3 mr-1" />
                Ready
              </>
            ) : (
              <>
                <AlertCircle className="h-3 w-3 mr-1" />
                Not configured
              </>
            )}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Template Selection */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 w-32 shrink-0">
            <FileText className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Template</span>
          </div>
          <Select value={selectedTemplate} onValueChange={onTemplateChange}>
            <SelectTrigger className="flex-1">
              <SelectValue placeholder="Select a template" />
            </SelectTrigger>
            <SelectContent>
              {PLACEHOLDER_TEMPLATES.map((template) => (
                <SelectItem key={template.value} value={template.value}>
                  {template.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Policy Pack Upload */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 w-32 shrink-0">
            <Upload className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Policy Pack</span>
          </div>
          <div className="flex-1 flex items-center gap-3">
            <Button 
              variant="outline" 
              size="sm"
              onClick={onPolicyPackUpload}
              className={policyPackUploaded ? "border-green-300 text-green-700" : ""}
            >
              {policyPackUploaded ? (
                <>
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                  Uploaded
                </>
              ) : (
                <>
                  <Upload className="h-4 w-4 mr-2" />
                  Upload policy pack (PDF)
                </>
              )}
            </Button>
            <span className="text-xs text-muted-foreground">
              Used to generate questions and required fields. No PHI is stored in The Eye.
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
