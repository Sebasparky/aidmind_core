"""
KB Ingestion Worker — PDF text extraction via PyMuPDF with continuation support.

Runs as a Google Cloud Run Job. Processes queued rows in kb_ingestion_jobs,
downloads PDFs from Supabase Storage, extracts native text in page-range chunks,
updates kb_documents.content and metadata.ingestion, and marks jobs succeeded/failed.

After full extraction completes, triggers the ingest-kb-text edge function to
chunk, embed, and index the document into document_chunks for vector retrieval.

For documents exceeding MAX_PAGES, the worker automatically enqueues continuation
jobs to process the next page range until all pages are extracted.

Environment variables:
  SUPABASE_URL              (required)
  SUPABASE_SERVICE_ROLE_KEY (required)
  SUPABASE_STORAGE_BUCKET   default "kb-documents"
  MAX_JOBS_PER_RUN          default 10
  SLEEP_NO_JOB_SECONDS      default 0
  WORKER_ID                 default hostname
  DRY_RUN                   default false
"""

from __future__ import annotations

import json as json_module
import logging
import os
import socket
import sys
import time
from datetime import datetime, timezone
from urllib.parse import urljoin

import fitz  # PyMuPDF
import requests
from supabase import create_client, Client

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
KB_INGEST_SECRET = os.environ.get("KB_INGEST_SECRET", "")
STORAGE_BUCKET = os.environ.get("SUPABASE_STORAGE_BUCKET", "kb-documents")
MAX_JOBS_PER_RUN = int(os.environ.get("MAX_JOBS_PER_RUN", "10"))
SLEEP_NO_JOB_SECONDS = int(os.environ.get("SLEEP_NO_JOB_SECONDS", "0"))
WORKER_ID = os.environ.get("WORKER_ID", socket.gethostname())
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() in ("true", "1", "yes")

# Hard limits
MAX_PDF_BYTES = 150 * 1024 * 1024  # 150 MB
MAX_PAGES = 1000  # pages per chunk/job
MAX_SECONDS_PER_DOC = 600  # 10 minutes per chunk
MIN_PAGE_CHARS = 30
TEXT_QUALITY_THRESHOLD = 0.70
MAX_TOTAL_CHUNKS_PER_DOC = 20  # prevent infinite continuation spam

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    stream=sys.stdout,
)
log = logging.getLogger("kb_extractor")

# ---------------------------------------------------------------------------
# Supabase client (service role — bypasses RLS)
# ---------------------------------------------------------------------------

sb: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _merge_ingestion_metadata(
    existing_metadata: dict, ingestion_update: dict
) -> dict:
    """Deep-merge ingestion_update into metadata.ingestion without clobbering
    other top-level keys or existing ingestion fields like original_filename."""
    meta = dict(existing_metadata) if existing_metadata else {}
    ingestion = dict(meta.get("ingestion", {}))
    ingestion.update(ingestion_update)
    meta["ingestion"] = ingestion
    return meta


def claim_job() -> dict | None:
    """Atomically claim the next queued job via the claim_next_kb_job RPC."""
    resp = sb.rpc("claim_next_kb_job", {"p_worker_id": WORKER_ID}).execute()
    rows = resp.data
    if not rows:
        return None
    return rows[0] if isinstance(rows, list) else rows


def complete_job(job_id: int, status: str, error: str | None = None) -> None:
    """Mark a job as succeeded or failed."""
    sb.rpc(
        "complete_kb_job",
        {"p_job_id": job_id, "p_status": status, "p_error": error},
    ).execute()


def fetch_document(doc_id: str) -> dict:
    """Fetch a kb_documents row by id."""
    resp = (
        sb.table("kb_documents")
        .select("id, tenant_id, file_path, metadata, content")
        .eq("id", doc_id)
        .single()
        .execute()
    )
    return resp.data


def update_document(doc_id: str, updates: dict) -> None:
    """Patch a kb_documents row."""
    sb.table("kb_documents").update(updates).eq("id", doc_id).execute()


