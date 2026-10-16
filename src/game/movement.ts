import { WORLD_HEIGHT, WORLD_WIDTH } from "./config";
import type { Rect } from "./config";
import { overlapsWall } from "./geometry";
import { findPath } from "./Pathfinding";
import type { Point } from "./types";

export function followPath<T extends Point>(unit: T & { id?: number; path: Point[]; pathTimer: number; routeKey: string; pendingRouteKey?: string }, target: Point, key: string, speed: number, dt: number,
  walls: readonly { x: number; y: number; width: number; height: number }[], threats?: readonly Point[], replanSeconds = 0.7): void {
  if (unit.pendingRouteKey !== undefined && unit.pendingRouteKey !== key) unit.pendingRouteKey = undefined;
  if (unit.routeKey !== key && unit.pendingRouteKey === undefined) {
    unit.pendingRouteKey = key;
    unit.pathTimer = pathPhase(unit.id ?? 0, key);
  }
  const pendingRoute = unit.pendingRouteKey === key;
  if (unit.pathTimer <= 0 && (pendingRoute || unit.routeKey === key)) {
    unit.path = findPath(unit, target, walls, key, threats);
    unit.pathTimer = replanSeconds + pathPhase(unit.id ?? 0, key);
    unit.routeKey = key;
    unit.pendingRouteKey = undefined;
  }
  const waypoint = unit.path[0];
  if (!waypoint) return;
  moveDirect(unit, waypoint, speed, dt, walls);
  if (distance(unit, waypoint) < 7 && unit.path.length) unit.path.shift();
}

function pathPhase(id: number, key: string): number {
  // Stable per-route staggering spreads simultaneous replans across simulation ticks.
  let hash = (2166136261 ^ id) >>> 0;
  for (let index = 0; index < key.length; index++) hash = Math.imul(hash ^ key.charCodeAt(index), 16777619);
  return (hash >>> 0) % 25 / 60;
}

export function moveDirect(unit: Point, target: Point, speed: number, dt: number, walls?: readonly Rect[]): void {
  const dx = target.x - unit.x, dy = target.y - unit.y;
  const length = Math.hypot(dx, dy);
  if (length < 0.01) return;
  const step = Math.min(length, speed * dt);
  const boundaryInset = 26;
  const steps = walls ? Math.max(1, Math.ceil(step / 4)) : 1;
  const stepX = dx / length * step / steps, stepY = dy / length * step / steps;
  for (let i = 0; i < steps; i++) {
    const nextX = Math.max(boundaryInset, Math.min(WORLD_WIDTH - boundaryInset, unit.x + stepX));
    const nextY = Math.max(boundaryInset, Math.min(WORLD_HEIGHT - boundaryInset, unit.y + stepY));
    if (!walls) { unit.x = nextX; unit.y = nextY; continue; }
    if (!overlapsWall(nextX, nextY, 6, walls)) {
      unit.x = nextX;
      unit.y = nextY;
      continue;
    }
    if (!overlapsWall(nextX, unit.y, 6, walls)) unit.x = nextX;
    if (!overlapsWall(unit.x, nextY, 6, walls)) unit.y = nextY;
  }
}

function distance(a: Point, b: Point): number { return Math.hypot(a.x - b.x, a.y - b.y); }
