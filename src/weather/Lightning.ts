import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { Sky } from '../sky/Sky';
import type { WeatherSystem } from './WeatherSystem';

/** 闪电：雷暴期间随机触发天空闪光 + 方向光脉冲，雷声按距离延迟（事件交给音频系统） */
export class Lightning {
  private nextIn = 5;
  private flashT = -1;
  private light: THREE.DirectionalLight;

  constructor(
    private engine: Engine,
    private sky: Sky,
    private weather: WeatherSystem,
  ) {
    this.light = new THREE.DirectionalLight(0xdfe8ff, 0);
    engine.scene.add(this.light, this.light.target);
  }

  update(dt: number): void {
    const stormy = this.weather.params.rainRate > 0.85;
    if (stormy) {
      this.nextIn -= dt;
      if (this.nextIn <= 0) {
        this.nextIn = 3 + Math.random() * 9;
        this.flashT = 0;
        // 随机方位与距离 → 雷声延迟
        const az = Math.random() * Math.PI * 2;
        const dist = 500 + Math.random() * 4500;
        this.light.position
          .copy(this.engine.camera.position)
          .add(new THREE.Vector3(Math.cos(az) * 300, 350, Math.sin(az) * 300));
        this.light.target.position.copy(this.engine.camera.position);
        this.engine.bus.emit('weather:lightning', { delaySec: dist / 340 });
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
