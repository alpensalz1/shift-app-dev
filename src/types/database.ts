export interface Shop {
  id: number
  name: string
  created_at: string
}

export interface Staff {
  id: number
  name: string
  token: string
  employment_type: '社員' | 'アルバイト'
  wage: number
  is_active: boolean
  created_at: string
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
}

export interface ShiftFixed {
  id: number
  date: string
  shop_id: number
  type: '仕込み' | '営業'
  staff_id: number
  start_time: string
  end_time: string
  created_at: string
}

// JOIN 結果用
export interface ShiftFixedWithStaff extends ShiftFixed {
  staffs: Pick<Staff, 'name'>
  shops: Pick<Shop, 'name'>
}

export interface ShiftRequestWithStaff extends ShiftRequest {
  staffs: Pick<Staff, 'name'>
}
