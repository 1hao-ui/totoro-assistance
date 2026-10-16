/**
 * 拟合度（轨迹相似度）—— 契约层纯函数，零框架依赖，可离线单测。
 *
 * ## 本模块要满足的**行为契约**
 * 服务端对每条跑步记录会给一个 0~1 的「拟合度」。本地必须能按**同一套口径**复算，
 * 否则预览与实际提交会对不上（E33 的教训：预览与实发口径一旦分叉，整条轨迹明细会被服务端拒收）。
 * 契约参数如下 —— 它们是**接口约定**，不是实现细节：
 *
 * | 参数 | 取值 | 含义 |
 * | --- | --- | --- |
 * | 采样间距 `FIT_SAMPLE_STEP_M` | 5 m | 沿**参考线路**加密取样 |
 * | 命中容差 `FIT_TOLERANCE_M` | 25 m | 采样点到候选轨迹的最短距离 ≤ 该值记一次命中 |
 * | 输出 | 命中数 ÷ 采样总数 | 0~1 的小数；任一侧不足 2 个点时定义为 0 |
 *
 * ## 数值方法（均为公开的教科书内容，不涉及任何专有实现）
 * - **两点距离**：球面 haversine 公式，取地球平均半径 6371000 m；
 * - **点到折线距离**：在小范围（单条跑道、数公里内）把经纬度当作**等距圆柱投影**下的平面坐标，
 *   做点到线段的正交投影；超出线段时取端点距离。这是该量级下精度足够、且与"曲率可忽略"前提一致的常规近似。
 *
 * ## ⚠️ 已知的观测边界（如实标注，不臆断）
 * 服务端**是否真的按这套口径复算、以及它实际使用的阈值**，本项目从未取得权威确认 ——
 * 真包只能观察到最终的判定结果，不能反推内部实现。因此本模块是"按可观测的协议行为拟合出的口径"，
 * 参数变更时需重新以真实提交结果校验（见 `tests/mp/routeSimilarity.test.ts` 与
 * `tests/mp/trajectory.test.ts` 的行为断言）。
 */

export interface LatLng {
  latitude: number | string
  longitude: number | string
}

/** 沿参考线路的取样间距（米）—— 契约常量，见文件头 */
export const FIT_SAMPLE_STEP_M = 5

/** 命中容差（米）—— 契约常量，见文件头 */
export const FIT_TOLERANCE_M = 25

/**
 * 球面模型用的地球平均半径（米）。
 * 6371000 是常规约定值（IUGG 平均半径），也是本项目全链路统一的常量口径。
 */
const MEAN_EARTH_RADIUS_M = 6371000

const degreesToRadians = (deg: number): number => (deg * Math.PI) / 180

/**
 * 球面两点间最短距离（米）—— 标准 haversine。
 *
 * ⚠️ 运算是**逐位敏感**的：本函数被轨迹生成链路反复调用，任何"数学上等价但运算次序不同"的改写
 *    （例如把 `R * (2 * atan2(...))` 写成 `R * 2 * atan2(...)`）都会因浮点结合律不成立而改变末位，
 *    进而让生成轨迹的拟合度偏离既定区间。改动这里必须重跑 `trajectory.test.ts` 的行为断言。
 */
export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const phi1 = degreesToRadians(lat1)
  const phi2 = degreesToRadians(lat2)
  const dPhi = degreesToRadians(lat2 - lat1)
  const dLambda = degreesToRadians(lng2 - lng1)
  const sinHalfDPhi = Math.sin(dPhi / 2)
  const sinHalfDLambda = Math.sin(dLambda / 2)
  const h = sinHalfDPhi * sinHalfDPhi + Math.cos(phi1) * Math.cos(phi2) * sinHalfDLambda * sinHalfDLambda
  return MEAN_EARTH_RADIUS_M * (2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h)))
}

/**
 * 点 P 到线段 AB 的最短距离（米）：等距圆柱投影下的正交投影，投影落到线段外时取较近端点的距离。
 */
