/** Types for KB bulk upload queue */

export interface UploadTask {
  localId: string;
  file: File;
  status: "queued" | "uploading" | "uploaded" | "failed";
  kbDocumentId?: string;
  jobId?: number;
  error?: string;
}

export interface KbIngestionMetadata {
  ingestion: {
    status: string;
    original_filename: string;
    byte_size: number;
    mime_type: string;
    queued_at?: string;
    job_id?: number;
    error?: string;
  };
}
