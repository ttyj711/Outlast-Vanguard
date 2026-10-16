import { AI_INTERVAL_SECONDS, WORLD_HEIGHT, WORLD_WIDTH, getMap } from "./config";
import { assignRescueTargets, decideTactic } from "../ai/Commander";
import { CLASS_INFO, getMode } from "./modes";
import { SpatialIndex } from "./SpatialIndex";
import { nextRandom, seedState } from "./random";
import { distance, hasLineOfSight, overlapsWall } from "./geometry";
import { attackProfile, type AttackKind } from "./combat";
import { followPath, moveDirect } from "./movement";
import { AMMO_RULES, WEAPON_CONFIG } from "./weaponConfig";
import type { AmmoCrate, Defense, GameModeId, Point, ShelterGuard, Soldier, SoldierClass, Survivor, WorldState, Zombie } from "./types";

const ZOMBIE_SPEED = 44;

export function createWorld(modeId: GameModeId = "rescue", requestedSeed?: string, hordePressure = 1, requestedRoster?: SoldierClass[]): WorldState {
  const mapSeed = requestedSeed?.trim() || makeSeed();
  let rngState = seedState(mapSeed);
  const random = (): number => { const roll = nextRandom(rngState); rngState = roll.state; return roll.value; };
  const mode = getMode(modeId);
  const roster = requestedRoster?.length ? requestedRoster : mode.roster;
  hordePressure = Math.max(0.5, Math.min(2, hordePressure));
  const map = getMap(modeId, mapSeed);
  const extractionMode = mode.objective === "rescue";
  const safeSpawnZones = zombieSafeZones(mode.objective, map);
  const stagingPoint = extractionMode ? map.exit : map.holdPoint;
  const columns = Math.ceil(Math.sqrt(roster.length));
  const rows = Math.ceil(roster.length / columns);
  const formationGap = roster.length > 200 ? 21 : roster.length > 40 ? 27 : roster.length > 12 ? 31 : 34;
  const team: Soldier[] = roster.map((classId, id) => ({
    id, classId,
    x: stagingPoint.x + ((id % columns) - (columns - 1) / 2) * formationGap,
    y: stagingPoint.y + (Math.floor(id / columns) - (rows - 1) / 2) * formationGap,
    health: classId === "shieldGuard" ? 220 : 100, state: "ready", attackCooldown: 0, hitCooldown: 0,
    specialCooldown: 0, infectionTimer: 0, path: [], pathTimer: 0,
    magazineSize: WEAPON_CONFIG[classId].magazineSize ?? 0,
    ammo: WEAPON_CONFIG[classId].magazineSize ?? 0,
    ammoReserve: null,
    reloadTimer: 0,
    ammoAssistTimer: 0,
    rearmProgress: 0,
    shieldEnergy: classId === "shieldGuard" ? 100 : 0, shieldOverheat: 0,
    routeKey: "", aimAngle: Math.PI / 2, carrierIds: [],
  }));
  const survivors: Survivor[] = Array.from({ length: mode.civilians }, (_, id) => ({
    id,
    x: map.civilianOrigin.x + (id % 4) * map.civilianSpacing.x,
    y: map.civilianOrigin.y + Math.floor(id / 4) * map.civilianSpacing.y,
    health: 100, state: "waiting",
  }));
  const initialZombieCount = Math.max(mode.bossCount ?? 0, Math.round(mode.initialZombies * hordePressure));
  const zombies = Array.from({ length: initialZombieCount }, (_, id) => {
    const nest = map.nests[id % map.nests.length];
    const isBoss = id < (mode.bossCount ?? 0);
    const edgePoint = !isBoss ? randomSafeEdgePoint(map.walls, safeSpawnZones, random) : undefined;
    const scatteredPoint = randomNestPoint(map, random);
    const bossNestSpawn = isBoss && mode.bossSpawn === "farNest";
    const x = edgePoint?.x ?? (bossNestSpawn ? nest.x + nest.width / 2 : isBoss && mode.objective !== "chase" ? map.holdPoint.x + (random() - 0.5) * 100 : scatteredPoint.x);
    const y = edgePoint?.y ?? (bossNestSpawn ? nest.y + nest.height / 2 : isBoss && mode.objective !== "chase" ? map.holdPoint.y + (random() - 0.5) * 100 : scatteredPoint.y);
    const safePoint = isSafeZombiePoint({ x, y }, safeSpawnZones) || overlapsWall(x, y, 5, map.walls)
      ? randomSafeSpawnPoint(map.walls, safeSpawnZones, random) : { x, y };
    const spawnX = safePoint.x;
    const spawnY = safePoint.y;
    const isElite = !isBoss && isEliteZombieId(id);
    const health = isBoss ? (mode.bossHealth ?? 3000) * (mode.randomBossHealth ? 0.65 + random() * 0.7 : 1) : isElite ? 65 : 20;
    const zombie = createZombie(id, spawnX, spawnY, health, isBoss);
    zombie.attackCooldown = random();
    zombie.isElite = isElite;
    zombie.speed = (mode.objective === "endless" ? endlessZombieSpeed(0) : ZOMBIE_SPEED) * (0.85 + hordePressure * 0.15);
    if (isElite) zombie.speed *= 1.08;
    if (isBoss && mode.objective === "chase") zombie.speed = 58;
    return zombie;
  });
  const shelterGuards: ShelterGuard[] = map.shelter ? [
    { id: 0, classId: "machineGunner", x: map.shelter.x + map.shelter.width * 0.43, y: map.shelter.y + map.shelter.height - 25,
      health: 180, maxHealth: 180, attackCooldown: 0.2, aimAngle: Math.PI / 2 },
    { id: 1, classId: "rifleman", x: map.shelter.x + map.shelter.width * 0.57, y: map.shelter.y + map.shelter.height - 25,
      health: 130, maxHealth: 130, attackCooldown: 0.45, aimAngle: Math.PI / 2 },
  ] : [];
  return {
    modeId, hordePressure, elapsedSeconds: 0, running: false, tactic: "idle", team, shelterGuards, survivors, zombies,
    evacuatedSurvivors: 0, kills: 0, nextZombieId: zombies.length,
    spawnAccumulator: 0, events: [], shots: [], defenses: [], nextDefenseId: 0, result: null, resultReason: null,
    mapSeed, totalShotsFired: 0, ammoCrates: [], nextAmmoCrateId: 0, ammoCrateCooldown: 0, collectedResourceIds: [],
    rngState, aiAccumulator: AI_INTERVAL_SECONDS, aiAssignments: [],
  };
}

