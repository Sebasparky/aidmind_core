create table if not exists public.review_documents (
  id uuid primary key default gen_random_uuid(),

  tenant_id uuid not null,
  session_id uuid not null references public.sessions(id) on delete cascade,

  -- storage reference
  storage_bucket text not null default 'review-documents',
  storage_object_key text not null,
  original_filename text,
  mime_type text not null default 'application/pdf',
  file_size_bytes bigint,

  -- lifecycle status
  status text not null default 'uploaded'
    check (
      status in (
        'uploaded',
        'extracting',
        'extracted',
        'reviewing',
        'completed',
        'failed'
      )
    ),

  -- extracted text from the PDF
  extracted_text text,
  extraction_metadata jsonb not null default '{}'::jsonb,

  -- reviewer output
  reviewer_model text,
  review_report jsonb,
  review_metadata jsonb not null default '{}'::jsonb,

  error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);