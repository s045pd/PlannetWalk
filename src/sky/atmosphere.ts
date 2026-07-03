/** Rayleigh + Mie 单次散射天穹 shader（视线 16 步 / 光路 8 步数值积分） */

export const ATMOSPHERE_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w; // 推到远平面
}
`;

export const ATMOSPHERE_FRAG = /* glsl */ `
varying vec3 vDir;
uniform vec3 uSunDir;
uniform float uSunIntensity;
uniform vec3 uBetaR;
uniform float uBetaM;
uniform float uG;
uniform vec3 uTint;
uniform float uFlash;

const float RG = 6360e3;
const float RT = 6460e3;
const float HR = 10500.0;
const float HM = 2400.0;
const int I_STEPS = 16;
const int J_STEPS = 8;

vec2 raySphere(vec3 ro, vec3 rd, float radius) {
  float b = dot(ro, rd);
  float c = dot(ro, ro) - radius * radius;
  float d = b * b - c;
  if (d < 0.0) return vec2(1e9, -1e9);
  d = sqrt(d);
  return vec2(-b - d, -b + d);
}

void main() {
  vec3 dir = normalize(vDir);
  vec3 ro = vec3(0.0, RG + 2.0, 0.0);
  // 地平线以下复用地平线霾色（远景由雾接管，钳制值与 CPU 雾采样一致）
  vec3 rd = normalize(vec3(dir.x, max(dir.y, 0.015), dir.z));

  vec2 t = raySphere(ro, rd, RT);
  float tMax = t.y;
  float segLen = tMax / float(I_STEPS);

  vec3 sumR = vec3(0.0);
  vec3 sumM = vec3(0.0);
  float odR = 0.0;
  float odM = 0.0;
  float mu = dot(rd, uSunDir);
  float phaseR = 3.0 / (16.0 * 3.14159265) * (1.0 + mu * mu);
  float g2 = uG * uG;
  float phaseM = 3.0 / (8.0 * 3.14159265) * ((1.0 - g2) * (1.0 + mu * mu)) /
    ((2.0 + g2) * pow(1.0 + g2 - 2.0 * uG * mu, 1.5));

  float tCur = 0.0;
  for (int i = 0; i < I_STEPS; i++) {
    vec3 p = ro + rd * (tCur + segLen * 0.5);
    float h = length(p) - RG;
    float hr = exp(-h / HR) * segLen;
    float hm = exp(-h / HM) * segLen;
    odR += hr;
    odM += hm;

    vec2 tj = raySphere(p, uSunDir, RT);
    float jSegLen = tj.y / float(J_STEPS);
    float jOdR = 0.0;
    float jOdM = 0.0;
    float jT = 0.0;
    bool hitGround = false;
    for (int j = 0; j < J_STEPS; j++) {
      vec3 jp = p + uSunDir * (jT + jSegLen * 0.5);
      float jh = length(jp) - RG;
      if (jh < 0.0) { hitGround = true; break; }
      jOdR += exp(-jh / HR) * jSegLen;
      jOdM += exp(-jh / HM) * jSegLen;
      jT += jSegLen;
    }
    if (!hitGround) {
      vec3 tau = uBetaR * (odR + jOdR) + vec3(uBetaM) * 1.1 * (odM + jOdM);
      vec3 att = exp(-tau);
      sumR += att * hr;
      sumM += att * hm;
    }
    tCur += segLen;
  }

  vec3 col = uSunIntensity * (sumR * uBetaR * phaseR + sumM * uBetaM * phaseM);

  // 多次散射近似：地平线霾光（正午偏白、日落偏暖、夜间消失）
  float dayness = smoothstep(-0.05, 0.3, uSunDir.y);
  vec3 hazeTint = mix(vec3(1.0, 0.72, 0.45), vec3(0.85, 0.85, 0.9), clamp(uSunDir.y * 2.5, 0.0, 1.0));
  col += hazeTint * 0.9 * pow(1.0 - clamp(rd.y, 0.0, 1.0), 7.0) * dayness;

  col *= uTint;

  // 太阳圆盘（Mie 前向峰之上叠加锐利盘面）
  float sunDisk = smoothstep(0.99955, 0.99985, mu) * smoothstep(-0.03, 0.01, uSunDir.y);
  vec3 trans = exp(-(uBetaR * odR + vec3(uBetaM) * 1.1 * odM));
  col += sunDisk * trans * uSunIntensity * 0.9;

  col += vec3(uFlash); // 闪电天空脉冲

  gl_FragColor = vec4(col, 1.0);
}
`;

/* ---------- CPU 端同算法采样（供雾色/环境色与天空严格一致） ---------- */

const RG = 6360e3;
const RT = 6460e3;
const HR = 10500;
const HM = 2400;
const I_STEPS = 16;
const J_STEPS = 8;

export interface ScatterParams {
  betaR: [number, number, number];
  betaM: number;
  g: number;
  sunIntensity: number;
  tint: [number, number, number];
}

export const DEFAULT_SCATTER: ScatterParams = {
  betaR: [5.8e-6, 13.5e-6, 30e-6],
  betaM: 26e-6,
  g: 0.76,
  sunIntensity: 22,
  tint: [1, 0.96, 0.92],
};

function raySphereFar(oy: number, dy: number, radius: number): number {
  // ro = (0, oy, 0)
  const b = oy * dy;
  const c = oy * oy - radius * radius;
  const d = b * b - c;
  if (d < 0) return -1;
  return -b + Math.sqrt(d);
}

/** GLSL 同构的单次散射（用于 CPU 侧取地平线/天顶颜色） */
export function scatterColor(
  dir: [number, number, number],
  sunDir: [number, number, number],
  p: ScatterParams = DEFAULT_SCATTER,
): [number, number, number] {
  const dy = Math.max(dir[1], 0.002);
  const len = Math.hypot(dir[0], dy, dir[2]);
  const rd = [dir[0] / len, dy / len, dir[2] / len];
  const oy = RG + 2;

  const tMax = raySphereFar(oy, rd[1], RT);
  const segLen = tMax / I_STEPS;
  const sumR = [0, 0, 0];
  const sumM = [0, 0, 0];
  let odR = 0;
  let odM = 0;
  const mu = rd[0] * sunDir[0] + rd[1] * sunDir[1] + rd[2] * sunDir[2];
  const phaseR = (3 / (16 * Math.PI)) * (1 + mu * mu);
  const g2 = p.g * p.g;
  const phaseM =
    ((3 / (8 * Math.PI)) * ((1 - g2) * (1 + mu * mu))) /
    ((2 + g2) * Math.pow(1 + g2 - 2 * p.g * mu, 1.5));

  let tCur = 0;
  for (let i = 0; i < I_STEPS; i++) {
    const tm = tCur + segLen * 0.5;
    const px = rd[0] * tm;
    const py = oy + rd[1] * tm;
    const pz = rd[2] * tm;
    const r = Math.hypot(px, py, pz);
    const h = r - RG;
    const hr = Math.exp(-h / HR) * segLen;
    const hm = Math.exp(-h / HM) * segLen;
    odR += hr;
    odM += hm;

    // 光路：以 p 为原点向太阳
    const b = px * sunDir[0] + py * sunDir[1] + pz * sunDir[2];
    const c = r * r - RT * RT;
    const dd = b * b - c;
    const jtMax = -b + Math.sqrt(Math.max(0, dd));
    const jSeg = jtMax / J_STEPS;
    let jOdR = 0;
    let jOdM = 0;
    let jT = 0;
    let hitGround = false;
    for (let j = 0; j < J_STEPS; j++) {
      const jt = jT + jSeg * 0.5;
      const jx = px + sunDir[0] * jt;
      const jy = py + sunDir[1] * jt;
      const jz = pz + sunDir[2] * jt;
      const jh = Math.hypot(jx, jy, jz) - RG;
      if (jh < 0) {
        hitGround = true;
        break;
      }
      jOdR += Math.exp(-jh / HR) * jSeg;
      jOdM += Math.exp(-jh / HM) * jSeg;
      jT += jSeg;
    }
    if (!hitGround) {
      for (let k = 0; k < 3; k++) {
        const tau = p.betaR[k] * (odR + jOdR) + p.betaM * 1.1 * (odM + jOdM);
        const att = Math.exp(-tau);
        sumR[k] += att * hr;
        sumM[k] += att * hm;
      }
    }
    tCur += segLen;
  }

  // 与 GLSL 相同的多次散射近似霾光
  const dayness = clampNum((sunDir[1] + 0.05) / 0.35, 0, 1);
  const daynessS = dayness * dayness * (3 - 2 * dayness);
  const warmMix = clampNum(sunDir[1] * 2.5, 0, 1);
  const hazeTint = [
    1 + (0.85 - 1) * warmMix,
    0.72 + (0.85 - 0.72) * warmMix,
    0.45 + (0.9 - 0.45) * warmMix,
  ];
  const haze = 0.9 * Math.pow(1 - clampNum(rd[1], 0, 1), 7) * daynessS;

  const out: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    out[k] =
      (p.sunIntensity * (sumR[k] * p.betaR[k] * phaseR + sumM[k] * p.betaM * phaseM) +
        hazeTint[k] * haze) *
      p.tint[k];
  }
  return out;
}

function clampNum(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

