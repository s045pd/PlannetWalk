import type { Engine } from '../core/Engine';
import type { Settings, QualityTier } from '../core/Settings';
import type { AudioSystem } from '../audio/AudioSystem';
import type { Player } from '../player/Player';

const PREF_KEY = 'planet-walk-prefs-v1';

interface Prefs {
  volume: number;
  sensitivity: number;
  fov: number;
  quality: QualityTier;
}

const DEFAULTS: Prefs = { volume: 0.7, sensitivity: 1, fov: 70, quality: 'high' };

function loadPrefs(): Prefs {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<Prefs>) };
  } catch {
    return { ...DEFAULTS };
  }
}

/** 设置菜单：Esc 开合（释放指针锁），音量/灵敏度/FOV/画质 持久化 */
export class SettingsMenu {
  private el: HTMLElement;
  private prefs: Prefs;
  open = false;

  constructor(
    private engine: Engine,
    private settings: Settings,
    private audio: AudioSystem,
    private player: Player,
  ) {
    this.prefs = loadPrefs();
    this.el = document.createElement('div');
    this.el.style.cssText =
      'position:fixed;inset:0;display:none;z-index:50;background:rgba(2,8,14,.72);' +
      'backdrop-filter:blur(4px);font-family:"SF Mono",Menlo,monospace;color:#9fe8ff;';
    this.el.innerHTML = `
      <div style="max-width:420px;margin:10vh auto;padding:28px 32px;border:1px solid rgba(159,232,255,.3);background:rgba(4,14,22,.85)">
        <div style="letter-spacing:4px;font-size:16px;margin-bottom:22px">设 置</div>
        <label style="display:block;margin-bottom:16px;font-size:12px">主音量 <span id="pw-vol-v"></span>
          <input id="pw-vol" type="range" min="0" max="1" step="0.05" style="width:100%"></label>
        <label style="display:block;margin-bottom:16px;font-size:12px">鼠标灵敏度 <span id="pw-sens-v"></span>
          <input id="pw-sens" type="range" min="0.3" max="2.5" step="0.1" style="width:100%"></label>
        <label style="display:block;margin-bottom:16px;font-size:12px">视场角 FOV <span id="pw-fov-v"></span>
          <input id="pw-fov" type="range" min="55" max="100" step="1" style="width:100%"></label>
        <label style="display:block;margin-bottom:20px;font-size:12px">画质
          <select id="pw-q" style="width:100%;background:#0a2433;color:#9fe8ff;border:1px solid #29596e;padding:4px">
            <option value="low">低</option><option value="medium">中</option><option value="high">高</option>
          </select></label>
        <div style="font-size:11px;opacity:.55;line-height:2">
          WASD 移动 · Shift 奔跑 · Space 跳跃/喷射 · E 交互<br>
          P 照片模式 · Tab 扫描 · G 切画质 · L 大灯 · R 复位<br>
          1-7 天气 · [ ] 时间快进 · \` 调试面板 · 支持手柄
        </div>
        <div style="margin-top:18px;font-size:11px;opacity:.7">Esc 关闭</div>
      </div>`;
    document.body.appendChild(this.el);

    const bind = (
      id: string,
      get: () => number,
      set: (v: number) => void,
      fmt: (v: number) => string,
    ): void => {
      const input = this.el.querySelector<HTMLInputElement>(`#${id}`)!;
      const label = this.el.querySelector(`#${id}-v`)!;
      input.value = String(get());
      label.textContent = fmt(get());
      input.addEventListener('input', () => {
        set(parseFloat(input.value));
        label.textContent = fmt(parseFloat(input.value));
        this.persist();
      });
    };
    bind(
      'pw-vol',
      () => this.prefs.volume,
      (v) => {
        this.prefs.volume = v;
        this.audio.setVolume(v);
      },
      (v) => `${Math.round(v * 100)}%`,
    );
    bind(
      'pw-sens',
      () => this.prefs.sensitivity,
      (v) => {
        this.prefs.sensitivity = v;
        this.player.sensitivity = v;
      },
      (v) => `${v.toFixed(1)}x`,
    );
    bind(
      'pw-fov',
      () => this.prefs.fov,
      (v) => {
        this.prefs.fov = v;
        this.engine.baseFov = v;
        this.engine.camera.fov = v;
        this.engine.camera.updateProjectionMatrix();
      },
      (v) => `${v}°`,
    );
    const q = this.el.querySelector<HTMLSelectElement>('#pw-q')!;
    q.value = this.prefs.quality;
    q.addEventListener('change', () => {
      this.prefs.quality = q.value as QualityTier;
      this.settings.apply(this.prefs.quality);
      this.persist();
    });

    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') this.toggle();
    });

    // 启动时应用持久化设置
    this.audio.setVolume(this.prefs.volume);
    this.player.sensitivity = this.prefs.sensitivity;
    this.engine.camera.fov = this.prefs.fov;
    this.engine.camera.updateProjectionMatrix();
  }

  private persist(): void {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify(this.prefs));
    } catch {
      /* noop */
    }
  }

  private toggle(): void {
    this.open = !this.open;
    this.el.style.display = this.open ? 'block' : 'none';
    if (this.open) document.exitPointerLock();
  }
}
