import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { WeatherSystem } from './WeatherSystem';
import { mulberry32 } from '../world/noise';

interface ParticleConf {
  count: number;
  box: number;
  size: [number, number];
  color: THREE.Color;
  opacity: number;
  /** 0=雨(拉长/快落) 1=尘(横飘) 2=灰烬(慢落摇摆) */
  kind: number;
}

const VERT = /* glsl */ `
attribute vec3 aSeed;
attribute float aRand;
uniform float uTime;
uniform vec3 uCamPos;
uniform float uBox;
uniform float uRate;
uniform vec2 uWind;
uniform float uWindSpeed;
uniform float uKind;
uniform vec2 uSize;
varying float vAlpha;
varying vec2 vCorner;

void main() {
  vCorner = position.xy; // 四角 [-0.5, 0.5]
  if (aRand > uRate) { gl_Position = vec4(2.0, 2.0, 2.0, 1.0); vAlpha = 0.0; return; }

  vec3 vel;
  float sway = 0.0;
  if (uKind < 0.5) {          // 雨
    vel = vec3(uWind.x * uWindSpeed * 0.5, -22.0, uWind.y * uWindSpeed * 0.5);
  } else if (uKind < 1.5) {   // 尘
    vel = vec3(uWind.x * (uWindSpeed * 1.8 + 2.0), -1.5, uWind.y * (uWindSpeed * 1.8 + 2.0));
  } else {                    // 灰烬
    vel = vec3(uWind.x * 1.2, -1.4, uWind.y * 1.2);
    sway = sin(uTime * (0.8 + aRand) + aRand * 40.0) * 1.2;
  }

  vec3 base = fract(aSeed + (vel * uTime) / uBox - uCamPos / uBox);
  vec3 p = (base - 0.5) * uBox + uCamPos;
  p.x += sway;

  // 距离淡出
  float distXZ = length(p.xz - uCamPos.xz);
  vAlpha = 1.0 - smoothstep(uBox * 0.32, uBox * 0.48, distXZ);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec2 corner = position.xy * uSize;
  if (uKind < 0.5) corner = vec2(position.x * uSize.x, position.y * uSize.y); // 雨已由 uSize 拉长
  mv.xy += corner;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uKind;
varying float vAlpha;
varying vec2 vCorner;
void main() {
  float shape;
  if (uKind < 0.5) {
    shape = 1.0 - abs(vCorner.x) * 2.0; // 雨丝：横向渐隐
  } else {
    shape = 1.0 - smoothstep(0.25, 0.5, length(vCorner)); // 软圆
  }
  float a = shape * vAlpha * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}
`;

function makeSystem(conf: ParticleConf, seed: number): THREE.Mesh {
  const rng = mulberry32(seed);
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  geo.instanceCount = conf.count;

  const seeds = new Float32Array(conf.count * 3);
  const rands = new Float32Array(conf.count);
  for (let i = 0; i < conf.count; i++) {
    seeds[i * 3] = rng();
    seeds[i * 3 + 1] = rng();
    seeds[i * 3 + 2] = rng();
    rands[i] = rng();
  }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 3));
  geo.setAttribute('aRand', new THREE.InstancedBufferAttribute(rands, 1));

  const mat = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uCamPos: { value: new THREE.Vector3() },
      uBox: { value: conf.box },
      uRate: { value: 0 },
      uWind: { value: new THREE.Vector2(1, 0) },
      uWindSpeed: { value: 0 },
      uKind: { value: conf.kind },
      uSize: { value: new THREE.Vector2(conf.size[0], conf.size[1]) },
      uColor: { value: conf.color },
      uOpacity: { value: conf.opacity },
    },
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 5;
  return mesh;
}

/** GPU 天气粒子：雨 / 尘 / 灰烬（相机包围盒回绕，发射率由天气驱动） */
export class Particles {
  private rain: THREE.Mesh;
  private dust: THREE.Mesh;
  private ash: THREE.Mesh;
  private time = 0;
  /** 画质倍率 */
  rateMul = 1;

  constructor(
    private engine: Engine,
    private weather: WeatherSystem,
    seed: number,
  ) {
    this.rain = makeSystem(
      { count: 6000, box: 40, size: [0.025, 0.5], color: new THREE.Color(0.6, 0.7, 0.72), opacity: 0.5, kind: 0 },
      seed + 1,
    );
    this.dust = makeSystem(
      { count: 2500, box: 60, size: [0.5, 0.5], color: new THREE.Color(0.75, 0.55, 0.32), opacity: 0.16, kind: 1 },
      seed + 2,
    );
    this.ash = makeSystem(
      { count: 2000, box: 50, size: [0.09, 0.09], color: new THREE.Color(0.55, 0.53, 0.52), opacity: 0.75, kind: 2 },
      seed + 3,
    );
    engine.scene.add(this.rain, this.dust, this.ash);
  }

  update(dt: number): void {
    this.time += dt;
    const p = this.weather.params;
    const cam = this.engine.camera.position;
    const wind = this.weather.windDir;
    const sets: [THREE.Mesh, number][] = [
      [this.rain, p.rainRate],
      [this.dust, p.dustRate],
      [this.ash, p.ashRate],
    ];
    for (const [mesh, rate] of sets) {
      const u = (mesh.material as THREE.ShaderMaterial).uniforms;
      u.uTime.value = this.time;
      u.uCamPos.value.copy(cam);
      u.uRate.value = rate * this.rateMul;
      u.uWind.value.copy(wind);
      u.uWindSpeed.value = p.windSpeed;
      mesh.visible = rate * this.rateMul > 0.01;
    }
  }
}
