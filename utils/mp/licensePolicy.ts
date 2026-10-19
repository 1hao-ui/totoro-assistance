/**
 * 授权状态的前端**纯策略层**：把「服务端返回的状态」翻译成「界面该显示什么、该不该拦」。
 *
 * ## 为什么单独抽一层（不写在页面/组件里）
 * 这套判断有 5 个分支（开发模式 / 正常 / 即将到期 / 宽限期内 / 未激活或已过期），
 * 散落在页面模板、顶栏 chip、路由守卫三处的话，**三个地方迟早各说各话**
 * （顶栏显示"已授权"、页面却拦着不让用，是最容易出现的自相矛盾）。
 * 抽成纯函数后：一处定义、三处复用、而且能离线单测。
 *
 * ## 纯函数约束
 * 本文件**不 import 任何框架**（vue/nuxt/#app 都不行）—— 这是仓库对算法层（`utils/mp/**`）的硬规则，
 * 也是它能被 `tests/mp/licensePolicy.test.ts` 直接跑的前提。时间一律由调用方传入（`nowMs`）。
 */

/** `/api/local/license/status` 返回的 `status` 结构（与 `server/utils/license/state.ts` 的 `LicenseStatus` 对应） */
export interface LicenseStatusView {
  /** 是否**可以放行**（= 证书有效，或处于 dev 绕过） */
  licensed: boolean
  /** 证书判定的真实结论码（`ok` / `not_activated` / `fingerprint_mismatch` / `grace_expired` …） */
  code: string
  /** 已过有效期但仍在离线宽限期内 */
  degraded: boolean
  /** 面向用户的一句话说明（服务端给） */
  message: string
  /** 本机机器码（显示形态，如 `A1B2-C3D4-E5F6-0718`） */
  machineCode: string
  /** 机器码是否已持久化；false = 下次运行会变 */
  machineCodeStable: boolean
  /** 发布者是否已配置公钥 */
  publicKeyConfigured: boolean
  /** 是否因开发模式而放行（生产构建恒为 false） */
  devBypass: boolean
  /** 是否处于强制校验口径 */
  enforced: boolean
  /** 授权对象 */
  subject: string
  /** 许可证编号 */
  licenseId: string
  /** 功能位 */
  features: string[]
  /** 签发时间（Unix 秒；0 = 无） */
  issuedAt: number
  /** 正常到期（Unix 秒；0 = 无） */
  expiresAt: number
  /** 离线宽限硬上限（Unix 秒；0 = 无） */
  graceUntil: number
  /** 激活时间（ISO） */
  activatedAt: string
  /** 授权数据目录 */
  dir: string
}

/** 提前多少天开始提醒续期（太早会烦，太晚来不及换证） */
export const LICENSE_EXPIRING_SOON_DAYS = 7

/** 界面上的授权状态分类 */
export type LicenseUiKind = 'unlicensed' | 'dev' | 'ok' | 'expiring' | 'degraded' | 'expired'

export interface LicenseChip {
  text: string
  /** Vuetify 颜色名 */
  color: string
  /** mdi 图标名 */
  icon: string
}

export interface LicenseBanner {
  type: 'info' | 'warning' | 'error'
  title: string
  text: string
}

export interface LicenseUiState {
  kind: LicenseUiKind
  /** 是否应该把用户**拦到** `/license`（仅"不能用"的状态才为 true） */
  mustActivate: boolean
  /** 顶栏状态 chip */
  chip: LicenseChip
  /** 页面横幅（null = 不显示） */
  banner: LicenseBanner | null
  /** 距正常到期还有几天（向上取整；null = 无期限/未激活） */
  daysLeft: number | null
}

/** 未激活时的默认状态（字段齐全，避免模板里出现 `undefined.xxx`） */
export function emptyLicenseStatus(): LicenseStatusView {
  return {
    licensed: false,
    code: 'not_activated',
    degraded: false,
    message: '正在读取授权状态…',
    machineCode: '',
    machineCodeStable: true,
    publicKeyConfigured: true,
    devBypass: false,
    enforced: true,
    subject: '',
    licenseId: '',
    features: [],
    issuedAt: 0,
    expiresAt: 0,
    graceUntil: 0,
    activatedAt: '',
    dir: '',
  }
}

/**
 * 距某个 Unix 秒时刻还有多少天（**向上取整**：剩 0.4 天会显示"1 天"，比显示"0 天"更符合直觉）。
 * @returns 已过期时为负数；`epochSec` 非法/为 0 时返回 `null`（表示"没有这个概念"）
 */