export function stepWorld(world: WorldState, dt: number): void {
  if (!world.running) return;
  const mode = getMode(world.modeId);
  const map = getMap(world.modeId, world.mapSeed);
  world.elapsedSeconds += dt;
  world.aiAccumulator += dt;
  const refreshStrategicAi = world.aiAccumulator >= AI_INTERVAL_SECONDS;
  if (refreshStrategicAi) world.aiAccumulator %= AI_INTERVAL_SECONDS;
  for (const zombie of world.zombies) {
    if (zombie.friendlyFireGrace !== undefined) zombie.friendlyFireGrace = Math.max(0, zombie.friendlyFireGrace - dt);
  }
  let shotWrite = 0;
  for (let shotRead = 0; shotRead < world.shots.length; shotRead++) {
    const shot = world.shots[shotRead];
    shot.age += dt;
    if (shot.age < shot.duration) world.shots[shotWrite++] = shot;
  }
  world.shots.length = shotWrite;
  let crateWrite = 0;
  for (let crateRead = 0; crateRead < world.ammoCrates.length; crateRead++) {
    const crate = world.ammoCrates[crateRead];
    if (crate.duration !== null) crate.duration -= dt;
    crate.refillTimer -= dt;
    if ((crate.duration !== null && crate.duration <= 0) || crate.health <= 0) continue;
    if (crate.refillTimer <= 0) {
      crate.refillTimer = AMMO_RULES.ammoCrateInterval;
      for (const ally of world.team) {
        if (crate.reserve <= 0) break;
        if (ally.state !== "active" || !ally.magazineSize || distance(crate, ally) > AMMO_RULES.ammoCrateRadius) continue;
        const need = ally.magazineSize - ally.ammo;
        const supplied = Math.min(need, 10, crate.reserve);
        if (supplied > 0) { ally.ammo += supplied; crate.reserve -= supplied; }
      }
    }
    world.ammoCrates[crateWrite++] = crate;
  }
  world.ammoCrates.length = crateWrite;
  world.ammoCrateCooldown = Math.max(0, world.ammoCrateCooldown - dt);
  for (let i = 0; i < (map.resourcePoints?.length ?? 0); i++) {
    if (world.collectedResourceIds.includes(i)) continue;
    const point = map.resourcePoints![i];
    const collector = world.team.find((soldier) => soldier.state === "active" && distance(soldier, point) < 16);
    if (!collector) continue;
    for (const ally of world.team.filter((soldier) => soldier.state === "active" && soldier.magazineSize > 0)) {
      ally.ammo = ally.magazineSize;
      ally.reloadTimer = 0;
      ally.ammoAssistTimer = 0;
    }
    world.collectedResourceIds.push(i);
    if (world.supplyTargetId === i) { world.supplyRunnerId = undefined; world.supplyEscortId = undefined; world.supplyTargetId = undefined; }
    world.events.push("小队拾取战场补给包，全队弹匣快速装满。");
  }
  if (mode.objective === "holdout") {
    if (world.supplyTargetId !== undefined && world.collectedResourceIds.includes(world.supplyTargetId)) {
      world.supplyTargetId = undefined; world.supplyRunnerId = undefined; world.supplyEscortId = undefined;
    }
    if (world.supplyRunnerId !== undefined && !world.team.some((soldier) => soldier.id === world.supplyRunnerId && soldier.state === "active")) {
      world.supplyRunnerId = undefined; world.supplyEscortId = undefined; world.supplyTargetId = undefined;
    }
    if (world.supplyTargetId === undefined) {
      const remaining = (map.resourcePoints ?? []).map((point, id) => ({ point, id })).filter(({ id }) => !world.collectedResourceIds.includes(id));
      const shooters = world.team.filter((soldier) => soldier.state === "active" && soldier.magazineSize > 0);
      const ammoRatio = shooters.length ? shooters.reduce((sum, soldier) => sum + soldier.ammo / soldier.magazineSize, 0) / shooters.length : 1;
      if (remaining.length && ammoRatio < 0.68 && shooters.length) {
        const runner = [...shooters].sort((a, b) => a.ammo / a.magazineSize - b.ammo / b.magazineSize || distance(a, remaining[0].point) - distance(b, remaining[0].point))[0];
        const supply = remaining.reduce((best, item) => distance(runner, item.point) < distance(runner, best.point) ? item : best);
        const escort = shooters.filter((unit) => unit.id !== runner.id && (unit.classId === "shieldGuard" || unit.classId === "shotgunner" || unit.classId === "flamethrower" || unit.classId === "machineGunner"))
          .sort((a, b) => distance(a, runner) - distance(b, runner))[0];
        world.supplyRunnerId = runner.id; world.supplyEscortId = escort?.id; world.supplyTargetId = supply.id;
        world.events.push("补给不足，AI 派出" + CLASS_INFO[runner.classId].name + (escort ? "与" + CLASS_INFO[escort.classId].name : "") + "前往补给点，其余队员留守断后掩护。");
      }
    }
  }
  world.spawnAccumulator += dt;

  const activeAtStart = world.team.filter((soldier) => soldier.state === "active");
  const activeIndex = new SpatialIndex<Soldier>();
  activeIndex.rebuild(activeAtStart);
  if ((mode.objective === "protect" || mode.objective === "endless") && world.survivors.every((survivor) => survivor.state === "dead")) {
    finish(world, false, "平民全部失守，防守任务失败。");
    return;
  }
  if (!activeAtStart.length) {
    const evacuatedSoldiers = world.team.filter((soldier) => soldier.state === "evacuated").length;
    const success = mode.objective === "rescue"
      ? world.evacuatedSurvivors >= Math.ceil(mode.civilians * 0.6)
      : mode.objective === "breakout" && evacuatedSoldiers >= Math.ceil(world.team.length * (mode.escapeRatio ?? 0.75));
    finish(world, success, "救援队已无可行动队员。");
    return;
  }
  if (mode.surviveSeconds && world.elapsedSeconds >= mode.surviveSeconds) {
    if (mode.objective === "endless") {
      const survivorsRemaining = world.survivors.filter((survivor) => survivor.state !== "dead");
      const success = survivorsRemaining.length >= Math.ceil(mode.civilians * 0.6);
      for (const survivor of survivorsRemaining) survivor.state = "evacuated";
      world.evacuatedSurvivors = survivorsRemaining.length;
      finish(world, success, success ? "救援直升机抵达，幸存者已撤离！" : "救援直升机抵达前，平民损失过重。任务失败。");
    } else {
      const civiliansAlive = world.survivors.filter((survivor) => survivor.state !== "dead").length;
      if (mode.objective === "breakout") {
        const escaped = world.team.filter((soldier) => soldier.state === "evacuated").length;
        const required = Math.ceil(world.team.length * (mode.escapeRatio ?? 0.75));
        finish(world, escaped >= required, escaped >= required ? "突围成功，" + escaped + " 名队员抵达撤离区。" : "突围失败，仅 " + escaped + " 名队员抵达撤离区。");
      } else if (mode.objective === "protect") {
        const required = Math.ceil(mode.civilians * (mode.survivorRequiredRatio ?? 0.5));
        finish(world, civiliansAlive >= required, civiliansAlive >= required ? "坚守成功，保护了 " + civiliansAlive + " 名平民。" : "防线失守，存活平民不足任务要求。 ");
      } else finish(world, true, "坚守成功，队伍守住阵地 " + mode.surviveSeconds + " 秒。");
    }
    return;
  }
  if (mode.objective === "boss" && !world.zombies.some((zombie) => zombie.isBoss)) {
    finish(world, true, "首领已被击败，任务成功。");
    return;
  }
  if (mode.killGoal && mode.objective !== "boss" && world.kills >= mode.killGoal && world.elapsedSeconds >= (mode.minimumCombatSeconds ?? 0)) {
    finish(world, true, "清剿成功，击杀目标已达成。");
    return;
  }

  const mainRescue = mode.id === "rescue";
  const directorPressure = mainRescue ? 1 + world.elapsedSeconds / 70 : 2 + world.elapsedSeconds / 45;
  const directorBaseInterval = mainRescue ? 0.16 : mode.spawnInterval;
  const baseSpawnInterval = (mode.objective === "rescue" || mode.objective === "endless" || mode.objective === "holdout")
    ? Math.max(0.075, directorBaseInterval / directorPressure)
    : Math.max(0.18, mode.spawnInterval - world.elapsedSeconds * 0.004);
  const spawnInterval = Math.max(0.045, baseSpawnInterval / world.hordePressure);
  if (world.zombies.length >= mode.zombieLimit) {
    // 上限期间只保留不到一次刷新的积压，避免达到上限后长时间不刷或突然爆发。
    world.spawnAccumulator = Math.min(world.spawnAccumulator, spawnInterval * 0.8);
  } else {
    let spawned = 0;
    while (world.spawnAccumulator >= spawnInterval && world.zombies.length < mode.zombieLimit && spawned < 3) {
      world.spawnAccumulator -= spawnInterval;
      spawnZombie(world);
      spawned++;
    }
  }
  const plan = world.commanderPlan && world.commanderPlan.expiresAt > world.elapsedSeconds ? world.commanderPlan : undefined;
  if (!plan) world.commanderPlan = undefined;
  if (refreshStrategicAi || !world.aiAssignments.length) {
    world.tactic = plan?.tactic ?? decideTactic(world);
    world.aiAssignments = [...assignRescueTargets(world)].map(([soldierId, survivor]) => ({ soldierId, survivorId: survivor.id }));
  } else if (plan) world.tactic = plan.tactic;
  const assignments = new Map<number, Survivor>();
  for (const assignment of world.aiAssignments) {
    const survivor = world.survivors.find((item) => item.id === assignment.survivorId && item.state === "waiting");
    if (survivor) assignments.set(assignment.soldierId, survivor);
  }
  const teamById = new Map(world.team.map((unit) => [unit.id, unit]));
  const survivorById = new Map(world.survivors.map((unit) => [unit.id, unit]));
  for (const assignment of plan?.assignments ?? []) {
    const soldier = teamById.get(assignment.soldierId);
    const survivor = survivorById.get(assignment.survivorId);
    if (soldier && survivor) assignments.set(soldier.id, survivor);
  }
  const squadsBySurvivor = new Map<number, Soldier[]>();
  for (const [soldierId, survivor] of assignments) {
    const soldier = teamById.get(soldierId);
    if (soldier?.state !== "active") continue;
    const squad = squadsBySurvivor.get(survivor.id);
    if (squad) squad.push(soldier);
    else squadsBySurvivor.set(survivor.id, [soldier]);
  }
  for (const squad of squadsBySurvivor.values()) {
    squad.sort((a, b) => rescueLeadPriority(a.classId) - rescueLeadPriority(b.classId) || a.id - b.id);
  }
  for (const engineer of world.team.filter((soldier) => soldier.state === "active" && soldier.classId === "engineer")) {
    if (engineer.rearmTargetId !== undefined) {
      const targetTurret = world.defenses.find((defense) => defense.id === engineer.rearmTargetId && defense.kind === "turret");
      if (!targetTurret || targetTurret.ammo > 0) { engineer.rearmTargetId = undefined; engineer.rearmProgress = 0; }
      else if (distance(engineer, targetTurret) <= 22) {
        engineer.rearmProgress += dt;
        if (engineer.rearmProgress >= AMMO_RULES.turretReloadSeconds) {
          targetTurret.ammo = targetTurret.maxAmmo;
          engineer.rearmTargetId = undefined; engineer.rearmProgress = 0;
          world.events.push("工兵完成机枪塔重装填（2.5 秒）。");
        }
      }
      continue;
    }
    if (engineer.specialCooldown <= 0 && (mode.objective === "endless" || mode.objective === "holdout" || mode.objective === "protect")) {
      const emptyTurret = world.defenses.find((defense) => defense.kind === "turret" && defense.ammo <= 0);
      if (emptyTurret) {
        engineer.rearmTargetId = emptyTurret.id;
        engineer.rearmProgress = 0;
        continue;
      }
      const damaged = world.defenses.filter((defense) => defense.health < defense.maxHealth)
        .sort((a, b) => a.health / a.maxHealth - b.health / b.maxHealth)[0];
      if (damaged) {
        damaged.health = Math.min(damaged.maxHealth, damaged.health + 28);
        engineer.specialCooldown = 2;
        world.events.push("工兵修复了受损防御设施。 ");
      } else {
        buildDefense(world, map.holdPoint);
        engineer.specialCooldown = 7;
      }
    }
  }

  // 医疗兵主动贴近伤员，优先解除感染，再处理普通伤势。
  for (const medic of activeAtStart) {
    if (medic.state !== "active" || medic.classId !== "medic") continue;
    const patients = activeIndex.query(medic, 82).filter((soldier) => soldier.id !== medic.id && (soldier.infectionTimer > 0 || soldier.health < 82));
    const patient = nearest(medic, patients);
    if (!patient || medic.specialCooldown > 0 || distance(medic, patient) > 34) continue;
    if (patient.infectionTimer > 0) {
      patient.infectionTimer = 0;
      patient.health = Math.min(100, patient.health + 18);
      world.events.push("医疗兵解除队员 " + patient.id + " 的感染。");
    } else {
      patient.health = Math.min(100, patient.health + 14);
      world.events.push("医疗兵治疗队员 " + patient.id + "。");
    }
    medic.specialCooldown = 1.5;
  }

  // 弹药兵优先拯救关键输出位的火力空窗；部署箱作为阵地阶段的持续后勤补充。
  for (const supplier of activeAtStart) {
    if (supplier.state !== "active" || supplier.classId !== "ammoSpecialist") continue;
    if (world.ammoCrateCooldown <= 0 && mode.objective === "endless" && world.ammoCrates.length === 0) {
      world.ammoCrates.push({ id: world.nextAmmoCrateId++, x: map.holdPoint.x + 46, y: map.holdPoint.y + 44,
        reserve: AMMO_RULES.ammoCrateReserve, health: 240, maxHealth: 240, duration: null, refillTimer: 0 });
      world.ammoCrateCooldown = AMMO_RULES.ammoCrateCooldown;
      world.events.push("弹药兵在防线后方部署了补给箱。");
    }
    if (supplier.specialCooldown > 0) continue;
    const needy = activeIndex.query(supplier, 58).filter((ally) => ally.id !== supplier.id && ally.state === "active" && ally.magazineSize > 0 && (ally.reloadTimer > 0 || ally.ammo === 0))
      .sort((a, b) => ammoPriority(a.classId) - ammoPriority(b.classId) || distance(supplier, a) - distance(supplier, b))[0];
    if (needy && distance(supplier, needy) <= 58) {
      needy.ammoAssistTimer = Math.max(needy.ammoAssistTimer, needy.reloadTimer * (1 - AMMO_RULES.ammoSpecialistReloadReduction));
      supplier.specialCooldown = AMMO_RULES.ammoSpecialistCooldown;
      world.events.push("弹药兵为" + needy.id + "号队员快速装填（换弹加速 80%）。");
    }
  }

  const zombieIndex = new SpatialIndex<Zombie>();
  zombieIndex.rebuild(world.zombies);
  const officers = activeAtStart.filter((ally) => ally.classId === "officer");
  const officerIndex = new SpatialIndex<Soldier>();
  officerIndex.rebuild(officers);
  const formationMembers = buildFormationMembers(world.team);
  const frontDirection = threatDirection(world, map.holdPoint);
  const orderBySoldier = new Map((plan?.orders ?? []).map((order) => [order.soldierId, order]));
  const rescueAdvanceBySurvivor = mode.objective === "rescue" || mode.objective === "breakout"
    ? new Map<number, number>() : undefined;
  for (const soldier of activeAtStart) {
    if (soldier.state !== "active") continue;
    const officerBonus = officers.length > 0 && officerIndex.query(soldier, 92).some((ally) => ally.id !== soldier.id);
    soldier.attackCooldown = Math.max(0, soldier.attackCooldown - dt);
    soldier.hitCooldown = Math.max(0, soldier.hitCooldown - dt);
    soldier.specialCooldown = Math.max(0, soldier.specialCooldown - dt);
    const reloadReduction = Math.max(officerBonus ? 0.25 : 0, soldier.ammoAssistTimer > 0 ? AMMO_RULES.ammoSpecialistReloadReduction : 0);
    if (soldier.reloadTimer > 0) {
      soldier.reloadTimer = Math.max(0, soldier.reloadTimer - dt / (1 - reloadReduction));
      if (soldier.reloadTimer === 0) {
        if (soldier.magazineSize > 0) soldier.ammo = soldier.magazineSize;
        soldier.ammoAssistTimer = 0;
      }
    }
    soldier.ammoAssistTimer = Math.max(0, soldier.ammoAssistTimer - dt);
    soldier.pathTimer -= dt;
    if (soldier.shieldOverheat > 0) soldier.shieldOverheat = Math.max(0, soldier.shieldOverheat - dt);
    else if (soldier.classId === "shieldGuard") soldier.shieldEnergy = Math.min(100, soldier.shieldEnergy + 16 * dt);

    if (soldier.infectionTimer > 0) {
      soldier.infectionTimer -= dt;
      if (soldier.infectionTimer <= 0) turnIntoZombie(world, soldier);
    }
    if (soldier.state !== "active") continue;

    const profile = attackProfile(soldier.classId);
    const rearmTarget = soldier.rearmTargetId === undefined ? undefined : world.defenses.find((defense) => defense.id === soldier.rearmTargetId);
    const areaAttacker = soldier.classId === "flamethrower" || soldier.classId === "grenadier";
    const visibleThreats = soldier.classId === "sniper"
      ? [zombieIndex.nearest(soldier, (zombie) => (zombie.friendlyFireGrace ?? 0) <= 0 && hasLineOfSight(soldier, zombie, map.walls)
        ? distance(soldier, zombie) * (zombie.isBoss ? 0.18 : 1) : Infinity, 0.18)].filter((zombie): zombie is Zombie => zombie !== undefined)
      : areaAttacker
        ? zombieIndex.query(soldier, profile.range, (zombie) => (zombie.friendlyFireGrace ?? 0) <= 0
          && hasLineOfSight(soldier, zombie, map.walls))
        : [zombieIndex.nearestWithin(soldier, profile.range, (zombie) => (zombie.friendlyFireGrace ?? 0) > 0
          || (soldier.classId !== "droneScout" && !hasLineOfSight(soldier, zombie, map.walls))
          ? Infinity : distance(soldier, zombie) * (zombie.isBoss ? 0.18 : 1))].filter((zombie): zombie is Zombie => zombie !== undefined);
    // 关键后勤行为由模拟器硬规则保障，LLM 不能把工兵从重装任务或补给小队从既定出勤中调走。
    const reservedForLogistics = Boolean(rearmTarget)
      || (mode.objective === "holdout" && (world.supplyRunnerId === soldier.id || world.supplyEscortId === soldier.id));
    const soldierOrder = reservedForLogistics ? undefined : orderBySoldier.get(soldier.id);
    const focusedZombie = soldierOrder?.action === "focus" ? world.zombies.find((zombie) => zombie.id === soldierOrder.targetId) : undefined;
    const focusedThreat = focusedZombie && (focusedZombie.friendlyFireGrace ?? 0) <= 0
      && distance(soldier, focusedZombie) <= profile.range
      && (soldier.classId === "droneScout" || hasLineOfSight(soldier, focusedZombie, map.walls))
      ? focusedZombie : undefined;
    const threat = focusedThreat ?? (soldier.classId === "flamethrower" || soldier.classId === "grenadier"
      ? clusterTarget(soldier, visibleThreats, soldier.classId === "flamethrower" ? 92 : 118)
      : preferredTarget(soldier, visibleThreats));
    if (soldier.classId === "shieldGuard" && world.zombies.length) {
      const facingThreat = nearest(soldier, world.zombies);
      if (facingThreat) soldier.aimAngle = Math.atan2(facingThreat.y - soldier.y, facingThreat.x - soldier.x);
    }
    const attackCooldown = profile.cooldown * (officerBonus ? 0.84 : 1);
    const ammoTarget = soldier.classId === "ammoSpecialist" ? nearest(soldier, activeIndex.query(soldier, 120)
      .filter((ally) => ally.id !== soldier.id && ally.state === "active" && ally.magazineSize > 0 && (ally.reloadTimer > 0 || ally.ammo === 0))) : undefined;
    const rearmingInPlace = rearmTarget !== undefined && distance(soldier, rearmTarget) <= 22;
    if (threat && !rearmingInPlace && soldier.attackCooldown <= 0 && soldier.reloadTimer <= 0 && (!soldier.magazineSize || soldier.ammo > 0)) {
      const damage = soldier.classId === "scout" && threat.isBoss ? profile.damage * 1.8 : profile.damage;
      fireWeapon(world, soldier, zombieIndex, threat, damage, attackCooldown, profile.kind);
      if (soldier.magazineSize > 0) {
        soldier.ammo--;
        world.totalShotsFired++;
        if (soldier.ammo === 0) {
          soldier.reloadTimer = WEAPON_CONFIG[soldier.classId].reloadSeconds;
        }
      }
    }

    let target: Point;
    let routeKey: string;
    if (soldierOrder?.action === "retreat") {
      target = exitFormationPoint(world, soldier, map.exitArea); routeKey = "llm-retreat-" + soldier.id;
    } else if (soldierOrder?.action === "hold") {
      target = roleFormationSlot(map.holdPoint, soldier, frontDirection, world.team.length > 40 ? 32 : 42, formationMembers);
      routeKey = "llm-hold-" + soldier.id;
    } else if (soldierOrder?.action === "focus" && focusedZombie) {
      const dx = soldier.x - focusedZombie.x, dy = soldier.y - focusedZombie.y, length = Math.hypot(dx, dy) || 1;
      const standOff = Math.min(140, Math.max(48, profile.range * 0.55));
      target = clampPoint({ x: focusedZombie.x + dx / length * standOff, y: focusedZombie.y + dy / length * standOff });
      routeKey = "llm-focus-" + focusedZombie.id + "-" + soldier.id;
    } else if (soldierOrder?.action === "cover" && Number.isInteger(soldierOrder.targetId)) {
      const protectedSoldier = teamById.get(soldierOrder.targetId!);
      const nearestThreat = protectedSoldier ? nearest(protectedSoldier, world.zombies) : undefined;
      if (protectedSoldier && nearestThreat) {
        const dx = nearestThreat.x - protectedSoldier.x, dy = nearestThreat.y - protectedSoldier.y, length = Math.hypot(dx, dy) || 1;
        target = clampPoint({ x: protectedSoldier.x + dx / length * 28, y: protectedSoldier.y + dy / length * 28 });
      } else if (protectedSoldier) {
        const angle = (soldier.id * 2.399) % (Math.PI * 2);
        target = clampPoint({ x: protectedSoldier.x + Math.cos(angle) * 30, y: protectedSoldier.y + Math.sin(angle) * 30 });
      } else target = soldier;
      routeKey = "llm-cover-" + soldierOrder.targetId + "-" + soldier.id;
    } else if (soldierOrder?.action === "resupply" && Number.isInteger(soldierOrder.targetId)) {
      target = map.resourcePoints?.[soldierOrder.targetId!] ?? map.holdPoint;
      routeKey = "llm-resupply-" + soldierOrder.targetId + "-" + soldier.id;
    } else if ((soldierOrder?.action === "rescue" || soldierOrder?.action === "escort") && Number.isInteger(soldierOrder.targetId)) {
      const orderedSurvivor = world.survivors.find((survivor) => survivor.id === soldierOrder.targetId
        && (soldierOrder.action === "rescue" ? survivor.state === "waiting" : survivor.state === "following"));
      if (orderedSurvivor && soldierOrder.action === "rescue") assignments.set(soldier.id, orderedSurvivor);
      if (orderedSurvivor) {
        const dx = orderedSurvivor.x - map.exit.x, dy = orderedSurvivor.y - map.exit.y, length = Math.hypot(dx, dy) || 1;
        target = soldierOrder.action === "escort" ? clampPoint({ x: orderedSurvivor.x - dx / length * 46, y: orderedSurvivor.y - dy / length * 46 }) : orderedSurvivor;
        routeKey = "llm-" + soldierOrder.action + "-" + orderedSurvivor.id + "-" + soldier.id;
      } else {
        target = world.tactic === "evacuate" ? exitFormationPoint(world, soldier, map.exitArea) : assignments.get(soldier.id) ?? map.exit;
        routeKey = "llm-invalid-target-fallback-" + soldier.id;
      }
    } else if (rearmTarget) {
      target = rearmTarget; routeKey = "rearm-turret-" + rearmTarget.id;
    } else if (soldier.classId === "ammoSpecialist" && ammoTarget && distance(soldier, ammoTarget) > 48) {
      target = ammoTarget;
      routeKey = "ammo-support-" + ammoTarget.id;
    } else if (mode.objective === "holdout" && (world.supplyRunnerId === soldier.id || world.supplyEscortId === soldier.id) && world.supplyTargetId !== undefined) {
      const supplyPoint = map.resourcePoints?.[world.supplyTargetId] ?? map.holdPoint;
      if (world.supplyEscortId === soldier.id) {
        const dx = map.holdPoint.x - supplyPoint.x, dy = map.holdPoint.y - supplyPoint.y, length = Math.hypot(dx, dy) || 1;
        target = { x: supplyPoint.x + dx / length * 26, y: supplyPoint.y + dy / length * 26 };
      } else target = supplyPoint;
      routeKey = "supply-run-" + world.supplyTargetId + "-" + soldier.id;
    } else if (mode.objective === "holdout" || mode.objective === "protect" || mode.objective === "endless") {
      const gap = world.team.length > 200 ? 24 : world.team.length > 40 ? 32 : world.team.length > 12 ? 38 : 42;
      const front = mode.objective === "endless" || mode.objective === "holdout" || mode.objective === "protect"
        ? frontDirection : { x: 0, y: -1 };
      const formationPoint = world.tactic === "kiting" && mode.objective === "endless"
        ? retreatPoint(soldier, zombieIndex)
        : roleFormationSlot(map.holdPoint, soldier, front, gap, formationMembers);
      const droneTarget = mode.objective === "endless" && soldier.classId === "droneScout" ? nearest(soldier, world.zombies) : undefined;
      if (droneTarget && distance(soldier, droneTarget) > profile.range * .7) {
        const dx = soldier.x - droneTarget.x, dy = soldier.y - droneTarget.y;
        const length = Math.hypot(dx, dy) || 1;
        target = { x: droneTarget.x + dx / length * profile.range * .62, y: droneTarget.y + dy / length * profile.range * .62 };
        routeKey = "drone-" + droneTarget.id;
      } else {
        target = formationPoint;
        routeKey = "hold-" + soldier.id;
      }
    } else if (mode.objective === "kill" || mode.objective === "boss" || mode.objective === "chase") {
      const bossThreats = visibleThreats.filter((zombie) => zombie.isBoss);
      const nearestVisibleBoss = (mode.objective === "boss" || mode.objective === "chase")
        ? zombieIndex.nearest(soldier, (zombie) => zombie.isBoss && (zombie.friendlyFireGrace ?? 0) <= 0
          && distance(soldier, zombie) <= profile.range
          && (soldier.classId === "droneScout" || hasLineOfSight(soldier, zombie, map.walls))
          ? distance(soldier, zombie) : Infinity, 1)
        : undefined;
      const enemy = (mode.objective === "boss" || mode.objective === "chase")
        ? nearestVisibleBoss ?? nearest(soldier, bossThreats) ?? nearest(soldier, visibleThreats)
        : nearest(soldier, world.zombies);
      if (mode.objective === "boss" && mode.bossSpawn === "farNest" && enemy?.isBoss) {
        const dx = enemy.x - map.holdPoint.x, dy = enemy.y - map.holdPoint.y;
        const length = Math.hypot(dx, dy) || 1;
        const forward = { x: dx / length, y: dy / length };
        const rally = clampPoint({ x: enemy.x - forward.x * 112, y: enemy.y - forward.y * 112 });
        target = roleFormationSlot(rally, soldier, forward, world.team.length > 40 ? 30 : 36, formationMembers);
        routeKey = "boss-assault-formation-" + enemy.id + "-" + soldier.id;
      } else {
        const forwardDelta = enemy
          ? { x: enemy.x - map.holdPoint.x, y: enemy.y - map.holdPoint.y }
          : world.zombies.length ? threatDirection(world, map.holdPoint) : { x: 0, y: -1 };
        const length = Math.hypot(forwardDelta.x, forwardDelta.y) || 1;
        const forward = { x: forwardDelta.x / length, y: forwardDelta.y / length };
        const standOff = enemy ? Math.min(150, Math.max(72, profile.range * 0.48)) : 0;
        const rally = enemy ? clampPoint({ x: enemy.x - forward.x * standOff, y: enemy.y - forward.y * standOff }) : map.holdPoint;
        const gap = world.team.length > 200 ? 24 : world.team.length > 40 ? 32 : world.team.length > 12 ? 38 : 42;
        target = roleFormationSlot(rally, soldier, forward, gap, formationMembers);
        routeKey = enemy ? "combat-formation-" + enemy.id + "-" + soldier.id : "hold-" + soldier.id;
      }
    } else if (mode.objective === "rescue" && world.tactic === "regroup") {
      const patient = soldier.infectionTimer > 0 ? soldier
        : nearest(soldier, world.team.filter((item) => item.state === "active" && item.infectionTimer > 0));
      if (patient && patient.id !== soldier.id && distance(soldier, patient) > 28) {
        const angle = (soldier.id * 2.399) % (Math.PI * 2);
        target = clampPoint({ x: patient.x + Math.cos(angle) * 38, y: patient.y + Math.sin(angle) * 38 });
        routeKey = "regroup-" + patient.id + "-" + soldier.id;
      } else {
        target = { x: soldier.x, y: soldier.y };
        routeKey = "regroup-cover-" + soldier.id;
      }
    } else if (mode.objective === "rescue" && soldier.classId === "medic") {
      const patient = nearest(soldier, world.team.filter((item) => item.state === "active" && item.id !== soldier.id && (item.infectionTimer > 0 || item.health < 70)));
      if (patient && distance(soldier, patient) > 30) {
        target = patient;
        routeKey = "patient-" + patient.id;
      } else {
        target = world.tactic === "evacuate" ? map.exit : assignments.get(soldier.id) ?? map.exit;
        routeKey = target === map.exit ? "exit" : "survivor-" + (target as Survivor).id;
      }
    } else {
      const assignedSurvivor = assignments.get(soldier.id);
      if (world.tactic !== "evacuate" && assignedSurvivor) {
        const squad = squadsBySurvivor.get(assignedSurvivor.id) ?? [];
        if (squad.length > 1 && squad[0].id !== soldier.id) {
          const dx = assignedSurvivor.x - map.exit.x, dy = assignedSurvivor.y - map.exit.y, length = Math.hypot(dx, dy) || 1;
          target = clampPoint({ x: assignedSurvivor.x - dx / length * 52, y: assignedSurvivor.y - dy / length * 52 });
          routeKey = "escort-survivor-" + assignedSurvivor.id + "-" + soldier.id;
        } else {
          target = assignedSurvivor;
          routeKey = "survivor-" + assignedSurvivor.id;
        }
      } else {
        target = world.tactic === "evacuate" || mode.objective === "breakout"
          ? exitFormationPoint(world, soldier, map.exitArea) : map.exit;
        routeKey = world.tactic === "evacuate" || mode.objective === "breakout" ? "exit-slot-" + soldier.id : "exit";
      }
    }

    const movementSpeed = soldier.classId === "droneScout" ? 80
      : soldier.classId === "scout" ? (mode.objective === "rescue" ? 56 : 64)
        : soldier.classId === "machineGunner" ? 46 : soldier.classId === "shieldGuard" ? 48 : 53;
    const rescueGoal = world.tactic === "evacuate" ? map.exit : assignments.get(soldier.id) ?? target;
    const assignedSurvivor = assignments.get(soldier.id);
    let advanceFactor = 1;
    if (mode.objective === "rescue" || mode.objective === "breakout") {
      soldier.rescueAdvanceTimer = (soldier.rescueAdvanceTimer ?? (soldier.id % 15) / 60) - dt;
      if (soldier.rescueAdvanceTimer <= 0 || soldier.rescueAdvanceFactor === undefined) {
        const cachedFactor = assignedSurvivor ? rescueAdvanceBySurvivor?.get(assignedSurvivor.id) : undefined;
        soldier.rescueAdvanceFactor = cachedFactor
          ?? rescueAdvanceFactor(world, soldier, rescueGoal, assignments, squadsBySurvivor, map.walls, zombieIndex);
        if (assignedSurvivor && cachedFactor === undefined) rescueAdvanceBySurvivor?.set(assignedSurvivor.id, soldier.rescueAdvanceFactor);
        soldier.rescueAdvanceTimer = AI_INTERVAL_SECONDS;
      }
      advanceFactor = soldier.rescueAdvanceFactor;
    }
    const boostedSpeed = movementSpeed * (officerBonus ? 1.1 : 1) * advanceFactor;
    if ((mode.objective !== "holdout" && mode.objective !== "protect") || distance(soldier, target) > 15) {
      if ((mode.objective === "rescue" || mode.objective === "breakout") && advanceFactor <= 0.02) {
        // 前方敌群未清除：原地交火，等小队火力打开通道后再推进。
      } else {
        if (soldier.classId === "droneScout") moveDirect(soldier, target, boostedSpeed, dt);
        else followPath(soldier, target, routeKey + "-" + world.mapSeed, boostedSpeed, dt, map.walls,
          (mode.objective === "rescue" || mode.objective === "breakout") ? zombieIndex.query(soldier, 180) : undefined,
          (mode.objective === "rescue" || mode.objective === "breakout") ? 0.34 : 0.7);
      }
    }

    if (mode.objective === "rescue" && target !== map.exit && distance(soldier, target) <= 18) {
      const survivor = target as Survivor;
      if (survivor.state === "waiting" && soldier.carrierIds.length < 2) {
        survivor.state = "following";
        survivor.carrierId = soldier.id;
        soldier.carrierIds.push(survivor.id);
        soldier.routeKey = "";
      }
    }
  }

  activateShelterGuards(world, map, mode.objective);
  applySquadSpacing(world, dt, map.walls);

  for (const survivor of world.survivors) {
    if (survivor.state !== "following" || survivor.carrierId === undefined) continue;
    const carrier = world.team.find((soldier) => soldier.id === survivor.carrierId && soldier.state === "active");
    if (!carrier) { survivor.state = "waiting"; survivor.carrierId = undefined; continue; }
    const index = carrier.carrierIds.indexOf(survivor.id);
    const offset = index * 10;
    survivor.x += (carrier.x - offset - survivor.x) * Math.min(1, dt * 6);
    survivor.y += (carrier.y + 12 + offset - survivor.y) * Math.min(1, dt * 6);
  }

  for (const turret of world.defenses.filter((defense) => defense.kind === "turret")) {
    turret.attackCooldown = Math.max(0, turret.attackCooldown - dt);
    const target = preferredTarget(turret, zombieIndex.query(turret, 205).filter((zombie) => hasLineOfSight(turret, zombie, map.walls)));
    if (!target || turret.attackCooldown > 0 || turret.ammo <= 0) continue;
    world.shots.push({ x1: turret.x, y1: turret.y, x2: target.x, y2: target.y, age: 0, duration: .16, kind: "turret" });
    target.health -= 15;
    turret.attackCooldown = .22;
    turret.ammo--;
  }

  const soldierTargetLoad = new Map<number, number>();
  applyZombieStatusEffects(world, dt);
  updateShelterGuards(world, map, dt, zombieIndex);
  removeKilledZombies(world);
  const liveAllies = world.team.filter((soldier) => soldier.state === "active");
  const liveCivilians = mode.objective === "protect" || mode.objective === "endless"
    ? world.survivors.filter((survivor) => survivor.state !== "dead" && survivor.state !== "evacuated") : [];
  const allyById = new Map(liveAllies.map((unit) => [unit.id, unit]));
  const civilianById = new Map(liveCivilians.map((unit) => [unit.id, unit]));
  const defenseById = new Map(world.defenses.map((unit) => [unit.id, unit]));
  const crateById = new Map(world.ammoCrates.map((unit) => [unit.id, unit]));
  activeIndex.rebuild(liveAllies);
  for (const zombie of world.zombies) {
    if (zombie.targetKind === "soldier" && zombie.targetId !== undefined) {
      soldierTargetLoad.set(zombie.targetId, (soldierTargetLoad.get(zombie.targetId) ?? 0) + 1);
    }
  }
  for (const zombie of world.zombies) {
    if (mode.objective === "endless") zombie.speed = endlessZombieSpeed(world.elapsedSeconds) * (0.85 + world.hordePressure * 0.15);
    zombie.attackCooldown = Math.max(0, zombie.attackCooldown - dt);
    zombie.pathTimer -= dt;
    if (mode.objective === "chase" && zombie.isBoss) {
      const hunter = nearest(zombie, liveAllies);
      if (!hunter) continue;
      const fleePoint = chooseFleePoint(zombie, hunter, map.walls);
      zombie.targetId = hunter.id;
      zombie.targetKind = "soldier";
      followPath(zombie, fleePoint, "flee-" + hunter.id + "-" + zombie.id + "-" + world.mapSeed,
        zombie.speed ?? 58, dt, map.walls, undefined, 0.28);
      continue;
    }
    zombie.targetRefreshTimer = Math.max(0, (zombie.targetRefreshTimer ?? 0) - dt);
    const previousTarget = zombie.targetId === undefined ? undefined : zombie.targetKind === "survivor"
      ? civilianById.get(zombie.targetId)
      : zombie.targetKind === "defense"
        ? defenseById.get(zombie.targetId)
        : zombie.targetKind === "ammoCrate"
          ? crateById.get(zombie.targetId)
        : allyById.get(zombie.targetId);
    let target: Soldier | Survivor | Defense | AmmoCrate | undefined;
    let targetKind: NonNullable<Zombie["targetKind"]> = zombie.targetKind ?? "soldier";
    if (previousTarget && zombie.targetRefreshTimer > 0) target = previousTarget;
    else {
      const closestSoldier = activeIndex.nearest(zombie, (ally) => {
        const weight = ally.classId === "shieldGuard" ? .55 : ally.classId === "shotgunner" || ally.classId === "flamethrower" ? .9 : 1;
        return distance(zombie, ally) * weight * (1 + (soldierTargetLoad.get(ally.id) ?? 0) * .24);
      });
      const closestCivilian = nearest(zombie, liveCivilians);
      const closestDefense = nearest(zombie, world.defenses);
      let closestTarget: Soldier | Survivor | Defense | AmmoCrate | undefined = closestSoldier;
      targetKind = "soldier";
      if (closestCivilian && targetScore(zombie, closestCivilian, "survivor") < (closestTarget ? targetScore(zombie, closestTarget, "soldier") : Infinity)) {
        closestTarget = closestCivilian; targetKind = "survivor";
      }
      if (closestDefense && targetScore(zombie, closestDefense, "defense") < (closestTarget ? targetScore(zombie, closestTarget, targetKind) : Infinity)) {
        closestTarget = closestDefense; targetKind = "defense";
      }
      const closestCrate = nearest(zombie, world.ammoCrates);
      if (closestCrate && targetScore(zombie, closestCrate, "ammoCrate") < (closestTarget ? targetScore(zombie, closestTarget, targetKind) : Infinity)) {
        closestTarget = closestCrate; targetKind = "ammoCrate";
      }
      target = previousTarget && closestTarget && targetScore(zombie, previousTarget, zombie.targetKind ?? "soldier") <= targetScore(zombie, closestTarget, targetKind) * 1.3
        ? previousTarget : closestTarget;
      zombie.targetRefreshTimer = AI_INTERVAL_SECONDS;
    }
    // 保持当前追击目标，只有它明显远离或失效时才换目标，避免尸群追击时左右摇摆。
    const previousTargetId = zombie.targetKind === "soldier" ? zombie.targetId : undefined;
    if (!target) continue;
    zombie.targetId = target.id;
    zombie.targetKind = target === previousTarget ? zombie.targetKind : targetKind;
    const currentTargetId = zombie.targetKind === "soldier" ? zombie.targetId : undefined;
    if (previousTargetId !== currentTargetId) {
      if (previousTargetId !== undefined) soldierTargetLoad.set(previousTargetId, Math.max(0, (soldierTargetLoad.get(previousTargetId) ?? 1) - 1));
      if (currentTargetId !== undefined) soldierTargetLoad.set(currentTargetId, (soldierTargetLoad.get(currentTargetId) ?? 0) + 1);
    }
    // Hostiles can approach the shelter entrance, but they never path through the doorway into the civilian room.
    if (map.shelter && pointInside(target, map.shelter) && !pointInside(zombie, map.shelter)) {
      const door = shelterDoorPoint(map.shelter);
      if (distance(zombie, door) > 13) {
        followPath(zombie, door, "shelter-door-" + zombie.id + "-" + world.mapSeed,
          zombie.speed ?? ZOMBIE_SPEED, dt, map.walls, undefined, 0.24);
      } else zombie.attackCooldown = Math.max(zombie.attackCooldown, 0.35);
      continue;
    }
    const infectedProfile = zombie.infectedClassId ? attackProfile(zombie.infectedClassId) : undefined;
    const attackRange = infectedProfile ? (infectedProfile.kind === "melee" ? 16 : infectedProfile.range) : 14;
    if (infectedProfile && zombie.infectedClassId) {
      const targetDistance = distance(zombie, target);
      if (targetDistance <= attackRange && hasLineOfSight(zombie, target, map.walls) && zombie.attackCooldown <= 0
        && (zombie.targetKind !== "soldier" || (target as Soldier).hitCooldown <= 0)) {
        attackAsInfectedSoldier(world, zombie, target, infectedProfile);
      }
      // Unlike ordinary gunner zombies, converted mini-bosses keep pressing the rescue team
      // while firing. This prevents long-range classes (especially snipers) from camping at spawn.
      const preferredCombatDistance = zombie.infectedClassId === "shieldGuard" ? 12 : 54;
      if (targetDistance > preferredCombatDistance) {
        const slowed = world.defenses.some((defense) => defense.kind === "wire" && distance(defense, zombie) < 28);
        const speed = (zombie.speed ?? ZOMBIE_SPEED) * (slowed ? .52 : 1);
        followPath(zombie, target, "infected-hunt-" + target.id + "-" + zombie.id + "-" + world.mapSeed,
          speed, dt, map.walls, undefined, 0.2);
      }
      continue;
    }
    if (distance(zombie, target) <= attackRange && hasLineOfSight(zombie, target, map.walls)) {
      if (zombie.attackCooldown <= 0 && (zombie.targetKind !== "soldier" || (target as Soldier).hitCooldown <= 0)) {
        if (zombie.targetKind === "ammoCrate") {
          const crate = target as AmmoCrate;
          crate.health -= 22;
          zombie.attackCooldown = 1.1;
          if (crate.health <= 0) {
            world.ammoCrates = world.ammoCrates.filter((item) => item.id !== crate.id);
            zombie.targetId = undefined;
            world.events.push("尸潮摧毁了弹药箱，阵地补给中断！");
          }
          continue;
        }
        if (zombie.targetKind === "defense") {
          target.health -= 12;
          zombie.attackCooldown = 1.2;
          if (target.health <= 0) {
            world.defenses = world.defenses.filter((defense) => defense.id !== target.id);
            zombie.targetId = undefined;
            world.events.push("防御设施被尸潮摧毁！");
          }
          continue;
        }
        if (zombie.targetKind === "soldier") {
          const soldier = target as Soldier;
          const incoming = Math.atan2(zombie.y - soldier.y, zombie.x - soldier.x);
          const angleDifference = Math.abs(Math.atan2(Math.sin(incoming - soldier.aimAngle), Math.cos(incoming - soldier.aimAngle)));
          const shieldBlocks = soldier.classId === "shieldGuard" && angleDifference < 1.3 && soldier.shieldEnergy > 0 && soldier.shieldOverheat <= 0;
          if (shieldBlocks) {
            soldier.shieldEnergy = Math.max(0, soldier.shieldEnergy - 12);
            if (soldier.shieldEnergy === 0) { soldier.shieldOverheat = 4; world.events.push("盾卫能量盾过热，正在冷却。"); }
          }
          soldier.health -= shieldBlocks ? 1 : 5;
          soldier.hitCooldown = 0.55;
          zombie.attackCooldown = 1;
          if (!shieldBlocks && soldier.infectionTimer <= 0) {
            soldier.infectionTimer = mode.infectionSeconds;
            world.events.push("队员 " + soldier.id + " 被咬伤！感染倒计时 " + mode.infectionSeconds + " 秒。");
          }
          if (soldier.health <= 0) {
            soldier.state = "down";
            dropCarriedSurvivors(world, soldier);
            world.events.push("救援队员 " + soldier.id + " 失守。 ");
          }
        } else {
          target.health -= 12;
          zombie.attackCooldown = 1;
          if (target.health <= 0) {
            (target as Survivor).state = "dead";
            world.events.push("平民 " + target.id + " 被尸潮吞没！");
          }
        }
      }
    } else {
      const slowed = world.defenses.some((defense) => defense.kind === "wire" && distance(defense, zombie) < 28);
      const speed = (zombie.speed ?? ZOMBIE_SPEED) * (slowed ? .52 : 1);
      const chaseReplan = world.zombies.length > 300 ? 0.62 : world.zombies.length > 160 ? 0.44 : 0.3;
      followPath(zombie, target, (zombie.targetKind ?? "soldier") + "-" + target.id + "-z" + zombie.id + "-" + world.mapSeed,
        speed, dt, map.walls, undefined, chaseReplan);
    }
  }

  // 小队从撤离区出发，首两秒内先离开集结点，不能被判成已经撤离。
  if ((mode.objective === "rescue" || mode.objective === "breakout") && world.elapsedSeconds > 2) {
    for (const soldier of world.team) {
      const returning = mode.objective === "breakout" || world.tactic === "evacuate" || soldier.carrierIds.length > 0;
      if (soldier.state === "active" && returning && insideExitArea(soldier, map.exitArea)) evacuate(world, soldier);
    }
  }
  if (!world.team.some((soldier) => soldier.state === "active")) {
    const success = mode.objective === "rescue"
      ? world.evacuatedSurvivors >= Math.ceil(mode.civilians * 0.6)
      : false;
    finish(world, success, "本局结束。");
    return;
  }
}

