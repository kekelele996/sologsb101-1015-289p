/**
 * 加固件（Support）
 * 支撑杆、拉纤、避雷设施，按检查周期自动提示超期未检查。
 * 冬季 / 汛期无法上树时可申请缓检：以缓检日作为下次检查日期，登记检查后自动清除缓检。
 */

/** 加固件类型 */
export type SupportType = '支撑杆' | '拉纤' | '避雷'

export const SUPPORT_TYPE_OPTIONS: SupportType[] = ['支撑杆', '拉纤', '避雷']

export interface Support {
  id: string
  /** 所属古树 */
  treeId: string
  /** 类型 */
  type: SupportType
  /** 安装日期 YYYY-MM-DD */
  installDate: string
  /** 检查周期（月） */
  checkCycleMon: number
  /** 最近检查日期 YYYY-MM-DD */
  lastCheckDate: string
  /** 缓检日 YYYY-MM-DD：下次检查日期以缓检日为准（早于原到期日则仍按原到期日算）；空串表示未缓检 */
  deferDate: string
  /** 缓检理由（如冬季上不了树、汛期无法作业） */
  deferReason: string
  createdAt: string
  updatedAt: string
  revision: number
}

/** 新建 / 编辑加固件的表单草稿 */
export interface SupportDraft {
  treeId: string
  type: SupportType
  installDate: string
  checkCycleMon: number
  lastCheckDate: string
}
