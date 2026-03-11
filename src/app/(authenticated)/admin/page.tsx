'use client'

import { useState } from 'react'
import { BarChart2, Banknote, UserPlus } from 'lucide-react'
import { LaborCostTab, StaffManagementTab } from '@/app/(authenticated)/manage/page'

type AdminTab = 'salary' | 'staff'

export default function AdminPage() {
  const [activeTab, setActiveTab] = useState<AdminTab>('salary')

  return (
    <div className="px-4 pt-4 pb-24 max-w-lg mx-auto">
      {/* ヘッダー */}
      <div className="flex items-center gap-2 mb-4">
        <BarChart2 className="h-5 w-5" />
        <h1 className="text-lg font-bold">管理</h1>
      </div>

      {/* タブナビ */}
      <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
        <button
          onClick={() => setActiveTab('salary')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
            activeTab === 'salary' ? 'bg-zinc-900 text-white' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
          }`}>
          <Banknote className="h-4 w-4" />
          人件費
        </button>
        <button
          onClick={() => setActiveTab('staff')}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
            activeTab === 'staff' ? 'bg-zinc-900 text-white' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
          }`}>
          <UserPlus className="h-4 w-4" />
          スタッフ管理
        </button>
      </div>

      {/* タブコンテンツ */}
      {activeTab === 'salary' && <LaborCostTab />}
      {activeTab === 'staff' && <StaffManagementTab />}
    </div>
  )
}