function fireWeapon(world: WorldState, soldier: Soldier, zombieIndex: SpatialIndex<Zombie>, target: Zombie, damage: number, cooldown: number, kind: AttackKind): void {
  soldier.aimAngle = Math.atan2(target.y - soldier.y, target.x - soldier.x);
  const muzzleX = soldier.x + Math.cos(soldier.aimAngle) * 12;
  const muzzleY = soldier.y + Math.sin(soldier.aimAngle) * 12;
  const duration = kind === "grenade" ? 0.46 : kind === "flame" ? 0.38 : kind === "machineGun" ? 0.12 : kind === "scout" || kind === "sniper" ? 0.2 : kind === "shotgun" ? 0.2 : 0.15;
  if (kind === "shotgun") {
    for (let i = -2; i <= 2; i++) {
      const angle = soldier.aimAngle + i * 0.095;
      world.shots.push({ x1: muzzleX, y1: muzzleY, x2: muzzleX + Math.cos(angle) * 96, y2: muzzleY + Math.sin(angle) * 96, age: 0, duration, kind });
    }
  } else {
    world.shots.push({ x1: muzzleX, y1: muzzleY, x2: target.x, y2: target.y, age: 0, duration, kind });
  }
  soldier.attackCooldown = cooldown;
  if (kind === "machineGun") {
    const dx = target.x - soldier.x, dy = target.y - soldier.y;
    const length = Math.hypot(dx, dy) || 1;
    const fx = dx / length, fy = dy / length;
    const hits = zombieIndex.query(soldier, length + 8).filter((zombie) => (zombie.friendlyFireGrace ?? 0) <= 0 && (() => {
      const zx = zombie.x - soldier.x, zy = zombie.y - soldier.y;
      const along = zx * fx + zy * fy;
      const across = Math.abs(-zx * fy + zy * fx);
      return along > 0 && along <= length + 5 && across <= 8 && hasLineOfSight(soldier, zombie, getMap(world.modeId, world.mapSeed).walls);
    })()).sort((a, b) => distance(soldier, a) - distance(soldier, b)).slice(0, 4);
    hits.forEach((zombie, index) => { zombie.health -= damage * Math.max(0.55, 1 - index * 0.14); });
  } else if (kind === "shotgun") {
    for (const zombie of zombieIndex.query(soldier, 115)) {
      if ((zombie.friendlyFireGrace ?? 0) > 0) continue;
      const dx = zombie.x - soldier.x, dy = zombie.y - soldier.y;
      const along = dx * Math.cos(soldier.aimAngle) + dy * Math.sin(soldier.aimAngle);
      const across = Math.abs(-dx * Math.sin(soldier.aimAngle) + dy * Math.cos(soldier.aimAngle));
      if (along > 0 && along <= 96 && across <= 16 + along * .28 && hasLineOfSight(soldier, zombie, getMap(world.modeId, world.mapSeed).walls)) {
        const closeBonus = along < 58 ? 1.45 : 0.82;
        zombie.health -= damage * closeBonus;
        const shove = Math.min(32, 23 - along * .1);
        const nx = zombie.x + Math.cos(soldier.aimAngle) * shove;
        const ny = zombie.y + Math.sin(soldier.aimAngle) * shove;
        if (!overlapsWall(nx, ny, 5, getMap(world.modeId, world.mapSeed).walls)) { zombie.x = nx; zombie.y = ny; zombie.pathTimer = 0; }
      }
    }
  } else if (kind === "grenade") {
    world.shots.push({ x1: target.x, y1: target.y, x2: target.x, y2: target.y, age: -0.28, duration: 0.42, kind: "explosion" });
    const walls = getMap(world.modeId, world.mapSeed).walls;
    for (const zombie of zombieIndex.query(target, 72)) {
      if ((zombie.friendlyFireGrace ?? 0) > 0) continue;
      const blastDistance = distance(zombie, target);
      if (blastDistance > 72 || !hasLineOfSight(target, zombie, walls)) continue;
      zombie.health -= damage * (blastDistance <= 34 ? 1 : Math.max(0.35, 1 - (blastDistance - 34) / 76));
    }
  } else if (kind === "flame") {
    const walls = getMap(world.modeId, world.mapSeed).walls;
    const fx = Math.cos(soldier.aimAngle), fy = Math.sin(soldier.aimAngle);
    for (const zombie of zombieIndex.query(soldier, 135)) {
      if ((zombie.friendlyFireGrace ?? 0) > 0) continue;
      const zx = zombie.x - soldier.x, zy = zombie.y - soldier.y;
      const along = zx * fx + zy * fy;
      const across = Math.abs(-zx * fy + zy * fx);
      if (along <= 0 || along > 132 || across > 10 + along * 0.38 || !hasLineOfSight(soldier, zombie, walls)) continue;
      zombie.health -= damage;
      if (!(zombie.burnTimer && zombie.burnTimer > 0)) zombie.burnTickTimer = 0.5;
      zombie.burnTimer = Math.max(zombie.burnTimer ?? 0, 2);
      zombie.burnDamage = 3;
    }
  } else if (kind === "melee") {
    const walls = getMap(world.modeId, world.mapSeed).walls;
    for (const zombie of zombieIndex.query(soldier, 58)) {
      if ((zombie.friendlyFireGrace ?? 0) > 0) continue;
      const dx = zombie.x - soldier.x, dy = zombie.y - soldier.y;
      const along = dx * Math.cos(soldier.aimAngle) + dy * Math.sin(soldier.aimAngle);
      const across = Math.abs(-dx * Math.sin(soldier.aimAngle) + dy * Math.cos(soldier.aimAngle));
      if (along <= 0 || along > 54 || across > 24 || !hasLineOfSight(soldier, zombie, walls)) continue;
      zombie.health -= damage;
      const nx = zombie.x + Math.cos(soldier.aimAngle) * 18;
      const ny = zombie.y + Math.sin(soldier.aimAngle) * 18;
      if (!overlapsWall(nx, ny, 5, walls)) { zombie.x = nx; zombie.y = ny; zombie.pathTimer = 0; }
    }
  } else {
    target.health -= damage;
  }
}

