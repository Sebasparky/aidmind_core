-- Add review_document_id column to sessions
alter table public.sessions
add column if not exists review_document_id uuid;

-- Add foreign key constraint
alter table public.sessions
add constraint sessions_review_document_id_fkey
foreign key (review_document_id)
references public.review_documents(id)
on delete set null;

-- Add index for performance
create index if not exists idx_sessions_review_document_id
on public.sessions (review_document_id);