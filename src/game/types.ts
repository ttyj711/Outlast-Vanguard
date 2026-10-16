export interface Point { x: number; y: number }

export type SoldierClass = "rifleman" | "machineGunner" | "flamethrower" | "grenadier" | "medic" | "scout"
  | "shieldGuard" | "shotgunner" | "sniper" | "engineer" | "droneScout" | "officer" | "ammoSpecialist";
export type GameModeId =
  | "rescue" | "holdout" | "purge" | "infection" | "endlessDefense"
  | "armoredBreak" | "mgFlame" | "giantGuard" | "tailRace" | "twelveHeavy" | "lastDefense"
  | "mother100k" | "houseSiege" | "army500" | "flamerWaves" | "rifleWaves" | "shockSquad" | "rifleHorde";

export interface Soldier extends Point {
  id: number;
  health: number;
  state: "ready" | "active" | "down" | "evacuated" | "turned";
  classId: SoldierClass;
  attackCooldown: number;
  hitCooldown: number;
  specialCooldown: number;
  magazineSize: number;
  ammo: number;
  /** null represents an unlimited reserve stock. */
  ammoReserve: number | null;
  reloadTimer: number;
  ammoAssistTimer: number;
  shieldEnergy: number;
  shieldOverheat: number;
  rearmTargetId?: number;
  rearmProgress: number;
  infectionTimer: number;
  path: Point[];
  pathTimer: number;
  routeKey: string;
  pendingRouteKey?: string;
  aimAngle: number;
  carrierIds: number[];
  rescueAdvanceFactor?: number;
  rescueAdvanceTimer?: number;
}

export interface ShotEffect {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  age: number;
  duration: number;
  kind: "rifle" | "machineGun" | "flame" | "grenade" | "medic" | "scout" | "shotgun" | "sniper" | "melee" | "turret" | "explosion";
}

export interface Defense extends Point {
  id: number;
  kind: "turret" | "wire";
  health: number;
  maxHealth: number;
  attackCooldown: number;
  ammo: number;
  maxAmmo: number;
}

export interface AmmoCrate extends Point {
  id: number;
  reserve: number;
  health: number;
  maxHealth: number;
  duration: number | null;
  refillTimer: number;
}

export interface Survivor extends Point {
  id: number;
  health: number;
  state: "waiting" | "following" | "evacuated" | "dead";
  carrierId?: number;
}

export interface Zombie extends Point {
  id: number;
  health: number;
  maxHealth: number;
  attackCooldown: number;
  targetId?: number;
  targetKind?: "soldier" | "survivor" | "defense" | "ammoCrate";
  isBoss?: boolean;
  isElite?: boolean;
  /** A soldier-turned zombie keeps its former class and weapon behavior. */
  infectedClassId?: SoldierClass;
  aimAngle?: number;
  isMiniBoss?: boolean;
  /** Brief grace period prevents instant spawn-point focus fire by former allies. */
  friendlyFireGrace?: number;
  speed?: number;
  path: Point[];
  pathTimer: number;
  routeKey: string;
  pendingRouteKey?: string;
  targetRefreshTimer?: number;
  burnTimer?: number;
  burnTickTimer?: number;
  burnDamage?: number;
}

export interface ShelterGuard extends Point {
  id: number;
  classId: SoldierClass;
  health: number;
  maxHealth: number;
  attackCooldown: number;
  aimAngle: number;
}

export type Tactic = "idle" | "search" | "rescue" | "defend" | "regroup" | "evacuate" | "kiting" | "finished";
export type CommanderAction = "focus" | "rescue" | "escort" | "hold" | "retreat" | "resupply" | "cover";
export interface CommanderAssignment { soldierId: number; survivorId: number }
export interface CommanderOrder { soldierId: number; action: CommanderAction; targetId?: number }
export interface CommanderPlan {
  tactic: Tactic;
  reason: string;
  assignments: CommanderAssignment[];
  orders: CommanderOrder[];
  issuedAt: number;
  expiresAt: number;
}

export interface WorldState {
  modeId: GameModeId;
  /** User selected horde pressure multiplier (0.5 to 2.0). */
  hordePressure: number;
  elapsedSeconds: number;
  running: boolean;
  tactic: Tactic;
  commanderPlan?: CommanderPlan;
  team: Soldier[];
  shelterGuards: ShelterGuard[];
  survivors: Survivor[];
  zombies: Zombie[];
  evacuatedSurvivors: number;
  kills: number;
  nextZombieId: number;
  spawnAccumulator: number;
  events: string[];
  shots: ShotEffect[];
  defenses: Defense[];
  nextDefenseId: number;
  result: "success" | "failure" | null;
  resultReason: string | null;
  mapSeed: string;
  totalShotsFired: number;
  ammoCrates: AmmoCrate[];
  nextAmmoCrateId: number;
  ammoCrateCooldown: number;
  collectedResourceIds: number[];
  supplyRunnerId?: number;
  supplyEscortId?: number;
  supplyTargetId?: number;
  /** Seeded simulation RNG; saved in the world so a seed reproduces the entire match. */
  rngState: number;
  aiAccumulator: number;
  aiAssignments: { soldierId: number; survivorId: number }[];
}
