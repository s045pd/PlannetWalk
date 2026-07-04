import type { Engine } from '../core/Engine';
import type { Player } from '../player/Player';
import type { WeatherSystem } from '../weather/WeatherSystem';
import type { VehicleManager } from '../vehicles/Rideable';
import { Biome, type Heightfield } from '../world/heightfield';

/** 全程序化音频：风 / 脚步 / 呼吸 / 引擎 / 雷声 / 雨——零音频资源，头盔低通总线 */
export class AudioSystem {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private wind!: { gain: GainNode; filter: BiquadFilterNode };
  private rain!: GainNode;
  private engineOsc!: { osc: OscillatorNode; gain: GainNode; filter: BiquadFilterNode };
  private breathGain!: GainNode;
  private stepPhase = 0;
  private breathPhase = 0;

  constructor(
    engine: Engine,
    private player: Player,
    private weather: WeatherSystem,
    private vehicles: VehicleManager,
    private hf: Heightfield,
  ) {
    // 浏览器要求用户手势后才能启动音频
    const boot = (): void => {
      if (!this.ctx) this.init();
      this.ctx!.resume();
    };
    window.addEventListener('click', boot, { once: false });
    window.addEventListener('keydown', boot, { once: false });

    engine.bus.on('weather:lightning', ({ delaySec }) => this.thunder(delaySec));
    engine.bus.on('player:landed', ({ speed }) => this.landThump(speed));
  }

  private noiseBuffer(seconds: number, brown = false): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      } else {
        data[i] = white;
      }
    }
    return buf;
  }

  private init(): void {
    const ctx = new AudioContext();
    this.ctx = ctx;
    // 头盔低通总线
    const helmet = ctx.createBiquadFilter();
    helmet.type = 'lowpass';
    helmet.frequency.value = 3500;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(helmet).connect(ctx.destination);

    // 风：循环白噪声 → lowpass
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = this.noiseBuffer(4);
    windSrc.loop = true;
    const windFilter = ctx.createBiquadFilter();
    windFilter.type = 'lowpass';
    windFilter.frequency.value = 500;
    const windGain = ctx.createGain();
    windGain.gain.value = 0.02;
    windSrc.connect(windFilter).connect(windGain).connect(this.master);
    windSrc.start();
    this.wind = { gain: windGain, filter: windFilter };

    // 雨：持续高频噪声层
    const rainSrc = ctx.createBufferSource();
    rainSrc.buffer = this.noiseBuffer(3);
    rainSrc.loop = true;
    const rainHp = ctx.createBiquadFilter();
    rainHp.type = 'highpass';
    rainHp.frequency.value = 1800;
    this.rain = ctx.createGain();
    this.rain.gain.value = 0;
    rainSrc.connect(rainHp).connect(this.rain).connect(this.master);
    rainSrc.start();

    // 引擎：锯齿振荡器 → lowpass
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 80;
    const engFilter = ctx.createBiquadFilter();
    engFilter.type = 'lowpass';
    engFilter.frequency.value = 350;
    const engGain = ctx.createGain();
    engGain.gain.value = 0;
    osc.connect(engFilter).connect(engGain).connect(this.master);
    osc.start();
    this.engineOsc = { osc, gain: engGain, filter: engFilter };

    // 呼吸：极低音量过滤噪声，周期起伏
    const brSrc = ctx.createBufferSource();
    brSrc.buffer = this.noiseBuffer(2);
    brSrc.loop = true;
    const brFilter = ctx.createBiquadFilter();
    brFilter.type = 'bandpass';
    brFilter.frequency.value = 700;
    brFilter.Q.value = 0.7;
    this.breathGain = ctx.createGain();
    this.breathGain.gain.value = 0;
    brSrc.connect(brFilter).connect(this.breathGain).connect(this.master);
    brSrc.start();
  }

  private volume = 0.7;

  /** 主音量（设置菜单驱动，0-1） */
  setVolume(v: number): void {
    this.volume = v;
    if (this.master) this.master.gain.value = v;
  }

  /** 信号滴答/确认音：短正弦 beep（音频未启动时静默跳过） */
  beep(freq: number, dur: number, gain: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    osc.connect(g).connect(this.master);
    osc.start();
    osc.stop(ctx.currentTime + dur + 0.02);
  }

  /** 短噪声 burst（脚步/雷/落地共用） */
  private burst(dur: number, freq: number, gain: number, type: BiquadFilterType = 'lowpass', brown = false): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer(dur, brown);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start();
  }

  private thunder(delaySec: number): void {
    setTimeout(() => this.burst(2.2, 220, 0.5, 'lowpass', true), delaySec * 1000);
  }

  private landThump(speed: number): void {
    this.burst(0.18, 300, Math.min(0.4, speed * 0.03));
  }

  update(dt: number): void {
    if (!this.ctx) return;
    const p = this.weather.params;
    const riding = this.vehicles.riding;

    // 风：随天气风速 + 移动速度
    const speed = riding ? 8 : this.player.speed;
    const windAmt = Math.min(1, p.windSpeed / 20 + speed * 0.02);
    this.wind.gain.gain.setTargetAtTime(0.02 + windAmt * 0.22, this.ctx.currentTime, 0.5);
    this.wind.filter.frequency.setTargetAtTime(400 + windAmt * 900, this.ctx.currentTime, 0.5);

    // 雨
    this.rain.gain.setTargetAtTime(p.rainRate * 0.12, this.ctx.currentTime, 0.8);

    // 脚步：按速度步频触发，音色随生物群系
    if (!riding && this.player.speed > 0.5 && this.player.groundedNow()) {
      this.stepPhase += dt * (this.player.speed > 5 ? 2.6 : 1.8);
      if (this.stepPhase >= 1) {
        this.stepPhase = 0;
        const w = this.player.worldPosition();
        const biome = this.hf.biome(w.x, w.z);
        const crisp = biome === Biome.ROCK || biome === Biome.GLASS;
        this.burst(0.09, crisp ? 2400 : 600, 0.16);
      }
    }

    // 呼吸：4s 周期，奔跑加快
    const brRate = this.player.speed > 5 ? 2.2 : 1;
    this.breathPhase += (dt / 4) * brRate;
    const br = (Math.sin(this.breathPhase * Math.PI * 2) * 0.5 + 0.5) * 0.018 * brRate;
    this.breathGain.gain.setTargetAtTime(riding ? 0 : br, this.ctx.currentTime, 0.3);

    // 引擎
    if (riding) {
      const throttle =
        riding.kind === 'rover'
          ? Math.min(1, (riding as { speedKmh?: number }).speedKmh! / 40)
          : (riding as { thrustLevel?: number }).thrustLevel! * 0.6 + 0.3;
      this.engineOsc.osc.frequency.setTargetAtTime(80 + throttle * 140, this.ctx.currentTime, 0.2);
      this.engineOsc.filter.frequency.setTargetAtTime(300 + throttle * 500, this.ctx.currentTime, 0.2);
      this.engineOsc.gain.gain.setTargetAtTime(0.05 + throttle * 0.06, this.ctx.currentTime, 0.2);
    } else {
      this.engineOsc.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
    }
  }
}
