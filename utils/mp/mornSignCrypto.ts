/**
 * 早操签到提交所需的 **RSA 分段加密**（纯函数，可离线单测）—— 2026-09-18
 *
 * ## 这个端点的协议要求
 * `morningExercises` 是唯一使用加密参的端点：请求体只有一个字段 `{ encryptParams }`，
 * 其值 = 「业务 JSON 明文」经 RSA/PKCS#1 v1.5 **分段**加密后、各段密文拼接并整体 Base64。
 *
 * 分段是**协议硬约束**（不是实现选择）：
 * ```text
 * 单段明文上限 = 128 − 11 = 117 字节     // 1024-bit 密钥的 PKCS#1 v1.5 填充开销是 11 字节
 * 分段必须按 UTF-8 字节宽度切，不能按字符切   // 一个中文字符占 3 字节，按字符切会让某段超限
 * 各段密文拼接 → 整体 Base64              // ⚠️ 拼接与 Base64 是 Node 侧的产物
 * ```
 * 该口径与公开库 JSEncrypt 的 `encryptLong` 行为一致（JSEncrypt 为 MIT 许可的公开库）；
 * 本实现直接使用 Node 内置 `crypto`，不引入该库。
 *
 * ## 为什么可以离线自证
 * 加密是**纯函数**（只依赖公钥），所以单测可以：造一对密钥 → 用本模块加密 → 用私钥解密
 * → **逐字节比对原文**。这样"117 字节分段 / 密文长度 = 128×段数 / 中文不裂"都能在没有线上凭据时证明。
 *
 * ⚠️ 本模块**只负责加密**，不发起任何请求；是否提交由调用方与用户决定。
 */
import { constants, createPublicKey, publicEncrypt, type KeyObject } from 'node:crypto'

/**
 * `morningExercises` 端点加密所使用的**服务端公钥**（1024-bit，SPKI/DER，Base64）。
 *
 * 🔒 这是**公钥**，不是机密：加密必须用它，而公钥本质上是可以公开的材料
 *    （协议中客户端所持有的就是它）。它也不构成任何人的"可版权表达" —— 公钥是算法参数，
 *    换掉它服务端就解不开密文。
 *
 * ⚠️ 运维注意：服务端若**轮换密钥**，本常量必须同步更新，否则签到提交会**静默失败**
 *    （客户端用旧公钥加密 → 服务端解不开）。排查方法：抓一次真实签到请求，
 *    验证 `encryptParams` 能否被新公钥解密。
 */
export const MORNSIGN_PUBLIC_KEY_B64 =
  'MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQC/dTvkr4EMAVX2Op39VYwufkOG1X6bDIXY8SPwOAujssdHuj/AbJKKAPAHYfNKFSt6IsPKNJcQRd94B1cc1Qb+AHOR+Zj4QnfGU7JLw0W2NrobGX3i6wBJCgxmvXqKDp+7fXs/r1zo76krrIj+bEEHKo3hPbLKaI1Xw9B1mFPUEQIDAQAB'

/** 1024-bit 密钥单段明文上限：128 − 11（PKCS#1 v1.5 填充开销） */
export const RSA_CHUNK_BYTES = 117

const keyCache = new Map<string, KeyObject>()

const publicKeyOf = (b64: string): KeyObject => {
  const cached = keyCache.get(b64)
  if (cached) return cached
  const key = createPublicKey({ key: Buffer.from(b64, 'base64'), format: 'der', type: 'spki' })
  keyCache.set(b64, key)
  return key
}

/**
 * 按 **UTF-8 字节宽度**把字符串切成每段 ≤ `maxBytes` 字节的片段。
 *
 * ⚠️ **不能按 `slice()` 切字符**：一个中文字符占 3 字节，按字符切会让某一段的字节数超限
 *    （PKCS#1 的上限是硬约束，超了 `publicEncrypt` 直接抛错）。所以这里逐字符累计字节宽度。
 *    等价的另一说法是按码点判断 UTF-8 编码长度（1/2/3/4 字节），本实现就用这个判据。
 */
export function splitUtf8ByBytes(value: string, maxBytes = RSA_CHUNK_BYTES): string[] {
  const out: string[] = []
  let cur = ''
  let bytes = 0
  for (const ch of value) {
    const c = ch.codePointAt(0) ?? 0
    const w = c <= 0x7f ? 1 : c <= 0x7ff ? 2 : c <= 0xffff ? 3 : 4
    if (bytes + w > maxBytes) {
      out.push(cur)
      cur = ch
      bytes = w
    } else {
      cur += ch
      bytes += w
    }
  }
  if (cur) out.push(cur)
  return out
}

/** 单段加密（PKCS#1 v1.5）；段长超限时抛错（而不是静默截断） */
export function encryptChunk(chunk: string, publicKeyB64 = MORNSIGN_PUBLIC_KEY_B64): Buffer {
  const bytes = Buffer.byteLength(chunk, 'utf8')
  if (bytes > RSA_CHUNK_BYTES) {
    throw new Error(`单段明文 ${bytes} 字节超过上限 ${RSA_CHUNK_BYTES}（应先分段）`)
  }
  return publicEncrypt({ key: publicKeyOf(publicKeyB64), padding: constants.RSA_PKCS1_PADDING }, Buffer.from(chunk, 'utf8'))
}

/**
 * 长明文加密：分段加密 → 密文拼接 → 整体 Base64。
 * 空明文返回空串（协议上空内容无需加密，服务端也不需要解）。
 */
export function encryptLong(value: string, publicKeyB64 = MORNSIGN_PUBLIC_KEY_B64): string {
  const text = String(value ?? '')
  if (!text) return ''
  const chunks = splitUtf8ByBytes(text)
  return Buffer.concat(chunks.map((c) => encryptChunk(c, publicKeyB64))).toString('base64')
}
