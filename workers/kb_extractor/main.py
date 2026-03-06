"""
KB Ingestion Worker — PDF text extraction via PyMuPDF.

Runs as a Google Cloud Run Job. Processes queued rows in kb_ingestion_jobs,
downloads PDFs from Supabase Storage, extracts native text, updates
kb_documents.content and metadata.ingestion, and marks jobs succeeded/failed.

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

import logging
import os
import socket
import sys
import time
from datetime import datetime, timezone

import fitz  # PyMuPDF
from supabase import create_client, Client

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_SERVICE_ROLE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
STORAGE_BUCKET = os.environ.get("SUPABASE_STORAGE_BUCKET", "kb-documents")
MAX_JOBS_PER_RUN = int(os.environ.get("MAX_JOBS_PER_RUN", "10"))
SLEEP_NO_JOB_SECONDS = int(os.environ.get("SLEEP_NO_JOB_SECONDS", "0"))
WORKER_ID = os.environ.get("WORKER_ID", socket.gethostname())
DRY_RUN = os.environ.get("DRY_RUN", "false").lower() in ("true", "1", "yes")

# Hard limits
MAX_PDF_BYTES = 150 * 1024 * 1024  # 150 MB
MAX_PAGES = 1000
MAX_SECONDS_PER_DOC = 600  # 10 minutes
MIN_PAGE_CHARS = 30
TEXT_QUALITY_THRESHOLD = 0.70

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


def download_pdf(file_path: str) -> bytes:
    """Download a file from Supabase Storage and return raw bytes."""
    return sb.storage.from_(STORAGE_BUCKET).download(file_path)


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------

def extract_text(pdf_bytes: bytes, job_id: int) -> dict:
    """Extract native text from a PDF using PyMuPDF.

    Returns a dict with keys: text, page_count, original_page_count,
    hit_max_pages, hit_timeout, char_count, non_empty_pages,
    text_quality_score, native_pages, status, error.
    """
    start_time = time.monotonic()

    byte_len = len(pdf_bytes)
    if byte_len > MAX_PDF_BYTES:
        return {
            "text": "",
            "original_page_count": 0,
            "page_count": 0,
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
    hit_max_pages = original_page_count > MAX_PAGES
    pages_to_process = min(original_page_count, MAX_PAGES)

    parts: list[str] = []
    non_empty_pages = 0
    native_pages = 0
    hit_timeout = False

    for i in range(pages_to_process):
        elapsed = time.monotonic() - start_time
        if elapsed > MAX_SECONDS_PER_DOC:
            hit_timeout = True
            break

        try:
            page_text = doc[i].get_text("text")
        except Exception:
            page_text = ""

        parts.append(f"--- Page {i + 1} ---\n{page_text}")

        stripped = page_text.strip()
        if len(stripped) >= MIN_PAGE_CHARS:
            non_empty_pages += 1
            native_pages += 1

    doc.close()

    page_count = len(parts)  # pages actually processed
    full_text = "\n\n".join(parts)
    char_count = len(full_text)
    quality = non_empty_pages / page_count if page_count else 0.0

    # --- Determine status and error ---
    errors: list[str] = []

    if hit_timeout:
        errors.append(
            f"Hit MAX_SECONDS_PER_DOC cap ({MAX_SECONDS_PER_DOC}s). "
            f"Extracted {page_count}/{original_page_count} pages."
        )

    if hit_max_pages:
        errors.append(
            f"Hit MAX_PAGES cap ({MAX_PAGES}). "
            f"Extracted first {page_count} of {original_page_count} pages."
        )

    needs_review = False
    if hit_max_pages or hit_timeout:
        needs_review = True
    elif page_count == 0 or char_count == 0:
        needs_review = True
    elif quality < TEXT_QUALITY_THRESHOLD:
        needs_review = True

    status = "needs_review" if needs_review else "ready"
    error = " ".join(errors) if errors else None

    return {
        "text": full_text,
        "original_page_count": original_page_count,
        "page_count": page_count,
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

    log.info("Processing job=%s doc=%s tenant=%s", job_id, doc_id, tenant_id)

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

    # 2. Mark document as extracting
    existing_meta = doc_row.get("metadata") or {}
    extracting_meta = _merge_ingestion_metadata(existing_meta, {
        "status": "extracting",
        "job_id": job_id,
        "started_at": _now_iso(),
        "file_path": file_path,
    })
    update_document(doc_id, {"metadata": extracting_meta})

    # 3. Download PDF
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

    # 4. Extract text
    result = extract_text(pdf_bytes, job_id)

    log.info(
        "job=%s pages=%d chars=%d non_empty=%d quality=%.2f status=%s",
        job_id,
        result["page_count"],
        result["char_count"],
        result["non_empty_pages"],
        result["text_quality_score"],
        result["status"],
    )

    # 5. Update document
    finished_at = _now_iso()
    ingestion_update = {
        "status": result["status"],
        "job_id": job_id,
        "started_at": extracting_meta["ingestion"].get("started_at"),
        "finished_at": finished_at,
        "page_count": result["page_count"],
        "char_count": result["char_count"],
        "non_empty_pages": result["non_empty_pages"],
        "text_quality_score": result["text_quality_score"],
        "native_pages": result["native_pages"],
        "ocr_pages": 0,
        "error": result["error"],
        "file_path": file_path,
    }

    # Re-fetch metadata to avoid race conditions with concurrent metadata writers
    fresh_doc = fetch_document(doc_id)
    fresh_meta = fresh_doc.get("metadata") or {}
    final_meta = _merge_ingestion_metadata(fresh_meta, ingestion_update)

    doc_updates: dict = {"metadata": final_meta}

    if not DRY_RUN:
        doc_updates["content"] = result["text"]
    else:
        log.info("job=%s DRY_RUN — skipping content write", job_id)

    update_document(doc_id, doc_updates)

    # 6. Complete job
    complete_job(job_id, "succeeded", result.get("error"))
    log.info("job=%s completed status=succeeded", job_id)


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
