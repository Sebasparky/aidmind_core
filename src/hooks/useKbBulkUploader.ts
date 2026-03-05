/**
 * useKbBulkUploader — Client-side concurrent upload queue for KB PDFs.
 *
 * Accepts File[], runs at most MAX_CONCURRENT uploads, updates task state.
 */

import { useState, useRef, useCallback } from "react";
import type { UploadTask } from "@/lib/kb/types";
import {
  createKbDocument,
  uploadPdfToStorage,
  updateDocFilePath,
  createIngestionJob,
  stampJobId,
  markDocFailed,
} from "@/lib/kb/kbUploadService";

const MAX_CONCURRENT_UPLOADS = 4;

export function useKbBulkUploader(tenantId: string | null) {
  const [tasks, setTasks] = useState<UploadTask[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const cancelledRef = useRef(false);
  const activeRef = useRef(0);

  const updateTask = useCallback(
    (localId: string, patch: Partial<UploadTask>) => {
      setTasks((prev) =>
        prev.map((t) => (t.localId === localId ? { ...t, ...patch } : t))
      );
    },
    []
  );

  /** Process a single file through the full pipeline */
  const processOne = useCallback(
    async (task: UploadTask) => {
      if (!tenantId) {
        updateTask(task.localId, { status: "failed", error: "No tenant" });
        return;
      }

      updateTask(task.localId, { status: "uploading" });
      let docId: string | undefined;

      try {
        // Step 1: create kb_documents row
        docId = await createKbDocument(tenantId, task.file);
        console.log(`[bulk-upload] Doc created: ${docId} for ${task.file.name}`);
        updateTask(task.localId, { kbDocumentId: docId });

        // Step 2: upload to storage
        const storagePath = await uploadPdfToStorage(tenantId, docId, task.file);
        console.log(`[bulk-upload] Uploaded: ${storagePath}`);

        // Step 3: update file_path + set status queued
        await updateDocFilePath(docId, storagePath);

        // Step 4: create ingestion job
        const jobId = await createIngestionJob(tenantId, docId);
        console.log(`[bulk-upload] Job created: ${jobId}`);

        // Step 5: stamp job_id into metadata
        await stampJobId(docId, jobId);

        updateTask(task.localId, { status: "uploaded", jobId });
      } catch (err: any) {
        const msg = err?.message || "Unknown error";
        console.error(`[bulk-upload] Failed ${task.file.name}:`, msg);
        updateTask(task.localId, { status: "failed", error: msg });

        if (docId) {
          await markDocFailed(docId, msg);
        }
      }
    },
    [tenantId, updateTask]
  );

  /** Start processing all queued tasks with concurrency limit */
  const start = useCallback(
    async (taskList: UploadTask[]) => {
      setIsRunning(true);
      cancelledRef.current = false;
      activeRef.current = 0;

      let idx = 0;

      const runNext = async (): Promise<void> => {
        while (idx < taskList.length && !cancelledRef.current) {
          const current = taskList[idx];
          idx++;
          activeRef.current++;
          await processOne(current);
          activeRef.current--;
        }
      };

      // Launch MAX_CONCURRENT workers
      const workers = Array.from(
        { length: Math.min(MAX_CONCURRENT_UPLOADS, taskList.length) },
        () => runNext()
      );

      await Promise.all(workers);
      setIsRunning(false);
    },
    [processOne]
  );

  /** Enqueue files and start */
  const enqueueFiles = useCallback(
    (files: File[]) => {
      const newTasks: UploadTask[] = files.map((file, i) => ({
        localId: `${Date.now()}-${i}`,
        file,
        status: "queued" as const,
      }));
      setTasks(newTasks);
      start(newTasks);
    },
    [start]
  );

  const cancel = useCallback(() => {
    cancelledRef.current = true;
  }, []);

  const stats = {
    total: tasks.length,
    uploaded: tasks.filter((t) => t.status === "uploaded").length,
    failed: tasks.filter((t) => t.status === "failed").length,
    uploading: tasks.filter((t) => t.status === "uploading").length,
    queued: tasks.filter((t) => t.status === "queued").length,
  };

  return { tasks, enqueueFiles, cancel, isRunning, stats };
}
