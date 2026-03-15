# CLAUDE.md — shift-app プロジェクト管理メモ

## プロジェクト概要

居酒屋（三軒茶屋・下北沢）のシフト管理 Web アプリ。
Next.js 15 App Router + TypeScript + Tailwind CSS + Supabase（PostgreSQL）。

- **本番リポジトリ**: `origin` → `shift-app`
- **開発リポジトリ**: `dev` → `shift-app-dev`
- 両リモートに常に `git push origin main && git push dev main` でプッシュすること。

---

## 技術スタック

| 項目 | 内容 |
|------|------|
| Framework | Next.js 15 App Router (`'use client'` ページ中心) |
| 言語 | TypeScript |
| スタイル | Tailwind CSS |
| DB | Supabase (PostgreSQL) REST API |
| DB クライアント | `src/lib/supabase.ts` |

**Supabase の鉄則**: `supabase.from(...)` は **絶対に throw しない**。必ず `{ data, error }` を返す。エラーは `if (error) console.error(...)` で処理。

---

## 雇用形態の定義

```typescript
type EmploymentType = '社員' | 'アルバイト' | '役員' | 'システム管理者' | '長期'
```

| 種別 | 意味 | 時給計算対象 | シフト申請方式 |
|------|------|:-----------:|:-------------:|
| 社員 | 正社員 | ✗ | off_requests（休み希望） |
| アルバイト | アルバイト | ✓ | shift_requests（出勤希望） |
| 長期 | 長期アルバイト | ✓ | shift_requests（出勤希望） |
| 役員 | 役員 | ✗ | off_requests |
| システム管理者 | 管理者（アルバイト扱い） | ✗ | shift_requests |

### isPartTimer パターン（全ファイル共通）

```typescript
const isPartTimer =
  staff.employment_type === 'アルバイト' ||
  staff.employment_type === '長期' ||
  staff.employment_type === 'システム管理者'
```

**重要**: `長期` は `アルバイト` と同等扱い。時給・人件費・給与概算・bottom-nav の給与タブ・StaffManagement の時給 UI すべてで `アルバイト || 長期` として扱う。

---

## DB テーブル一覧

| テーブル | 用途 |
|---------|------|
| `staffs` | スタッフ情報（`deleted_at` で論理削除） |
| `shops` | 店舗情報（id: 1=三軒茶屋, 2=下北沢） |
| `shift_requests` | アルバイト/長期/管理者の出勤希望申請 |
| `shifts_fixed` | 確定済みシフト |
| `off_requests` | 社員/役員の休み希望（休み/仕込みのみ/営業のみ） |
| `wage_history` | 時給変更履歴（`effective_from`, `effective_to`） |
| `shift_config` | 仕込み/営業のデフォルト時刻・必要人数 |
| `shift_rules` | 社員の配属店舗ルール |
| `closed_dates` | 定休日・臨時休業日 |

### 時刻フォーマット

- DB 上: `HH:MM:SS` 形式（例: `18:00:00`）
- 表示時: `.substring(0, 5)` で `HH:MM` に正規化する
- `formatTime(time)` ユーティリティ（`src/lib/utils.ts`）を使用

### 日付フォーマット

- DB 上: PostgreSQL `date` 型 → `YYYY-MM-DD` 文字列として返る
- グループ化・比較時は念のため `.substring(0, 10)` で正規化する習慣を統一

---

## コーディングパターン（必須）

### キャンセルフラグパターン（useEffect + 非同期）

```typescript
useEffect(() => {
  let cancelled = false
  // ...fetch...
  .then(({ data, error }) => {
    if (cancelled) return
    // setState...
  })
  return () => { cancelled = true }
}, [deps])
```

### バージョン管理パターン（月/期間切替の race condition 防止）

```typescript
const fetchVersionRef = useRef(0)
const fetchData = useCallback(async () => {
  const version = ++fetchVersionRef.current
  // ...fetch...
  if (fetchVersionRef.current !== version) return
  // setState...
}, [deps])
```

