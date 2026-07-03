import * as THREE from 'three';
import { mulberry32 } from '../world/noise';

const RING_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  // RingGeometry 位于局部 XY 平面：手动计算径向/角向 UV（几何自带 UV 是平面映射）
  float r = length(position.xy);
  vUv = vec2((r - 5500.0) / 2000.0, atan(position.y, position.x) / 6.2831853 + 0.5);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

// 沿环向的程序噪声条纹 + 径向淡出
const RING_FRAG = /* glsl */ `
varying vec2 vUv;
uniform float uOpacity;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x),
             mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
void main() {
  // vUv.x 径向 [内->外], vUv.y 环向
  float bands = vnoise(vec2(vUv.x * 26.0, vUv.y * 3.0)) * 0.65 +
                vnoise(vec2(vUv.x * 90.0, vUv.y * 8.0)) * 0.35;
  bands = 0.25 + 0.75 * bands;
  float radial = smoothstep(0.0, 0.12, vUv.x) * (1.0 - smoothstep(0.8, 1.0, vUv.x));
  float a = bands * radial * uOpacity;
  vec3 col = mix(vec3(0.55, 0.5, 0.45), vec3(0.75, 0.72, 0.68), bands) * 1.9;
  gl_FragColor = vec4(col, a);
}
`;

/** 行星环碎带：被摧毁卫星的残骸环，横跨天空（白天隐约、夜间清晰） */
export class DebrisRing {
  readonly group = new THREE.Group();
  private mat: THREE.ShaderMaterial;
  private rocks: THREE.InstancedMesh;
  /** 观察者偏离环面的位移（否则环与视点共面时退化为一条线） */
  private planeOffset: THREE.Vector3;

  constructor(scene: THREE.Scene, seed: number) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      uniforms: { uOpacity: { value: 0.3 } },
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      fog: false,
    });
    // 近垂直的大圆弧横跨天穹（环面倾角 ~20°），观察者在环内侧看到完整拱带
    const ring = new THREE.Mesh(new THREE.RingGeometry(5500, 7500, 128, 8), this.mat);
    ring.rotation.x = 0.35;
    ring.rotation.y = 0.5;
    ring.renderOrder = -8;
    this.group.add(ring);

    // 近段散布不规则岩块（环面内缘）
    const rng = mulberry32(seed + 77);
    const rockGeo = new THREE.IcosahedronGeometry(1, 0);
    const rockMat = new THREE.MeshStandardMaterial({ color: 0x6b625a, roughness: 0.95 });
    this.rocks = new THREE.InstancedMesh(rockGeo, rockMat, 60);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const eul = new THREE.Euler();
    const rockRot = new THREE.Euler(0.35, 0.5, 0);
    for (let i = 0; i < 60; i++) {
      const ang = (i / 60) * Math.PI * 2;
      const rad = 5600 + rng() * 1700;
      // RingGeometry 位于 XY 平面，与环带同向旋转
      const p = new THREE.Vector3(Math.cos(ang) * rad, Math.sin(ang) * rad, 0);
      p.applyEuler(rockRot);
      eul.set(rng() * Math.PI, rng() * Math.PI, rng() * Math.PI);
      q.setFromEuler(eul);
      const s = 6 + rng() * 22;
      m.compose(p, q, new THREE.Vector3(s, s * (0.6 + rng() * 0.6), s));
      this.rocks.setMatrixAt(i, m);
    }
    this.rocks.instanceMatrix.needsUpdate = true;
    this.group.add(this.rocks);

    this.group.frustumCulled = false;
    this.planeOffset = new THREE.Vector3(0, 0, 1)
      .applyEuler(new THREE.Euler(0.35, 0.5, 0))
      .multiplyScalar(-2400);
    scene.add(this.group);
  }

  update(cameraPos: THREE.Vector3, sunElevation: number, dt: number): void {
    this.group.position.copy(cameraPos).add(this.planeOffset);
    this.group.rotation.z += dt * 0.0015; // 碎带缓慢漂移
    const night = Math.min(1, Math.max(0, (-sunElevation + 0.1) / 0.3));
    this.mat.uniforms.uOpacity.value = 0.15 + 0.4 * night;
  }
}
