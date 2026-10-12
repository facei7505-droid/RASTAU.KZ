-- FAKT: схема базы данных (Supabase / PostgreSQL 15+)
-- Ключевые проверки доказательств выполняет сервер: время, расстояние, повтор фото.
-- Журнал действий неизменяемый: цепочка SHA-256, UPDATE/DELETE запрещены.
-- Порядок установки: этот файл, затем migrations/20261012_fakt_v2.sql и migrations/20261012_fakt_v3.sql.

create extension if not exists pgcrypto with schema extensions;

-- ---------- Таблицы ----------
create table if not exists public.contractors (
  id text primary key, name text not null, bin text, head text, phone text, module text
);

create table if not exists public.profiles (
  id uuid primary key references auth.users on delete cascade,
  email text, full_name text not null, role text not null check (role in ('admin','inspector','contractor')),
  position text, contractor_id text references public.contractors
);

create table if not exists public.objects (
  id text primary key, module text not null check (module in ('build','road','waste')),
  code text not null, name text not null, district text, address text,
  lat float8, lng float8, radius int default 80, path jsonb, length_km numeric,
  contractor_id text references public.contractors, contract_no text, amount numeric,
  start_date date, end_date date, status text default 'active',
  progress_claimed int default 0, progress_confirmed int default 0,
  last_report_at timestamptz, last_inspected_at timestamptz,
  pickups_per_week int, containers int, site_state text default 'ok'
);

create table if not exists public.orders (
  id text primary key, object_id text references public.objects on delete cascade,
  contractor_id text references public.contractors, kind text default 'defect',
  title text not null, defect_type text, severity text, lat float8, lng float8,
  created_at timestamptz default now(), due_at timestamptz,
  status text default 'open' check (status in ('open','submitted','accepted','rejected')),
  created_by text, before_id text, after_id text, amount numeric,
  accepted_at timestamptz, accepted_by text, reject_reason text
);

create table if not exists public.evidence (
  id text primary key, object_id text references public.objects on delete cascade,
  order_id text, contractor_id text, stage text not null,
  photo_url text, lat float8, lng float8, accuracy float8,
  device_time timestamptz, server_time timestamptz default now(),
  capture text default 'camera', simulated boolean default false,
  sha256 text, phash text, blur int, brightness int, similarity numeric, progress int,
  comment text, author_id text, author_name text,
  checks jsonb default '[]', score int, verdict text,
  review text, review_note text, reviewed_by text
);
create index if not exists evidence_object_idx on public.evidence(object_id);
create index if not exists evidence_order_idx on public.evidence(order_id);

create table if not exists public.tracks (
  id text primary key, inspector_id text, started_at timestamptz, ended_at timestamptz,
  points jsonb, km numeric
);

create table if not exists public.reports (
  id text primary key, created_at timestamptz default now(), module text, text text,
  lat float8, lng float8, object_id text, status text default 'new', photo_url text, author text default 'Житель'
);

create table if not exists public.audit (
  id bigserial primary key, at timestamptz default now(), actor text, action text,
  entity text, entity_id text, summary text, prev_hash text, hash text
);

-- ---------- Вспомогательные функции ----------
create or replace function public.fakt_role() returns text language sql stable security definer set search_path = public as
$$ select role from public.profiles where id = auth.uid() $$;

create or replace function public.fakt_contractor() returns text language sql stable security definer set search_path = public as
$$ select contractor_id from public.profiles where id = auth.uid() $$;

create or replace function public.fakt_actor() returns text language sql stable security definer set search_path = public as
$$ select coalesce((select full_name from public.profiles where id = auth.uid()), 'Житель') $$;

create or replace function public.fakt_dist(lat1 float8, lng1 float8, lat2 float8, lng2 float8) returns float8 language sql immutable as
$$ select 2 * 6371000 * asin(sqrt(power(sin(radians(lat2 - lat1) / 2), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))) $$;

