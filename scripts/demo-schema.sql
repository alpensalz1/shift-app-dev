-- ============================================================
-- shift-management-demo スキーマ + デモシードデータ
-- 完全にダミーデータのみ。本物のスタッフ情報は一切含まない。
-- Supabase SQL Editor で一括実行してください。
-- ============================================================

-- ── テーブル作成 ─────────────────────────────────────────

create table if not exists shops (
  id            serial primary key,
  name          text not null,
  created_at    timestamptz default now(),
  shop_type     text,
  color         text,
  is_active     boolean default true
);

create table if not exists staffs (
  id              serial primary key,
  name            text not null,
  token           text not null unique,
  employment_type text not null check (employment_type in ('アルバイト', '社員', '役員', 'システム管理者')),
  wage            integer default 0,
  is_active       boolean default true,
  shop_id         integer references shops(id),
  created_at      timestamptz default now(),
  deleted_at      timestamptz
);

create table if not exists shift_config (
  id                    serial primary key,
  shop_id               integer references shops(id),
  type                  text not null,
  required_count        integer default 1,
  required_employees    integer default 1,
  default_start_time    time,
  default_end_time      time,
  created_at            timestamptz default now()
);

create table if not exists shift_requests (
  id            serial primary key,
  staff_id      integer references staffs(id),
  date          date not null,
  type          text not null,
  start_time    time,
  end_time      time,
  note          text default '',
  status        text default 'pending',
  submitted_at  timestamptz default now(),
  created_at    timestamptz default now(),
  updated_at    timestamptz default now()
);

create table if not exists shifts_fixed (
  id          serial primary key,
  date        date not null,
  shop_id     integer references shops(id),
  type        text not null,
  staff_id    integer references staffs(id),
  start_time  time,
  end_time    time,
  created_at  timestamptz default now()
);