function turnIntoZombie(world: WorldState, soldier: Soldier): void {
  soldier.state = "turned";
  dropCarriedSurvivors(world, soldier);
  const soldierMaxHealth = soldier.classId === "shieldGuard" ? 220 : 100;
  const miniBossHealth = soldierMaxHealth * 3;
  const zombie = createZombie(world.nextZombieId++, soldier.x, soldier.y, miniBossHealth);
  zombie.attackCooldown = nextWorldRandom(world);
  zombie.maxHealth = miniBossHealth;
  zombie.infectedClassId = soldier.classId;
  zombie.aimAngle = soldier.aimAngle;
  zombie.isMiniBoss = true;
  zombie.friendlyFireGrace = 1.5;
  zombie.attackCooldown = 0.25;
  world.zombies.push(zombie);
  world.events.push("感染倒计时结束：" + CLASS_INFO[soldier.classId].name + " 已尸变，保留原兵种武器并倒戈！");
}

function attackAsInfectedSoldier(world: WorldState, zombie: Zombie,
  target: Soldier | Survivor | Defense | AmmoCrate,
  profile: { range: number; damage: number; cooldown: number; kind: AttackKind }): void {
  const angle = Math.atan2(target.y - zombie.y, target.x - zombie.x);
  zombie.aimAngle = angle;
  const kind = profile.kind;
  const damage = Math.max(3, profile.damage * 0.42);
  const muzzleX = zombie.x + Math.cos(angle) * 12;
  const muzzleY = zombie.y + Math.sin(angle) * 12;
  const effectKind = kind === "medic" ? "rifle" : kind;
  const duration = kind === "flame" ? 0.38 : kind === "grenade" ? 0.46 : 0.18;
  world.shots.push({ x1: muzzleX, y1: muzzleY, x2: target.x, y2: target.y, age: 0, duration, kind: effectKind });
  target.health -= damage;
  zombie.attackCooldown = Math.max(kind === "melee" ? 0.65 : 0.55, profile.cooldown * 1.25);
  if ("hitCooldown" in target) target.hitCooldown = Math.max(target.hitCooldown, 0.4);
  if (target.health > 0) return;
  if ("state" in target) {
    if (target.state === "waiting" || target.state === "following") {
      target.state = "dead";
      target.carrierId = undefined;
      world.events.push("平民 " + target.id + " 被倒戈兵种击倒。");
    } else if (target.state === "active") {
      target.state = "down";
      dropCarriedSurvivors(world, target);
      world.events.push("队员 " + target.id + " 被倒戈兵种击倒。");
    }
  } else if ("maxAmmo" in target) {
    world.defenses = world.defenses.filter((item) => item.id !== target.id);
    world.events.push("防御设施被倒戈兵种摧毁。");
  } else {
    world.ammoCrates = world.ammoCrates.filter((item) => item.id !== target.id);
    world.events.push("弹药箱被倒戈兵种摧毁。");
  }
}

