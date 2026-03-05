/**
 * kbUploadService — Supabase calls for KB bulk PDF upload.
 * Each function is a single atomic DB/storage operation.
 */

import { supabase } from "@/integrations/supabase/client";
import type { KbIngestionMetadata } from "./types";

const BUCKET = "kb-documents";

/**
 * Sanitize a filename for use as a Supabase Storage object key.
 * - NFKD normalize + strip diacritics
 * - Replace any char not in [A-Za-z0-9._-] with _
 * - Collapse consecutive underscores
 * - Trim to 200 chars (before extension)
 * - Guarantee .pdf extension
 */
export function sanitizeForStorageKey(name: string): string {
  // NFKD normalize and strip combining marks (diacritics)
  let s = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

  // Remove .pdf suffix so we can re-add it
  s = s.replace(/\.pdf$/i, "");

  // Replace disallowed chars
  s = s.replace(/[^A-Za-z0-9._-]/g, "_");

  // Collapse consecutive underscores
  s = s.replace(/_+/g, "_");

  // Trim leading/trailing underscores
  s = s.replace(/^_+|_+$/g, "");

  // Limit length
  if (s.length > 200) s = s.slice(0, 200);

  // Fallback if empty
  if (!s) s = "document";

  return `${s}.pdf`;
}

/** 1. Create a kb_documents row (file_path null initially) */
export async function createKbDocument(
  tenantId: string,
  file: File
): Promise<string> {
  const metadata: KbIngestionMetadata = {
    ingestion: {
      status: "uploaded",
      original_filename: file.name,
      byte_size: file.size,
      mime_type: "application/pdf",
    },
  };

  const title = file.name.replace(/\.pdf$/i, "");

  const { data, error } = await supabase
    .from("kb_documents")
    .insert({
      tenant_id: tenantId,
      title,
      content: "",
      source: "upload",
      metadata: metadata as any,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Create doc failed: ${error.message}`);
  return data.id;
}

/** 2. Upload PDF to storage */
export async function uploadPdfToStorage(
  tenantId: string,
  kbDocumentId: string,
  file: File
): Promise<string> {
  const storagePath = `tenants/${tenantId}/kb_documents/${kbDocumentId}/${file.name}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, file, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (error) throw new Error(`Storage upload failed: ${error.message}`);
  return storagePath;
}

/** 3. Update kb_documents with file_path and set ingestion status to queued */
export async function updateDocFilePath(
  kbDocumentId: string,
  storagePath: string
): Promise<void> {
  // Read current metadata first to merge
  const { data: current, error: readErr } = await supabase
    .from("kb_documents")
    .select("metadata")
    .eq("id", kbDocumentId)
    .single();

  if (readErr) throw new Error(`Read metadata failed: ${readErr.message}`);

  const meta = (current.metadata as any) || {};
  meta.ingestion = {
    ...meta.ingestion,
    status: "queued",
    queued_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from("kb_documents")
    .update({ file_path: storagePath, metadata: meta as any })
    .eq("id", kbDocumentId);

  if (error) throw new Error(`Update file_path failed: ${error.message}`);
}

/** 4. Insert kb_ingestion_jobs row */
export async function createIngestionJob(
  tenantId: string,
  kbDocumentId: string
): Promise<number> {
  const { data, error } = await supabase
    .from("kb_ingestion_jobs" as any)
    .insert({
      tenant_id: tenantId,
      kb_document_id: kbDocumentId,
      status: "queued",
      priority: 50,
    } as any)
    .select("id")
    .single();

  if (error) throw new Error(`Create job failed: ${error.message}`);
  return (data as any).id as number;
}

/** 5. Stamp job_id back into kb_documents metadata */
export async function stampJobId(
  kbDocumentId: string,
  jobId: number
): Promise<void> {
  const { data: current, error: readErr } = await supabase
    .from("kb_documents")
    .select("metadata")
    .eq("id", kbDocumentId)
    .single();

  if (readErr) throw new Error(`Read metadata for stamp failed: ${readErr.message}`);

  const meta = (current.metadata as any) || {};
  meta.ingestion = { ...meta.ingestion, job_id: jobId };

  const { error } = await supabase
    .from("kb_documents")
    .update({ metadata: meta as any })
    .eq("id", kbDocumentId);

  if (error) throw new Error(`Stamp job_id failed: ${error.message}`);
}

/** Mark a document as failed in metadata */
export async function markDocFailed(
  kbDocumentId: string,
  errorMessage: string
): Promise<void> {
  try {
    const { data: current } = await supabase
      .from("kb_documents")
      .select("metadata")
      .eq("id", kbDocumentId)
      .single();

    const meta = ((current?.metadata as any) || {});
    meta.ingestion = { ...meta.ingestion, status: "failed", error: errorMessage };

    await supabase
      .from("kb_documents")
      .update({ metadata: meta as any })
      .eq("id", kbDocumentId);
  } catch {
    console.error("[kbUploadService] Failed to mark doc as failed:", kbDocumentId);
  }
}
