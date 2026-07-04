import { mulberry32 } from '../world/noise';

/** 信号追踪主线：5 级信号源，终点为方舟九号发射台 */

export const QUEST_STAGES = 5;

export interface QuestTarget {
  x: number;
  z: number;
  /** 终点级为发射台，其余为中继天线 */
  final: boolean;
}

/** 每级信号获取后的打字机文本 */
export const QUEST_TEXTS: { title: string; body: string }[] = [
  {
    title: '信号获取 · 中继 K-1',
    body: '……这里是方舟七号，自动重播。如果地面还有人：撤离网络的中继链还活着。沿信号走。下一站会告诉你更多。',
  },
  {
    title: '信号获取 · 中继 K-2',
    body: '重播补丁 #211：不要走直线。「烛台」的轨道镜每 9 小时扫过一次撤离走廊——废墟和峡谷是你的朋友。链路还剩三跳。',
  },
  {
    title: '信号获取 · 中继 K-3',
    body: '这一段录音来自地面：『我们把最后的燃料给了九号。别管我们，去发射台。如果它还立着，就说明我们没有白干。』',
  },
  {
    title: '信号获取 · 中继 K-4',
    body: '信号越来越清晰了。方舟七号：我们在轨道上看到了发射台的信标——它还在供电。最后一跳。去看看九号吧，替我们所有人。',
  },
  {
    title: '方舟九号发射台',
    body: '龙门架还立着，船身半埋在灰烬里。发射记录终端还亮着最后一行：\n\n「点火中止 · 乘员舱完整分离 · 328 人转入地下掩体」\n\n——它没能起飞，但没有人留在船上。天上的环带擦过龙门架的剪影，像一枚缓慢转动的勋章。',
  },
];

/**
 * 生成 5 级信号源坐标：从出生点出发，方向渐变、距离递进（1.2–3km/跳），
 * 种子确定性。
 */
export function questTargets(
  seed: number,
  spawn: { x: number; z: number },
): QuestTarget[] {
  const rng = mulberry32((seed ^ 0x51611e57) >>> 0);
  const targets: QuestTarget[] = [];
  let x = spawn.x;
  let z = spawn.z;
  let dir = rng() * Math.PI * 2;
  for (let k = 0; k < QUEST_STAGES; k++) {
    const dist = 1200 + rng() * 1400 + k * 250;
    dir += (rng() - 0.5) * 1.6; // 方向渐变，路线自然折行
    x += Math.cos(dir) * dist;
    z += Math.sin(dir) * dist;
    targets.push({ x, z, final: k === QUEST_STAGES - 1 });
  }
  return targets;
}
