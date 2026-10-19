/**
 * 授权**前端策略层**单测（2026-10-19）
 *
 * 这一层决定三件事：**该不该拦用户、顶栏显示什么、页面上弹什么提示**。
 * 它最危险的失效形态同样是"静默误导"，而且不会报错：
 *   · 已过期的授权被判成"正常" ⇒ 用户以为能用到明天，结果中途停服；
 *   · 宽限期被判成"已过期" ⇒ 明明还能用却把用户拦在门外；
 *   · 开发模式被判成"未授权" ⇒ 开发者每次启动都被弹到授权页（会让人干脆把守卫删掉）；
 *   · 守卫把 `/license` 也拦了 ⇒ 死循环，谁都进不去。
 * 所以每个分支都钉一条断言，且**拦截/放行两侧都要有**。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  deriveLicenseUi,
  daysUntil,
  emptyLicenseStatus,
  LICENSE_EXPIRING_SOON_DAYS,
  shouldRedirectToLicense,
  type LicenseStatusView,
} from '../../utils/mp/licensePolicy.ts'

const DAY = 86400000
const NOW = Date.UTC(2026, 0, 15, 12, 0, 0)
const sec = (ms: number) => Math.floor(ms / 1000)

/** 构造一个"已授权"的状态，再按需覆盖字段 */
function mkStatus(over: Partial<LicenseStatusView> = {}): LicenseStatusView {
  return {
    ...emptyLicenseStatus(),
    licensed: true,
    code: 'ok',
    message: '授权有效',
    machineCode: 'A1B2-C3D4-E5F6-0718',
    subject: '测试',
    licenseId: 'TH-TEST',
    issuedAt: sec(NOW - 10 * DAY),
    expiresAt: sec(NOW + 30 * DAY),
    graceUntil: sec(NOW + 44 * DAY),
    activatedAt: '2026-01-05T00:00:00.000Z',
    ...over,
  }
}

test('daysUntil：向上取整、可正可负，非法值返回 null', () => {
  assert.equal(daysUntil(sec(NOW + 30 * DAY), NOW), 30)
  // 剩 0.4 天 ⇒ 显示 1 天（比显示 0 天更符合直觉）
  assert.equal(daysUntil(sec(NOW + 0.4 * DAY), NOW), 1)
  assert.equal(daysUntil(sec(NOW), NOW), 0)
  assert.equal(daysUntil(sec(NOW - 3 * DAY), NOW), -3)
  // 0 / 负数 / NaN ⇒ null（表示"没有这个概念"，而不是"已过期很久"）
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(daysUntil(bad, NOW), null, `应返回 null：${bad}`)
  }
})

test('开发模式：放行，但必须标成 dev（不能误判成"未授权"把人拦走）', () => {
  const ui = deriveLicenseUi(mkStatus({ licensed: false, code: 'not_activated', devBypass: true }), NOW)
  assert.equal(ui.kind, 'dev')
  assert.equal(ui.mustActivate, false)
  assert.equal(ui.chip.color, 'info')
  assert.ok(ui.banner !== null, '开发模式应当有横幅说明"校验未生效"')
})

test('正常授权（远未到期）：放行 + 绿色 chip + 无横幅', () => {
  const ui = deriveLicenseUi(mkStatus(), NOW)
  assert.equal(ui.kind, 'ok')
  assert.equal(ui.mustActivate, false)
  assert.equal(ui.chip.color, 'success')
  assert.equal(ui.banner, null)
  assert.equal(ui.daysLeft, 30)
})

test('即将到期（≤ 阈值）：仍放行，但要提醒续期', () => {
  const ui = deriveLicenseUi(mkStatus({ expiresAt: sec(NOW + (LICENSE_EXPIRING_SOON_DAYS - 2) * DAY) }), NOW)
  assert.equal(ui.kind, 'expiring')
  assert.equal(ui.mustActivate, false, '快到期但仍有效 ⇒ 不能拦')
  assert.equal(ui.chip.color, 'warning')
  assert.ok(ui.banner !== null)
  assert.equal(ui.daysLeft, LICENSE_EXPIRING_SOON_DAYS - 2)
})

test('今天到期：仍算 expiring（还有效），文案要说清楚', () => {
  const ui = deriveLicenseUi(mkStatus({ expiresAt: sec(NOW) }), NOW)
  assert.equal(ui.kind, 'expiring')
  assert.equal(ui.mustActivate, false)
  assert.equal(ui.daysLeft, 0)
  assert.match(ui.chip.text, /今日到期/)
})

