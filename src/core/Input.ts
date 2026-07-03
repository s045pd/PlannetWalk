/** 手柄按键 → 键码映射（standard mapping） */
const PAD_BUTTONS: [number, string][] = [
  [0, 'Space'], // A：跳跃/喷射
  [1, 'KeyR'], // B：复位
  [2, 'KeyE'], // X：交互
  [3, 'KeyP'], // Y：照片模式
  [4, 'KeyL'], // LB：大灯
  [5, 'Tab'], // RB：扫描
  [10, 'ShiftLeft'], // L3：奔跑
  [9, 'Backquote'], // Start：调试面板由 window 监听，此处只作边沿源
];
const STICK_DEADZONE = 0.18;

/** 键鼠 + 手柄输入：键码状态、边沿触发、PointerLock 鼠标增量、摇杆合成 */
export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private padHeld = new Set<string>();
  private dx = 0;
  private dy = 0;
  /** 左摇杆模拟移动（-1..1），与 WASD 合成 */
  moveAxis = { x: 0, y: 0 };
  locked = false;

  constructor(private canvas: HTMLCanvasElement) {
    window.addEventListener('keydown', (e) => {
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());

    canvas.addEventListener('click', () => {
      if (!this.locked) canvas.requestPointerLock();
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.dx += e.movementX;
      this.dy += e.movementY;
    });
  }

  /** 每帧开头轮询手柄：按键合成键码、摇杆合成移动/视角 */
  pollGamepad(): void {
    this.moveAxis.x = 0;
    this.moveAxis.y = 0;
    const pads = navigator.getGamepads?.() ?? [];
    const pad = pads.find((p) => p && p.connected);
    if (!pad) return;

    // 左摇杆 → 移动；右摇杆 → 视角增量
    const ax = pad.axes[0] ?? 0;
    const ay = pad.axes[1] ?? 0;
    if (Math.hypot(ax, ay) > STICK_DEADZONE) {
      this.moveAxis.x = ax;
      this.moveAxis.y = ay;
    }
    const rx = pad.axes[2] ?? 0;
    const ry = pad.axes[3] ?? 0;
    if (Math.abs(rx) > STICK_DEADZONE) this.dx += rx * 14;
    if (Math.abs(ry) > STICK_DEADZONE) this.dy += ry * 14;

    for (const [idx, code] of PAD_BUTTONS) {
      const down = pad.buttons[idx]?.pressed ?? false;
      const was = this.padHeld.has(code);
      if (down && !was) {
        this.padHeld.add(code);
        this.keys.add(code);
        this.pressed.add(code);
      } else if (!down && was) {
        this.padHeld.delete(code);
        this.keys.delete(code);
      }
    }
    // RT 扳机 → 奔跑/油门
    const rt = pad.buttons[7]?.value ?? 0;
    if (rt > 0.4 && !this.padHeld.has('ShiftLeft')) {
      this.padHeld.add('ShiftLeft');
      this.keys.add('ShiftLeft');
    } else if (rt <= 0.4 && this.padHeld.has('ShiftLeft') && !(pad.buttons[10]?.pressed ?? false)) {
      this.padHeld.delete('ShiftLeft');
      this.keys.delete('ShiftLeft');
    }
  }

  isDown(code: string): boolean {
    return this.keys.has(code);
  }

  /** 边沿触发：本帧首次按下返回 true 并消费 */
  consumePressed(code: string): boolean {
    return this.pressed.delete(code);
  }

  /** 取走本帧鼠标增量并清零 */
  consumeMouse(): { dx: number; dy: number } {
    const r = { dx: this.dx, dy: this.dy };
    this.dx = 0;
    this.dy = 0;
    return r;
  }

  /** 每帧末尾调用，清理未消费的边沿事件 */
  endFrame(): void {
    this.pressed.clear();
  }
}
