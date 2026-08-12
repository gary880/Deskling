import type {
  AnchorName,
  AvatarRenderer,
  Facing,
  HitRegion,
  PetPackage,
  Point,
} from "../domain/avatar";
import { resolveAnimation } from "../domain/fallback";

export class SpriteRenderer implements AvatarRenderer {
  private pkg: PetPackage | null = null;
  private animation = "idle";
  private facing: Facing = "right";

  async load(pkg: PetPackage): Promise<void> {
    this.pkg = pkg;
    this.animation = resolveAnimation("idle", pkg.manifest.animations);
  }

  play(animation: string): void {
    if (!this.pkg) return;
    this.animation = resolveAnimation(animation, this.pkg.manifest.animations);
  }

  setFacing(direction: Facing): void {
    this.facing = direction;
  }

  hitTest(point: Point): HitRegion | null {
    if (!this.pkg) return null;
    const width = this.pkg.manifest.renderer.frameWidth;
    const sourceX = this.facing === "left" ? width - point.x : point.x;
    for (const region of ["head", "body"] as const) {
      const rect = this.pkg.manifest.hitboxes[region];
      if (
        sourceX >= rect.x &&
        sourceX <= rect.x + rect.width &&
        point.y >= rect.y &&
        point.y <= rect.y + rect.height
      ) {
        return region;
      }
    }
    return null;
  }

  getAnchor(name: AnchorName): Point | null {
    if (!this.pkg) return null;
    const [x, y] = this.pkg.manifest.anchors[name];
    const frameWidth = this.pkg.manifest.renderer.frameWidth;
    return { x: this.facing === "left" ? frameWidth - x : x, y };
  }

  get currentAnimation(): string {
    return this.animation;
  }

  get currentFacing(): Facing {
    return this.facing;
  }
}
