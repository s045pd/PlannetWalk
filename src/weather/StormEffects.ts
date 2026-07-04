import type { Engine } from '../core/Engine';
import type { WeatherSystem } from './WeatherSystem';
import type { Player } from '../player/Player';
import type { Physics } from '../physics/Physics';
import type { AudioSystem } from '../audio/AudioSystem';
import type { VehicleManager } from '../vehicles/Rideable';

/** 沙尘暴避难：掩蔽判定（车内/屋檐下）、室外风推、掩蔽音效闷化 */
export class StormEffects {
  /** 当前是否处于掩蔽 */
  sheltered = false;
  /** 风暴全强（dustRate 高） */
  storming = false;
  private checkTimer = 0;

  constructor(
    private engine: Engine,
    private weather: WeatherSystem,
    private player: Player,
    private physics: Physics,
    private audio: AudioSystem,
    private vehicles: VehicleManager,
  ) {
    void this.engine;
  }

  update(dt: number): void {
    const p = this.weather.params;
    this.storming = p.dustRate > 0.9;

    this.checkTimer -= dt;
    if (this.checkTimer <= 0) {
      this.checkTimer = 0.25;
      const local = this.player.localPosition();
      this.sheltered =
        this.vehicles.riding !== null ||
        this.physics.hasRoofAbove({ x: local.x, y: local.y + 0.8, z: local.z }, this.player.cc.body);
    }

    // 室外风推（推向风向）
    if (this.storming && !this.sheltered && !this.player.riding) {
      const push = p.windSpeed * 0.09;
      this.player.externalPush.set(
        this.weather.windDir.x * push,
        this.weather.windDir.y * push,
      );
    } else {
      this.player.externalPush.set(0, 0);
    }

    // 掩蔽闷化
    this.audio.setMuffle(this.storming && this.sheltered);
  }
}
