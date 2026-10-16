/**
 * **本机身份**：数据目录、实例 ID、机器码。
 *
 * ## 🔴 为什么这里**不用** `RUNTIME_DIR`（`logger.ts` 的 `%TEMP%\totoro-heaven-runtime`）
 * 仓库里日志 / 抓包存档都放 `%TEMP%` —— 那是**可丢弃**的运行数据，被清掉无所谓。
 * 但**许可证不是**：`%TEMP%` 会被 Windows 磁盘清理、安全软件、`cleanmgr` 清空，
 * 一旦授权文件随临时目录消失，用户会在**毫无预兆**的情况下突然"未授权"，
 * 而且他手里的证书因为机器码变了也**再也激活不回去**（等于要重新找供应商签发）。
 * ⇒ 授权数据放**每用户持久目录** `%LOCALAPPDATA%\totoro-heaven`（`TOTORO_LICENSE_DIR` 可覆盖，供测试）。
 *
 * ## 机器码怎么算（为什么是这三样）
 * ```
 * sha256('totoro-license-v1' | 实例ID | platform | arch) 的前 16 位 hex
 * ```
 * - **实例 ID**：首次运行随机生成（UUID）、落盘持久化。它是"这台机器上的这个安装"的身份，
 *   也是防"把证书文件拷给同学"的主力 —— 对方机器上的实例 ID 不同 ⇒ 指纹对不上。
 * - **platform / arch**：与实例 ID 一起哈希，换操作系统/换架构（x64→arm64）后指纹变化。
 * - ❌ **故意不含** `hostname` / CPU 型号 / 内存大小：这些用户改个计算机名、加条内存就会变，
 *   会造成"什么都没干授权就没了"的客服灾难。稳定性优先 —— 这类破解成本由**续期 + 席位**去压，
 *   不靠脆弱的硬件指纹（详见 `certificate.ts` 文件头的分层说明）。
 *
 * ⚠️ 已知边界（如实记录，不粉饰）：把 `license.json` **和** `instance-id` 两个文件一起拷到别的机器，
 *    指纹还是对得上的（因为指纹由这两个文件推出）。要根治必须引入服务端在线校验 ——
 *    这正是供应商那侧"阶段②（Cloudflare Worker 激活）"才能补上的能力。
 */
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { arch, homedir, platform } from 'node:os'
import { join } from 'node:path'
import { formatMachineCode, MACHINE_CODE_HEX_LEN } from './certificate'

/** 指纹哈希前缀：将来改口径时递增，老指纹自然失效（比"悄悄算错"可控） */
const FINGERPRINT_SALT = 'totoro-license-v1'

/** 实例 ID 的合法形状（UUID v4；用正则卡住，防止文件被写坏后一直算出不同的机器码） */
const INSTANCE_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * 授权数据目录（**持久**，见文件头）。
 * Windows 上 `LOCALAPPDATA` 恒存在；若缺失（被精简的容器/CI）则退回用户主目录，保证仍有可写位置。
 */
export const LICENSE_DIR =
  process.env.TOTORO_LICENSE_DIR?.trim() ||
  join(process.env.LOCALAPPDATA?.trim() || process.env.APPDATA?.trim() || homedir(), 'totoro-heaven')

/** 授权证书文件（内容 = 已激活的证书 + 激活时间，**不含秘密**：证书本身是公开可存的签名产物） */
export const LICENSE_FILE = join(LICENSE_DIR, 'license.json')

/** 实例 ID 文件（随机 UUID，一次生成、长期复用） */
export const INSTANCE_ID_FILE = join(LICENSE_DIR, 'instance-id')

/** 建目录（幂等；失败不抛，由调用方按 `persisted=false` 处理） */
function ensureDir(): boolean {
  try {
    if (!existsSync(LICENSE_DIR)) mkdirSync(LICENSE_DIR, { recursive: true })
    return true
  } catch {
    // 建目录失败（磁盘满/权限）：返回 false，由调用方决定"内存里继续跑"还是报错，这里不抛
    return false
  }
}

/** 进程内缓存：同一进程里机器码是常量，不必每次读盘 */
let cachedInstanceId: string | null = null

/**
 * 取本机实例 ID。读不到就生成一个并落盘。
 *
 * @returns `id` 实例 ID；`persisted` 是否成功落盘（false = 本次能用、下次会变，界面**必须**提示）
 */
export function getInstanceId(): { id: string; persisted: boolean } {
  if (cachedInstanceId) return { id: cachedInstanceId, persisted: true }
  try {
    if (existsSync(INSTANCE_ID_FILE)) {
      const text = readFileSync(INSTANCE_ID_FILE, 'utf8').trim()
      if (INSTANCE_ID_RE.test(text)) {
        cachedInstanceId = text.toLowerCase()
        return { id: cachedInstanceId, persisted: true }
      }
      // 文件在但内容坏了（写了一半/被手工改过）⇒ 当它不存在，下面重建；不抛错、不让程序起不来
    }
  } catch {
    // 读失败（权限/被占用）：走下面的重建路径，重建也失败时返回"未持久化"，绝不抛
  }
  const fresh = randomUUID()
  cachedInstanceId = fresh
  const dirOk = ensureDir()
  if (!dirOk) return { id: fresh, persisted: false }
  try {
    writeFileSync(INSTANCE_ID_FILE, `${fresh}\n`, 'utf8')
    return { id: fresh, persisted: true }
  } catch {
    // 写不进去：本次运行仍可用（id 在内存里），但**下次机器码会变** ⇒ 由 persisted=false 上报给界面
    return { id: fresh, persisted: false }
  }
}

/**
 * 本机机器指纹（16 位小写 hex）—— 证书里的 `fp` 必须等于它。
 * 纯计算 + 一次读盘（首次）；运行期调用**零额外开销**（实例 ID 已缓存）。
 */
export function machineFingerprint(): string {
  const { id } = getInstanceId()
  return createHash('sha256')
    .update([FINGERPRINT_SALT, id, platform(), arch()].join('|'))
    .digest('hex')
    .slice(0, MACHINE_CODE_HEX_LEN)
}

/** 显示用机器码（`A1B2-C3D4-E5F6-7890`）—— 用户念给供应商、或供应商签发时粘贴的那一串 */
export function machineCode(): string {
  return formatMachineCode(machineFingerprint())
}