export function daysUntil(epochSec: number, nowMs: number): number | null {
  if (!Number.isFinite(epochSec) || epochSec <= 0) return null
  const diffMs = epochSec * 1000 - nowMs
  return Math.ceil(diffMs / 86400000)
}

/**
 * 由服务端状态推导界面状态。**这是三处 UI 的唯一判据。**
 *
 * 判定顺序（短路，互斥）：
 * ① 开发模式绕过 → `dev`（放行，但界面要明确标注"未生效"，避免误以为门禁坏了）
 * ② 已授权 + 在宽限期内 → `degraded`（放行，但必须催续期）
 * ③ 已授权 + 剩余 ≤ 7 天 → `expiring`（放行 + 提醒）
 * ④ 已授权 → `ok`
 * ⑤ 证书判定为"宽限也过了" → `expired`（拦住）
 * ⑥ 其余（未激活 / 机器码不匹配 / 签名无效 …）→ `unlicensed`（拦住）
 */
export function deriveLicenseUi(status: LicenseStatusView, nowMs: number = Date.now()): LicenseUiState {
  // ① 开发模式：放行，但界面要能看出"这不是正式校验"
  if (status.devBypass) {
    return {
      kind: 'dev',
      mustActivate: false,
      chip: { text: '开发模式', color: 'info', icon: 'mdi-wrench-outline' },
      banner: {
        type: 'info',
        title: '开发模式：授权校验未生效',
        text: '当前运行的是开发版，门禁不拦截请求；打包后的正式版会强制校验。',
      },
      daysLeft: null,
    }
  }

  // ② 已授权但在宽限期内：能用，但必须说清楚"正在透支"
  if (status.licensed && status.degraded) {
    return {
      kind: 'degraded',
      mustActivate: false,
      chip: { text: '宽限期', color: 'warning', icon: 'mdi-timer-alert-outline' },
      banner: {
        type: 'warning',
        title: '授权已过期，正在离线宽限期内',
        text: '程序仍可继续使用，但超过宽限截止时间后会停止服务，请尽快联系发布者续期。',
      },
      daysLeft: daysUntil(status.graceUntil, nowMs),
    }
  }

  // ③ / ④ 正常授权：区分"快到期了"与"还早"
  if (status.licensed) {
    const left = daysUntil(status.expiresAt, nowMs)
    if (left !== null && left <= LICENSE_EXPIRING_SOON_DAYS) {
      return {
        kind: 'expiring',
        mustActivate: false,
        chip: { text: left <= 0 ? '今日到期' : `剩 ${left} 天`, color: 'warning', icon: 'mdi-calendar-clock' },
        banner: {
          type: 'warning',
          title: '授权即将到期',
          text: `距正常到期还有约 ${Math.max(left, 0)} 天，请提前联系发布者续期（到期后仍有离线宽限期，但不宜依赖）。`,
        },
        daysLeft: left,
      }
    }
    return {
      kind: 'ok',
      mustActivate: false,
      chip: {
        text: left === null ? '已授权' : `已授权 · ${left} 天`,
        color: 'success',
        icon: 'mdi-shield-check-outline',
      },
      banner: null,
      daysLeft: left,
    }
  }

  // ⑤ 宽限期也过了：明确"授权已失效"，与"还没激活"区分开（处理方式一样，但原因不同）
  if (status.code === 'grace_expired') {
    return {
      kind: 'expired',
      mustActivate: true,
      chip: { text: '授权已过期', color: 'error', icon: 'mdi-shield-off-outline' },
      banner: {
        type: 'error',
        title: '授权已过期',
        text: '已超出离线宽限期，请向发布者重新申请授权证书。',
      },
      daysLeft: 0,
    }
  }

  // ⑥ 未激活 / 证书与本机不符 / 签名无效 …
  return {
    kind: 'unlicensed',
    mustActivate: true,
    chip: { text: '未授权', color: 'warning', icon: 'mdi-shield-alert-outline' },
    banner: null,
    daysLeft: null,
  }
}

/**
 * 路由守卫的判据：**该不该把用户拦到 `/license`**。
 *
 * 三条刻意设计：
 * ① 授权页自身永远放行 —— 否则会变成"要激活先去授权页，去授权页要先激活"的死循环；
 * ② 只有 `mustActivate` 才拦 —— 开发模式/宽限期/快到期都放行，只是提示；
 * ③ 判据只依赖**服务端返回的状态**，前端算不出别的花样。
 */
export function shouldRedirectToLicense(status: LicenseStatusView, path: string, nowMs: number = Date.now()): boolean {
  if (path === '/license') return false
  return deriveLicenseUi(status, nowMs).mustActivate
}
