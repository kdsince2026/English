-- =====================================================================
--  English B1 — база данных для Supabase
--  Как запустить: Supabase → SQL Editor → New query → вставить весь
--  файл → Run. Скрипт можно запускать один раз на новом проекте.
-- =====================================================================

-- ▼▼▼ ЕДИНСТВЕННОЕ, ЧТО НУЖНО ПРОВЕРИТЬ: email, с которым вы зарегистрируетесь как учитель
create table if not exists public.app_config (
  id boolean primary key default true check (id),
  teacher_email text not null
);
insert into public.app_config (teacher_email)
values (lower('dicenkokristina@gmail.com'))
on conflict (id) do update set teacher_email = excluded.teacher_email;
-- ▲▲▲

-- ---------- Профили ----------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  role text not null check (role in ('teacher','student')),
  created_at timestamptz not null default now()
);
-- учитель может быть только один
create unique index if not exists profiles_one_teacher on public.profiles ((role)) where role = 'teacher';

create table if not exists public.invites (
  code text primary key,
  created_at timestamptz not null default now(),
  used_by uuid references public.profiles(id) on delete set null,
  used_at timestamptz
);

-- ---------- Вспомогательные функции ----------
create or replace function public.is_teacher() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'teacher');
$$;

create or replace function public.is_teacher_id(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = uid and role = 'teacher');
$$;

create or replace function public.teacher_exists() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where role = 'teacher');
$$;

create or replace function public.check_invite(p_code text) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.invites where code = upper(trim(p_code)) and used_by is null);
$$;

-- ---------- Регистрация: учитель по email, ученики только по коду ----------
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_code text := upper(trim(coalesce(new.raw_user_meta_data->>'invite_code', '')));
  v_name text := coalesce(nullif(trim(new.raw_user_meta_data->>'name'), ''), split_part(new.email, '@', 1));
  v_teacher_email text;
begin
  select teacher_email into v_teacher_email from public.app_config limit 1;

  if lower(new.email) = v_teacher_email and not exists (select 1 from public.profiles where role = 'teacher') then
    insert into public.profiles (id, name, role) values (new.id, v_name, 'teacher');
    return new;
  end if;

  insert into public.profiles (id, name, role) values (new.id, v_name, 'student');
  update public.invites set used_by = new.id, used_at = now()
   where code = v_code and used_by is null;
  if not found then
    raise exception 'INVALID_INVITE';
  end if;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- Уроки ----------
create table if not exists public.lessons (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  starts_at timestamptz not null,
  topic text not null default '',
  call_link text not null default '',
  created_at timestamptz not null default now()
);

