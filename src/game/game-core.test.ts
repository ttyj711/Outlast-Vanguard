import { describe, expect, it } from "vitest";
import { GAME_MODES } from "./modes";
import { findPath } from "./Pathfinding";
import { seededRandom } from "./random";
import { SpatialIndex } from "./SpatialIndex";
import { createWorld, stepWorld } from "./World";
import { hasLineOfSight } from "./geometry";

describe("deterministic simulation", () => {
  it("replays the same seeded rescue match exactly", () => {
    const first = createWorld("rescue", "repeatable-seed");
    const second = createWorld("rescue", "repeatable-seed");
    first.team.forEach((unit) => { if (unit.state === "ready") unit.state = "active"; });
    second.team.forEach((unit) => { if (unit.state === "ready") unit.state = "active"; });
    first.running = second.running = true;
    for (let frame = 0; frame < 120; frame++) {
      stepWorld(first, 1 / 60);
      stepWorld(second, 1 / 60);
      const firstSoldier = first.team.find((unit) => unit.x !== second.team[unit.id]?.x || unit.y !== second.team[unit.id]?.y);
      const firstZombie = first.zombies.find((unit, index) => unit.x !== second.zombies[index]?.x || unit.y !== second.zombies[index]?.y
        || unit.health !== second.zombies[index]?.health || unit.targetId !== second.zombies[index]?.targetId);
      if (firstSoldier || firstZombie || first.rngState !== second.rngState) {
        throw new Error(`Replay differs at frame ${frame}; soldier=${firstSoldier?.id ?? "same"}; zombie=${firstZombie?.id ?? "same"}; rng=${first.rngState}/${second.rngState}`);
      }
    }
    expect(first).toEqual(second);
  });

  it("changes the deployment when the seed changes", () => {
    expect(createWorld("rescue", "seed-one").zombies.map(({ x, y }) => [x, y]))
      .not.toEqual(createWorld("rescue", "seed-two").zombies.map(({ x, y }) => [x, y]));
  });

  it("uses a stable seeded random sequence", () => {
    const a = seededRandom("sequence"), b = seededRandom("sequence");
    expect(Array.from({ length: 12 }, a)).toEqual(Array.from({ length: 12 }, b));
  });

  it("initializes every configured game mode", () => {
    for (const mode of GAME_MODES) {
      const world = createWorld(mode.id, "mode-smoke");
      expect(world.modeId).toBe(mode.id);
      expect(world.team.length).toBeGreaterThan(0);
    }
  });
});

describe("navigation and spatial queries", () => {
  it("routes around walls and returns independent cached paths", () => {
    const walls = [{ x: 280, y: 200, width: 120, height: 180 }];
    const route = findPath({ x: 220, y: 280 }, { x: 460, y: 280 }, walls, "wall-test");
    expect(route.length).toBeGreaterThan(3);
    expect(route.every((point) => !(point.x > 272 && point.x < 408 && point.y > 192 && point.y < 388))).toBe(true);
    route[0].x = -1000;
    expect(findPath({ x: 220, y: 280 }, { x: 460, y: 280 }, walls, "wall-test")[0].x).toBeGreaterThan(0);
  });

  it("uses local queries and finds the nearest indexed item", () => {
    const units = [{ x: 15, y: 15 }, { x: 92, y: 12 }, { x: 420, y: 415 }];
    const index = new SpatialIndex(80);
    index.rebuild(units);
    expect(index.query({ x: 0, y: 0 }, 30)).toEqual([units[0]]);
    expect(index.nearest({ x: 100, y: 10 }, (unit) => Math.hypot(unit.x - 100, unit.y - 10))).toBe(units[1]);
    expect(index.nearestWithin({ x: 100, y: 10 }, 40, (unit) => Math.hypot(unit.x - 100, unit.y - 10))).toBe(units[1]);
  });

  it("continues a graded nearest search far enough to find a higher priority target", () => {
    const ordinary = { x: 25, y: 10, priority: 1 };
    const priorityTarget = { x: 70, y: 10, priority: 0.18 };
    const items = [ordinary, priorityTarget] as const;
    const index = new SpatialIndex<(typeof items)[number]>(20);
    index.rebuild(items);
    expect(index.nearest({ x: 10, y: 10 }, (unit) =>
      Math.hypot(unit.x - 10, unit.y - 10) * unit.priority, 0.18)).toBe(priorityTarget);
  });

  it("blocks rays through cover while allowing targets immediately beside cover", () => {
    const wall = [{ x: 40, y: 20, width: 20, height: 60 }];
    expect(hasLineOfSight({ x: 0, y: 50 }, { x: 100, y: 50 }, wall)).toBe(false);
    expect(hasLineOfSight({ x: 0, y: 0 }, { x: 100, y: 0 }, wall)).toBe(true);
    expect(hasLineOfSight({ x: 0, y: 50 }, { x: 47, y: 50 }, wall)).toBe(true);
  });
});
