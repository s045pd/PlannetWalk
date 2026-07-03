import * as THREE from 'three';

const VERT = /* glsl */ `
attribute vec3 aPos;
attribute vec3 aVel;
attribute float aBorn;
attribute float aLife;
attribute float aSize;
attribute vec3 aColor;
uniform float uTime;
uniform float uGravity;
uniform float uGrow;
varying float vFade;
varying vec3 vColor;
varying vec2 vCorner;

void main() {
  float t = uTime - aBorn;
  vCorner = position.xy;
  vColor = aColor;
  if (t < 0.0 || t > aLife || aLife <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vFade = 0.0;
    return;
  }
  float k = t / aLife;
  vFade = (1.0 - k) * min(1.0, k * 8.0);
  vec3 p = aPos + aVel * t + vec3(0.0, -0.5 * uGravity * t * t, 0.0);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  mv.xy += position.xy * aSize * (1.0 + k * uGrow);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform float uOpacity;
varying float vFade;
varying vec3 vColor;
varying vec2 vCorner;
void main() {
  float shape = 1.0 - smoothstep(0.2, 0.5, length(vCorner));
  float a = shape * vFade * uOpacity;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
}
`;

export interface SpawnOpts {
  size: number;
  life: number;
  color: THREE.Color;
}

/** 通用 CPU-spawn / GPU-animate 粒子池（环形缓冲）：扬尘、喷焰、气垫尘共用 */
export class ParticlePool {
  private mesh: THREE.Mesh;
  private aPos: THREE.InstancedBufferAttribute;
  private aVel: THREE.InstancedBufferAttribute;
  private aBorn: THREE.InstancedBufferAttribute;
  private aLife: THREE.InstancedBufferAttribute;
  private aSize: THREE.InstancedBufferAttribute;
  private aColor: THREE.InstancedBufferAttribute;
  private head = 0;
  private dirty = false;
  private time = 0;
  private uniforms: {
    uTime: { value: number };
    uGravity: { value: number };
    uGrow: { value: number };
    uOpacity: { value: number };
  };

  constructor(
    scene: THREE.Scene,
    private capacity: number,
    opts: { additive?: boolean; gravity?: number; grow?: number; opacity?: number } = {},
  ) {
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index;
    geo.setAttribute('position', quad.getAttribute('position'));
    geo.instanceCount = capacity;

    this.aPos = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.aVel = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    this.aBorn = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.aLife = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.aSize = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
    this.aColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
    for (const a of [this.aPos, this.aVel, this.aBorn, this.aLife, this.aSize, this.aColor]) {
      a.setUsage(THREE.DynamicDrawUsage);
    }
    geo.setAttribute('aPos', this.aPos);
    geo.setAttribute('aVel', this.aVel);
    geo.setAttribute('aBorn', this.aBorn);
    geo.setAttribute('aLife', this.aLife);
    geo.setAttribute('aSize', this.aSize);
    geo.setAttribute('aColor', this.aColor);

    this.uniforms = {
      uTime: { value: 0 },
      uGravity: { value: opts.gravity ?? 0.6 },
      uGrow: { value: opts.grow ?? 2.5 },
      uOpacity: { value: opts.opacity ?? 0.5 },
    };
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      transparent: true,
      depthWrite: false,
      blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    scene.add(this.mesh);
  }

  /** pos/vel 为场景局部坐标 */
  spawn(pos: THREE.Vector3, vel: THREE.Vector3, opts: SpawnOpts): void {
    const i = this.head;
    this.head = (this.head + 1) % this.capacity;
    this.aPos.setXYZ(i, pos.x, pos.y, pos.z);
    this.aVel.setXYZ(i, vel.x, vel.y, vel.z);
    this.aBorn.setX(i, this.time);
    this.aLife.setX(i, opts.life);
    this.aSize.setX(i, opts.size);
    this.aColor.setXYZ(i, opts.color.r, opts.color.g, opts.color.b);
    this.dirty = true;
  }

  /** floating origin 回移后清空（粒子坐标已失效） */
  clear(): void {
    for (let i = 0; i < this.capacity; i++) this.aLife.setX(i, 0);
    this.dirty = true;
  }

  update(dt: number): void {
    this.time += dt;
    this.uniforms.uTime.value = this.time;
    if (this.dirty) {
      this.dirty = false;
      for (const a of [this.aPos, this.aVel, this.aBorn, this.aLife, this.aSize, this.aColor]) {
        a.needsUpdate = true;
      }
    }
  }
}
