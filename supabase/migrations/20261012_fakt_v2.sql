-- FAKT v2: настройки акимата, гарантия, обращения закрываются фактом, съёмка без связи, публичная карточка объекта
alter table public.reports add column if not exists closed_at timestamptz;
alter table public.reports add column if not exists order_id text;
alter table public.reports add column if not exists resolution text;
alter table public.reports add column if not exists evidence_id text;
alter table public.orders add column if not exists warranty_of text;
alter table public.orders add column if not exists report_id text;
alter table public.evidence add column if not exists delay_ms bigint;
alter table public.evidence add column if not exists masked int;

create table if not exists public.settings (id text primary key default 'main', data jsonb not null default '{}', updated_at timestamptz not null default now());
alter table public.settings enable row level security;
create policy settings_read on public.settings for select to authenticated using (true);
create policy settings_insert on public.settings for insert to authenticated with check (public.fakt_role() = 'admin');
create policy settings_update on public.settings for update to authenticated using (public.fakt_role() = 'admin');
insert into public.settings(id, data) values ('main', '{}') on conflict (id) do nothing;

create or replace function public.fakt_setting(p_key text, p_default numeric) returns numeric language sql stable security definer set search_path = public as
$$ select coalesce((select (data->>p_key)::numeric from public.settings where id = 'main'), p_default) $$;

-- Журнал для справочников и настроек
create or replace function public.fakt_settings_log() returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  perform public.fakt_log('settings.update', 'settings', new.id, 'Изменены нормативы и настройки');
  return new;
end $$;
create trigger settings_log before update on public.settings for each row execute function public.fakt_settings_log();

create or replace function public.fakt_contractors_log() returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.fakt_log(case when tg_op = 'INSERT' then 'contractor.create' else 'contractor.update' end, 'contractor', new.id,
    case when tg_op = 'INSERT' then 'Добавлен' else 'Изменён' end || ' подрядчик ' || new.name || ', БИН ' || coalesce(new.bin, '—'));
  return new;
end $$;
create trigger contractors_log after insert or update on public.contractors for each row execute function public.fakt_contractors_log();

-- Создание профиля сотрудника: вызывается только серверной функцией fakt-admin (ключ сервиса)
create or replace function public.fakt_create_profile(p_admin uuid, p_id uuid, p_email text, p_full_name text, p_role text, p_position text, p_contractor text) returns void
language plpgsql security definer set search_path = public as $$
declare who text;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Недостаточно прав'; end if;
  if p_role not in ('admin','inspector','contractor') then raise exception 'Неизвестная роль'; end if;
  select full_name into who from public.profiles where id = p_admin and role = 'admin';
  if who is null then raise exception 'Создавать пользователей может только руководитель'; end if;
  insert into public.profiles(id, email, full_name, role, position, contractor_id) values (p_id, lower(p_email), p_full_name, p_role, p_position, nullif(p_contractor, ''));
  insert into public.audit(actor, action, entity, entity_id, summary) values (who, 'user.create', 'user', p_id::text, 'Добавлен пользователь ' || p_full_name || ' (' || p_role || ')');
end $$;

