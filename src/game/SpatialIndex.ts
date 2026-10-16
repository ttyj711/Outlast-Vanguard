import type { Point } from "./types";

/** Uniform-grid broadphase for local combat, threat and support queries. */
export class SpatialIndex<T extends Point> {
  private readonly buckets = new Map<number, T[]>();

  constructor(private readonly cellSize = 80) {}

  rebuild(items: readonly T[]): void {
    this.buckets.clear();
    for (const item of items) {
      const key = this.key(Math.floor(item.x / this.cellSize), Math.floor(item.y / this.cellSize));
      const bucket = this.buckets.get(key);
      if (bucket) bucket.push(item);
      else this.buckets.set(key, [item]);
    }
  }

  query(point: Point, radius: number, include?: (item: T) => boolean): T[] {
    const minX = Math.floor((point.x - radius) / this.cellSize);
    const maxX = Math.floor((point.x + radius) / this.cellSize);
    const minY = Math.floor((point.y - radius) / this.cellSize);
    const maxY = Math.floor((point.y + radius) / this.cellSize);
    const radiusSquared = radius * radius;
    const result: T[] = [];
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      for (const item of this.buckets.get(this.key(x, y)) ?? []) {
        const dx = item.x - point.x, dy = item.y - point.y;
        if (dx * dx + dy * dy <= radiusSquared && (!include || include(item))) result.push(item);
      }
    }
    return result;
  }

  forEachWithin(point: Point, radius: number, visit: (item: T) => void): void {
    const minX = Math.floor((point.x - radius) / this.cellSize);
    const maxX = Math.floor((point.x + radius) / this.cellSize);
    const minY = Math.floor((point.y - radius) / this.cellSize);
    const maxY = Math.floor((point.y + radius) / this.cellSize);
    const radiusSquared = radius * radius;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      for (const item of this.buckets.get(this.key(x, y)) ?? []) {
        const dx = item.x - point.x, dy = item.y - point.y;
        if (dx * dx + dy * dy <= radiusSquared) visit(item);
      }
    }
  }

  nearestWithin(point: Point, radius: number, score: (item: T) => number): T | undefined {
    const minX = Math.floor((point.x - radius) / this.cellSize);
    const maxX = Math.floor((point.x + radius) / this.cellSize);
    const minY = Math.floor((point.y - radius) / this.cellSize);
    const maxY = Math.floor((point.y + radius) / this.cellSize);
    const radiusSquared = radius * radius;
    let best: T | undefined;
    let bestScore = Infinity;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      for (const item of this.buckets.get(this.key(x, y)) ?? []) {
        const dx = item.x - point.x, dy = item.y - point.y;
        if (dx * dx + dy * dy > radiusSquared) continue;
        const candidateScore = score(item);
        if (candidateScore < bestScore) { best = item; bestScore = candidateScore; }
      }
    }
    return best;
  }

  nearest(point: Point, score: (item: T) => number, minimumDistanceWeight = 0.55): T | undefined {
    const cellX = Math.floor(point.x / this.cellSize), cellY = Math.floor(point.y / this.cellSize);
    const maxRing = Math.ceil(Math.max(680, 660) / this.cellSize) + 1;
    let best: T | undefined;
    let bestScore = Infinity;
    for (let ring = 0; ring <= maxRing; ring++) {
      for (let y = cellY - ring; y <= cellY + ring; y++) for (let x = cellX - ring; x <= cellX + ring; x++) {
        if (ring && x > cellX - ring && x < cellX + ring && y > cellY - ring && y < cellY + ring) continue;
        for (const item of this.buckets.get(this.key(x, y)) ?? []) {
          const candidateScore = score(item);
          if (candidateScore < bestScore) { best = item; bestScore = candidateScore; }
        }
      }
      if (best) {
        const left = point.x - (cellX - ring) * this.cellSize;
        const right = (cellX + ring + 1) * this.cellSize - point.x;
        const top = point.y - (cellY - ring) * this.cellSize;
        const bottom = (cellY + ring + 1) * this.cellSize - point.y;
        if (Math.min(left, right, top, bottom) * minimumDistanceWeight > bestScore) break;
      }
    }
    return best;
  }

  private key(x: number, y: number): number { return (x & 0xffff) | ((y & 0xffff) << 16); }
}
