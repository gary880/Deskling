import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import type { Facing, HitRegion, PetPackage, Point } from "../domain/avatar";
import { resolveAnimation } from "../domain/fallback";
import { SpriteRenderer } from "../renderers/SpriteRenderer";

interface SpriteAvatarProps {
  pkg: PetPackage;
  renderer: SpriteRenderer;
  animation: string;
  facing: Facing;
  scale: number;
  debug: boolean;
  speech: string | null;
  onAnimationComplete: () => void;
  onPointerDown: (
    event: ReactPointerEvent<HTMLDivElement>,
    point: Point,
    region: HitRegion | null,
  ) => void;
  onPointerMove: (
    event: ReactPointerEvent<HTMLDivElement>,
    point: Point,
    region: HitRegion | null,
  ) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerLeave?: () => void;
  onSpeechClick?: () => void;
}

export function SpriteAvatar({
  pkg,
  renderer,
  animation,
  facing,
  scale,
  debug,
  speech,
  onAnimationComplete,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerLeave,
  onSpeechClick,
}: SpriteAvatarProps) {
  const [frame, setFrame] = useState(0);
  const completedRef = useRef(false);
  const resolvedAnimation = resolveAnimation(animation, pkg.manifest.animations);
  const definition = pkg.manifest.animations[resolvedAnimation];
  const animationRow = definition.facingRows?.[facing] ?? definition.row;
  const animationFrames = definition.facingFrames?.[facing] ?? definition.frames;
  const { frameWidth, frameHeight } = pkg.manifest.renderer;
  const displayWidth = frameWidth * scale;
  const displayHeight = frameHeight * scale;

  useEffect(() => {
    setFrame(0);
    completedRef.current = false;
    const startedAt = performance.now();
    let animationFrame = 0;

    const tick = (now: number) => {
      const elapsedFrames = Math.floor(((now - startedAt) / 1000) * definition.fps);
      const nextFrame = definition.loop
        ? elapsedFrames % animationFrames
        : Math.min(elapsedFrames, animationFrames - 1);
      setFrame((current) => (current === nextFrame ? current : nextFrame));

      if (!definition.loop && elapsedFrames >= animationFrames && !completedRef.current) {
        completedRef.current = true;
        onAnimationComplete();
        return;
      }
      animationFrame = requestAnimationFrame(tick);
    };

    animationFrame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrame);
  }, [animationFrames, definition, onAnimationComplete, resolvedAnimation]);

  const pointFromEvent = (event: ReactPointerEvent<HTMLDivElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * frameWidth,
      y: ((event.clientY - rect.top) / rect.height) * frameHeight,
    };
  };

  const spriteStyle = useMemo<CSSProperties>(
    () => ({
      width: displayWidth,
      height: displayHeight,
      backgroundImage: `url(${pkg.assetUrl})`,
      backgroundSize: `${pkg.imageWidth * scale}px ${pkg.imageHeight * scale}px`,
      backgroundPosition: `${-frame * displayWidth}px ${-animationRow * displayHeight}px`,
      transform: definition.facingRows ? undefined : facing === "left" ? "scaleX(-1)" : undefined,
    }),
    [animationRow, definition.facingRows, displayHeight, displayWidth, facing, frame, pkg, scale],
  );

  const speechAnchor = pkg.manifest.anchors.speechBubble;
  const displaySpeechX = (facing === "left" ? frameWidth - speechAnchor[0] : speechAnchor[0]) * scale;

  return (
    <div
      className="avatar-shell"
      style={{ width: displayWidth, height: displayHeight }}
      aria-label={`${pkg.manifest.name} 正在 ${resolvedAnimation}`}
    >
      {speech && (
        <div
          className="speech-bubble"
          style={{ left: displaySpeechX, top: speechAnchor[1] * scale }}
          role="status"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={onSpeechClick}
          data-clickable={Boolean(onSpeechClick)}
        >
          {speech}
        </div>
      )}

      <div
        className="sprite-avatar"
        style={spriteStyle}
        onPointerDown={(event) => {
          event.stopPropagation();
          const point = pointFromEvent(event);
          onPointerDown(event, point, renderer.hitTest(point));
        }}
        onPointerMove={(event) => {
          const point = pointFromEvent(event);
          onPointerMove(event, point, renderer.hitTest(point));
        }}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerLeave}
      >
        {debug && (
          <div className="debug-layer" aria-hidden="true">
            {(Object.entries(pkg.manifest.hitboxes) as [HitRegion, typeof pkg.manifest.hitboxes.body][]).map(
              ([name, box]) => (
                <span
                  className={`debug-hitbox debug-hitbox--${name}`}
                  key={name}
                  style={{
                    left: box.x * scale,
                    top: box.y * scale,
                    width: box.width * scale,
                    height: box.height * scale,
                  }}
                >
                  {name}
                </span>
              ),
            )}
            {Object.entries(pkg.manifest.anchors).map(([name, [x, y]]) => (
              <span
                className={`debug-anchor debug-anchor--${name}`}
                key={name}
                style={{ left: x * scale, top: y * scale }}
                title={name}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