-- Проверка доказательства: добавлена съёмка без связи (delay_ms по монотонным часам телефона)
create or replace function public.fakt_evidence_verify() returns trigger language plpgsql security definer set search_path = public as $$
declare
  o public.objects; ord public.orders; prof public.profiles;
  checks jsonb := '[]'; pen int := 0; d float8; radius int; skew float8; delay float8;
  dup record; t_lat float8; t_lng float8; use_path boolean := false; pair_id text;
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

  if new.capture = 'camera' then checks := checks || jsonb_build_object('code','capture','ok',true,'label','Снято камерой внутри FAKT','penalty',0);
  else checks := checks || jsonb_build_object('code','capture','ok',false,'label','Загружено из файла, а не снято камерой','penalty',40); pen := pen + 40; end if;

  if new.lat is null then checks := checks || jsonb_build_object('code','gps','ok',false,'label','Нет координат GPS','penalty',50); pen := pen + 50;
  elsif new.accuracy > 100 then checks := checks || jsonb_build_object('code','gps','ok',false,'label','Низкая точность GPS: ±' || round(new.accuracy) || ' м','penalty',15); pen := pen + 15;
  else checks := checks || jsonb_build_object('code','gps','ok',true,'label','GPS точность ±' || round(coalesce(new.accuracy,0)) || ' м','penalty',0); end if;

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

  delay := greatest(coalesce(new.delay_ms, 0), 0) / 1000.0;
  skew := abs(extract(epoch from (now() - coalesce(new.device_time, now()))) - delay);
  if skew <= 600 then checks := checks || jsonb_build_object('code','time','ok',true,'label','Время съёмки совпадает с сервером','penalty',0);
  else checks := checks || jsonb_build_object('code','time','ok',false,'label','Часы телефона расходятся с сервером на ' || case when skew < 3600 then round(skew/60) || ' мин' when skew < 172800 then round(skew/3600) || ' ч' else round(skew/86400) || ' дн' end,'penalty',25); pen := pen + 25; end if;
  if delay > 300 then
    if delay <= 86400 then checks := checks || jsonb_build_object('code','offline','ok',true,'label','Снято без связи, отправлено через ' || case when delay < 3600 then round(delay/60) || ' мин' else round(delay/3600) || ' ч' end,'penalty',0,'info',true);
    else checks := checks || jsonb_build_object('code','offline','ok',false,'label','Отправлено через ' || round(delay/86400) || ' дн после съёмки: время не подтверждено сервером','penalty',25); pen := pen + 25; end if;
  end if;

  -- Парное фото «до» той же работы сравнивается по сцене, а не как повтор (кроме того же самого файла)
  if new.stage = 'after' then pair_id := ord.before_id;
  elsif new.stage = 'pickup_after' then
    select e.id into pair_id from public.evidence e where e.object_id = new.object_id and e.stage = 'pickup_before' and e.server_time > now() - interval '12 hours' order by e.server_time desc limit 1;
  end if;

  select e.server_time, ob.name, public.fakt_hamming(new.phash, e.phash) h into dup
    from public.evidence e left join public.objects ob on ob.id = e.object_id
    where e.phash is not null and e.id <> new.id and public.fakt_hamming(new.phash, e.phash) <= 6
      and (pair_id is null or e.id <> pair_id or e.sha256 = new.sha256)
    order by 3 limit 1;
  if dup.h is not null then checks := checks || jsonb_build_object('code','duplicate','ok',false,'label','Это фото уже сдавали: ' || coalesce(dup.name,'другой объект') || ', ' || to_char(dup.server_time, 'DD.MM.YYYY'),'penalty',70); pen := pen + 70;
  else checks := checks || jsonb_build_object('code','duplicate','ok',true,'label','Фото уникально, повторов в базе нет','penalty',0); end if;

  if new.blur is not null and new.blur < 40 then checks := checks || jsonb_build_object('code','quality','ok',false,'label','Фото размыто, детали не видны','penalty',10); pen := pen + 10;
  elsif new.brightness is not null and new.brightness < 35 then checks := checks || jsonb_build_object('code','quality','ok',false,'label','Слишком темно','penalty',10); pen := pen + 10;
  else checks := checks || jsonb_build_object('code','quality','ok',true,'label','Качество снимка достаточное','penalty',0); end if;

  if new.stage in ('after','pickup_after') then
    if new.similarity is null then checks := checks || jsonb_build_object('code','scene','ok',false,'label','Нет фото «до» для сравнения','penalty',5); pen := pen + 5;
    elsif new.similarity < 0.42 then checks := checks || jsonb_build_object('code','scene','ok',false,'label','Сцена не совпадает с фото «до» (' || round(new.similarity*100) || '%)','penalty',30); pen := pen + 30;
    elsif new.similarity > 0.975 then checks := checks || jsonb_build_object('code','scene','ok',false,'label','Фото «после» почти копия «до»: изменений не видно','penalty',55); pen := pen + 55;
    else checks := checks || jsonb_build_object('code','scene','ok',true,'label','Та же сцена, что на фото «до» (' || round(new.similarity*100) || '%), есть изменения','penalty',0); end if;
  end if;

  if new.simulated then checks := checks || jsonb_build_object('code','sim','ok',true,'label','Демо-режим: позиция имитирована','penalty',0,'info',true); end if;

  new.checks := checks;
  new.score := greatest(0, 100 - pen);
  new.verdict := case when new.score >= 80 then 'ok' when new.score >= 50 then 'review' else 'rejected' end;
  return new;
end $$;

-- Последствия доказательства: фото вывоза закрывает обращения жителей по площадке
create or replace function public.fakt_evidence_apply() returns trigger language plpgsql security definer set search_path = public as $$
declare o public.objects; reason text;
begin
  select * into o from public.objects where id = new.object_id;
  if o.module = 'build' and new.stage in ('progress','inspection') then
    update public.objects set last_report_at = new.server_time,
      progress_claimed = greatest(progress_claimed, coalesce(new.progress, 0)),
      progress_confirmed = case when new.progress is not null and (new.verdict = 'ok' or new.stage = 'inspection') then greatest(progress_confirmed, new.progress) else progress_confirmed end
    where id = o.id;
  elsif o.module = 'waste' then
    if new.stage = 'pickup_after' and new.verdict <> 'rejected' then
      update public.objects set last_report_at = new.server_time, site_state = 'ok' where id = o.id;
      update public.reports set status = 'closed', closed_at = new.server_time, evidence_id = new.id,
        resolution = 'Вывоз подтверждён фото (' || new.score || '/100)' where object_id = o.id and status <> 'closed';
    end if;
    if new.stage = 'citizen' or (new.stage = 'inspection' and coalesce(new.comment,'') like '%переполн%') then update public.objects set site_state = 'full' where id = o.id; end if;
  elsif o.module = 'road' and new.stage in ('before','inspection') then
    update public.objects set last_inspected_at = new.server_time where id = o.id;
  end if;
  if new.order_id is not null and new.stage = 'after' then
    if new.verdict = 'rejected' then
      select c->>'label' into reason from jsonb_array_elements(coalesce(new.checks,'[]'::jsonb)) c
        where coalesce((c->>'ok')::boolean, true) = false and coalesce((c->>'penalty')::int, 0) >= 25 limit 1;
      update public.orders set after_id = new.id, status = 'rejected', reject_reason = 'Автоматически: ' || coalesce(reason, 'низкий балл доверия') where id = new.order_id;
    else
      update public.orders set after_id = new.id, status = 'submitted', reject_reason = null where id = new.order_id;
    end if;
  end if;
  if new.order_id is not null and new.stage = 'before' then
    update public.orders set before_id = new.id where id = new.order_id and before_id is null;
  end if;
  perform public.fakt_log('evidence.add', 'evidence', new.id,
    (case new.verdict when 'rejected' then 'Отклонено' when 'review' then 'На проверку' else 'Подтверждено' end) || ' (' || new.score || '/100): ' || coalesce(o.code,'') || ' ' || coalesce(o.name,''));
  return new;
