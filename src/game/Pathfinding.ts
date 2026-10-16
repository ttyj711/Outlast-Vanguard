import { WORLD_HEIGHT, WORLD_WIDTH } from "./config";
import type { Rect } from "./config";
import type { Point } from "./types";

const CELL = 20;
type Cell = { x: number; y: number; g: number; f: number; parent?: number };
const center = (x: number, y: number): Point => ({ x: x * CELL + CELL / 2, y: y * CELL + CELL / 2 });
const nodeId = (x: number, y: number) => y * Math.ceil(WORLD_WIDTH / CELL) + x;

const wallIds = new WeakMap<object, number>();
let nextWallId = 1;
const routeCache = new Map<string, Point[]>();
const MAX_CACHED_ROUTES = 1200;
const COLS = Math.ceil(WORLD_WIDTH / CELL), ROWS = Math.ceil(WORLD_HEIGHT / CELL);
const compiledWallGrids = new WeakMap<object, { walkable: Uint8Array; cost: Float32Array }>();

function compileGrid(walls: readonly Rect[]): { walkable: Uint8Array; cost: Float32Array } {
  const identity = walls as object;
  const cached = compiledWallGrids.get(identity);
  if (cached) return cached;
  const walkableCells = new Uint8Array(COLS * ROWS), costs = new Float32Array(COLS * ROWS);
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const point = center(x, y), index = y * COLS + x;
    if (point.x < 5 || point.y < 5 || point.x > WORLD_WIDTH - 5 || point.y > WORLD_HEIGHT - 5
      || walls.some((wall) => point.x >= wall.x - 8 && point.x <= wall.x + wall.width + 8
        && point.y >= wall.y - 8 && point.y <= wall.y + wall.height + 8)) continue;
    walkableCells[index] = 1;
    const edgeDistance = Math.min(point.x, point.y, WORLD_WIDTH - point.x, WORLD_HEIGHT - point.y);
    let cost = edgeDistance < 100 ? (100 - edgeDistance) / 100 * 3 : 0;
    for (const wall of walls) {
      const dx = Math.max(wall.x - point.x, 0, point.x - (wall.x + wall.width));
      const dy = Math.max(wall.y - point.y, 0, point.y - (wall.y + wall.height));
      const clearance = Math.hypot(dx, dy);
      if (clearance < 30) cost += (30 - clearance) / 30 * 0.45;
    }
    costs[index] = cost;
  }
  const compiled = { walkable: walkableCells, cost: costs };
  compiledWallGrids.set(identity, compiled);
  return compiled;
}

function wallsId(walls: readonly Rect[]): number {
  const identity = walls as object;
  let id = wallIds.get(identity);
  if (!id) { id = nextWallId++; wallIds.set(identity, id); }
  return id;
}

class MinHeap {
  private values: Cell[] = [];
  get length(): number { return this.values.length; }
  push(value: Cell): void {
    let index = this.values.push(value) - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (this.values[parent].f <= value.f) break;
      this.values[index] = this.values[parent]; index = parent;
    }
    this.values[index] = value;
  }
  pop(): Cell | undefined {
    const first = this.values[0];
    const last = this.values.pop();
    if (!first || !last || !this.values.length) return first;
    let index = 0;
    while (true) {
      const left = index * 2 + 1, right = left + 1;
      if (left >= this.values.length) break;
      const child = right < this.values.length && this.values[right].f < this.values[left].f ? right : left;
      if (this.values[child].f >= last.f) break;
      this.values[index] = this.values[child]; index = child;
    }
    this.values[index] = last;
    return first;
  }
}