function dropCarriedSurvivors(world: WorldState, soldier: Soldier): void {
  for (const survivorId of soldier.carrierIds) {
    const survivor = world.survivors.find((item) => item.id === survivorId);
    if (survivor && survivor.state !== "dead") { survivor.state = "waiting"; survivor.carrierId = undefined; }
  }
  soldier.carrierIds = [];
}

function createZombie(id: number, x: number, y: number, health = 20, isBoss = false): Zombie {
  return { id, x, y, health, maxHealth: health, isBoss, attackCooldown: 0, path: [], pathTimer: 0, routeKey: "", targetRefreshTimer: 0 };
}

function spawnZombie(world: WorldState): void {
  const mode = getMode(world.modeId);
  let x: number, y: number;
  const map = getMap(world.modeId, world.mapSeed);
  // 普通僵尸统一从四边随机入场；巢穴只作为关卡装饰/首领出生点，不再成为固定刷怪口。
  ({ x, y } = randomSafeEdgePoint(map.walls, zombieSafeZones(mode.objective, map), () => nextWorldRandom(world)));
  const zombieId = world.nextZombieId++;
  const isElite = isEliteZombieId(zombieId);
  const zombie = createZombie(zombieId, x, y, isElite ? 65 : 20);
  zombie.attackCooldown = nextWorldRandom(world);
  zombie.isElite = isElite;
  if (overlapsWall(zombie.x, zombie.y, 5, map.walls)) {
    const fallback = randomSafeSpawnPoint(map.walls, zombieSafeZones(mode.objective, map), () => nextWorldRandom(world));
    zombie.x = fallback.x;
    zombie.y = fallback.y;
  }
  if (mode.objective === "endless") zombie.speed = endlessZombieSpeed(world.elapsedSeconds) * (0.85 + world.hordePressure * 0.15);
  else zombie.speed = ZOMBIE_SPEED * (0.85 + world.hordePressure * 0.15);
  if (isElite) zombie.speed *= 1.08;
  world.zombies.push(zombie);
}

