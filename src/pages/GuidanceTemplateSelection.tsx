import { useState, useRef, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Upload,
  FileText,
  Check,
  X,
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
import { supabase } from "@/integrations/supabase/client";
import { usePdfTextExtractor } from "@/hooks/usePdfTextExtractor";
import { useTenant } from "@/hooks/useTenant";
import { toast } from "sonner";
import { SaveTemplateModal } from "@/components/session/SaveTemplateModal";

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

interface SelectedTemplate {
  id: string;
  name: string;
  source: "existing" | "upload";
  file?: File;
  objectUrl?: string;
  jurisdiction?: string;
  extraction_status?: string;
}

interface DbTemplate {
  id: string;
  name: string;
  version: string;
  extraction_status: string;
  created_at: string;
}

export default function GuidanceTemplateSelection() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const navigate = useNavigate();
  const { tenant } = useTenant();

  const [selectedTemplate, setSelectedTemplate] = useState<SelectedTemplate | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [scopeLabel, setScopeLabel] = useState<string | null>(null);
  const [dbTemplates, setDbTemplates] = useState<DbTemplate[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // PDF text extraction
  const { fullText, extracting, error: extractionError, extractText, clearText } = usePdfTextExtractor();

  // Fetch session scope for display
  useEffect(() => {
    if (!sessionId) return;
    supabase
      .from("sessions")
      .select("guidance_scope, guidance_scope_other")
      .eq("session_id", sessionId)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.guidance_scope) {
          setScopeLabel(
            data.guidance_scope === "other" && data.guidance_scope_other
              ? data.guidance_scope_other
              : data.guidance_scope.replace(/_/g, " ")
          );
        }
      });
  }, [sessionId]);

  // Fetch real templates from database
  useEffect(() => {
    if (!tenant?.tenantId) {
      setLoadingTemplates(false);
      return;
    }

    const fetchTemplates = async () => {
      setLoadingTemplates(true);
      const { data, error } = await supabase
        .from("kb_templates")
        .select("id, name, version, extraction_status, created_at")
        .eq("tenant_id", tenant.tenantId)
        .eq("is_active", true)
        .eq("extraction_status", "ready")
        .order("created_at", { ascending: false })
        .limit(20);

      if (error) {
        console.error("[GuidanceTemplateSelection] Failed to fetch templates:", error);
      } else {
        setDbTemplates((data as DbTemplate[]) ?? []);
      }
      setLoadingTemplates(false);
    };

    fetchTemplates();
  }, [tenant?.tenantId]);

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
    setUploadError(null);

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

    // Start client-side text extraction immediately
    clearText();
    extractText(file);
  }, [selectedTemplate?.objectUrl, extractText, clearText]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) validateAndSetFile(file);
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
    const tpl = dbTemplates.find((t) => t.id === templateId);
    if (!tpl) return;

    if (selectedTemplate?.objectUrl) {
      URL.revokeObjectURL(selectedTemplate.objectUrl);
    }

    clearText();
    setSelectedTemplate({
      id: tpl.id,
      name: tpl.name,
      source: "existing",
      extraction_status: tpl.extraction_status,
    });
    setFileError(null);
    setUploadError(null);
  };

  const handleRemove = () => {
    if (selectedTemplate?.objectUrl) {
      URL.revokeObjectURL(selectedTemplate.objectUrl);
    }
    clearText();
    setSelectedTemplate(null);
    setFileError(null);
    setUploadError(null);
  };

  const handleReplace = () => {
    fileInputRef.current?.click();
  };

  // ── Real upload handler ─────────────────────────────────
  const handleUploadTemplate = async () => {
    if (!selectedTemplate || !sessionId) return;
    setIsUploading(true);
    setUploadError(null);

    try {
      // Resolve session UUID from session_id text
      const { data: sessionRow, error: sessionErr } = await supabase
        .from("sessions")
        .select("id")
        .eq("session_id", sessionId)
        .maybeSingle();

      if (sessionErr || !sessionRow) {
        throw new Error("Could not resolve session. Please try again.");
      }

      const sessionUuid = sessionRow.id;

      if (selectedTemplate.source === "upload" && selectedTemplate.file) {
        // Upload path: send file + extracted text to select-template
        const formData = new FormData();
        formData.append("session_id", sessionUuid);
        formData.append("template_upload", selectedTemplate.file);
        formData.append("template_name", selectedTemplate.name);

        // Include extracted text if available
        if (fullText && fullText.trim().length > 0) {
          formData.append("template_content", fullText);
        }

        const projectId = import.meta.env.VITE_SUPABASE_PROJECT_ID;
        const { data: authData } = await supabase.auth.getSession();
        const accessToken = authData?.session?.access_token;

        if (!accessToken) {
          throw new Error("You must be logged in to upload templates.");
        }

        const response = await fetch(
          `https://${projectId}.supabase.co/functions/v1/select-template`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
            },
            body: formData,
          }
        );

        const result = await response.json();

        if (!response.ok || !result.success) {
          throw new Error(result.error || `Upload failed (${response.status})`);
        }

        if (result.template?.extraction_status !== "ready") {
          throw new Error("Template was uploaded but extraction failed. Please try a different file.");
        }

        toast.success("Template uploaded and ready for guidance generation.");

        navigate(`/guidance/${sessionId}`, {
          state: {
            templateId: result.template_id,
            templateName: result.template?.name,
            templateSource: "upload",
          },
        });
      } else if (selectedTemplate.source === "existing") {
        // Existing template path: JSON call
        const { data: authData } = await supabase.auth.getSession();
        const accessToken = authData?.session?.access_token;

        if (!accessToken) {
          throw new Error("You must be logged in to select templates.");
        }

        const { data, error } = await supabase.functions.invoke("select-template", {
          body: {
            session_id: sessionUuid,
            template_id: selectedTemplate.id,
          },
        });

        if (error) throw new Error(error.message || "Failed to select template");
        if (!data?.success) throw new Error(data?.error || "Failed to select template");

        toast.success("Template selected.");

        navigate(`/guidance/${sessionId}`, {
          state: {
            templateId: data.template_id,
            templateName: selectedTemplate.name,
            templateSource: "existing",
          },
        });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "An unexpected error occurred.";
      console.error("[GuidanceTemplateSelection] Upload error:", err);
      setUploadError(message);
      toast.error(message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleCancel = () => navigate("/dashboard");

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  // Determine if the confirm button should be disabled
  // For uploads: block unless extraction succeeded with meaningful text
  const uploadExtractionValid = selectedTemplate?.source === "upload"
    ? !extracting && !extractionError && !!fullText && fullText.trim().length >= 10
    : true;

  const isConfirmDisabled = !selectedTemplate || isUploading || !uploadExtractionValid;

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
            <div className="flex items-center gap-2">
              {scopeLabel && (
                <Badge variant="secondary" className="text-xs">
                  Scope: {scopeLabel}
                </Badge>
              )}
              {sessionId && (
                <Badge variant="outline" className="text-xs font-mono text-muted-foreground">
                  Session: {sessionId.slice(0, 8)}…
                </Badge>
              )}
            </div>
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

          {/* Upload error banner */}
          {uploadError && (
            <Alert variant="destructive" className="mb-6">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{uploadError}</AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
            {/* ── Left: Template Selection ── */}
            <div className="lg:col-span-2 space-y-5">
              {/* Option 1: Recent templates from DB */}
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-base">Use an existing template</CardTitle>
                  <CardDescription>
                    Select a previously uploaded template from your organization.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {loadingTemplates ? (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Loading templates…
                    </div>
                  ) : dbTemplates.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-2">
                      No templates available yet. Upload one below.
                    </p>
                  ) : (
                    <Select
                      value={selectedTemplate?.source === "existing" ? selectedTemplate.id : ""}
                      onValueChange={handleExistingSelect}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Choose a template…" />
                      </SelectTrigger>
                      <SelectContent>
                        {dbTemplates.map((tpl) => (
                          <SelectItem key={tpl.id} value={tpl.id}>
                            <div className="flex flex-col items-start">
                              <span className="text-sm">{tpl.name}</span>
                              <span className="text-xs text-muted-foreground">
                                v{tpl.version} · {new Date(tpl.created_at).toLocaleDateString()}
                              </span>
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
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
                        {extracting ? (
                          <Badge variant="secondary" className="text-xs shrink-0">
                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            Extracting text…
                          </Badge>
                        ) : extractionError ? (
                          <Badge variant="destructive" className="text-xs shrink-0">
                            Extraction failed
                          </Badge>
                        ) : fullText ? (
                          <Badge variant="secondary" className="text-xs shrink-0 bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200">
                            <Check className="h-3 w-3 mr-1" />
                            Text extracted
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs shrink-0">
                            Ready
                          </Badge>
                        )}
                      </div>

                      {/* Extraction error warning */}
                      {extractionError && (
                        <Alert variant="destructive" className="py-2">
                          <AlertCircle className="h-3.5 w-3.5" />
                          <AlertDescription className="text-xs">
                            {extractionError} Upload is blocked — text extraction is required for guidance generation. Try a different PDF.
                          </AlertDescription>
                        </Alert>
                      )}

                      {/* Warn if extracted text is too short */}
                      {!extracting && !extractionError && fullText !== null && fullText.trim().length < 10 && (
                        <Alert variant="destructive" className="py-2">
                          <AlertCircle className="h-3.5 w-3.5" />
                          <AlertDescription className="text-xs">
                            Extracted text is too short to be usable. This PDF may be image-only or empty. Try a different file.
                          </AlertDescription>
                        </Alert>
                      )}

                      {/* Extraction stats */}
                      {fullText && (
                        <p className="text-xs text-muted-foreground">
                          {fullText.length.toLocaleString()} characters extracted
                        </p>
                      )}

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
                        <p className="text-sm font-medium text-foreground">
                          {selectedTemplate.name}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          This template is ready for guidance generation.
                        </p>
                      </div>

                      <Separator />

                      <div className="text-left space-y-2">
                        <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wider">Template</p>
                          <p className="text-sm font-medium text-foreground">{selectedTemplate.name}</p>
                        </div>
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
            disabled={isConfirmDisabled}
          >
            {isUploading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {selectedTemplate?.source === "upload" ? "Uploading…" : "Selecting…"}
              </>
            ) : extracting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Extracting text…
              </>
            ) : selectedTemplate?.source === "upload" ? (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Upload Template
              </>
            ) : (
              <>
                <Check className="h-4 w-4 mr-2" />
                Select Template
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}
