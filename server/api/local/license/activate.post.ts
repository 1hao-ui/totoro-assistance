/**
 * `POST /api/local/license/activate` —— 用发布者签发的证书激活本机（仅本机）
 *
 * 请求体：`{ certificate: string }`（用户从发布者那里拿到的证书原文）
 * 返回：`{ ok, error, status }`
 *
 * ⚠️ **失败时绝不落盘**：把一张坏证书写进 license.json 会变成"以后每次启动都报错、还难查"的隐性问题，
 *    所以只在验签 + 机器码匹配都通过后才写（见 `activateLicense`）。
 */
import { defineEventHandler, readBody } from 'h3'
import { activateLicense } from '../../../utils/license/state'
import { assertLocalRequest } from '../../../utils/tokenScanState'

export default defineEventHandler(async (event) => {
  assertLocalRequest(event)
  const body = await readBody<{ certificate?: unknown }>(event).catch(() => null)
  const result = activateLicense(String(body?.certificate ?? ''))
  /**
   * 失败返回 **200 + `ok:false`**，而不是抛 4xx：
   * "证书不对"是**业务结果**（要连同 status 一起给前端渲染提示），不是传输/权限错误。
   * 若抛 402，前端拿不到 status，界面就会只剩一句干巴巴的报错。
   */
  return { ok: result.ok, error: result.error, status: result.status }
})