export function pointToSegmentDistance(
  plat: number,
  plng: number,
  alat: number,
  alng: number,
  blat: number,
  blng: number,
): number {
  const dx = blat - alat
  const dy = blng - alng
  const lenSq = dx * dx + dy * dy
  let t = -1
  if (lenSq !== 0) t = ((plat - alat) * dx + (plng - alng) * dy) / lenSq

  let clat: number
  let clng: number
  if (t < 0) {
    clat = alat
    clng = alng
  } else if (t > 1) {
    clat = blat
    clng = blng
  } else {
    clat = alat + t * dx
    clng = alng + t * dy
  }
  return distanceMeters(plat, plng, clat, clng)
}

/** 把 `LatLng` 列表归一成 `[lat, lng]` 数值二元组，避免在主循环里反复做类型转换 */
function toNumericPairs(list: LatLng[]): [number, number][] {
  return list.map((p) => [Number(p.latitude), Number(p.longitude)])
}

/**
 * 采样点到候选折线的最短距离（米）。
 *
 * 一旦发现 ≤ `thresholdM` 的段就**提前返回**：调用方只需要判断"是否命中"，
 * 不需要全局最小值，提前退出不改变判定结果（命中与否只取决于"有没有一段足够近"）。
 */
function nearestDistanceToPolyline(
  plat: number,
  plng: number,
  polyline: readonly [number, number][],
  thresholdM: number,
): number {
  let nearest = Number.POSITIVE_INFINITY
  for (let j = 0; j + 1 < polyline.length; j++) {
    const d = pointToSegmentDistance(plat, plng, polyline[j]![0], polyline[j]![1], polyline[j + 1]![0], polyline[j + 1]![1])
    if (d < nearest) nearest = d
    if (nearest <= thresholdM) break
  }
  return nearest
}

/**
 * 计算拟合度（0~1）。命中数 ÷ 采样总数。
 *
 * @param reference  参考线路（服务端下发的 `pointList`）
 * @param candidate  候选轨迹（本地生成、或实测跑出来的点列）
 * @param sampleStepM 取样间距（米），默认取契约常量 5
 * @param toleranceM  命中容差（米），默认取契约常量 25
 * @returns 0~1；任一侧点数不足 2 时返回 0
 */
export function computeFitDegree(
  reference: LatLng[],
  candidate: LatLng[],
  sampleStepM = FIT_SAMPLE_STEP_M,
  toleranceM = FIT_TOLERANCE_M,
): number {
  if (!reference || reference.length < 2 || !candidate || candidate.length < 2) return 0

  const ref = toNumericPairs(reference)
  const cand = toNumericPairs(candidate)

  let hits = 0
  let samples = 0

  for (let i = 0; i + 1 < ref.length; i++) {
    const [alat, alng] = ref[i]!
    const [blat, blng] = ref[i + 1]!
    /** 该段的取样段数：不足一米也至少取一个点（`steps >= 1` 保证每段都被采样到） */
    const steps = Math.max(1, Math.ceil(distanceMeters(alat, alng, blat, blng) / sampleStepM))

    for (let s = 0; s < steps; s++) {
      const ratio = s / steps
      const plat = alat + (blat - alat) * ratio
      const plng = alng + (blng - alng) * ratio
      if (nearestDistanceToPolyline(plat, plng, cand, toleranceM) <= toleranceM) hits++
      samples++
    }
  }

  return samples === 0 ? 0 : hits / samples
}

/** 轨迹累计长度（米）：相邻点球面距离之和 */
export function pathLengthMeters(points: LatLng[]): number {
  if (!points || points.length < 2) return 0
  const p = toNumericPairs(points)
  let total = 0
  for (let i = 0; i + 1 < p.length; i++) {
    total += distanceMeters(p[i]![0], p[i]![1], p[i + 1]![0], p[i + 1]![1])
  }
  return total
}
