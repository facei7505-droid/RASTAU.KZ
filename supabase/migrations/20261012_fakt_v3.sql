-- FAKT v3: публичные функции отдают id объекта и данные для трекинга обращения
create or replace function public.fakt_public_object(p_code text) returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('id', o.id, 'code', o.code, 'name', o.name, 'module', o.module, 'address', o.address, 'contractor', c.name, 'contract_no', o.contract_no,
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
  select jsonb_build_object('id', r.id, 'status', r.status, 'created_at', r.created_at, 'closed_at', r.closed_at, 'resolution', r.resolution, 'text', r.text,
    'module', r.module, 'object_code', o.code, 'object_name', o.name, 'contractor', c.name)
  from public.reports r left join public.objects o on o.id = r.object_id left join public.contractors c on c.id = o.contractor_id
  where lower(r.id) = lower(p_id) limit 1
$$;

-- Перевозчик и подрядчик видят обращения жителей по своим объектам (норматив реакции 24 ч)
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'reports' and policyname = 'reports_read_contractor') then
    create policy reports_read_contractor on public.reports for select to authenticated
      using (public.fakt_role() = 'contractor' and object_id in (select id from public.objects where contractor_id = public.fakt_contractor()));
  end if;
end $$;

-- Сколько областей (лица, номера) закрыто на фото до отправки
alter table public.evidence add column if not exists masked int default 0;

-- Фиксированный search_path у вспомогательных функций (рекомендация линтера безопасности)
do $$ declare r record; begin
  for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('fakt_dist','fakt_fmt_dist','fakt_hamming','fakt_audit_immutable') loop
    execute format('alter function %s set search_path = public, extensions', r.sig);
  end loop;
end $$;
