import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { WeatherSystem } from '../weather/WeatherSystem';
import type { DayNight } from './DayNight';

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAG = /* glsl */ `
uniform float uTime;
uniform float uStrength;
varying vec2 vUv;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}

void main() {
  // 帘幕：沿 u 的波动条带，随时间滚动；v 向上渐隐
  float curtain =
    vnoise(vec2(vUv.x * 6.0 + uTime * 0.05, uTime * 0.1)) * 0.6 +
    vnoise(vec2(vUv.x * 18.0 - uTime * 0.08, uTime * 0.05)) * 0.4;
  float band = smoothstep(0.35, 0.75, curtain);
  float vert = smoothstep(0.0, 0.15, vUv.y) * (1.0 - smoothstep(0.35, 1.0, vUv.y));
  float a = band * vert * uStrength;
  if (a < 0.01) discard;
  // 绿 → 青 → 紫 的高度渐变
  vec3 col = mix(vec3(0.2, 1.0, 0.55), vec3(0.3, 0.75, 1.0), vUv.y * 1.6);
  col = mix(col, vec3(0.65, 0.4, 1.0), smoothstep(0.5, 0.9, vUv.y));
  gl_FragColor = vec4(col * 1.6, a * 0.55);
}
`;

/** 极光帘幕：AURORA 天气 × 夜间因子时显现，缓慢滚动的绿-青-紫光带 */
export class Aurora {
  private mats: THREE.ShaderMaterial[] = [];
  private group = new THREE.Group();
  private time = 0;

  constructor(
    private engine: Engine,
    private weather: WeatherSystem,
    private dayNight: DayNight,
  ) {
    // 两片不同方位/半径的圆柱帘幕
    for (const [radius, y0, h, rot] of [
      [5200, 1500, 2600, 0.3],
      [6800, 2100, 3200, 2.1],
    ]) {
      const geo = new THREE.CylinderGeometry(radius, radius, h, 96, 1, true, rot, Math.PI * 1.1);
      geo.translate(0, y0 + h / 2, 0);
      const mat = new THREE.ShaderMaterial({
        vertexShader: VERT,
        fragmentShader: FRAG,
        uniforms: { uTime: { value: 0 }, uStrength: { value: 0 } },
        transparent: true,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      });
      this.mats.push(mat);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.frustumCulled = false;
      mesh.renderOrder = -7;
      this.group.add(mesh);
    }
    engine.scene.add(this.group);
  }

  update(dt: number): void {
    this.time += dt;
    this.group.position.copy(this.engine.camera.position);
    // 仅 AURORA 天气 + 夜间可见
    const auroraAmt =
      this.weather.core.current === 'AURORA'
        ? 1
        : this.weather.core.target === 'AURORA'
          ? 0.5
          : 0;
    const night = Math.min(1, Math.max(0, (-this.dayNight.sunElevation - 0.02) / 0.15));
    const strength = auroraAmt * night;
    for (let i = 0; i < this.mats.length; i++) {
      this.mats[i].uniforms.uTime.value = this.time * (i === 0 ? 1 : 0.7);
      this.mats[i].uniforms.uStrength.value = strength;
    }
    this.group.visible = strength > 0.01;
  }
}
