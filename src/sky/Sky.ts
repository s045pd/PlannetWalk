import * as THREE from 'three';
import { ATMOSPHERE_VERT, ATMOSPHERE_FRAG } from './atmosphere';

/** 大气散射天穹：跟随相机的反面球壳 */
export class Sky {
  readonly mesh: THREE.Mesh;
  readonly uniforms = {
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunIntensity: { value: 22 },
    // 经典 Rayleigh 系数，暖色由 uTint 控制（与 atmosphere.ts DEFAULT_SCATTER 保持一致）
    uBetaR: { value: new THREE.Vector3(5.8e-6, 13.5e-6, 30e-6) },
    uBetaM: { value: 26e-6 },
    uG: { value: 0.76 },
    uTint: { value: new THREE.Color(1, 0.96, 0.92) },
    uFlash: { value: 0 },
  };

  constructor(scene: THREE.Scene) {
    const mat = new THREE.ShaderMaterial({
      vertexShader: ATMOSPHERE_VERT,
      fragmentShader: ATMOSPHERE_FRAG,
      uniforms: this.uniforms,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.IcosahedronGeometry(9000, 3), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -10;
    scene.add(this.mesh);
  }

  setSunDir(dir: THREE.Vector3): void {
    this.uniforms.uSunDir.value.copy(dir);
  }

  setTint(color: THREE.Color): void {
    this.uniforms.uTint.value.copy(color);
  }

  setFlash(v: number): void {
    this.uniforms.uFlash.value = v;
  }

  /** 每帧跟随相机 */
  update(cameraPos: THREE.Vector3): void {
    this.mesh.position.copy(cameraPos);
  }
}
