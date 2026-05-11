-- Agent memory: chat history with pgvector embeddings + persisted facts about the user.

create extension if not exists vector;

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  conversation_id uuid not null,
  role text not null check (role in ('system', 'user', 'assistant', 'tool')),
  content text not null,
  tool_calls jsonb,            -- when role='assistant' and the model called tools
  tool_call_id text,           -- when role='tool', references assistant.tool_calls[*].id
  tool_name text,              -- mirror of the tool function name (for filtering/inspection)
  embedding vector(1536),      -- only for user / assistant text (tool messages stay null)
  created_at timestamptz default now()
);

create index idx_chat_messages_user on chat_messages(user_id, created_at desc);
create index idx_chat_messages_conversation on chat_messages(conversation_id, created_at);
-- Vector index for similarity search (HNSW, cosine distance).
-- If pgvector version doesn't support HNSW yet, replace with ivfflat (lists=100).
create index idx_chat_messages_embedding on chat_messages using hnsw (embedding vector_cosine_ops);

-- Persisted facts about the user, extracted from chat or added explicitly via tools.
create table user_context (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  key text not null,           -- e.g. "goal", "injury", "preference.swim_pace"
  value text not null,
  source text,                 -- "chat" | "manual" | "tool:<name>"
  embedding vector(1536),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  unique (user_id, key)
);

create index idx_user_context_user on user_context(user_id);
create index idx_user_context_embedding on user_context using hnsw (embedding vector_cosine_ops);

alter table chat_messages enable row level security;
alter table user_context enable row level security;

create policy "chat_messages_dev_anon_all" on chat_messages for all using (true) with check (true);
create policy "user_context_dev_anon_all" on user_context for all using (true) with check (true);
