import type { Rect } from "./config";
import type { Point } from "./types";

export function overlapsWall(x: number, y: number, radius: number, walls: readonly Rect[]): boolean {
  return walls.some((wall) => x + radius > wall.x && x - radius < wall.x + wall.width
    && y + radius > wall.y && y - radius < wall.y + wall.height);
}

export function distance(a: Point, b: Point): number { return Math.hypot(a.x - b.x, a.y - b.y); }

/** Solid walls block visibility, including targets standing immediately behind cover. */
export function hasLineOfSight(start: Point, end: Point, walls: readonly Rect[]): boolean {
  const dx = end.x - start.x, dy = end.y - start.y;
  const minX = Math.min(start.x, end.x), maxX = Math.max(start.x, end.x);
  const minY = Math.min(start.y, end.y), maxY = Math.max(start.y, end.y);
  for (const wall of walls) {
    if (maxX < wall.x || minX > wall.x + wall.width || maxY < wall.y || minY > wall.y + wall.height) continue;
    let near = 0, far = 1;
    if (Math.abs(dx) < 0.0001) {
      if (start.x < wall.x || start.x > wall.x + wall.width) continue;
    } else {
      const t1 = (wall.x - start.x) / dx;
      const t2 = (wall.x + wall.width - start.x) / dx;
      near = Math.max(near, Math.min(t1, t2));
      far = Math.min(far, Math.max(t1, t2));
      if (near > far) continue;
    }
    if (Math.abs(dy) < 0.0001) {
      if (start.y < wall.y || start.y > wall.y + wall.height) continue;
    } else {
      const t1 = (wall.y - start.y) / dy;
      const t2 = (wall.y + wall.height - start.y) / dy;
      near = Math.max(near, Math.min(t1, t2));
      far = Math.min(far, Math.max(t1, t2));
      if (near > far) continue;
    }
    if (far >= 0 && near <= 1) return false;
  }
  return true;
}