end $$;

-- Заявки: гарантия считается на сервере, приёмка закрывает связанное обращение жителя
create or replace function public.fakt_orders_log() returns trigger language plpgsql security definer set search_path = public as $$
declare w record;
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid()::text, new.created_by);
    new.warranty_of := null;
    if new.kind = 'defect' and new.lat is not null then
      select x.id into w from public.orders x
       where x.object_id = new.object_id and x.status = 'accepted' and x.lat is not null and x.id <> new.id
         and x.accepted_at > now() - make_interval(days => round(public.fakt_setting('warranty_months', 12) * 30.44)::int)
         and public.fakt_dist(new.lat, new.lng, x.lat, x.lng) <= public.fakt_setting('warranty_radius', 50)
       order by public.fakt_dist(new.lat, new.lng, x.lat, x.lng) limit 1;
      if w.id is not null then new.warranty_of := w.id; new.amount := 0; end if;
    end if;
    if new.report_id is not null then update public.reports set order_id = new.id, status = 'in_work' where id = new.report_id; end if;
    perform public.fakt_log('order.create', 'order', new.id, case when new.warranty_of is not null then 'Гарантийная заявка (за счёт подрядчика): ' else 'Заявка подрядчику: ' end || new.title);
  elsif new.status is distinct from old.status and new.status in ('accepted','rejected') then
    if new.status = 'accepted' then
      new.accepted_at := now(); new.accepted_by := auth.uid()::text; new.reject_reason := null;
      update public.reports set status = 'closed', closed_at = now(), resolution = 'Работа принята по фото: ' || new.title where order_id = new.id and status <> 'closed';
    end if;
    perform public.fakt_log(case when new.status = 'accepted' then 'order.accept' else 'order.reject' end, 'order', new.id,
      case when new.status = 'accepted' then 'Работа принята: ' else 'Работа возвращена: ' end || new.title || coalesce(' — ' || new.reject_reason, ''));
  end if;
  return new;
end $$;

-- Публичная карточка объекта для QR-таблички: без персональных данных и фото
create or replace function public.fakt_public_object(p_code text) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('code', o.code, 'name', o.name, 'module', o.module, 'address', o.address, 'contractor', c.name, 'contract_no', o.contract_no,
    'amount', o.amount, 'start_date', o.start_date, 'end_date', o.end_date, 'progress_confirmed', o.progress_confirmed, 'site_state', o.site_state,
    'last_fact_at', (select max(e.server_time) from public.evidence e where e.object_id = o.id and e.verdict = 'ok'),
    'open_reports', (select count(*) from public.reports r where r.object_id = o.id and r.status <> 'closed'),
    'tone', case
      when o.site_state = 'full' then 'red'
      when exists (select 1 from public.orders x where x.object_id = o.id and x.status in ('open','rejected') and x.due_at < now()) then 'red'
      when o.module = 'build' and o.status <> 'done' and (coalesce(o.progress_claimed,0) - coalesce(o.progress_confirmed,0) >= 10 or o.last_report_at is null or o.last_report_at < now() - interval '14 days') then 'red'
      when o.module = 'build' and o.status <> 'done' and o.last_report_at < now() - interval '7 days' then 'amber'
      else 'green' end)
  from public.objects o left join public.contractors c on c.id = o.contractor_id
  where lower(o.code) = lower(p_code) limit 1
$$;

create or replace function public.fakt_report_status(p_id text) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', id, 'status', status, 'created_at', created_at, 'closed_at', closed_at, 'resolution', resolution, 'text', text)
  from public.reports where lower(id) = lower(p_id) limit 1
$$;
grant execute on function public.fakt_public_object(text) to anon, authenticated;
grant execute on function public.fakt_report_status(text) to anon, authenticated;
