import type { Facing, Point } from "../domain/avatar";

export interface MotionSnapshot {
  position: Point;
  target: Point | null;
  velocity: Point;
  facing: Facing;
  moving: boolean;
}

export class MotionEngine {
  private position: Point;
  private target: Point | null = null;
  private speed: number;
  private facing: Facing = "right";

  constructor(initialPosition: Point, speed = 150) {
    this.position = { ...initialPosition };
    this.speed = speed;
  }

  moveTo(target: Point): void {
    this.target = { ...target };
  }

  teleport(position: Point): void {
    this.position = { ...position };
    this.target = null;
  }

  step(deltaSeconds: number): MotionSnapshot {
    if (!this.target) return this.snapshot(0);
    const dx = this.target.x - this.position.x;
    if (dx !== 0) this.facing = dx < 0 ? "left" : "right";
    const distance = Math.abs(dx);
    const step = this.speed * Math.max(0, deltaSeconds);
    if (distance <= step || distance < 0.5) {
      this.position.x = this.target.x;
      this.position.y = this.target.y;
      this.target = null;
      return this.snapshot(0);
    }
    const velocityX = Math.sign(dx) * this.speed;
    this.position.x += velocityX * deltaSeconds;
    return this.snapshot(velocityX);
  }

  getSnapshot(): MotionSnapshot {
    return this.snapshot(0);
  }

  private snapshot(velocityX: number): MotionSnapshot {
    return {
      position: { ...this.position },
      target: this.target ? { ...this.target } : null,
      velocity: { x: velocityX, y: 0 },
      facing: this.facing,
      moving: this.target !== null,
    };
  }
}