def append_document_content(doc_id: str, chunk_text: str) -> None:
    """Append text to kb_documents.content server-side (no download)."""
    sb.rpc(
        "append_kb_document_content",
        {"p_doc_id": doc_id, "p_chunk": chunk_text},
    ).execute()


def enqueue_continuation(
    doc_id: str, tenant_id: str, start_page: int, end_page: int, priority: int = 50
) -> int | None:
    """Enqueue the next continuation job via RPC. Returns job id."""
    resp = sb.rpc(
        "enqueue_kb_continuation_job",
        {
            "p_kb_document_id": doc_id,
            "p_tenant_id": tenant_id,
            "p_start_page": start_page,
            "p_end_page": end_page,
            "p_priority": priority,
        },
    ).execute()
    return resp.data


def download_pdf(file_path: str) -> bytes:
    """Download a file from Supabase Storage and return raw bytes."""
    return sb.storage.from_(STORAGE_BUCKET).download(file_path)


# ---------------------------------------------------------------------------
# Indexing — call ingest-kb-text edge function
# ---------------------------------------------------------------------------

INGEST_MAX_RETRIES = 3
INGEST_TIMEOUT_SECONDS = 120  # Shorter per-batch — each invocation processes ≤20 chunks
INGEST_MAX_BATCHES = 200  # Safety cap: max continuation loops for one document


def _call_ingest_once(
    url: str,
    headers: dict,
    body_dict: dict,
) -> dict:
    """Single HTTP call to ingest-kb-text with retries on transient failures.

    Returns parsed JSON response body on 200+success.
    Raises RuntimeError on permanent failure.
    """
    body = json_module.dumps(body_dict)
    last_error: str | None = None

    for attempt in range(1, INGEST_MAX_RETRIES + 1):
        try:
            log.info(
                "ingest-kb-text attempt=%d/%d doc=%s",
                attempt, INGEST_MAX_RETRIES, body_dict.get("document_id"),
            )
            resp = requests.post(
                url,
                data=body,
                headers=headers,
                timeout=INGEST_TIMEOUT_SECONDS,
            )

            try:
                resp_body = resp.json()
            except Exception:
                resp_body = {"raw": resp.text[:500]}

            if resp.status_code == 200 and resp_body.get("success"):
                return resp_body

            # Non-retryable client errors
            if 400 <= resp.status_code < 500 and resp.status_code != 429:
                raise RuntimeError(
                    f"ingest-kb-text returned {resp.status_code}: "
                    f"{resp_body.get('error', resp.text[:300])}"
                )

            last_error = (
                f"ingest-kb-text HTTP {resp.status_code}: "
                f"{resp_body.get('error', resp.text[:300])}"
            )
            log.warning("ingest-kb-text attempt %d failed: %s", attempt, last_error)

        except requests.exceptions.Timeout:
            last_error = f"ingest-kb-text timeout after {INGEST_TIMEOUT_SECONDS}s"
            log.warning("ingest-kb-text attempt %d: %s", attempt, last_error)
        except RuntimeError:
            raise
        except Exception as exc:
            last_error = f"ingest-kb-text request error: {exc}"
            log.warning("ingest-kb-text attempt %d: %s", attempt, last_error)

        if attempt < INGEST_MAX_RETRIES:
            time.sleep(2 * attempt)  # simple backoff

    raise RuntimeError(last_error or "ingest-kb-text failed after retries")