### confirming ガードパターン（二重送信防止）

```typescript
const [confirming, setConfirming] = useState(false)
// ...
setConfirming(true)
try {
  // DB操作
} finally {
  setConfirming(false)
}
// ボタン: disabled={confirming}
```

### getWageForDate（時給履歴参照）

`admin/page.tsx` と `salary/page.tsx` に同一関数が定義されている。
シフト日付に対応した時給を `wage_history` から取得する。

```typescript
function getWageForDate(wageHistories, staffId, date): number | null {
  // effective_from <= date <= effective_to のレコードを返す
  // マッチなし → 最新レコードを返す
}
```

### autoSplitShift（仕込み/営業の自動分割）

`manage/page.tsx` に定義。`shift_config.default_end_time` が仕込み/営業の境界時刻。
- `アルバイト / 長期 / システム管理者`: 仕込み開始 = max(申請開始, `14:00`)
- `社員`: 制限なし（11:00 スタートあり）

---

## ファイル構成と役割

```
src/
├── app/
│   ├── (authenticated)/
│   │   ├── layout.tsx         ← 認証チェック + BottomNav
│   │   ├── home/page.tsx      ← 週間シフト閲覧（全スタッフ）
│   │   ├── shifts/page.tsx    ← シフト希望提出
│   │   ├── history/page.tsx   ← 自分の出勤履歴
│   │   ├── salary/page.tsx    ← 給与概算（アルバイト・長期のみ）
│   │   ├── manage/page.tsx    ← シフト確定・ルール設定・自動生成（管理者）
│   │   └── admin/page.tsx     ← 人件費・スタッフ管理・充足率・レポート（管理者）
│   └── login/page.tsx         ← ログイン（token認証）
├── components/
│   └── bottom-nav.tsx         ← ナビゲーション（給与タブはアルバイト・長期のみ表示）
├── lib/
│   ├── auth.ts                ← localStorage でスタッフ情報管理
│   ├── supabase.ts            ← Supabase クライアント
│   └── utils.ts               ← calcWage / calcHours / formatTime / getSubmissionPeriod
└── types/
    └── database.ts            ← 全 DB 型定義
```

---

## 管理者ページのアクセス制限

```typescript
// manage/page.tsx, admin/page.tsx 共通
const allowed = employment_type === '社員' || '役員' || 'システム管理者'
// アルバイト・長期はアクセス不可
```

---

## 修正済みバグ一覧

### コミット `c26fd85`

1. **`manage/page.tsx` offMap 日付キー不一致**
   `r.date` → `r.date.substring(0, 10)` に修正。時刻付き ISO 文字列でもルックアップが正しく動作するように。

2. **`admin/page.tsx` LaborCostTab — `長期` 除外**
   `.eq('employment_type', 'アルバイト')` → `.in('employment_type', ['アルバイト', '長期'])`

3. **`salary/page.tsx` — ヘッダー時給が常に現在の時給を表示**
   `displayWage` を useMemo で定義し、選択月の `wage_history` を参照するよう変更。

4. **`salary/page.tsx` — `長期` スタッフのアクセス拒否**
   `!== 'アルバイト'` → `!== 'アルバイト' && !== '長期'`

5. **`bottom-nav.tsx` — 給与タブが `長期` に非表示**
   `=== 'アルバイト'` → `=== 'アルバイト' || === '長期'`

### コミット `837ddb6`

6. **`admin/page.tsx` MonthlyReportTab — `長期` を労務費集計から除外**
   `albeits` フィルタに `|| s.employment_type === '長期'` を追加。

7. **`admin/page.tsx` MonthlyReportTab — ラベル `アルバイト` → `アルバイト・長期`**

8. **`admin/page.tsx` LaborCostTab — ヘッダーラベル修正**
   `アルバイト人件費合計` → `アルバイト・長期人件費合計`

9. **`admin/page.tsx` StaffManagementTab — 新規登録フォームに `長期` 選択肢なし**
   `<option value="長期">長期</option>` を追加。

