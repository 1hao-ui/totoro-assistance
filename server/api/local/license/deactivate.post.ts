/**
 * `POST /api/local/license/deactivate` —— 解绑本机授权（仅本机）
 *
 * 用途：换机器、重装前主动解绑（把授权"腾出来"），或用户想换一张证书时先清掉旧的。
 * 幂等：本来就没有授权文件时同样返回成功。
 * ⚠️ 解绑**不会**让发布者那侧的记录消失，也不会自动回收席位（离线签发模型下做不到实时回收）——
 *    需要真正回收席位时得让发布者手工作废那张证书（阶段②的在线激活接口才能自动回收）。
 */
import { defineEventHandler } from 'h3'
import { deactivateLicense } from '../../../utils/license/state'
import { assertLocalRequest } from '../../../utils/tokenScanState'

export default defineEventHandler((event) => {
  assertLocalRequest(event)
  return { ok: true, status: deactivateLicense() }
})
