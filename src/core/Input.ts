/** 键鼠输入：键码状态、边沿触发、PointerLock 鼠标增量 */
export class Input {
  private keys = new Set<string>();
  private pressed = new Set<string>();
  private dx = 0;
  private dy = 0;
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