function isEliteZombieId(id: number): boolean {
  return id % 17 === 8;
}

function randomEdgePoint(random: () => number): Point {
  const edge = Math.floor(random() * 4);
  const inset = 34;
  const alongX = inset + random() * (WORLD_WIDTH - inset * 2);
  const alongY = inset + random() * (WORLD_HEIGHT - inset * 2);
  if (edge === 0) return { x: alongX, y: inset };
  if (edge === 1) return { x: WORLD_WIDTH - inset, y: alongY };
  if (edge === 2) return { x: alongX, y: WORLD_HEIGHT - inset };
  return { x: inset, y: alongY };
}

function zombieSafeZones(objective: string, map: ReturnType<typeof getMap>): { x: number; y: number; width: number; height: number }[] {
  const zones: { x: number; y: number; width: number; height: number }[] = map.shelter ? [map.shelter] : [];
  if (objective === "rescue" || objective === "breakout") zones.push(map.exitArea);
  return zones;
}

function isSafeZombiePoint(point: Point, zones: readonly { x: number; y: number; width: number; height: number }[]): boolean {
  return zones.some((zone) => point.x >= zone.x - 14 && point.x <= zone.x + zone.width + 14
    && point.y >= zone.y - 14 && point.y <= zone.y + zone.height + 14);
}

