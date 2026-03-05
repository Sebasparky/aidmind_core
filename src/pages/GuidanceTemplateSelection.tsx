import { useState, useRef, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Upload,
  FileText,
  Check,
  X,
  ChevronDown,
  Loader2,
  AlertCircle,
  Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

// ── Mock data ────────────────────────────────────────────────
const MOCK_TEMPLATES = [
  {
    id: "tpl-001",
    name: "Child Welfare Assessment – Initial Intake",
    lastUsed: "2026-02-28",
    jurisdiction: "State of Illinois",
  },
  {
    id: "tpl-002",
    name: "Housing Assistance Application – HUD Section 8",
    lastUsed: "2026-02-15",
    jurisdiction: "Federal",
  },
  {
    id: "tpl-003",
    name: "Mental Health Screening – Adult Services",
    lastUsed: "2026-01-22",
    jurisdiction: "Cook County",
  },
  {
    id: "tpl-004",
    name: "SNAP Benefits Recertification Form",
    lastUsed: "2026-03-01",
    jurisdiction: "State of Illinois",
  },
];

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

interface SelectedTemplate {
  id: string;
  name: string;
  source: "existing" | "upload";
  file?: File;
  objectUrl?: string;
  jurisdiction?: string;
}

export default function GuidanceTemplateSelection() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();

  const [selectedTemplate, setSelectedTemplate] = useState<SelectedTemplate | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Cleanup objectURL on unmount
  useEffect(() => {
    return () => {
      if (selectedTemplate?.objectUrl) {
        URL.revokeObjectURL(selectedTemplate.objectUrl);
      }
    };
  }, [selectedTemplate?.objectUrl]);

  // ── File handling ──────────────────────────────────────────
  const validateAndSetFile = useCallback((file: File) => {
    setFileError(null);

    if (file.type !== "application/pdf") {
      setFileError("Please upload a PDF file.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setFileError("File exceeds 20 MB limit.");
      return;
    }

    // Revoke old URL
    if (selectedTemplate?.objectUrl) {
      URL.revokeObjectURL(selectedTemplate.objectUrl);
    }

    const objectUrl = URL.createObjectURL(file);
    setSelectedTemplate({
      id: crypto.randomUUID(),
      name: file.name.replace(/\.pdf$/i, ""),
      source: "upload",
      file,
      objectUrl,
    });
  }, [selectedTemplate?.objectUrl]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) validateAndSetFile(file);
    // Reset so same file can be re-selected
    e.target.value = "";
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files[0];
    if (file) validateAndSetFile(file);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => setIsDragging(false);

  const handleExistingSelect = (templateId: string) => {
    const tpl = MOCK_TEMPLATES.find((t) => t.id === templateId);
    if (!tpl) return;

    // Clear previous upload URL
    if (selectedTemplate?.objectUrl) {
      URL.revokeObjectURL(selectedTemplate.objectUrl);
    }

    setSelectedTemplate({
      id: tpl.id,
      name: tpl.name,
      source: "existing",
      jurisdiction: tpl.jurisdiction,
    });
    setFileError(null);
  };

  const handleRemove = () => {
    if (selectedTemplate?.objectUrl) {
      URL.revokeObjectURL(selectedTemplate.objectUrl);
    }
    setSelectedTemplate(null);
    setFileError(null);
  };

  const handleReplace = () => {
    fileInputRef.current?.click();
  };

  // ── Upload Template (mock) ─────────────────────────────────
  const handleUploadTemplate = async () => {
    if (!selectedTemplate) return;
    setIsUploading(true);
    // Mock: simulate 800ms
    await new Promise((r) => setTimeout(r, 800));
    setIsUploading(false);
    // Navigate to guidance page with template info
    navigate(`/guidance/${sessionId}`, {
      state: {
        templateId: selectedTemplate.id,
        templateName: selectedTemplate.name,
        templateSource: selectedTemplate.source,
      },
    });
  };

  const handleCancel = () => navigate("/dashboard");

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* ── Header ── */}
      <header className="border-b border-border bg-card shrink-0">
        <div className="container mx-auto px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <Button variant="ghost" size="icon" onClick={handleCancel}>
                <ArrowLeft className="h-5 w-5" />
              </Button>
              <div>
                <h1 className="text-xl font-semibold text-foreground">Select Template</h1>
                <p className="text-sm text-muted-foreground">
                  Choose a blank program template to generate interview questions.
                </p>
              </div>
            </div>
            {sessionId && (
              <Badge variant="outline" className="text-xs font-mono text-muted-foreground">
                Session: {sessionId.slice(0, 8)}…
              </Badge>
            )}
          </div>
        </div>
      </header>

      {/* ── Content ── */}
      <div className="flex-1 overflow-y-auto">
        <div className="container mx-auto px-6 py-6 max-w-6xl">
          {/* Trust messaging */}
          <Alert className="mb-6 border-primary/20 bg-primary/5">
            <FileText className="h-4 w-4 text-primary" />
            <AlertDescription className="text-sm text-muted-foreground">
              Templates are blank program forms — they do not contain client data.
              <strong className="block mt-1 text-foreground">
                AidMind stores template metadata only. No client content is retained.
              </strong>
            </AlertDescription>
          </Alert>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* ── Left: Template Selection ── */}
            <div className="lg:col-span-2 space-y-5">
              {/* Option 1: Recent templates */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Use a recent template</CardTitle>
                  <CardDescription>
                    Select a previously used template from your organization.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Select
                    value={selectedTemplate?.source === "existing" ? selectedTemplate.id : ""}
                    onValueChange={handleExistingSelect}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Choose a template…" />
                    </SelectTrigger>
                    <SelectContent>
                      {MOCK_TEMPLATES.map((tpl) => (
                        <SelectItem key={tpl.id} value={tpl.id}>
                          <div className="flex flex-col items-start">
                            <span className="text-sm">{tpl.name}</span>
                            <span className="text-xs text-muted-foreground">
                              {tpl.jurisdiction} · Last used {tpl.lastUsed}
                            </span>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </CardContent>
              </Card>

              {/* Divider */}
              <div className="flex items-center gap-3">
                <Separator className="flex-1" />
                <span className="text-xs text-muted-foreground uppercase tracking-wider">or</span>
                <Separator className="flex-1" />
              </div>

              {/* Option 2: Upload new template */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Upload a new template (PDF)</CardTitle>
                  <CardDescription>
                    Upload a blank program form. Max 20 MB.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Hidden file input */}
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="application/pdf"
                    className="hidden"
                    onChange={handleFileChange}
                  />

                  {/* Drop zone */}
                  {(!selectedTemplate || selectedTemplate.source !== "upload") && (
                    <div
                      role="button"
                      tabIndex={0}
                      className={cn(
                        "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
                        "hover:border-primary/50 hover:bg-primary/5",
                        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                        isDragging && "border-primary bg-primary/10",
                        fileError && "border-destructive/50"
                      )}
                      onClick={() => fileInputRef.current?.click()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          fileInputRef.current?.click();
                        }
                      }}
                      onDrop={handleDrop}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                    >
                      <Upload className="h-8 w-8 mx-auto text-muted-foreground/40 mb-3" />
                      <p className="text-sm text-muted-foreground mb-1">
                        Drag & drop a PDF here, or{" "}
                        <span className="text-primary font-medium">browse your computer</span>
                      </p>
                      <p className="text-xs text-muted-foreground">PDF only · Max 20 MB</p>
                    </div>
                  )}

                  {/* File error */}
                  {fileError && (
                    <div className="flex items-center gap-2 text-destructive text-sm">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span>{fileError}</span>
                    </div>
                  )}

                  {/* Uploaded file info */}
                  {selectedTemplate?.source === "upload" && selectedTemplate.file && (
                    <div className="border rounded-lg p-4 bg-accent/30 space-y-2">
                      <div className="flex items-start justify-between">
                        <div className="flex items-start gap-3 min-w-0">
                          <FileText className="h-5 w-5 text-primary mt-0.5 shrink-0" />
                          <div className="min-w-0">
                            <p className="text-sm font-medium text-foreground truncate">
                              {selectedTemplate.file.name}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {formatFileSize(selectedTemplate.file.size)}
                            </p>
                          </div>
                        </div>
                        <Badge variant="secondary" className="text-xs shrink-0">
                          Ready
                        </Badge>
                      </div>
                      <div className="flex gap-2">
                        <Button variant="outline" size="sm" onClick={handleReplace} className="text-xs">
                          Replace
                        </Button>
                        <Button variant="ghost" size="sm" onClick={handleRemove} className="text-xs text-destructive hover:text-destructive">
                          <X className="h-3.5 w-3.5 mr-1" />
                          Remove
                        </Button>
                      </div>
                    </div>
                  )}

                  <p className="text-[11px] text-muted-foreground">
                    Templates are blank forms — not filled client documents.
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* ── Right: Preview Panel ── */}
            <div className="lg:col-span-3">
              {!selectedTemplate ? (
                <Card className="border-dashed h-full min-h-[400px]">
                  <CardContent className="flex flex-col items-center justify-center h-full py-16">
                    <Eye className="h-10 w-10 text-muted-foreground/20 mb-4" />
                    <p className="text-sm text-muted-foreground text-center">
                      Select or upload a template to preview it here.
                    </p>
                  </CardContent>
                </Card>
              ) : selectedTemplate.source === "upload" && selectedTemplate.objectUrl ? (
                <Card className="h-full min-h-[500px] flex flex-col overflow-hidden">
                  <CardHeader className="pb-2 shrink-0">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium truncate">
                        {selectedTemplate.name}
                      </CardTitle>
                      <Badge variant="outline" className="text-xs shrink-0">PDF Preview</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 p-0">
                    <iframe
                      src={selectedTemplate.objectUrl}
                      title="Template preview"
                      className="w-full h-full min-h-[450px] border-t border-border"
                    />
                  </CardContent>
                </Card>
              ) : (
                <Card className="h-full min-h-[400px] flex flex-col">
                  <CardHeader className="pb-2 shrink-0">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-medium truncate">
                        {selectedTemplate.name}
                      </CardTitle>
                      <Badge variant="outline" className="text-xs shrink-0">Selected</Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="flex-1 flex flex-col items-center justify-center">
                    <div className="text-center space-y-4 max-w-sm">
                      <FileText className="h-12 w-12 mx-auto text-muted-foreground/20" />
                      <div>
                        <p className="text-sm text-muted-foreground">
                          Preview unavailable in mock mode
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Preview will be available when connected to the backend.
                        </p>
                      </div>

                      <Separator />

                      <div className="text-left space-y-2">
                        <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wider">Template</p>
                          <p className="text-sm font-medium text-foreground">{selectedTemplate.name}</p>
                        </div>
                        {selectedTemplate.jurisdiction && (
                          <div>
                            <p className="text-xs text-muted-foreground uppercase tracking-wider">Jurisdiction</p>
                            <p className="text-sm font-medium text-foreground">{selectedTemplate.jurisdiction}</p>
                          </div>
                        )}
                      </div>

                      {/* Readiness checklist */}
                      <Separator />
                      <div className="text-left space-y-1.5">
                        <div className="flex items-center gap-2">
                          <Check className="h-3.5 w-3.5 text-green-600" />
                          <span className="text-xs text-foreground">Template selected</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Check className="h-3.5 w-3.5 text-green-600" />
                          <span className="text-xs text-foreground">Ready to proceed</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ── Bottom Action Bar ── */}
      <div className="border-t border-border bg-card shrink-0">
        <div className="container mx-auto px-6 py-3 max-w-6xl flex items-center justify-between">
          <Button variant="outline" onClick={handleCancel}>
            Cancel
          </Button>
          <Button
            onClick={handleUploadTemplate}
            disabled={!selectedTemplate || isUploading}
          >
            {isUploading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Uploading…
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Upload Template
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
