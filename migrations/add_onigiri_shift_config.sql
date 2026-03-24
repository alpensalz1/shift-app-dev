-- おにぎり店舗（shop_id=3）の shift_config を追加
-- demo DB (ubfgnrnfky...) と beta DB (wkpeozzvdx...) の両方で実行すること

INSERT INTO shift_config (shop_id, type, required_count, required_employees, default_start_time, default_end_time)
VALUES (3, '営業', 2, 1, '12:00:00', '18:00:00')
ON CONFLICT DO NOTHING;