def trigger_ingest_kb_text(doc_id: str, extracted_text: str) -> dict:
    """Call the ingest-kb-text edge function to chunk, embed, and index.

    The edge function now processes chunks in bounded batches and returns
    more_work=true when additional invocations are needed. This function
    loops until all batches are complete or a failure occurs.

    Uses service-role key for auth.
    Returns the final parsed JSON response body on success.
    Raises RuntimeError on permanent failure.
    """
    url = urljoin(SUPABASE_URL + "/", "functions/v1/ingest-kb-text")

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}",
        "apikey": SUPABASE_SERVICE_ROLE_KEY,
        "X-AIDMIND-INGEST-SECRET": KB_INGEST_SECRET,
    }

    # First call sends the full extracted_text + overwrite flag
    body_dict: dict = {
        "document_id": doc_id,
        "extracted_text": extracted_text,
        "overwrite": True,
    }

    for batch_num in range(1, INGEST_MAX_BATCHES + 1):
        log.info(
            "ingest-kb-text batch=%d doc=%s chars=%d",
            batch_num, doc_id, len(extracted_text) if batch_num == 1 else 0,
        )

        result = _call_ingest_once(url, headers, body_dict)

        more_work = result.get("more_work", False)
        status = result.get("status", "unknown")
        indexed = result.get("indexed_chunk_count", "?")
        total = result.get("chunk_count", "?")

        log.info(
            "ingest-kb-text batch=%d doc=%s status=%s progress=%s/%s more_work=%s",
            batch_num, doc_id, status, indexed, total, more_work,
        )

        if not more_work:
            log.info("ingest-kb-text COMPLETE doc=%s chunks=%s", doc_id, total)
            return result

        # Subsequent calls: no need to re-send extracted_text (stored in DB).
        # The edge function reads from kb_documents.content on resume.
        body_dict = {
            "document_id": doc_id,
        }

    raise RuntimeError(
        f"ingest-kb-text exceeded max batches ({INGEST_MAX_BATCHES}) for doc={doc_id}"
    )


# ---------------------------------------------------------------------------
# Extraction (page range)
# ---------------------------------------------------------------------------

def extract_text_range(
    pdf_bytes: bytes,
    start_page: int,
    end_page: int | None,
) -> dict:
    """Extract native text from pages [start_page, end_page) of a PDF.

    Returns a dict with keys: text, original_page_count, page_count,
    hit_max_pages, hit_timeout, char_count, non_empty_pages,
    text_quality_score, native_pages, status, error, actual_end_page.
    """
    start_time = time.monotonic()

    byte_len = len(pdf_bytes)
    if byte_len > MAX_PDF_BYTES:
        return {
            "text": "",
            "original_page_count": 0,
            "page_count": 0,
            "actual_end_page": start_page,
            "hit_max_pages": False,
            "hit_timeout": False,
            "char_count": 0,
            "non_empty_pages": 0,
            "text_quality_score": 0.0,
            "native_pages": 0,
            "status": "needs_review",
            "error": f"PDF too large: {byte_len} bytes (max {MAX_PDF_BYTES})",
        }

    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:
        return {
            "text": "",
            "original_page_count": 0,
            "page_count": 0,
            "actual_end_page": start_page,
            "hit_max_pages": False,
            "hit_timeout": False,
            "char_count": 0,
            "non_empty_pages": 0,
            "text_quality_score": 0.0,
            "native_pages": 0,
            "status": "needs_review",
            "error": f"Failed to open PDF: {exc}",
        }

    original_page_count = len(doc)

    # Compute effective end_page
    if end_page is None:
        end_page = min(start_page + MAX_PAGES, original_page_count)
    end_page = min(end_page, original_page_count)

    hit_max_pages = (end_page - start_page) >= MAX_PAGES and end_page < original_page_count

    parts: list[str] = []
    non_empty_pages = 0
    native_pages = 0
    hit_timeout = False

    for i in range(start_page, end_page):
        elapsed = time.monotonic() - start_time
        if elapsed > MAX_SECONDS_PER_DOC:
            hit_timeout = True
            end_page = i  # update to actual stop point
            break

        try:
            page_text = doc[i].get_text("text")
        except Exception:
            page_text = ""

        # Use absolute page numbers (1-based) for citation traceability
        parts.append(f"--- Page {i + 1} ---\n{page_text}")

        stripped = page_text.strip()
        if len(stripped) >= MIN_PAGE_CHARS:
            non_empty_pages += 1
            native_pages += 1

    doc.close()

    page_count = len(parts)
    full_text = "\n\n".join(parts)
    char_count = len(full_text)
    quality = non_empty_pages / page_count if page_count else 0.0

    # Determine chunk-level status and errors
    errors: list[str] = []
    needs_review = False

    if hit_timeout:
        needs_review = True
        errors.append(
            f"Hit MAX_SECONDS_PER_DOC cap ({MAX_SECONDS_PER_DOC}s). "
            f"Extracted {page_count} pages in this chunk."
        )

    if page_count == 0 or char_count == 0:
        needs_review = True
    elif quality < TEXT_QUALITY_THRESHOLD:
        needs_review = True

    status = "needs_review" if needs_review else "ok"
    error = " ".join(errors) if errors else None

    return {
        "text": full_text,
        "original_page_count": original_page_count,
        "page_count": page_count,
        "actual_end_page": end_page,
        "hit_max_pages": hit_max_pages,
        "hit_timeout": hit_timeout,
        "char_count": char_count,
        "non_empty_pages": non_empty_pages,
        "text_quality_score": round(quality, 4),
        "native_pages": native_pages,
        "status": status,
        "error": error,
    }