10. **`admin/page.tsx` StaffManagementTab — `長期` の時給入力欄が非表示**
    時給 Input の表示条件・onChange の時給クリア条件に `長期` を追加。

11. **`admin/page.tsx` StaffManagementTab — 時給表示・アクションボタン・時給履歴が `長期` に非表示**
    3 箇所の `=== 'アルバイト'` → `=== 'アルバイト' || === '長期'`

### コミット `68b2775`

12. **`home/page.tsx` — シフト日付比較に `.substring(0, 10)` がない**
    `s.date === dateStr` → `s.date.substring(0, 10) === dateStr`（2箇所）
    Supabase が時刻付き文字列を返した場合にシフトが表示されなくなる予防的修正。

### コミット `068fb66`

13. **`shifts/page.tsx` — シフト希望の全取り消し機能を追加（新機能）**
    `PartTimerForm` に `handleWithdraw` 関数を追加。確認ダイアログ後に `shift_requests` を期間ごとに DELETE しフォームに戻る。`StatusView` に「申請を全取り消しする」ボタンを追加。

### コミット `(次のコミット)`

14. **`admin/page.tsx` FulfillmentTab — 日付比較に `.substring(0, 10)` がない**
    `cd.date === date` → `cd.date.substring(0, 10) === date`
    `s.date === date` → `s.date.substring(0, 10) === date`
    充足率計算で休業日判定・シフトカウントが正しく動作しない可能性。

15. **`admin/page.tsx` MonthlyReportTab — `uniqueDays` 集計の正規化漏れ**
    `shifts.map(s => s.date)` → `shifts.map(s => s.date.substring(0, 10))`
    Supabase が時刻付き文字列を返した場合に営業日数の重複カウントが発生する予防的修正。

### コミット `(次のコミット)`

16. **`manage/page.tsx` — dateMap・fixedMap・closedDates・halfStatus の正規化漏れ**
    - `dateMap`: `r.date` → `r.date.substring(0, 10)` をキーに使用
    - `fixedMap`: `f.date` → `f.date.substring(0, 10)` をキーに使用
    - `closedDates`: `c.date` → `c.date.substring(0, 10)` に正規化して格納
    - `handleRestore`: `closedDates.includes(req.date)` → `closedDates.includes(req.date.substring(0, 10))`
    - `halfStatus.fixedTypesByKey`: キーを `staff_id + '_' + f.date.substring(0, 10)` に統一
    タイムスタンプ付き日付でカレンダー選択・定休日判定・確定状態判定が正しく動作しない問題を予防。

---

## 今後バグ探しをする際のチェックポイント

- **`長期` の取り扱い**: `アルバイト` と同列に扱われているか全ファイルを確認
- **日付の正規化**: `.substring(0, 10)` で統一されているか
- **時刻の正規化**: `.substring(0, 5)` で `HH:MM` に変換されているか
- **キャンセルフラグ**: useEffect 内の非同期処理に `cancelled` フラグがあるか
- **バージョン管理**: 月/期間切替がある fetch に `fetchVersionRef` があるか
- **confirming ガード**: DB 書き込みボタンに `disabled={confirming}` があるか
- **Supabase エラーハンドリング**: `{ data, error }` を必ず確認しているか
- **時給計算**: `getWageForDate()` を使い、常に `wage_history` を参照しているか（`staff.wage` 直参照は不可）

---

## シフト期間ルール

- **前半**: 月の 1〜15 日
- **後半**: 月の 16〜末日
- **提出締め切り**:
  - 前半（翌月1〜15日）: 当月20日
  - 後半（翌月16〜末日）: 当月5日
- `getSubmissionPeriod(today)` で「次の締め切りに対応する期間」を取得

---

## Git 運用

```bash
# 常にこの2コマンドで両リモートにプッシュ
git push origin main && git push dev main
```

コミットメッセージは日本語または英語どちらでも可。Co-authored-by 行を必ず付ける。