create table if not exists off_requests (
  id          serial primary key,
  staff_id    integer references staffs(id),
  date        date not null,
  type        text not null,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

create table if not exists shift_rules (
  id          serial primary key,
  shop_id     integer references shops(id),
  staff_id    integer references staffs(id),
  priority    integer default 1,
  is_active   boolean default true,
  created_at  timestamptz default now()
);

create table if not exists wage_history (
  id              serial primary key,
  staff_id        integer references staffs(id),
  wage            integer not null,
  effective_from  date not null,
  effective_to    date,
  created_at      timestamptz default now()
);

create table if not exists closed_dates (
  id          serial primary key,
  date        date not null unique,
  shop_id     integer,
  note        text,
  created_at  timestamptz default now()
);

-- ── RLS（Row Level Security）──────────────────────────────

alter table staffs enable row level security;
alter table shift_requests enable row level security;
alter table shifts_fixed enable row level security;
alter table off_requests enable row level security;
alter table shift_rules enable row level security;
alter table shift_config enable row level security;
alter table shops enable row level security;
alter table wage_history enable row level security;
alter table closed_dates enable row level security;

-- 全テーブル: 匿名ユーザーに SELECT を許可
create policy "staffs_read"         on staffs         for select using (true);
create policy "requests_read"       on shift_requests for select using (true);
create policy "fixed_read"          on shifts_fixed   for select using (true);
create policy "off_read"            on off_requests   for select using (true);
create policy "rules_read"          on shift_rules    for select using (true);
create policy "config_read"         on shift_config   for select using (true);
create policy "shops_read"          on shops          for select using (true);
create policy "wage_read"           on wage_history   for select using (true);
create policy "closed_read"         on closed_dates   for select using (true);

-- 書き込み系（INSERT / UPDATE / DELETE）
create policy "staffs_update_token" on staffs         for update using (true) with check (true);
create policy "staffs_insert"       on staffs         for insert with check (true);

create policy "requests_insert"     on shift_requests for insert with check (true);
create policy "requests_update"     on shift_requests for update using (true) with check (true);
create policy "requests_delete"     on shift_requests for delete using (true);

create policy "fixed_insert"        on shifts_fixed   for insert with check (true);
create policy "fixed_delete"        on shifts_fixed   for delete using (true);

create policy "off_insert"          on off_requests   for insert with check (true);
create policy "off_update"          on off_requests   for update using (true) with check (true);
create policy "off_delete"          on off_requests   for delete using (true);

create policy "rules_insert"        on shift_rules    for insert with check (true);
create policy "rules_delete"        on shift_rules    for delete using (true);

create policy "wage_insert"         on wage_history   for insert with check (true);
create policy "wage_update"         on wage_history   for update using (true) with check (true);

create policy "closed_insert"       on closed_dates   for insert with check (true);
create policy "closed_delete"       on closed_dates   for delete using (true);

-- ── デモシードデータ ──────────────────────────────────────

-- 店舗
insert into shops (id, name) values
  (1, '三軒茶屋'),
  (2, '下北沢');

-- スタッフ（ダミー名のみ。パスコードは簡単なもの）
insert into staffs (name, token, employment_type, wage, is_active, shop_id) values
  ('山田さん', 'yamada',  'アルバイト',    1200, true, 1),
  ('渡辺さん', 'watanabe','アルバイト',    1100, true, 2),
  ('田中さん', 'tanaka',  '社員',          0,    true, 1),
  ('佐藤さん', 'sato',    '社員',          0,    true, 2),
  ('鈴木さん', 'suzuki',  '役員',          0,    true, 1),
  ('いっさ',   'issa',    'システム管理者', 0,    true, 1);

-- 時給履歴（アルバイトのみ）
insert into wage_history (staff_id, wage, effective_from) values
  ((select id from staffs where token = 'yamada'),   1200, '2025-01-01'),
  ((select id from staffs where token = 'watanabe'), 1100, '2025-01-01');

-- シフト設定
insert into shift_config (shop_id, type, required_count, required_employees, default_start_time, default_end_time) values
  (1, '仕込み', 1, 1, '11:00:00', '17:00:00'),
  (1, '営業',   1, 1, '17:00:00', '24:00:00'),
  (2, '仕込み', 1, 1, '11:00:00', '18:00:00'),
  (2, '営業',   1, 1, '18:00:00', '24:00:00');

-- 社員配属ルール
insert into shift_rules (shop_id, staff_id, priority, is_active) values
  (1, (select id from staffs where token = 'tanaka'), 1, true),
  (2, (select id from staffs where token = 'sato'),   1, true);

-- サンプルシフト申請（来月前半）
do $$
declare
  v_next text := to_char(now() + interval '1 month', 'YYYY-MM');
  a_id int := (select id from staffs where token = 'yamada');
  b_id int := (select id from staffs where token = 'watanabe');
begin
  insert into shift_requests (staff_id, date, type, start_time, end_time, note, status, submitted_at) values
    (a_id, (v_next || '-03')::date, '仕込み・営業', '14:00:00', '22:00:00', '',        'pending', now()),
    (a_id, (v_next || '-07')::date, '仕込み・営業', '14:00:00', '21:00:00', '',        'pending', now()),
    (a_id, (v_next || '-10')::date, '営業',         '17:00:00', '23:00:00', '早退希望', 'pending', now()),
    (b_id, (v_next || '-04')::date, '仕込み・営業', '14:00:00', '22:00:00', '',        'pending', now()),
    (b_id, (v_next || '-08')::date, '仕込み・営業', '14:00:00', '23:00:00', '',        'pending', now()),
    (b_id, (v_next || '-12')::date, '仕込み',       '14:00:00', '18:00:00', '',        'pending', now());
end $$;

-- サンプル確定シフト（今月分）
do $$
declare
  v_this text := to_char(now(), 'YYYY-MM');
  a_id int := (select id from staffs where token = 'yamada');
  b_id int := (select id from staffs where token = 'watanabe');
  c_id int := (select id from staffs where token = 'tanaka');
  d_id int := (select id from staffs where token = 'sato');
begin
  insert into shifts_fixed (date, shop_id, type, staff_id, start_time, end_time) values
    ((v_this || '-01')::date, 1, '仕込み', c_id, '11:00:00', '17:00:00'),
    ((v_this || '-01')::date, 1, '営業',   c_id, '17:00:00', '24:00:00'),
    ((v_this || '-02')::date, 1, '仕込み', c_id, '11:00:00', '17:00:00'),
    ((v_this || '-02')::date, 1, '営業',   c_id, '17:00:00', '24:00:00'),
    ((v_this || '-01')::date, 2, '仕込み', d_id, '11:00:00', '18:00:00'),
    ((v_this || '-01')::date, 2, '営業',   d_id, '18:00:00', '24:00:00'),
    ((v_this || '-03')::date, 1, '仕込み', a_id, '14:00:00', '17:00:00'),
    ((v_this || '-03')::date, 1, '営業',   a_id, '17:00:00', '22:00:00'),
    ((v_this || '-05')::date, 1, '仕込み', a_id, '14:00:00', '17:00:00'),
    ((v_this || '-05')::date, 1, '営業',   a_id, '17:00:00', '21:00:00'),
    ((v_this || '-04')::date, 2, '仕込み', b_id, '14:00:00', '18:00:00'),
    ((v_this || '-04')::date, 2, '営業',   b_id, '18:00:00', '23:00:00');
end $$;