# ---------------------------------------------------------------------------
# Process one job
# ---------------------------------------------------------------------------

def process_job(job: dict) -> None:
    job_id = job["id"]
    doc_id = job["kb_document_id"]
    tenant_id = job["tenant_id"]
    start_page = job.get("start_page", 0)
    end_page = job.get("end_page")  # may be None for initial jobs
    job_priority = job.get("priority", 50)

    log.info(
        "Processing job=%s doc=%s tenant=%s pages=[%s, %s)",
        job_id, doc_id, tenant_id, start_page, end_page,
    )

    # 1. Fetch document
    try:
        doc_row = fetch_document(doc_id)
    except Exception as exc:
        log.error("Failed to fetch document %s: %s", doc_id, exc)
        complete_job(job_id, "failed", f"Document fetch failed: {exc}")
        return

    file_path = doc_row.get("file_path")
    if not file_path:
        msg = "file_path is null on kb_documents row"
        log.error("job=%s: %s", job_id, msg)
        _fail_document(doc_id, doc_row, job_id, msg)
        complete_job(job_id, "failed", msg)
        return

    existing_meta = doc_row.get("metadata") or {}
    existing_ingestion = existing_meta.get("ingestion", {})
    completed_ranges: list[str] = list(existing_ingestion.get("completed_ranges", []))

    # 2. Idempotency check — skip if this range was already processed
    range_key_preview = f"{start_page}-{end_page}" if end_page is not None else None
    if range_key_preview and range_key_preview in completed_ranges:
        log.info(
            "job=%s range %s already completed, skipping (idempotent)",
            job_id, range_key_preview,
        )
        complete_job(job_id, "succeeded", None)
        return

    # 3. Mark document as extracting
    extracting_meta = _merge_ingestion_metadata(existing_meta, {
        "status": "extracting",
        "job_id": job_id,
        "started_at": _now_iso(),
        "file_path": file_path,
    })
    update_document(doc_id, {"metadata": extracting_meta})

    # 4. Download PDF
    try:
        pdf_bytes = download_pdf(file_path)
    except Exception as exc:
        msg = f"Storage download failed: {exc}"
        log.error("job=%s: %s", job_id, msg)
        _fail_document(doc_id, doc_row, job_id, msg)
        complete_job(job_id, "failed", msg)
        return

    if not pdf_bytes:
        msg = "Downloaded 0 bytes from storage"
        log.error("job=%s: %s", job_id, msg)
        _fail_document(doc_id, doc_row, job_id, msg)
        complete_job(job_id, "failed", msg)
        return

    log.info("job=%s downloaded %d bytes", job_id, len(pdf_bytes))

    # 5. Extract text for this page range
    result = extract_text_range(pdf_bytes, start_page, end_page)
    actual_end = result["actual_end_page"]
    original_page_count = result["original_page_count"]

    # Build definitive range key using actual end
    range_key = f"{start_page}-{actual_end}"

    log.info(
        "job=%s original_pages=%d chunk_pages=%d [%d,%d) chars=%d "
        "non_empty=%d quality=%.2f hit_timeout=%s status=%s",
        job_id, original_page_count, result["page_count"],
        start_page, actual_end, result["char_count"],
        result["non_empty_pages"], result["text_quality_score"],
        result["hit_timeout"], result["status"],
    )

    # Second idempotency check with actual range
    if range_key in completed_ranges:
        log.info("job=%s range %s already completed (post-extract), skipping", job_id, range_key)
        complete_job(job_id, "succeeded", None)
        return

    # 6. Write content
    is_first_chunk = start_page == 0

    if not DRY_RUN:
        if is_first_chunk:
            # Overwrite content for the first chunk
            update_document(doc_id, {"content": result["text"]})
        else:
            # Append with continuation marker
            marker = (
                f"\n\n===== CONTINUATION (pages {start_page + 1}-{actual_end}) =====\n\n"
            )
            append_document_content(doc_id, marker + result["text"])
    else:
        log.info("job=%s DRY_RUN — skipping content write", job_id)

    # 7. Update metadata
    completed_ranges.append(range_key)
    chunks_completed = len(completed_ranges)
    processed_pages_total = actual_end  # pages 0..actual_end are done

    # Determine overall document status
    more_pages = actual_end < original_page_count
    chunk_needs_review = result["status"] == "needs_review"
    too_many_chunks = chunks_completed >= MAX_TOTAL_CHUNKS_PER_DOC and more_pages

    # Extraction-level status (before indexing)
    if chunk_needs_review:
        doc_status = "needs_review"
    elif too_many_chunks:
        doc_status = "needs_review"
    elif more_pages:
        doc_status = "extracting"
    else:
        doc_status = "extracted"  # fully extracted, pending indexing

    finished_at = _now_iso()
    ingestion_update: dict = {
        "status": doc_status,
        "job_id": job_id,
        "finished_at": finished_at,
        "original_page_count": original_page_count,
        "page_count": result["page_count"],
        "processed_pages_total": processed_pages_total,
        "next_start_page": actual_end if more_pages else None,
        "hit_max_pages": more_pages,
        "hit_timeout": result["hit_timeout"],
        "char_count": result["char_count"],
        "non_empty_pages": result["non_empty_pages"],
        "text_quality_score": result["text_quality_score"],
        "native_pages": result["native_pages"],
        "ocr_pages": 0,
        "chunks_completed": chunks_completed,
        "completed_ranges": completed_ranges,
        "last_chunk": {
            "start_page": start_page,
            "end_page": actual_end,
            "pages_extracted": result["page_count"],
            "char_count": result["char_count"],
            "job_id": job_id,
            "finished_at": finished_at,
        },
        "error": result["error"],
        "file_path": file_path,
    }

    if too_many_chunks:
        ingestion_update["error"] = (
            f"Too many continuation chunks ({chunks_completed}); "
            f"manual intervention required. Processed {processed_pages_total}/{original_page_count} pages."
        )

    # Re-fetch metadata to merge safely
    fresh_doc = fetch_document(doc_id)
    fresh_meta = fresh_doc.get("metadata") or {}
    final_meta = _merge_ingestion_metadata(fresh_meta, ingestion_update)
    update_document(doc_id, {"metadata": final_meta})

    # 8. Enqueue continuation if needed
    if more_pages and not chunk_needs_review and not too_many_chunks:
        next_start = actual_end
        next_end = min(next_start + MAX_PAGES, original_page_count)
        log.info(
            "job=%s enqueueing continuation [%d, %d) for doc=%s",
            job_id, next_start, next_end, doc_id,
        )
        enqueue_continuation(doc_id, tenant_id, next_start, next_end, job_priority)

    # 9. Trigger indexing if extraction is fully complete
    if doc_status == "extracted" and not DRY_RUN:
        log.info("job=%s extraction complete, triggering indexing for doc=%s", job_id, doc_id)

        # Re-fetch the final full document content
        final_doc = fetch_document(doc_id)
        final_text = (final_doc.get("content") or "").strip()

        if not final_text:
            indexing_error = "Extraction produced empty content, skipping indexing"
            log.warning("job=%s %s", job_id, indexing_error)
            _update_ingestion_fields(doc_id, {
                "status": "indexing_failed",
                "indexing_error": indexing_error,
                "indexing_failed_at": _now_iso(),
            })
            complete_job(job_id, "failed", f"Indexing skipped: {indexing_error}")
            log.info("job=%s completed status=failed (empty content) doc_status=indexing_failed", job_id)
            return
        else:
            _update_ingestion_status(doc_id, "indexing")
            try:
                ingest_result = trigger_ingest_kb_text(doc_id, final_text)
                log.info(
                    "job=%s indexing complete doc=%s chunk_count=%s",
                    job_id, doc_id, ingest_result.get("chunk_count"),
                )
                # Update to final ready status — clear any stale failure fields
                _update_ingestion_fields(doc_id, {
                    "status": "ready",
                    "indexing_completed_at": _now_iso(),
                    "indexed_chunk_count": ingest_result.get("chunk_count"),
                    "indexing_error": None,
                    "indexing_failed_at": None,
                })
            except RuntimeError as exc:
                indexing_error = str(exc)
                log.error("job=%s indexing failed doc=%s: %s", job_id, doc_id, indexing_error)
                _update_ingestion_fields(doc_id, {
                    "status": "indexing_failed",
                    "indexing_error": indexing_error,
                    "indexing_failed_at": _now_iso(),
                    "indexing_completed_at": None,
                    "indexed_chunk_count": None,
                })
                complete_job(job_id, "failed", f"Indexing failed: {indexing_error}")
                log.info("job=%s completed status=failed (indexing) doc_status=indexing_failed", job_id)
                return

    # 10. Complete job
    complete_job(job_id, "succeeded", result.get("error"))
    log.info("job=%s completed status=succeeded doc_status=%s", job_id, doc_status)


