import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { Sky } from '../sky/Sky';
import type { WeatherSystem } from './WeatherSystem';
import type { Player } from '../player/Player';
import type { Terrain } from '../world/Terrain';

/** 闪电：雷暴期间随机触发天空闪光 + 方向光脉冲，雷声按距离延迟（事件交给音频系统）。
 * 玩家在雷暴中暴露（高空/喷射）时，落雷会偏向玩家。 */
export class Lightning {
  private nextIn = 5;
  private flashT = -1;
  private light: THREE.DirectionalLight;

  constructor(
    private engine: Engine,
    private sky: Sky,
    private weather: WeatherSystem,
    private player: Player,
    private terrain: Terrain,
  ) {
    this.light = new THREE.DirectionalLight(0xdfe8ff, 0);
    engine.scene.add(this.light, this.light.target);
  }

  /** 暴露判定：离地 >15m 或正在喷射 */
  private playerExposed(): boolean {
    const w = this.player.worldPosition();
    const ground = this.terrain.heightAt(w.x, w.z);
    return w.y - ground > 15 || this.player.jetThrusting;
  }

  update(dt: number): void {
    const stormy = this.weather.params.rainRate > 0.85;
    if (stormy) {
      const exposed = this.playerExposed();
      this.nextIn -= dt * (exposed ? 3 : 1); // 暴露时雷击更频繁
      if (this.nextIn <= 0) {
        this.nextIn = 3 + Math.random() * 9;
        this.flashT = 0;
        if (exposed && Math.random() < 0.65) {
          // 近雷击：立即炸响 + 电击玩家
          this.light.position
            .copy(this.engine.camera.position)
            .add(new THREE.Vector3((Math.random() - 0.5) * 60, 320, (Math.random() - 0.5) * 60));
          this.light.target.position.copy(this.engine.camera.position);
          this.engine.bus.emit('weather:lightning', { delaySec: 0.08 });
          this.engine.bus.emit('player:shocked', { intensity: 1 });
        } else {
          // 远处落雷 → 雷声按距离延迟
          const az = Math.random() * Math.PI * 2;
          const dist = 500 + Math.random() * 4500;
          this.light.position
            .copy(this.engine.camera.position)
            .add(new THREE.Vector3(Math.cos(az) * 300, 350, Math.sin(az) * 300));
          this.light.target.position.copy(this.engine.camera.position);
          this.engine.bus.emit('weather:lightning', { delaySec: dist / 340 });
        }
      }
    }

    if (this.flashT >= 0) {
      this.flashT += dt;
      // 双峰闪烁包络
      const t = this.flashT;
      const env =
        Math.max(0, 1 - t / 0.09) * 0.7 + Math.max(0, 1 - Math.abs(t - 0.14) / 0.07) * 0.5;
      this.sky.setFlash(env * 0.35);
      this.light.intensity = env * 2.6;
      if (t > 0.25) {
        this.flashT = -1;
        this.sky.setFlash(0);
        this.light.intensity = 0;
      }
    }
  }
}