create or replace function public.fakt_hamming(a text, b text) returns int language plpgsql immutable as $$
begin
  if a !~ '^[0-9a-f]{16}$' or b !~ '^[0-9a-f]{16}$' then return 64; end if;
  return bit_count(('x' || a)::bit(64) # ('x' || b)::bit(64));
end $$;

create or replace function public.fakt_fmt_dist(m float8) returns text language sql immutable as
$$ select case when m < 1000 then round(m)::text || ' м' when m < 10000 then replace(round((m / 1000)::numeric, 1)::text, '.', ',') || ' км' else round(m / 1000)::text || ' км' end $$;

-- ---------- Журнал: цепочка хэшей ----------
create or replace function public.fakt_audit_chain() returns trigger language plpgsql security definer set search_path = public, extensions as $$
declare prev text;
begin
  perform pg_advisory_xact_lock(424242);
  select hash into prev from public.audit order by id desc limit 1;
  new.at := coalesce(new.at, now());
  new.prev_hash := coalesce(prev, '');
  new.hash := encode(extensions.digest(new.prev_hash || '|' || to_char(new.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || '|' || coalesce(new.actor,'') || '|' || coalesce(new.action,'') || '|' || coalesce(new.entity,'') || '|' || coalesce(new.entity_id,'') || '|' || coalesce(new.summary,''), 'sha256'), 'hex');
  return new;
end $$;
drop trigger if exists audit_chain on public.audit;
create trigger audit_chain before insert on public.audit for each row execute function public.fakt_audit_chain();

create or replace function public.fakt_audit_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'Журнал FAKT защищён: изменение и удаление записей запрещены';
end $$;
drop trigger if exists audit_no_update on public.audit;
create trigger audit_no_update before update or delete on public.audit for each row execute function public.fakt_audit_immutable();

create or replace function public.fakt_log(p_action text, p_entity text, p_id text, p_summary text) returns void language sql security definer set search_path = public as
$$ insert into public.audit(actor, action, entity, entity_id, summary) values (public.fakt_actor(), p_action, p_entity, p_id, p_summary) $$;

create or replace function public.fakt_verify_audit() returns jsonb language plpgsql stable security definer set search_path = public, extensions as $$
declare r record; prev text := ''; h text; n int := 0;
begin
  for r in select * from public.audit order by id loop
    n := n + 1;
    if coalesce(r.prev_hash, '') <> prev then return jsonb_build_object('ok', false, 'brokenAt', r.id, 'count', n); end if;
    h := encode(extensions.digest(r.prev_hash || '|' || to_char(r.at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') || '|' || coalesce(r.actor,'') || '|' || coalesce(r.action,'') || '|' || coalesce(r.entity,'') || '|' || coalesce(r.entity_id,'') || '|' || coalesce(r.summary,''), 'sha256'), 'hex');
    if h <> r.hash then return jsonb_build_object('ok', false, 'brokenAt', r.id, 'count', n); end if;
    prev := r.hash;
  end loop;
  return jsonb_build_object('ok', true, 'count', n, 'last', prev);
end $$;

-- ---------- Проверка доказательства на сервере ----------
create or replace function public.fakt_evidence_verify() returns trigger language plpgsql security definer set search_path = public as $$
declare
  o public.objects; ord public.orders; prof public.profiles;
  checks jsonb := '[]'; pen int := 0; d float8; radius int; skew float8;
  dup record; t_lat float8; t_lng float8; use_path boolean := false;
begin
  select * into prof from public.profiles where id = auth.uid();
  if prof.id is not null then
    new.author_id := prof.id::text;
    new.author_name := prof.full_name;
    if prof.role = 'contractor' then new.contractor_id := prof.contractor_id; end if;
  end if;
  new.server_time := now();
  new.review := null; new.reviewed_by := null;
  select * into o from public.objects where id = new.object_id;
  if new.order_id is not null then select * into ord from public.orders where id = new.order_id; end if;
  if prof.role = 'contractor' and o.contractor_id is distinct from prof.contractor_id then
    raise exception 'Объект не закреплён за вашей организацией';
  end if;

  -- 1. Снято камерой
  if new.capture = 'camera' then checks := checks || jsonb_build_object('code','capture','ok',true,'label','Снято камерой внутри FAKT','penalty',0);
  else checks := checks || jsonb_build_object('code','capture','ok',false,'label','Загружено из файла, а не снято камерой','penalty',40); pen := pen + 40; end if;

  -- 2. GPS
  if new.lat is null then checks := checks || jsonb_build_object('code','gps','ok',false,'label','Нет координат GPS','penalty',50); pen := pen + 50;
  elsif new.accuracy > 100 then checks := checks || jsonb_build_object('code','gps','ok',false,'label','Низкая точность GPS: ±' || round(new.accuracy) || ' м','penalty',15); pen := pen + 15;
  else checks := checks || jsonb_build_object('code','gps','ok',true,'label','GPS точность ±' || round(coalesce(new.accuracy,0)) || ' м','penalty',0); end if;

  -- 3. Расстояние до точки работ (считает сервер)
  if new.lat is not null and o.id is not null then
    if new.stage <> 'before' and ord.id is not null and ord.lat is not null then
      t_lat := ord.lat; t_lng := ord.lng; radius := 40;
    elsif o.module = 'road' and o.path is not null then
      use_path := true; radius := 60;
    else
      t_lat := o.lat; t_lng := o.lng; radius := coalesce(o.radius, 80);
    end if;
    if new.stage = 'before' then radius := greatest(radius, 60); end if;
    if use_path then
      select min(public.fakt_dist(new.lat, new.lng, (p->>0)::float8, (p->>1)::float8)) into d from jsonb_array_elements(o.path) p;
    else
      d := public.fakt_dist(new.lat, new.lng, t_lat, t_lng);
    end if;
    if d <= radius then checks := checks || jsonb_build_object('code','distance','ok',true,'label','Снято на месте: ' || public.fakt_fmt_dist(d) || ' от точки','penalty',0);
    elsif d <= radius * 4 then checks := checks || jsonb_build_object('code','distance','ok',false,'label','Снято в ' || public.fakt_fmt_dist(d) || ' от точки (допуск ' || radius || ' м)','penalty',25); pen := pen + 25;
    else checks := checks || jsonb_build_object('code','distance','ok',false,'label','Снято в ' || public.fakt_fmt_dist(d) || ' от объекта','penalty',60); pen := pen + 60; end if;
  end if;

  -- 4. Время устройства против времени сервера
  skew := abs(extract(epoch from (now() - coalesce(new.device_time, now()))));
  if skew <= 600 then checks := checks || jsonb_build_object('code','time','ok',true,'label','Время съёмки совпадает с сервером','penalty',0);
  else checks := checks || jsonb_build_object('code','time','ok',false,'label','Часы телефона расходятся с сервером на ' || case when skew < 3600 then round(skew/60) || ' мин' when skew < 172800 then round(skew/3600) || ' ч' else round(skew/86400) || ' дн' end,'penalty',25); pen := pen + 25; end if;

  -- 5. Повтор фото (перцептивный хэш по всей базе)
  select e.server_time, ob.name, public.fakt_hamming(new.phash, e.phash) h into dup
    from public.evidence e left join public.objects ob on ob.id = e.object_id
    where e.phash is not null and e.id <> new.id and public.fakt_hamming(new.phash, e.phash) <= 6
    order by 3 limit 1;
  if dup.h is not null then checks := checks || jsonb_build_object('code','duplicate','ok',false,'label','Это фото уже сдавали: ' || coalesce(dup.name,'другой объект') || ', ' || to_char(dup.server_time, 'DD.MM.YYYY'),'penalty',70); pen := pen + 70;
  else checks := checks || jsonb_build_object('code','duplicate','ok',true,'label','Фото уникально, повторов в базе нет','penalty',0); end if;

  -- 6. Качество
  if new.blur is not null and new.blur < 40 then checks := checks || jsonb_build_object('code','quality','ok',false,'label','Фото размыто, детали не видны','penalty',10); pen := pen + 10;
  elsif new.brightness is not null and new.brightness < 35 then checks := checks || jsonb_build_object('code','quality','ok',false,'label','Слишком темно','penalty',10); pen := pen + 10;
  else checks := checks || jsonb_build_object('code','quality','ok',true,'label','Качество снимка достаточное','penalty',0); end if;

  -- 7. Сцена «до/после»
  if new.stage in ('after','pickup_after') then
    if new.similarity is null then checks := checks || jsonb_build_object('code','scene','ok',false,'label','Нет фото «до» для сравнения','penalty',5); pen := pen + 5;
    elsif new.similarity < 0.42 then checks := checks || jsonb_build_object('code','scene','ok',false,'label','Сцена не совпадает с фото «до» (' || round(new.similarity*100) || '%)','penalty',30); pen := pen + 30;
    elsif new.similarity > 0.975 then checks := checks || jsonb_build_object('code','scene','ok',false,'label','Фото «после» почти копия «до»: изменений не видно','penalty',30); pen := pen + 30;
    else checks := checks || jsonb_build_object('code','scene','ok',true,'label','Та же сцена, что на фото «до» (' || round(new.similarity*100) || '%), есть изменения','penalty',0); end if;
  end if;

  if new.simulated then checks := checks || jsonb_build_object('code','sim','ok',true,'label','Демо-режим: позиция имитирована','penalty',0,'info',true); end if;

  new.checks := checks;
  new.score := greatest(0, 100 - pen);
  new.verdict := case when new.score >= 80 then 'ok' when new.score >= 50 then 'review' else 'rejected' end;
  return new;
end $$;
drop trigger if exists evidence_verify on public.evidence;
create trigger evidence_verify before insert on public.evidence for each row execute function public.fakt_evidence_verify();

create or replace function public.fakt_evidence_apply() returns trigger language plpgsql security definer set search_path = public as $$
declare o public.objects;
begin
  select * into o from public.objects where id = new.object_id;
  if o.module = 'build' and new.stage in ('progress','inspection') then
    update public.objects set last_report_at = new.server_time,
      progress_claimed = greatest(progress_claimed, coalesce(new.progress, 0)),
      progress_confirmed = case when new.progress is not null and (new.verdict = 'ok' or new.stage = 'inspection') then greatest(progress_confirmed, new.progress) else progress_confirmed end
    where id = o.id;
  elsif o.module = 'waste' then
    if new.stage = 'pickup_after' and new.verdict <> 'rejected' then update public.objects set last_report_at = new.server_time, site_state = 'ok' where id = o.id; end if;
  elsif o.module = 'road' and new.stage in ('before','inspection') then
    update public.objects set last_inspected_at = new.server_time where id = o.id;
  end if;
  if new.order_id is not null and new.stage = 'after' then
    update public.orders set after_id = new.id, status = 'submitted', reject_reason = null where id = new.order_id;
  end if;
  if new.order_id is not null and new.stage = 'before' then
    update public.orders set before_id = new.id where id = new.order_id and before_id is null;
  end if;
  perform public.fakt_log('evidence.add', 'evidence', new.id,
    (case new.verdict when 'rejected' then 'Отклонено' when 'review' then 'На проверку' else 'Подтверждено' end) || ' (' || new.score || '/100): ' || coalesce(o.code,'') || ' ' || coalesce(o.name,''));
  return new;
end $$;
drop trigger if exists evidence_apply on public.evidence;
create trigger evidence_apply after insert on public.evidence for each row execute function public.fakt_evidence_apply();

-- Решение инспектора по отчёту (подтвердить или отклонить)
create or replace function public.fakt_review_evidence(p_id text, p_approve boolean, p_note text) returns void language plpgsql security definer set search_path = public as $$
declare e public.evidence; o public.objects;
begin
  if public.fakt_role() not in ('admin','inspector') then raise exception 'Недостаточно прав'; end if;
  update public.evidence set review = case when p_approve then 'approved' else 'declined' end, review_note = p_note, reviewed_by = public.fakt_actor() where id = p_id returning * into e;
  select * into o from public.objects where id = e.object_id;
  if p_approve and o.module = 'build' and e.progress is not null then
    update public.objects set progress_confirmed = greatest(progress_confirmed, e.progress) where id = o.id;
  end if;
  perform public.fakt_log(case when p_approve then 'evidence.approve' else 'evidence.decline' end, 'evidence', p_id,
    case when p_approve then 'Отчёт подтверждён инспектором: ' else 'Отчёт отклонён инспектором: ' end || coalesce(o.code,'') || ' ' || coalesce(p_note,''));
end $$;

-- Журналирование заявок, объектов, обращений, треков
create or replace function public.fakt_orders_log() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid()::text, new.created_by);
    perform public.fakt_log('order.create', 'order', new.id, 'Заявка подрядчику: ' || new.title);
  elsif new.status is distinct from old.status and new.status in ('accepted','rejected') then
    if new.status = 'accepted' then new.accepted_at := now(); new.accepted_by := auth.uid()::text; new.reject_reason := null; end if;
    perform public.fakt_log(case when new.status = 'accepted' then 'order.accept' else 'order.reject' end, 'order', new.id,
      case when new.status = 'accepted' then 'Работа принята: ' else 'Работа возвращена: ' end || new.title || coalesce(' — ' || new.reject_reason, ''));
  end if;
  return new;
end $$;
drop trigger if exists orders_log on public.orders;
create trigger orders_log before insert or update on public.orders for each row execute function public.fakt_orders_log();

create or replace function public.fakt_objects_log() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then perform public.fakt_log('object.create', 'object', new.id, 'Добавлен объект ' || new.code || ' ' || new.name);
  elsif auth.uid() is not null and (new.name, new.contractor_id, new.amount, new.end_date, new.status, new.site_state) is distinct from (old.name, old.contractor_id, old.amount, old.end_date, old.status, old.site_state) then
    perform public.fakt_log('object.update', 'object', new.id, 'Изменён объект ' || new.code);
  end if;
  return new;
end $$;
drop trigger if exists objects_log on public.objects;
create trigger objects_log after insert or update on public.objects for each row execute function public.fakt_objects_log();

create or replace function public.fakt_reports_log() returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.fakt_log('report.add', 'report', new.id, 'Обращение: ' || coalesce(new.text, ''));
    if new.object_id is not null then update public.objects set site_state = 'full' where id = new.object_id and module = 'waste'; end if;
  elsif new.status is distinct from old.status then
    perform public.fakt_log('report.update', 'report', new.id, 'Обращение: статус «' || new.status || '»');
  end if;
  return new;
end $$;
drop trigger if exists reports_log on public.reports;
create trigger reports_log after insert or update on public.reports for each row execute function public.fakt_reports_log();

create or replace function public.fakt_tracks_apply() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.inspector_id := coalesce(auth.uid()::text, new.inspector_id);
  update public.objects o set last_inspected_at = new.ended_at
   where o.module = 'road' and exists (
     select 1 from jsonb_array_elements(o.path) p, jsonb_array_elements(new.points) q
      where abs((p->>0)::float8 - (q->>0)::float8) < 0.0015 and abs((p->>1)::float8 - (q->>1)::float8) < 0.002);
  perform public.fakt_log('track.save', 'track', new.id, 'Объезд: ' || coalesce(new.km, 0) || ' км, ' || jsonb_array_length(new.points) || ' точек GPS');
  return new;
end $$;
drop trigger if exists tracks_apply on public.tracks;
create trigger tracks_apply before insert on public.tracks for each row execute function public.fakt_tracks_apply();

-- ---------- Права доступа (RLS) ----------
alter table public.contractors enable row level security;
alter table public.profiles enable row level security;
alter table public.objects enable row level security;
alter table public.orders enable row level security;
alter table public.evidence enable row level security;
alter table public.tracks enable row level security;
alter table public.reports enable row level security;
alter table public.audit enable row level security;

do $$ declare t text; begin
  for t in select unnest(array['contractors','profiles','objects','orders','evidence','tracks','reports','audit']) loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
  end loop;
end $$;

create policy contractors_read on public.contractors for select to authenticated using (true);
create policy contractors_write on public.contractors for insert to authenticated with check (public.fakt_role() = 'admin');
create policy contractors_update on public.contractors for update to authenticated using (public.fakt_role() = 'admin');

create policy profiles_read on public.profiles for select to authenticated using (true);

create policy objects_read on public.objects for select to authenticated
  using (public.fakt_role() in ('admin','inspector') or contractor_id = public.fakt_contractor());
create policy objects_write on public.objects for insert to authenticated with check (public.fakt_role() = 'admin');
create policy objects_update on public.objects for update to authenticated using (public.fakt_role() in ('admin','inspector'));

create policy orders_read on public.orders for select to authenticated
  using (public.fakt_role() in ('admin','inspector') or contractor_id = public.fakt_contractor());
create policy orders_write on public.orders for insert to authenticated with check (public.fakt_role() in ('admin','inspector'));
create policy orders_update on public.orders for update to authenticated using (public.fakt_role() in ('admin','inspector'));

create policy evidence_read on public.evidence for select to authenticated
  using (public.fakt_role() in ('admin','inspector') or contractor_id = public.fakt_contractor()
         or object_id in (select id from public.objects where contractor_id = public.fakt_contractor()));
create policy evidence_write on public.evidence for insert to authenticated with check (public.fakt_role() is not null);

create policy tracks_read on public.tracks for select to authenticated using (public.fakt_role() in ('admin','inspector'));
create policy tracks_write on public.tracks for insert to authenticated with check (public.fakt_role() in ('admin','inspector'));

create policy reports_read on public.reports for select to authenticated using (public.fakt_role() in ('admin','inspector'));
create policy reports_write on public.reports for insert to anon, authenticated with check (status = 'new');
create policy reports_update on public.reports for update to authenticated using (public.fakt_role() in ('admin','inspector'));

create policy audit_read on public.audit for select to authenticated using (public.fakt_role() in ('admin','inspector'));

grant usage on schema public to anon, authenticated;
grant select, insert, update on all tables in schema public to authenticated;
grant insert on public.reports to anon;
grant usage, select on all sequences in schema public to authenticated;
revoke update, delete on public.audit from authenticated, anon;
revoke insert on public.audit from authenticated, anon;
grant execute on function public.fakt_verify_audit() to authenticated;
grant execute on function public.fakt_review_evidence(text, boolean, text) to authenticated;

-- Обращение жителя по ближайшему объекту (без входа в систему)
create or replace function public.fakt_nearest_object(p_lat float8, p_lng float8, p_module text) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'code', code, 'name', name, 'dist', round(public.fakt_dist(p_lat, p_lng, lat, lng)))
  from public.objects where module = p_module and lat is not null
  order by public.fakt_dist(p_lat, p_lng, lat, lng) limit 1
$$;
grant execute on function public.fakt_nearest_object(float8, float8, text) to anon, authenticated;

-- ---------- Хранилище фото ----------
insert into storage.buckets (id, name, public) values ('evidence', 'evidence', false) on conflict (id) do nothing;
drop policy if exists "fakt evidence read" on storage.objects;
drop policy if exists "fakt evidence upload" on storage.objects;
drop policy if exists "fakt citizen upload" on storage.objects;
create policy "fakt evidence read" on storage.objects for select to authenticated using (bucket_id = 'evidence');
create policy "fakt evidence upload" on storage.objects for insert to authenticated with check (bucket_id = 'evidence');
create policy "fakt citizen upload" on storage.objects for insert to anon with check (bucket_id = 'evidence' and (storage.foldername(name))[1] = 'citizen');

-- ---------- Обновления в реальном времени ----------
do $$ begin
  begin alter publication supabase_realtime add table public.orders; exception when others then null; end;
  begin alter publication supabase_realtime add table public.evidence; exception when others then null; end;
  begin alter publication supabase_realtime add table public.reports; exception when others then null; end;
  begin alter publication supabase_realtime add table public.objects; exception when others then null; end;
end $$;