export function findPath(start: Point, target: Point, walls: readonly Rect[], tieSeed = "", threats: readonly Point[] = []): Point[] {
  const grid = compileGrid(walls);
  const isWalkable = (x: number, y: number) => x >= 0 && y >= 0 && x < COLS && y < ROWS && grid.walkable[y * COLS + x] === 1;
  const sx = Math.floor(start.x / CELL), sy = Math.floor(start.y / CELL);
  let tx = Math.floor(target.x / CELL), ty = Math.floor(target.y / CELL);
  const targetIsWalkable = isWalkable(tx, ty);
  if (!targetIsWalkable) {
    const options = [[1,0],[-1,0],[0,1],[0,-1]].map(([dx,dy]) => [tx + dx!, ty + dy!] as const);
    const valid = options.filter(([x,y]) => isWalkable(x,y))
      .sort((a, b) => Math.hypot(center(a[0], a[1]).x - target.x, center(a[0], a[1]).y - target.y)
        - Math.hypot(center(b[0], b[1]).x - target.x, center(b[0], b[1]).y - target.y))[0];
    if (valid) [tx, ty] = valid;
  }
  const cacheKey = threats.length ? "" : `${wallsId(walls)}:${tieSeed}:${sx},${sy}:${tx},${ty}:${target.x},${target.y}`;
  if (cacheKey) {
    const cached = routeCache.get(cacheKey);
    if (cached) { routeCache.delete(cacheKey); routeCache.set(cacheKey, cached); return cached.map((point) => ({ ...point })); }
  }

  const startId = nodeId(sx, sy), targetId = nodeId(tx, ty);
  const first: Cell = { x: sx, y: sy, g: 0, f: Math.abs(tx - sx) + Math.abs(ty - sy) };
  const open = new MinHeap(); open.push(first);
  const best = new Map<number, Cell>([[startId, first]]);
  const closed = new Set<number>();
  let result: Point[] = [];
  while (open.length) {
    const current = open.pop()!;
    const currentId = nodeId(current.x, current.y);
    if (closed.has(currentId) || best.get(currentId) !== current) continue;
    if (currentId === targetId) {
      const path: Point[] = [];
      let cursor: Cell | undefined = current;
      while (cursor && nodeId(cursor.x, cursor.y) !== startId) {
        path.unshift(center(cursor.x, cursor.y));
        cursor = cursor.parent === undefined ? undefined : best.get(cursor.parent);
      }
      // Copy the goal: caching a live unit reference would let a later cache hit
      // read that unit's current position instead of the position when planned.
      path.push(targetIsWalkable ? { x: target.x, y: target.y } : center(tx, ty));
      result = path;
      break;
    }
    closed.add(currentId);
    const directions = [[1,0],[-1,0],[0,1],[0,-1]];
    let hash = 2166136261;
    const tieKey = tieSeed + currentId;
    for (let i = 0; i < tieKey.length; i++) hash = Math.imul(hash ^ tieKey.charCodeAt(i), 16777619);
    const offset = (hash >>> 0) % directions.length;
    for (let i = 0; i < directions.length; i++) {
      const [dx, dy] = directions[(i + offset) % directions.length];
      const nx = current.x + dx!, ny = current.y + dy!, nextId = nodeId(nx, ny);
      if (!isWalkable(nx, ny) || closed.has(nextId)) continue;
      const point = center(nx, ny);
      let threatCost = 0;
      for (const threat of threats) {
        const distance = Math.hypot(point.x - threat.x, point.y - threat.y);
        if (distance < 145) { const influence = 1 - distance / 145; threatCost = Math.min(6, threatCost + influence * influence * 1.65); }
      }
      const g = current.g + 1 + grid.cost[nextId] + threatCost;
      const old = best.get(nextId);
      if (old && old.g <= g) continue;
      const next: Cell = { x: nx, y: ny, g, f: g + Math.abs(tx - nx) + Math.abs(ty - ny), parent: currentId };
      best.set(nextId, next);
      open.push(next);
    }
  }
  if (cacheKey && result.length) {
    routeCache.set(cacheKey, result.map((point) => ({ ...point })));
    if (routeCache.size > MAX_CACHED_ROUTES) routeCache.delete(routeCache.keys().next().value!);
  }
  return result;
}
