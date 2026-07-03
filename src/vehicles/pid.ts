export interface PidConfig {
  kp: number;
  ki: number;
  kd: number;
  /** 积分项输出限幅（防 windup） */
  iMax: number;
}

export interface Pid {
  update(error: number, dt: number): number;
  reset(): void;
}

/** 增量式 PID 控制器（d 项用误差差分） */
export function createPid(cfg: PidConfig): Pid {
  let integral = 0;
  let lastError: number | null = null;
  return {
    update(error: number, dt: number): number {
      integral += error * dt * cfg.ki;
      integral = Math.max(-cfg.iMax, Math.min(cfg.iMax, integral));
      const d = lastError === null ? 0 : (error - lastError) / dt;
      lastError = error;
      return cfg.kp * error + integral + cfg.kd * d;
    },
    reset(): void {
      integral = 0;
      lastError = null;
    },
  };
}
