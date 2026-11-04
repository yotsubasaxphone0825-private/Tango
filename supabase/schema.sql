-- マイ単語帳：Supabase 同期用テーブル
-- Supabase の管理画面 → SQL Editor に全部貼り付けて「Run」してください（何回実行しても大丈夫です）

create table if not exists public.tango_items (
  user_id           uuid        not null default auth.uid() references auth.users (id) on delete cascade,
  store             text        not null check (store in ('decks', 'cards', 'materials')),
  id                text        not null,
  data              jsonb,
  deleted           boolean     not null default false,
  updated_at        bigint      not null,            -- 端末側で更新した時刻（ミリ秒）
  server_updated_at timestamptz not null default clock_timestamp(),  -- サーバーで書き込んだ時刻（差分取得用）
  primary key (user_id, store, id)
);

create index if not exists tango_items_user_sync_idx on public.tango_items (user_id, server_updated_at);

-- 書き込むたびにサーバー時刻を更新
create or replace function public.tango_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.server_updated_at := clock_timestamp();
  return new;
end
$$;

drop trigger if exists tango_items_touch on public.tango_items;
create trigger tango_items_touch
  before insert or update on public.tango_items
  for each row execute function public.tango_touch();

-- 自分のデータだけ読み書きできるようにする（行レベルセキュリティ）
alter table public.tango_items enable row level security;

drop policy if exists "tango select own" on public.tango_items;
drop policy if exists "tango insert own" on public.tango_items;
drop policy if exists "tango update own" on public.tango_items;
drop policy if exists "tango delete own" on public.tango_items;

create policy "tango select own" on public.tango_items for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "tango insert own" on public.tango_items for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "tango update own" on public.tango_items for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "tango delete own" on public.tango_items for delete to authenticated
  using ((select auth.uid()) = user_id);

revoke all on public.tango_items from anon;
grant select, insert, update, delete on public.tango_items to authenticated;