def _fail_document(doc_id: str, doc_row: dict, job_id: int, error: str) -> None:
    """Mark a document's ingestion status as failed."""
    existing_meta = doc_row.get("metadata") or {}
    failed_meta = _merge_ingestion_metadata(existing_meta, {
        "status": "failed",
        "job_id": job_id,
        "finished_at": _now_iso(),
        "error": error,
    })
    update_document(doc_id, {"metadata": failed_meta})


def _update_ingestion_status(doc_id: str, status: str, error: str | None = None) -> None:
    """Quick helper to update only ingestion.status (and optionally error)."""
    doc_row = fetch_document(doc_id)
    fields: dict = {"status": status}
    if error:
        fields["indexing_error"] = error
    meta = _merge_ingestion_metadata(doc_row.get("metadata") or {}, fields)
    update_document(doc_id, {"metadata": meta})


def _update_ingestion_fields(doc_id: str, fields: dict) -> None:
    """Merge arbitrary fields into metadata.ingestion."""
    doc_row = fetch_document(doc_id)
    meta = _merge_ingestion_metadata(doc_row.get("metadata") or {}, fields)
    update_document(doc_id, {"metadata": meta})


# ---------------------------------------------------------------------------
# Main loop
# ---------------------------------------------------------------------------

def main() -> None:
    log.info(
        "KB Extractor starting worker_id=%s max_jobs=%d dry_run=%s",
        WORKER_ID,
        MAX_JOBS_PER_RUN,
        DRY_RUN,
    )

    processed = 0
    while processed < MAX_JOBS_PER_RUN:
        job = claim_job()
        if job is None:
            log.info("No queued jobs found. Exiting.")
            # Explicit signal for the service drain loop to detect "no work"
            print("NO_JOBS_AVAILABLE=true", flush=True)
            if SLEEP_NO_JOB_SECONDS > 0:
                time.sleep(SLEEP_NO_JOB_SECONDS)
            break

        try:
            process_job(job)
        except Exception as exc:
            log.exception("Unhandled error processing job=%s: %s", job["id"], exc)
            try:
                complete_job(job["id"], "failed", f"Unhandled: {exc}")
            except Exception:
                log.exception("Failed to mark job %s as failed", job["id"])

        processed += 1

    log.info("KB Extractor finished. Processed %d jobs.", processed)


if __name__ == "__main__":
    main()