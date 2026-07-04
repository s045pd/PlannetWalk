import type { Engine } from '../core/Engine';
import type { WeatherSystem } from '../weather/WeatherSystem';
import type { DebrisRing } from '../sky/DebrisRing';
import { LOGS } from './logs';

const REPLY = `……方舟七号收到。全部十七段记录已归档。

地面的朋友：我们离开那天，以为带走的是文明的最后一份备份。现在我们知道错了——备份一直在地面上。在会烧皮肤的雨里给陌生人留罐头的人，在第十九天还惦记着替别人关灯的人，在灰烬里往北送种子盒的人。

我们调转航向了。不是明天，也许不是明年。但方舟会回家。

替我们看好那枚环。它不是伤疤，是灯塔。

—— 方舟七号 · 全体船员`;

/** 收集结局：17/17 日志时一次性触发——极光漫天 + 方舟七号回信 + 碎片环增亮 */
export class Ending {
  seen = false;

  constructor(
    engine: Engine,
    weather: WeatherSystem,
    debrisRing: DebrisRing,
  ) {
    engine.bus.on('log:collected', ({ count, total }) => {
      if (this.seen || count < total || count < LOGS.length) return;
      this.seen = true;
      // 延迟几秒让最后一条日志读完，再进入结局序列
      setTimeout(() => {
        weather.setWeather('AURORA', 8);
        debrisRing.boost(90);
        engine.bus.emit('quest:acquired', {
          title: '收到回信',
          body: REPLY,
          stage: LOGS.length,
          total: LOGS.length,
        });
      }, 9000);
    });
  }

  restore(seen: boolean): void {
    this.seen = seen;
  }
}
