/**
 * 授权闸门的**纯判定逻辑**（与 HTTP 层解耦，便于单测）。
 *
 * ## 为什么要把这段判定单独抽出来 + 归一化路径
 * 中间件用的是 `event.path` 这类**原始**请求路径，而路由匹配用的是**归一化后**的路径。
 * 只要两者可能不一致，"前缀放行"就会出现理论绕过面。最典型的三种：
 * ```
 *   GET /api/local/license/../../mp/getData     ← 归一化后是 /api/mp/getData（真正的业务接口！）
 *   GET /api/local/license/%2e%2e/%2e%2e/mp/x   ← URL 编码的 ../，解码后同上
 *   GET /api/local/license/../../local/mornsign-submit
 * ```
 * 若只看"是否以 `/api/local/license/` 开头"，上面三条都会被判成"授权接口 ⇒ 放行"，
 * 然后被路由**归一化后**分发到真正的业务处理器 ⇒ **未授权用户直接拿到核心能力**。
 * 所以：判定必须建立在**归一化（解码 + 折叠 `.`/`..`）之后**的路径上。
 *
 * ## 放行名单为什么用"精确前缀"而不是"以 / 开头的前缀"
 * `path.startsWith('/api/local/license/')` 挡不住 `/api/local/license`（无尾斜杠）；
 * 而 `path.startsWith('/api/local/license')` 会**误放行** `/api/local/licenseX`（将来新增的别的接口）。
 * 这里用 `path === P || path.startsWith(P + '/')`：既覆盖有无尾斜杠，又不吃相邻名字。
 */
import type { H3Event } from 'h3'

/** 只有 `/api/` 下的请求需要授权（页面外壳与静态资源必须放行，否则用户连「授权」页都打不开） */
export const LICENSE_API_PREFIX = '/api/'

/** 授权自身的接口（查状态 / 激活 / 解绑）—— 拦了它们就会**自锁死循环**，永远激活不了 */
export const LICENSE_EXEMPT_PREFIX = '/api/local/license'

export type LicenseGateReason = 'not-api' | 'license-endpoint' | 'api'

export interface LicenseGateDecision {
  /** 是否需要校验授权（`false` = 直接放行） */
  needsLicense: boolean
  reason: LicenseGateReason
  /** 归一化后的路径（排查用：与实际路由匹配的形态一致） */
  path: string
}

/**
 * 归一化请求路径：URL 解码 + 折叠空段/`.`/`..`，结果恒以 `/` 开头、无尾斜杠。
 *
 * ⚠️ 解码失败（非法百分号转义，如 `%zz`、截断的 `%E4`）时**保留原串**、不做任何猜测 ——
 * 原始串里的 `%2e%2e` 之类不会被我们"善意解释"成 `..`，于是它会自然落进"需要授权"那一支（保守方向）。
 */
export function normalizeLicensePath(raw: unknown): string {
  const text = String(raw ?? '')
  let decoded = text
  try {
    decoded = decodeURIComponent(text)
  } catch {
    // 非法转义：保留原始串（不猜测意图），前缀判定会把未知形状归入"需要授权"
    decoded = text
  }
  const out: string[] = []
  for (const seg of decoded.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') {
      out.pop()
      continue
    }
    out.push(seg)
  }
  return `/${out.join('/')}`
}

/** 是否属于"授权自身接口"（精确匹配或其后紧跟 `/`） */
export function isLicenseExemptPath(path: string): boolean {
  return path === LICENSE_EXEMPT_PREFIX || path.startsWith(`${LICENSE_EXEMPT_PREFIX}/`)
}

/** 闸门判定（纯函数：输入原始路径，输出是否需要授权） */
export function decideLicenseGate(rawPathname: unknown): LicenseGateDecision {
  const path = normalizeLicensePath(rawPathname)
  if (!path.startsWith(LICENSE_API_PREFIX)) return { needsLicense: false, reason: 'not-api', path }
  if (isLicenseExemptPath(path)) return { needsLicense: false, reason: 'license-endpoint', path }
  return { needsLicense: true, reason: 'api', path }
}

/** 从事件取原始路径（只读；取不到就给空串 ⇒ 归一化为 `/` ⇒ 放行，服务端路由自会 404） */
export function pathnameOf(event: H3Event): string {
  return String(event.node?.req?.url ?? '').split('?')[0] || '/'
}
