export interface Shop {
  id: number
  name: string
  created_at: string
  shop_type?: '常設' | 'イベント'
  color?: string
  is_active?: boolean
  weekend_only?: boolean
}

export interface Staff {
  id: number
  name: string
  token: string
  employment_type: '社員' | 'アルバイト' | '役員' | 'システム管理者'
  wage: number
  is_active: boolean
  shop_id: number
  created_at: string
  deleted_at?: string | null
}

export interface ShiftConfig {
  id: number
  shop_id: number
  type: '仕込み' | '営業'
  required_count: number
  required_employees: number
  default_start_time: string
  default_end_time: string
  created_at: string
}

export interface ShiftRequest {
  id: number
  staff_id: number
  date: string
  type: '仕込み' | '営業' | '仕込み・営業'
  start_time: string
  end_time: string
  note: string
  submitted_at: string
  created_at: string
  updated_at: string
  status?: 'pending' | 'rejected' | 'deleted'
}

export interface ShiftFixed {
  id: number
  date: string
  shop_id: number | null
  type: '仕込み' | '営業' | '作業日'
  staff_id: number
  start_time: string
  end_time: string | null
  created_at: string
}

// 社員の休み希望テーブル
export interface OffRequest {
  id: number
  staff_id: number
  date: string
  type: '休み' | '仕込みのみ' | '営業のみ' | 'おにぎりのみ'
  created_at: string
  updated_at: string
}

// 店舗ごとの社員配属優先ルール
export interface ShiftRule {
  id: number
  shop_id: number
  staff_id: number
  priority: number
  is_active: boolean
  created_at: string
}

export interface WageHistory {
  id: number
  staff_id: number
  wage: number
  effective_from: string
  effective_to: string | null
  created_at: string
}

export interface ClosedDate {
  id: number
  date: string
  shop_id?: number | null
  note?: string
  created_at: string
}

// JOIN 結果用
export interface ShiftRuleWithStaff extends ShiftRule {
  staffs: Pick<Staff, 'name'>
  shops: Pick<Shop, 'name'>
}

export interface ShiftFixedWithStaff extends ShiftFixed {
  staffs: Pick<Staff, 'name' | 'employment_type'>
}

export interface ShiftRequestWithStaff extends ShiftRequest {
  staffs: Pick<Staff, 'name'>
}

export interface OffRequestWithStaff extends OffRequest {
  staffs: Pick<Staff, 'name'>
}
