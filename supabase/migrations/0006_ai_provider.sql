-- AI provider switch (Claude or Meta): file ids are stored per provider.
-- Run once in the Supabase SQL editor, after 0005_public_modules.sql, BEFORE deploying the code that uses it.
-- Shape: {"claude": [{"fileId": "...", "firstPage": 1, "lastPage": 80}], "meta": [...]}.
-- Long lessons are uploaded to Meta as parts of at most 100 pages (Meta reads text from the first 100 pages of a PDF).
-- anthropic_file_id is kept so older rows keep working; it is copied into ai_files below.

alter table public.documents
  add column if not exists ai_files jsonb not null default '{}'::jsonb;

update public.documents
set ai_files = jsonb_set(
  ai_files,
  '{claude}',
  jsonb_build_array(jsonb_build_object(
    'fileId', anthropic_file_id,
    'firstPage', 1,
    'lastPage', coalesce(page_count, 1)
  ))
)
where anthropic_file_id is not null
  and not (ai_files ? 'claude');
