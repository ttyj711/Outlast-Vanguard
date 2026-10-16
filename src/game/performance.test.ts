import { expect, it } from "vitest";
import { createWorld, stepWorld } from "./World";
import type { GameModeId } from "./types";

const ENTITY_BUDGET = 500;
const WARMUP_STEPS = 60;
const MEASURED_STEPS = 180;
const BENCHMARK_MODES: GameModeId[] = ["rescue", "holdout", "houseSiege"];

it("keeps 500 active entities within the simulation frame budget across key maps", () => {
  const results: { modeId: GameModeId; p95: number; overBudgetRatio: number }[] = [];
  for (const [scenarioIndex, modeId] of BENCHMARK_MODES.entries()) {
    const soldierCount = 400;
    const world = createWorld(modeId, `perf-500-${modeId}-v1`, 1,
      Array.from({ length: soldierCount }, () => "rifleman" as const));
    // Prevent attrition or new spawns from changing the live-unit count mid-sample.
    world.team.forEach((unit) => { unit.state = "active"; unit.health = 100_000; });

    const zombieCount = ENTITY_BUDGET - soldierCount;
    expect(world.zombies.length, `${modeId} benchmark needs enough initial zombies`).toBeGreaterThanOrEqual(zombieCount);
    world.zombies = world.zombies.slice(0, zombieCount).map((unit) => ({
      ...unit, health: 100_000, maxHealth: 100_000, path: [], routeKey: "", pathTimer: 0,
      targetId: undefined, targetKind: undefined, targetRefreshTimer: 0,
    }));
    world.nextZombieId = zombieCount;
    world.spawnAccumulator = -60;
    world.running = true;
    expect(world.team.filter((unit) => unit.state === "active").length + world.zombies.length).toBe(ENTITY_BUDGET);

    const samples: { frame: number; ms: number }[] = [];
    for (let frame = 0; frame < WARMUP_STEPS + MEASURED_STEPS; frame++) {
      const start = performance.now();
      stepWorld(world, 1 / 60);
      const elapsed = performance.now() - start;
      expect(world.running, `${modeId} ended before benchmark sampling completed at step ${frame}`).toBe(true);
      expect(world.team.filter((unit) => unit.state === "active").length + world.zombies.length,
        `${modeId} active entity count changed at step ${frame}`).toBe(ENTITY_BUDGET);
      if (frame >= WARMUP_STEPS) samples.push({ frame, ms: elapsed });
    }

    const sorted = samples.map(({ ms }) => ms).sort((a, b) => a - b);
    const p50 = sorted[Math.floor((sorted.length - 1) * 0.5)];
    const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
    const maximum = sorted[sorted.length - 1];
    const overBudgetRatio = samples.filter(({ ms }) => ms > 16).length / samples.length;
    console.info(`[benchmark] ${modeId} (${scenarioIndex + 1}/${BENCHMARK_MODES.length}, ${ENTITY_BUDGET} entities): P50=${p50.toFixed(2)}ms, P95=${p95.toFixed(2)}ms, max=${maximum.toFixed(2)}ms, >16ms=${(overBudgetRatio * 100).toFixed(2)}%`);
    results.push({ modeId, p95, overBudgetRatio });
  }
  for (const result of results) {
    expect(result.p95, `${result.modeId} P95`).toBeLessThanOrEqual(8);
    expect(result.overBudgetRatio, `${result.modeId} >16ms ratio`).toBeLessThan(0.01);
  }
}, 30000);
