-- ============================================================
-- مخطط قاعدة المعرفة (مرجعي)
-- ============================================================
-- هذا الملف مرجع لتوثيق الشكل المتوقع لجدول المقاطع ودالة الاسترجاع.
-- لا تشغّله فوق قاعدة قائمة قبل مقارنة التعريف الحالي، لأن
-- `create or replace function` قد يستبدل نسخة الإنتاج.
--
-- المتطلبات: امتداد pgvector.
-- ============================================================

create extension if not exists vector;
create extension if not exists pg_trgm;

create table if not exists public.knowledge_chunks (
  id bigint generated always as identity primary key,
  book text not null,
  chapter text,
  page integer,
  content text not null,
  embedding vector(1536),
  created_at timestamptz not null default now()
);

create index if not exists knowledge_chunks_embedding_idx
  on public.knowledge_chunks using ivfflat (embedding vector_cosine_ops)
  with (lists = 100);

create index if not exists knowledge_chunks_text_idx
  on public.knowledge_chunks using gin (to_tsvector('simple', content));

-- مثال لدالة استرجاع هجينة: كلماتي + متجهي. عدّلها لتطابق بياناتك.
create or replace function public.match_knowledge_chunks(
  p_query_embedding vector(1536),
  p_query_text text,
  p_match_count integer default 6
)
returns table (
  id bigint,
  book text,
  chapter text,
  page integer,
  content text,
  score double precision
)
language sql
stable
as $$
  with lexical as (
    select
      k.id,
      k.book,
      k.chapter,
      k.page,
      k.content,
      word_similarity(p_query_text, k.content)::double precision as text_score,
      case
        when p_query_embedding is null then 0
        else 1 - (k.embedding <=> p_query_embedding)
      end as vector_score
    from public.knowledge_chunks k
    where p_query_text is null
       or word_similarity(p_query_text, k.content) > 0.05
       or p_query_embedding is not null
  )
  select
    id,
    book,
    chapter,
    page,
    content,
    (0.6 * text_score + 0.4 * vector_score)::double precision as score
  from lexical
  order by score desc
  limit greatest(1, least(coalesce(p_match_count, 6), 20));
$$;

revoke all on function public.match_knowledge_chunks(vector, text, integer)
  from public, anon, authenticated;
grant execute on function public.match_knowledge_chunks(vector, text, integer)
  to service_role;