test('宽限期内（已过 exp 但未过 grace）：**放行**并催续期（这是最容易写错成"拦"的分支）', () => {
  const ui = deriveLicenseUi(mkStatus({ degraded: true, expiresAt: sec(NOW - 2 * DAY), graceUntil: sec(NOW + 12 * DAY) }), NOW)
  assert.equal(ui.kind, 'degraded')
  assert.equal(ui.mustActivate, false, '宽限期内必须能用 —— 否则"离线宽限"就没有意义')
  assert.equal(ui.chip.color, 'warning')
  assert.ok(ui.banner !== null)
  assert.equal(ui.daysLeft, 12)
})

test('授权已彻底过期（grace_expired）：拦，并给出"已过期"而非"未激活"的原因', () => {
  const ui = deriveLicenseUi(mkStatus({ licensed: false, code: 'grace_expired' }), NOW)
  assert.equal(ui.kind, 'expired')
  assert.equal(ui.mustActivate, true)
  assert.equal(ui.chip.color, 'error')
  assert.ok(ui.banner !== null)
})

test('未激活：拦，文案是"未授权"（与"已过期"区分开）', () => {
  for (const code of ['not_activated', 'fingerprint_mismatch', 'bad_signature', 'malformed']) {
    const ui = deriveLicenseUi({ ...emptyLicenseStatus(), licensed: false, code }, NOW)
    assert.equal(ui.kind, 'unlicensed', `code=${code} 应归为 unlicensed`)
    assert.equal(ui.mustActivate, true)
    assert.equal(ui.chip.color, 'warning')
  }
})

test('路由守卫：该拦的都拦、该放的都放', () => {
  const unlicensed = { ...emptyLicenseStatus(), licensed: false, code: 'not_activated' }
  // 拦
  for (const p of ['/', '/runs', '/field', '/data', '/morning-sign', '/version-info']) {
    assert.equal(shouldRedirectToLicense(unlicensed, p, NOW), true, `未授权应拦：${p}`)
  }
  // 放
  assert.equal(shouldRedirectToLicense(unlicensed, '/license', NOW), false, '授权页自身绝不能拦（否则死循环）')
  assert.equal(shouldRedirectToLicense(mkStatus(), '/runs', NOW), false, '已授权不该拦')
  assert.equal(shouldRedirectToLicense(mkStatus({ degraded: true }), '/runs', NOW), false, '宽限期不该拦')
  assert.equal(shouldRedirectToLicense(mkStatus({ expiresAt: sec(NOW + DAY) }), '/runs', NOW), false, '快到期不该拦')
  assert.equal(
    shouldRedirectToLicense({ ...emptyLicenseStatus(), devBypass: true }, '/runs', NOW),
    false,
    '开发模式不该拦',
  )
})

test('emptyLicenseStatus：字段齐全（防止模板里出现 undefined.xxx）', () => {
  const s = emptyLicenseStatus()
  const expected = [
    'licensed', 'code', 'degraded', 'message', 'machineCode', 'machineCodeStable',
    'publicKeyConfigured', 'devBypass', 'enforced', 'subject', 'licenseId', 'features',
    'issuedAt', 'expiresAt', 'graceUntil', 'activatedAt', 'dir',
  ]
  for (const k of expected) assert.ok(k in s, `缺少字段：${k}`)
  assert.equal(s.licensed, false)
  assert.ok(Array.isArray(s.features))
})

test('三种状态的 mustActivate 组合互斥且完整（状态机不重叠）', () => {
  const cases: Array<[LicenseStatusView, string, boolean]> = [
    [mkStatus(), 'ok', false],
    [mkStatus({ expiresAt: sec(NOW + DAY) }), 'expiring', false],
    [mkStatus({ degraded: true }), 'degraded', false],
    [{ ...emptyLicenseStatus(), devBypass: true }, 'dev', false],
    [{ ...emptyLicenseStatus(), code: 'grace_expired' }, 'expired', true],
    [emptyLicenseStatus(), 'unlicensed', true],
  ]
  for (const [s, kind, must] of cases) {
    const ui = deriveLicenseUi(s, NOW)
    assert.equal(ui.kind, kind)
    assert.equal(ui.mustActivate, must, `${kind} 的 mustActivate 应为 ${must}`)
  }
})
