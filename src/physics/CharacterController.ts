import RAPIER from '@dimforge/rapier3d-compat';
import type { Physics } from './Physics';

export const CAPSULE_HALF = 0.55;
export const CAPSULE_RADIUS = 0.4;
/** 眼睛相对胶囊中心的高度 */
export const EYE_OFFSET = 0.75;

/** 运动学胶囊角色控制器：斜坡/台阶/贴地 */
export class CharacterController {
  readonly body: RAPIER.RigidBody;
  readonly collider: RAPIER.Collider;
  private ctrl: RAPIER.KinematicCharacterController;
  grounded = false;

  constructor(physics: Physics, spawn: { x: number; y: number; z: number }) {
    const w = physics.world;
    this.body = w.createRigidBody(
      RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(spawn.x, spawn.y, spawn.z),
    );
    this.collider = w.createCollider(
      RAPIER.ColliderDesc.capsule(CAPSULE_HALF, CAPSULE_RADIUS),
      this.body,
    );
    this.ctrl = w.createCharacterController(0.1);
    this.ctrl.enableAutostep(0.5, 0.2, true);
    this.ctrl.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.ctrl.setMinSlopeSlideAngle((55 * Math.PI) / 180);
    this.ctrl.enableSnapToGround(0.5);
  }

  /** 计算期望位移的实际可行移动并应用，返回实际位移 */
  move(desired: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
    this.ctrl.computeColliderMovement(this.collider, desired);
    this.grounded = this.ctrl.computedGrounded();
    const m = this.ctrl.computedMovement();
    const t = this.body.translation();
    this.body.setNextKinematicTranslation({ x: t.x + m.x, y: t.y + m.y, z: t.z + m.z });
    return { x: m.x, y: m.y, z: m.z };
  }

  position(): { x: number; y: number; z: number } {
    const t = this.body.translation();
    return { x: t.x, y: t.y, z: t.z };
  }

  setPosition(p: { x: number; y: number; z: number }): void {
    this.body.setTranslation(p, true);
    this.body.setNextKinematicTranslation(p);
  }
}