function randomSafeEdgePoint(walls: readonly { x: number; y: number; width: number; height: number }[],
  zones: readonly { x: number; y: number; width: number; height: number }[], random: () => number): Point {
  for (let attempt = 0; attempt < 120; attempt++) {
    const point = randomEdgePoint(random);
    if (!overlapsWall(point.x, point.y, 6, walls) && !isSafeZombiePoint(point, zones)) return point;
  }
  return randomSafeSpawnPoint(walls, zones, random);
}

function randomSafeSpawnPoint(walls: readonly { x: number; y: number; width: number; height: number }[],
  zones: readonly { x: number; y: number; width: number; height: number }[], random: () => number): Point {
  for (let attempt = 0; attempt < 240; attempt++) {
    const point = randomEdgePoint(random);
    if (!overlapsWall(point.x, point.y, 6, walls) && !isSafeZombiePoint(point, zones)) return point;
  }
  const candidates: Point[] = [];
  for (let offset = 34; offset <= Math.max(WORLD_WIDTH, WORLD_HEIGHT) - 34; offset += 12) {
    for (const point of [
      { x: offset, y: 34 }, { x: WORLD_WIDTH - 34, y: offset },
      { x: WORLD_WIDTH - offset, y: WORLD_HEIGHT - 34 }, { x: 34, y: WORLD_HEIGHT - offset },
    ]) if (!overlapsWall(point.x, point.y, 6, walls) && !isSafeZombiePoint(point, zones)) candidates.push(point);
  }
  return candidates[Math.floor(random() * candidates.length)] ?? { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
}

function pointInside(point: Point, rect: { x: number; y: number; width: number; height: number }): boolean {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function shelterDoorPoint(shelter: { x: number; y: number; width: number; height: number }): Point {
  return { x: shelter.x + shelter.width / 2, y: shelter.y + shelter.height + 30 };
}

function updateShelterGuards(world: WorldState, map: ReturnType<typeof getMap>, dt: number, zombieIndex: SpatialIndex<Zombie>): void {
  for (const guard of world.shelterGuards) {
    guard.attackCooldown = Math.max(0, guard.attackCooldown - dt);
    if (guard.health <= 0 || guard.attackCooldown > 0) continue;
    const machineGun = guard.classId === "machineGunner";
    const range = machineGun ? 190 : 155;
    const target = preferredTarget(guard, zombieIndex.query(guard, range)
      .filter((zombie) => !pointInside(zombie, map.shelter!) && hasLineOfSight(guard, zombie, map.walls)));
    if (!target) continue;
    guard.aimAngle = Math.atan2(target.y - guard.y, target.x - guard.x);
    const muzzleX = guard.x + Math.cos(guard.aimAngle) * 12;
    const muzzleY = guard.y + Math.sin(guard.aimAngle) * 12;
    world.shots.push({ x1: muzzleX, y1: muzzleY, x2: target.x, y2: target.y, age: 0, duration: machineGun ? 0.12 : 0.15,
      kind: machineGun ? "machineGun" : "rifle" });
    target.health -= machineGun ? 8 : 13;
    guard.attackCooldown = machineGun ? 0.18 : 0.48;
  }
}

function activateShelterGuards(world: WorldState, map: ReturnType<typeof getMap>, objective: string): void {
  if (objective !== "rescue" || !map.shelter || !world.shelterGuards.length) return;
  const reachedShelter = world.team.some((soldier) => soldier.state === "active" && pointInside(soldier, map.shelter!));
  if (!reachedShelter) return;
  let nextId = world.team.reduce((maxId, soldier) => Math.max(maxId, soldier.id), -1) + 1;
  for (const guard of world.shelterGuards) {
    const maxHealth = guard.classId === "shieldGuard" ? 220 : 100;
    const weapon = WEAPON_CONFIG[guard.classId];
    world.team.push({
      id: nextId++, classId: guard.classId, x: guard.x, y: guard.y,
      health: Math.max(1, maxHealth * guard.health / guard.maxHealth), state: "active",
      attackCooldown: guard.attackCooldown, hitCooldown: 0, specialCooldown: 0,
      magazineSize: weapon.magazineSize ?? 0, ammo: weapon.magazineSize ?? 0, ammoReserve: null,
      reloadTimer: 0, ammoAssistTimer: 0, shieldEnergy: 0, shieldOverheat: 0,
      rearmProgress: 0, infectionTimer: 0, path: [], pathTimer: 0, routeKey: "",
      aimAngle: guard.aimAngle, carrierIds: [],
    });
  }
  const joined = world.shelterGuards.length;
  world.shelterGuards = [];
  world.events.push("救援队抵达避难屋，" + joined + " 名守卫加入小队并协助护送幸存者。");
}

function randomNestPoint(map: ReturnType<typeof getMap>, random: () => number): Point {
  for (let attempt = 0; attempt < 20; attempt++) {
    const nest = map.nests[Math.floor(random() * map.nests.length)];
    const spreadX = Math.max(44, nest.width * 0.9), spreadY = Math.max(44, nest.height * 0.9);
    const point = clampPoint({ x: nest.x + nest.width / 2 + (random() * 2 - 1) * spreadX,
      y: nest.y + nest.height / 2 + (random() * 2 - 1) * spreadY });
    if (!overlapsWall(point.x, point.y, 6, map.walls)) return point;
  }
  const nest = map.nests[Math.floor(random() * map.nests.length)];
  return clampPoint({ x: nest.x + nest.width / 2, y: nest.y + nest.height / 2 });
}

function pressureAt(seconds: number): number { return Math.min(5, Math.exp(seconds / 150)); }
function endlessZombieSpeed(seconds: number): number { return ZOMBIE_SPEED * Math.min(1.75, 1 + (pressureAt(seconds) - 1) * .14); }

function buildDefense(world: WorldState, center: Point): void {
  if (world.defenses.length >= 6) return;
  const walls = getMap(world.modeId, world.mapSeed).walls;
  const slots = Array.from({ length: 16 }, (_, i) => {
    const angle = (i / 16) * Math.PI * 2;
    const radius = i % 2 ? 92 : 72;
    return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
  });
  const position = slots.find((point) => !overlapsWall(point.x, point.y, 15, walls)
    && world.defenses.every((item) => distance(item, point) > 34));
  if (!position) return;
  const kind = world.defenses.length % 2 === 0 ? "turret" : "wire";
  const maxHealth = kind === "turret" ? 180 : 130;
  world.defenses.push({ id: world.nextDefenseId++, ...position, kind, health: maxHealth, maxHealth, attackCooldown: .25,
    ammo: kind === "turret" ? AMMO_RULES.turretMagazineSize : 0, maxAmmo: kind === "turret" ? AMMO_RULES.turretMagazineSize : 0 });
  world.events.push(kind === "turret" ? "工兵架设了一座自动机枪塔。" : "工兵铺设了铁丝网，正在减缓尸群。 ");
}

function ammoPriority(classId: SoldierClass): number {
  return ({ sniper: 0, shotgunner: 1, machineGunner: 2, flamethrower: 3, grenadier: 4, rifleman: 5,
    officer: 6, engineer: 7, medic: 8, scout: 9, ammoSpecialist: 10, shieldGuard: 11, droneScout: 12 } satisfies Record<SoldierClass, number>)[classId];
}

function preferredTarget<T extends Zombie | Defense>(from: Point, targets: T[]): T | undefined {
  let best: T | undefined;
  let bestScore = Infinity;
  for (const target of targets) {
    if ("friendlyFireGrace" in target && (target.friendlyFireGrace ?? 0) > 0) continue;
    const score = distance(from, target) * ("isBoss" in target && target.isBoss ? .18 : 1);
    if (score < bestScore) { best = target; bestScore = score; }
  }
  return best;
}

function clusterTarget(from: Point, targets: Zombie[], radius: number): Zombie | undefined {
  return targets.reduce<Zombie | undefined>((best, candidate) => {
    if (!best) return candidate;
    const score = (target: Zombie) => {
      const nearby = targets.filter((other) => distance(target, other) <= radius).length;
      return distance(from, target) - Math.min(6, nearby - 1) * 22 - (target.isBoss ? 18 : 0);
    };
    return score(candidate) < score(best) ? candidate : best;
  }, undefined);
}

function targetScore(from: Point, target: Soldier | Survivor | Defense | AmmoCrate, kind: NonNullable<Zombie["targetKind"]>): number {
  const multiplier = kind === "soldier" && (target as Soldier).classId === "shieldGuard" ? .62
    : kind === "survivor" ? .86
      : kind === "defense" && (target as Defense).kind === "turret" ? .78 : 1;
  return distance(from, target) * multiplier;
}

function threatDirection(world: WorldState, center: Point): Point {
  const threats = [...world.zombies].sort((a, b) => distance(center, a) - distance(center, b)).slice(0, 6);
  if (!threats.length) return { x: 0, y: -1 };
  const x = threats.reduce((sum, zombie) => sum + zombie.x, 0) / threats.length - center.x;
  const y = threats.reduce((sum, zombie) => sum + zombie.y, 0) / threats.length - center.y;
  const length = Math.hypot(x, y) || 1;
  return { x: x / length, y: y / length };
}

function formationRole(classId: SoldierClass): "front" | "middle" | "rear" {
  if (classId === "shieldGuard" || classId === "shotgunner" || classId === "flamethrower") return "front";
  if (classId === "medic" || classId === "engineer" || classId === "ammoSpecialist" || classId === "droneScout" || classId === "sniper") return "rear";
  return "middle";
}

function rescueLeadPriority(classId: SoldierClass): number {
  return ({ shieldGuard: 0, shotgunner: 1, flamethrower: 2, machineGunner: 3, scout: 4, rifleman: 5,
    grenadier: 6, officer: 7, sniper: 8, medic: 9, engineer: 10, ammoSpecialist: 11, droneScout: 12 } satisfies Record<SoldierClass, number>)[classId];
}

function rescueAdvanceFactor(world: WorldState, soldier: Soldier, goal: Point, assignments: Map<number, Survivor>,
  squadsBySurvivor: Map<number, Soldier[]>, walls: readonly { x: number; y: number; width: number; height: number }[], zombieIndex: SpatialIndex<Zombie>): number {
  const assigned = assignments.get(soldier.id);
  const squad = assigned
    ? squadsBySurvivor.get(assigned.id) ?? []
    : [soldier];
  let closest = Infinity;
  let corridorCount = 0;
  for (const ally of squad) {
    const allyGoal = assigned && world.tactic !== "evacuate" ? assigned : goal;
    const dx = allyGoal.x - ally.x, dy = allyGoal.y - ally.y;
    const length = Math.hypot(dx, dy);
    if (length < 1) continue;
    const fx = dx / length, fy = dy / length;
    zombieIndex.forEachWithin(ally, 145, (zombie) => {
      const zx = zombie.x - ally.x, zy = zombie.y - ally.y;
      const along = zx * fx + zy * fy;
      const across = Math.abs(zx * fy - zy * fx);
      const separation = Math.hypot(zx, zy);
      if (along < -12 || along > 145 || across > 52 || separation > 145 || !hasLineOfSight(ally, zombie, walls)) return;
      corridorCount++;
      closest = Math.min(closest, separation);
    });
  }
  if (!corridorCount) return 1;
  if (closest < 44 || (corridorCount >= 3 && closest < 105) || (corridorCount >= 2 && closest < 70)) return 0;
  if (closest < 78) return 0.22;
  if (closest < 112) return 0.48;
  return 0.7;
}

type FormationMembers = { byRole: Map<"front" | "middle" | "rear", Soldier[]>; indexById: Map<number, number> };

function buildFormationMembers(team: readonly Soldier[]): FormationMembers {
  const byRole = new Map<"front" | "middle" | "rear", Soldier[]>([["front", []], ["middle", []], ["rear", []]]);
  const indexById = new Map<number, number>();
  for (const soldier of team) {
    if (soldier.state !== "active" && soldier.state !== "ready") continue;
    const members = byRole.get(formationRole(soldier.classId))!;
    indexById.set(soldier.id, members.length);
    members.push(soldier);
  }
  return { byRole, indexById };
}

function roleFormationSlot(center: Point, soldier: Soldier, forward: Point, spacing: number, formationMembers: FormationMembers): Point {
  const length = Math.hypot(forward.x, forward.y) || 1;
  const fx = forward.x / length, fy = forward.y / length;
  const sideX = -fy, sideY = fx;
  const role = formationRole(soldier.classId);
  const members = formationMembers.byRole.get(role) ?? [];
  const index = Math.max(0, formationMembers.indexById.get(soldier.id) ?? 0);
  const columns = Math.max(1, Math.ceil(Math.sqrt(members.length)));
  const rows = Math.ceil(members.length / columns);
  const row = Math.floor(index / columns), col = index % columns;
  const width = Math.min(columns, members.length - row * columns);
  const lateral = (col - (width - 1) / 2) * spacing;
  const roleDepth = role === "front" ? spacing * 1.35 : role === "rear" ? -spacing * 1.35 : 0;
  const depth = roleDepth - row * spacing * 0.82 + (rows - 1) * spacing * 0.24;
  return clampPoint({ x: center.x + sideX * lateral + fx * depth, y: center.y + sideY * lateral + fy * depth });
}

function exitFormationPoint(world: WorldState, soldier: Soldier, area: { x: number; y: number; width: number; height: number }): Point {
  const columns = Math.max(1, Math.floor((area.width - 20) / 30));
  const rows = Math.ceil(world.team.length / columns);
  const row = Math.floor(soldier.id / columns), column = soldier.id % columns;
  const usableWidth = Math.max(0, area.width - 20), usableHeight = Math.max(0, area.height - 20);
  const x = area.x + 10 + (columns <= 1 ? usableWidth / 2 : column / (columns - 1) * usableWidth);
  const y = area.y + 10 + (rows <= 1 ? usableHeight / 2 : row / (rows - 1) * usableHeight);
  return clampPoint({ x, y });
}

function insideExitArea(point: Point, area: { x: number; y: number; width: number; height: number }): boolean {
  return point.x >= area.x + 5 && point.x <= area.x + area.width - 5
    && point.y >= area.y + 5 && point.y <= area.y + area.height - 5;
}

function clampPoint(point: Point): Point {
  return { x: Math.max(28, Math.min(WORLD_WIDTH - 28, point.x)), y: Math.max(28, Math.min(WORLD_HEIGHT - 28, point.y)) };
}

function applySquadSpacing(world: WorldState, dt: number, walls: readonly { x: number; y: number; width: number; height: number }[]): void {
  const soldiers = world.team.filter((item) => item.state === "active");
  if (soldiers.length < 2) return;
  const minSeparation = soldiers.length > 200 ? 24 : soldiers.length > 40 ? 30 : 36;
  const cellSize = minSeparation;
  const buckets = new Map<number, number[]>();
  const key = (x: number, y: number) => (x & 0xffff) | ((y & 0xffff) << 16);
  soldiers.forEach((soldier, index) => {
    const bucketKey = key(Math.floor(soldier.x / cellSize), Math.floor(soldier.y / cellSize));
    const bucket = buckets.get(bucketKey) ?? [];
    bucket.push(index);
    buckets.set(bucketKey, bucket);
  });
  const pushX = new Float64Array(soldiers.length);
  const pushY = new Float64Array(soldiers.length);
  for (let i = 0; i < soldiers.length; i++) {
    const a = soldiers[i];
    const cx = Math.floor(a.x / cellSize), cy = Math.floor(a.y / cellSize);
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
      for (const j of buckets.get(key(cx + ox, cy + oy)) ?? []) {
        if (j <= i) continue;
        const b = soldiers[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let length = Math.hypot(dx, dy);
        if (length >= minSeparation) continue;
        if (length < 0.001) { const angle = ((a.id * 31 + b.id * 17) % 360) * Math.PI / 180; dx = Math.cos(angle); dy = Math.sin(angle); length = 1; }
        const push = Math.min(3, (minSeparation - length) * Math.min(0.32, dt * 4));
        const px = dx / length * push, py = dy / length * push;
        pushX[i] += px; pushY[i] += py;
        pushX[j] -= px; pushY[j] -= py;
      }
    }
  }
  soldiers.forEach((soldier, index) => {
    const magnitude = Math.hypot(pushX[index], pushY[index]);
    if (!magnitude) return;
    const scale = Math.min(1, 4 / magnitude);
    const nextX = Math.max(8, Math.min(WORLD_WIDTH - 8, soldier.x + pushX[index] * scale));
    const nextY = Math.max(8, Math.min(WORLD_HEIGHT - 8, soldier.y + pushY[index] * scale));
    if (!overlapsWall(nextX, nextY, 6, walls)) { soldier.x = nextX; soldier.y = nextY; }
  });
}

function retreatPoint(soldier: Soldier, zombieIndex: SpatialIndex<Zombie>): Point {
  const threats = zombieIndex.query(soldier, 220);
  if (!threats.length) return { x: soldier.x + (soldier.x < WORLD_WIDTH / 2 ? -36 : 36), y: soldier.y };
  const cx = threats.reduce((sum, zombie) => sum + zombie.x, 0) / threats.length;
  const cy = threats.reduce((sum, zombie) => sum + zombie.y, 0) / threats.length;
  const dx = soldier.x - cx, dy = soldier.y - cy, length = Math.hypot(dx, dy) || 1;
  return { x: Math.max(28, Math.min(WORLD_WIDTH - 28, soldier.x + dx / length * 76)), y: Math.max(28, Math.min(WORLD_HEIGHT - 28, soldier.y + dy / length * 76)) };
}

function chooseFleePoint(zombie: Zombie, hunter: Soldier, walls: readonly { x: number; y: number; width: number; height: number }[]): Point {
  let best = { x: zombie.x, y: zombie.y };
  let bestDistance = distance(best, hunter);
  for (let i = 0; i < 16; i++) {
    const angle = (i / 16) * Math.PI * 2;
    const candidate = clampPoint({ x: zombie.x + Math.cos(angle) * 118, y: zombie.y + Math.sin(angle) * 118 });
    if (overlapsWall(candidate.x, candidate.y, 7, walls)) continue;
    const score = distance(candidate, hunter);
    if (score > bestDistance) { best = candidate; bestDistance = score; }
  }
  return best;
}

function removeKilledZombies(world: WorldState): void {
  let write = 0;
  for (let read = 0; read < world.zombies.length; read++) {
    const zombie = world.zombies[read];
    if (zombie.health <= 0) { world.kills++; continue; }
    world.zombies[write++] = zombie;
  }
  world.zombies.length = write;
}

function applyZombieStatusEffects(world: WorldState, dt: number): void {
  for (const zombie of world.zombies) {
    if (!zombie.burnTimer || zombie.burnTimer <= 0) continue;
    zombie.burnTimer = Math.max(0, zombie.burnTimer - dt);
    zombie.burnTickTimer = (zombie.burnTickTimer ?? 0.5) - dt;
    while (zombie.burnTickTimer <= 0 && zombie.burnTimer > 0) {
      zombie.health -= zombie.burnDamage ?? 3;
      zombie.burnTickTimer += 0.5;
    }
  }
}

function evacuate(world: WorldState, soldier: Soldier): void {
  if (soldier.state !== "active") return;
  soldier.state = "evacuated";
  for (const survivorId of soldier.carrierIds) {
    const survivor = world.survivors.find((item) => item.id === survivorId);
    if (survivor && survivor.state !== "evacuated") {
      survivor.state = "evacuated";
      world.evacuatedSurvivors++;
    }
  }
  soldier.carrierIds = [];
  if (getMode(world.modeId).objective === "breakout") {
    world.events.push("突围队员 " + soldier.id + " 抵达撤离区（" + world.team.filter((item) => item.state === "evacuated").length + "/" + world.team.length + "）。");
    const required = Math.ceil(world.team.length * (getMode(world.modeId).escapeRatio ?? 0.75));
    const escaped = world.team.filter((item) => item.state === "evacuated").length;
    if (escaped >= required) finish(world, true, "突围成功，" + escaped + " 名队员抵达撤离区。");
  } else world.events.push("救援小队抵达撤离区，已撤离 " + world.evacuatedSurvivors + " 名平民。");
}

function finish(world: WorldState, success: boolean, message: string): void {
  if (world.tactic === "finished") return;
  world.result = success ? "success" : "failure";
  world.resultReason = message;
  world.tactic = "finished";
  world.running = false;
  world.ammoCrates = [];
  world.events.push(message);
}

function nearest<T extends Point>(from: Point, items: T[]): T | undefined {
  return items.reduce<T | undefined>((best, item) => !best || distance(from, item) < distance(from, best) ? item : best, undefined);
}

function makeSeed(): string {
  return globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 8) ?? Math.random().toString(36).slice(2, 10);
}

function nextWorldRandom(world: WorldState): number {
  const roll = nextRandom(world.rngState);
  world.rngState = roll.state;
  return roll.value;
}

