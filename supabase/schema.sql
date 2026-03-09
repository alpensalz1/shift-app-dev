-- ============================================
-- シフト管理システム: Supabase テーブル定義
-- スプレッドシート「tanatana_テーブル定義」準拠
-- ============================================

-- 店舗マスタ
CREATE TABLE shops (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO shops (name) VALUES ('三軒茶屋'), ('下北沢');

-- スタッフマスタ (staff_master シート準拠)
-- A列: ID, B列: 名前, C列: 雇用形態, D列: 時給
CREATE TABLE staffs (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name TEXT NOT NULL,
  token TEXT NOT NULL,                -- ログイン用パスワード
  employment_type TEXT NOT NULL DEFAULT 'アルバイト'
    CHECK (employment_type IN ('社員', 'アルバイト')),
  wage INTEGER NOT NULL DEFAULT 1226, -- 時給（円）
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- スプレッドシートのスタッフデータ (token は名前のローマ字+ID)
INSERT INTO staffs (name, token, employment_type, wage) VALUES
  ('田中',       'tanaka1',     '社員',       3000),
  ('しゅうふく', 'shufuku2',    '社員',       3000),
  ('さとる',     'satoru3',     '社員',       3000),
  ('ダイヤ',     'daiya4',      '社員',       3000),
  ('さえ',       'sae5',        '社員',       2000),
  ('かすみ',     'kasumi6',     'アルバイト', 1500),
  ('なち',       'nachi7',      'アルバイト', 1500),
  ('りな',       'rina8',       'アルバイト', 1226),
  ('おとは',     'otoha9',      'アルバイト', 1226),
  ('みゆ',       'miyu10',      'アルバイト', 1226),
  ('かいしゅう', 'kaishu11',    'アルバイト', 1226),
  ('ひな',       'hina12',      'アルバイト', 1226),
  ('ナナ',       'nana13',      'アルバイト', 1226),
  ('そら',       'sora14',      'アルバイト', 1226),
  ('ゆな',       'yuna15',      'アルバイト', 1226),
  ('リアル',     'riaru16',     'アルバイト', 1226),
  ('たかあきら', 'takaakira17', 'アルバイト', 1226),
  ('れんと',     'rento18',     'アルバイト', 1226);

-- シフト設定マスタ (shift_config シート準拠)
-- 店舗ごと・枠種別ごとの必要人数と勤務時間帯
CREATE TABLE shift_config (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  shop_id BIGINT NOT NULL REFERENCES shops(id),
  type TEXT NOT NULL CHECK (type IN ('仕込み', '営業')),
  required_count INTEGER NOT NULL DEFAULT 2,   -- 必要人数
  required_employees INTEGER NOT NULL DEFAULT 1, -- 必要社員数
  default_start_time TIME NOT NULL,
  default_end_time TIME NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

INSERT INTO shift_config (shop_id, type, required_count, required_employees, default_start_time, default_end_time) VALUES
  (1, '仕込み', 2, 1, '14:00', '17:00'),
  (1, '営業',   2, 1, '17:00', '24:00'),
  (2, '仕込み', 2, 1, '14:00', '17:00'),
  (2, '営業',   5, 1, '17:00', '24:00');

-- シフト希望 (shift_requests シート準拠)
-- A列: 日付, B列: スタッフID, C列: 希望種別, D列: 希望開㧋時間, E列: 希望終了時間, F列: 備考, G列: 提出スタンプ
CREATE TABLE shift_requests (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  staff_id BIGINT NOT NULL REFERENCES staffs(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('仕込み', '営業', '仕込み・営業')),
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  note TEXT DEFAULT '',               -- 備考
  submitted_at TIMESTAMPTZ DEFAULT now(), -- 提出スタンプ
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (staff_id, date)
);

-- 確定シフト (shift_fixed シート準拠)
-- A列: 日付, B列: 店舗ID, C列: 枠種別, D列: スタッフID, E列: 開始時間, F列: 終了時間
CREATE TABLE shifts_fixed (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  date DATE NOT NULL,
  shop_id BIGINT NOT NULL REFERENCES shops(id),
  type TEXT NOT NULL CHECK (type IN ('仕込み', '営業')),
  staff_id BIGINT NOT NULL REFERENCES staffs(id) ON DELETE CASCADE,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (staff_id, date, type)
);

-- インデックス
CREATE INDEX idx_shift_requests_staff_date ON shift_requests (staff_id, date);
CREATE INDEX idx_shift_requests_date ON shift_requests (date);
CREATE INDEX idx_shifts_fixed_date ON shifts_fixed (date);
CREATE INDEX idx_shifts_fixed_shop_date ON shifts_fixed (shop_id, date);
CREATE INDEX idx_shifts_fixed_staff_date ON shifts_fixed (staff_id, date);
CREATE INDEX idx_shift_config_shop ON shift_config (shop_id);

-- updated_at 自動更新トリゲー
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_shift_requests_updated_at
  BEFORE UPDATE ON shift_requests
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS (Row Level Security)
ALTER TABLE shops ENABLE ROW LEVEL SECURITY;
ALTER TABLE staffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE shift_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts_fixed ENABLE ROW LEVEL SECURITY;

-- 読み取りポリシー（anon key でアクセスするため全許可）
CREATE POLICY "shops_read" ON shops FOR SELECT USING (true);
CREATE POLICY "staffs_read" ON staffs FOR SELECT USING (true);
CREATE POLICY "shift_config_read" ON shift_config FOR SELECT USING (true);
CREATE POLICY "shift_requests_read" ON shift_requests FOR SELECT USING (true);
CREATE POLICY "shifts_fixed_read" ON shifts_fixed FOR SELECT USING (true);

-- 書き込みポリシー
CREATE POLICY "shift_requests_insert" ON shift_requests FOR INSERT WITH CHECK (true);
CREATE POLICY "shift_requests_update" ON shift_requests FOR UPDATE USING (true);
CREATE POLICY "shift_requests_delete" ON shift_requests FOR DELETE USING (true);
CREATE POLICY "shifts_fixed_insert" ON shifts_fixed FOR INSERT WITH CHECK (true);
CREATE POLICY "shifts_fixed_update" ON shifts_fixed FOR UPDATE USING (true);
CREATE POLICY "shifts_fixed_delete" ON shifts_fixed FOR DELETE USING (true);
CREATE POLICY "shift_config_all" ON shift_config USING (true) WITH CHECK (true);

-- Supabase Realtime 有効化
ALTER PUBLICATION supabase_realtime ADD TABLE shifts_fixed;
ALTER PUBLICATION supabase_realtime ADD TABLE shift_requests;
