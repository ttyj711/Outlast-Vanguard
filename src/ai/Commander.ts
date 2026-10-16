import { getMode } from "../game/modes";
import { SpatialIndex } from "../game/SpatialIndex";
import type { Point, Soldier, Tactic, WorldState } from "../game/types";

const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const rescuePriorityOrder = new WeakMap<WorldState, Soldier[]>();

export function decideTactic(world: WorldState): Tactic {
  const mode = getMode(world.modeId);
  const active = world.team.filter((soldier) => soldier.state === "active");
  if (!active.length) return "finished";
  if (mode.surviveSeconds && world.elapsedSeconds >= mode.surviveSeconds) return "finished";
  if (mode.objective === "boss" && !world.zombies.some((zombie) => zombie.isBoss)) return "finished";
  if (mode.objective !== "boss" && mode.killGoal && world.kills >= mode.killGoal
    && world.elapsedSeconds >= (mode.minimumCombatSeconds ?? 0)) return "finished";
  if (mode.objective === "endless") {
    const shooters = active.filter((soldier) => soldier.magazineSize > 0);
    const reloading = shooters.filter((soldier) => soldier.reloadTimer > 0 || soldier.ammo === 0).length;
    if (shooters.length && reloading / shooters.length >= .45 && world.zombies.some((zombie) => active.some((ally) => dist(zombie, ally) < 190))) return "kiting";
  }
  if (mode.objective !== "rescue") return "defend";

  const avgHealth = active.reduce((sum, soldier) => sum + soldier.health, 0) / active.length;
  if (active.length < 3 || avgHealth < 35) return "evacuate";
  if (world.survivors.every((survivor) => survivor.state !== "waiting") || world.evacuatedSurvivors >= Math.ceil(mode.civilians * 0.6)) return "evacuate";
  if (active.some((soldier) => soldier.infectionTimer > 0)) return "regroup";
  // 远处的尸群不应让救援队从撤离区起步后就切入原地防守。
  // 只有进入近距离交战圈，才标记为 defend；是否暂停推进由路线阻塞判断处理。
  const activeIndex = new SpatialIndex<Soldier>(80);
  activeIndex.rebuild(active);
  const nearby = world.zombies.filter((zombie) => activeIndex.query(zombie, 78).length > 0).length;
  if (nearby >= 4) return "defend";
  return world.survivors.some((survivor) => survivor.state === "following") ? "rescue" : "search";
}

export function assignRescueTargets(world: WorldState): Map<number, WorldState["survivors"][number]> {
  const result = new Map<number, WorldState["survivors"][number]>();
  const waiting = world.survivors.filter((survivor) => survivor.state === "waiting");
  const claimed = new Set<number>();
  let ordered = rescuePriorityOrder.get(world);
  if (!ordered) {
    ordered = [...world.team].sort((a, b) => rescueRolePriority(a.classId) - rescueRolePriority(b.classId) || a.id - b.id);
    rescuePriorityOrder.set(world, ordered);
  }
  const soldiers = ordered.filter((soldier) => soldier.state === "active" && soldier.carrierIds.length < 2);
  // 盾卫、近战和压制兵种优先组成前出小组，后勤与远程单位留在后续梯队。
  for (let index = 0; index < soldiers.length; index += 2) {
    const squad = soldiers.slice(index, index + 2);
    const center = { x: squad.reduce((sum, soldier) => sum + soldier.x, 0) / squad.length,
      y: squad.reduce((sum, soldier) => sum + soldier.y, 0) / squad.length };
    const target = waiting.filter((survivor) => !claimed.has(survivor.id))
      .sort((a, b) => dist(center, a) - dist(center, b))[0];
    if (target) {
      for (const soldier of squad) result.set(soldier.id, target);
      claimed.add(target.id);
    }
  }
  return result;
}

function rescueRolePriority(classId: Soldier["classId"]): number {
  const priorities: Record<Soldier["classId"], number> = {
    shieldGuard: 0, shotgunner: 1, flamethrower: 2, machineGunner: 3, scout: 4, rifleman: 5,
    grenadier: 6, officer: 7, sniper: 8, medic: 9, engineer: 10, ammoSpecialist: 11, droneScout: 12,
  };
  return priorities[classId];
}

