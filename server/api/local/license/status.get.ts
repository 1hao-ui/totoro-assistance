/**
 * `GET /api/local/license/status` —— 查本机授权状态（仅本机）
 *
 * 返回的内容**不含任何秘密**：机器码、判定码、有效期、授权对象。前端「授权」页据此渲染。
 * ⚠️ 强制重算（`getLicenseStatus(true)`）：本接口只在页面加载时调用，代价是一次 Ed25519 验签（约 50 微秒），
 *    换来"界面永远显示真实状态"——缓存导致的"刚激活却显示未激活"是最容易引起误会的 bug。
 */
import { defineEventHandler } from 'h3'
import { getLicenseStatus } from '../../../utils/license/state'
import { assertLocalRequest } from '../../../utils/tokenScanState'

export default defineEventHandler((event) => {
  assertLocalRequest(event)
  return { ok: true, status: getLicenseStatus(true) }
})
