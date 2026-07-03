import * as THREE from 'three';
import type { Engine } from '../core/Engine';

const BASE_FOV = 70;

/** 照片模式：P 切换。自由相机 + 慢动作 + 隐藏 HUD。滚轮 FOV、Z/C 滚转、R 重置。 */
export class PhotoMode {
  active = false;
  private pos = new THREE.Vector3();
  private yaw = 0;
  private pitch = 0;
  private roll = 0;
  private fov = BASE_FOV;
  private hint: HTMLElement;

  constructor(private engine: Engine) {
    window.addEventListener(
      'wheel',
      (e) => {
        if (!this.active) return;
        this.fov = THREE.MathUtils.clamp(this.fov + e.deltaY * 0.02, 14, 100);
      },
      { passive: true },
    );
    this.hint = document.createElement('div');
    this.hint.style.cssText =
      'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);color:rgba(159,232,255,.7);' +
      'font:11px monospace;letter-spacing:2px;z-index:30;display:none;pointer-events:none';
    this.hint.textContent = '照片模式 — WASD/QE 移动 · 滚轮 FOV · Z/C 滚转 · R 重置 · P 退出';
    document.body.appendChild(this.hint);
  }

  private enter(): void {
    this.active = true;
    this.engine.cameraLock = 'photo';
    this.engine.timeScale = 0.15;
    const cam = this.engine.camera;
    this.pos.copy(cam.position);
    const e = new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ');
    this.yaw = e.y;
    this.pitch = e.x;
    this.roll = 0;
    this.fov = cam.fov;
    const hud = document.getElementById('hud');
    if (hud) hud.style.display = 'none';
    this.hint.style.display = 'block';
  }

  private exit(): void {
    this.active = false;
    this.engine.cameraLock = null;
    this.engine.timeScale = 1;
    this.engine.camera.fov = this.engine.baseFov;
    this.engine.camera.updateProjectionMatrix();
    const hud = document.getElementById('hud');
    if (hud) hud.style.display = 'block';
    this.hint.style.display = 'none';
  }

  update(dt: number): void {
    const input = this.engine.input;
    if (input.consumePressed('KeyP')) {
      if (this.active) this.exit();
      else this.enter();
    }
    if (!this.active) return;

    // 慢动作下相机操作用真实时间手感（dt 已被 timeScale 缩放，还原）
    const rdt = dt / Math.max(0.01, this.engine.timeScale);
    const m = input.consumeMouse();
    this.yaw -= m.dx * 0.0022;
    this.pitch = THREE.MathUtils.clamp(this.pitch - m.dy * 0.0022, -1.55, 1.55);
    if (input.isDown('KeyZ')) this.roll -= rdt * 0.8;
    if (input.isDown('KeyC')) this.roll += rdt * 0.8;
    if (input.consumePressed('KeyR')) {
      this.roll = 0;
      this.fov = BASE_FOV;
    }

    const speed = input.isDown('ShiftLeft') ? 40 : 10;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    if (input.isDown('KeyW')) this.pos.addScaledVector(fwd, speed * rdt);
    if (input.isDown('KeyS')) this.pos.addScaledVector(fwd, -speed * rdt);
    if (input.isDown('KeyD')) this.pos.addScaledVector(right, speed * rdt);
    if (input.isDown('KeyA')) this.pos.addScaledVector(right, -speed * rdt);
    if (input.isDown('KeyE')) this.pos.y += speed * rdt;
    if (input.isDown('KeyQ')) this.pos.y -= speed * rdt;

    const cam = this.engine.camera;
    cam.position.copy(this.pos);
    cam.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }
}