-- ---------- Слова ----------
create table if not exists public.folders (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.words (
  id uuid primary key default gen_random_uuid(),
  folder_id uuid not null references public.folders(id) on delete cascade,
  en text not null,
  ru text not null default '',
  example text not null default '',
  added_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.word_progress (
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  word_id uuid not null references public.words(id) on delete cascade,
  status text not null default 'new' check (status in ('new','learning','learned')),
  streak int not null default 0,
  due_at timestamptz not null default now(),
  learned_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (user_id, word_id)
);

create table if not exists public.review_log (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  word_id uuid references public.words(id) on delete cascade,
  result text not null,
  created_at timestamptz not null default now()
);

-- ---------- Домашка ----------
create table if not exists public.homework (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles(id) on delete cascade,
  lesson_label text not null default '',
  title text not null,
  description text not null default '',
  due_date date,
  status text not null default 'todo' check (status in ('todo','done','checked')),
  teacher_comment text not null default '',
  grade text not null default '',
  created_at timestamptz not null default now(),
  done_at timestamptz,
  checked_at timestamptz
);

create table if not exists public.homework_files (
  id uuid primary key default gen_random_uuid(),
  homework_id uuid not null references public.homework(id) on delete cascade,
  kind text not null check (kind in ('task','answer')),
  path text not null,
  name text not null,
  size bigint not null default 0,
  uploaded_by uuid default auth.uid() references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

-- ученица может менять только статус todo/done у своей домашки
create or replace function public.guard_homework_update() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if public.is_teacher() then
    return new;
  end if;
  if new.status not in ('todo','done') or old.status = 'checked'
     or new.title is distinct from old.title
     or new.description is distinct from old.description
     or new.due_date is distinct from old.due_date
     or new.student_id is distinct from old.student_id
     or new.teacher_comment is distinct from old.teacher_comment
     or new.grade is distinct from old.grade
     or new.lesson_label is distinct from old.lesson_label then
    raise exception 'NOT_ALLOWED';
  end if;
  new.done_at := case when new.status = 'done' then now() else null end;
  return new;
end $$;

drop trigger if exists homework_guard on public.homework;
create trigger homework_guard before update on public.homework
  for each row execute function public.guard_homework_update();

-- ---------- Материалы ----------
create table if not exists public.materials (
  id uuid primary key default gen_random_uuid(),
  group_name text not null,
  title text not null,
  note text not null default '',
  url text not null default '',
  file_path text not null default '',
  file_name text not null default '',
  added_by uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now()
);

-- ---------- Оценки навыков и комментарий учителя ----------
create table if not exists public.student_notes (
  student_id uuid primary key references public.profiles(id) on delete cascade,
  skills jsonb not null default '{"Словарный запас":5,"Говорение":5,"Грамматика":5,"Аудирование":5}',
  note text not null default '',
  updated_at timestamptz not null default now()
);

-- =====================================================================
--  Права доступа (Row Level Security)
-- =====================================================================
alter table public.app_config     enable row level security;
alter table public.profiles       enable row level security;
alter table public.invites        enable row level security;
alter table public.lessons        enable row level security;
alter table public.folders        enable row level security;
alter table public.words          enable row level security;
alter table public.word_progress  enable row level security;
alter table public.review_log     enable row level security;
alter table public.homework       enable row level security;
alter table public.homework_files enable row level security;
alter table public.materials      enable row level security;
alter table public.student_notes  enable row level security;

-- профили: каждый видит себя и учителя; учитель видит всех и может менять имена
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or role = 'teacher' or public.is_teacher());
create policy profiles_update on public.profiles for update to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

-- коды приглашений — только учитель
create policy invites_all on public.invites for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

-- уроки: ученица видит свои, учитель — всё
create policy lessons_select on public.lessons for select to authenticated
  using (student_id = auth.uid() or public.is_teacher());
create policy lessons_write on public.lessons for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

-- папки: топики учителя видят все; папки ученицы — она и учитель
create policy folders_select on public.folders for select to authenticated
  using (owner_id = auth.uid() or public.is_teacher() or public.is_teacher_id(owner_id));
create policy folders_insert on public.folders for insert to authenticated
  with check (owner_id = auth.uid());
create policy folders_update on public.folders for update to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy folders_delete on public.folders for delete to authenticated
  using (owner_id = auth.uid());

-- слова: видны, если видна папка; добавляет только владелец папки
create policy words_select on public.words for select to authenticated
  using (exists (select 1 from public.folders f where f.id = folder_id));
create policy words_insert on public.words for insert to authenticated
  with check (exists (select 1 from public.folders f where f.id = folder_id and f.owner_id = auth.uid()));
create policy words_update on public.words for update to authenticated
  using (exists (select 1 from public.folders f where f.id = folder_id and f.owner_id = auth.uid()));
create policy words_delete on public.words for delete to authenticated
  using (exists (select 1 from public.folders f where f.id = folder_id and f.owner_id = auth.uid()));

-- прогресс по словам: свой; учитель читает всех
create policy wp_select on public.word_progress for select to authenticated
  using (user_id = auth.uid() or public.is_teacher());
create policy wp_write on public.word_progress for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy rl_select on public.review_log for select to authenticated
  using (user_id = auth.uid() or public.is_teacher());
create policy rl_insert on public.review_log for insert to authenticated
  with check (user_id = auth.uid());

-- домашка
create policy hw_select on public.homework for select to authenticated
  using (student_id = auth.uid() or public.is_teacher());
create policy hw_insert on public.homework for insert to authenticated
  with check (public.is_teacher());
create policy hw_update on public.homework for update to authenticated
  using (student_id = auth.uid() or public.is_teacher());
create policy hw_delete on public.homework for delete to authenticated
  using (public.is_teacher());

create policy hwf_select on public.homework_files for select to authenticated
  using (exists (select 1 from public.homework h where h.id = homework_id));
create policy hwf_insert on public.homework_files for insert to authenticated
  with check (
    (kind = 'task' and public.is_teacher())
    or (kind = 'answer' and exists (select 1 from public.homework h where h.id = homework_id and h.student_id = auth.uid() and h.status <> 'checked'))
  );
create policy hwf_delete on public.homework_files for delete to authenticated
  using (uploaded_by = auth.uid() or public.is_teacher());

-- материалы: от учителя видят все; от ученицы — она и учитель
create policy mat_select on public.materials for select to authenticated
  using (added_by = auth.uid() or public.is_teacher() or public.is_teacher_id(added_by));
create policy mat_insert on public.materials for insert to authenticated
  with check (added_by = auth.uid());
create policy mat_delete on public.materials for delete to authenticated
  using (added_by = auth.uid() or public.is_teacher());

-- оценки навыков
create policy notes_select on public.student_notes for select to authenticated
  using (student_id = auth.uid() or public.is_teacher());
create policy notes_write on public.student_notes for all to authenticated
  using (public.is_teacher()) with check (public.is_teacher());

grant execute on function public.teacher_exists() to anon, authenticated;
grant execute on function public.check_invite(text) to anon, authenticated;

-- =====================================================================
--  Хранилище файлов (фото, PDF, DOCX) — приватное, только для вошедших
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit)
values ('files', 'files', false, 20971520)
on conflict (id) do nothing;

create policy files_read on storage.objects for select to authenticated
  using (bucket_id = 'files');
create policy files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'files');
create policy files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'files' and (owner = auth.uid() or public.is_teacher()));
