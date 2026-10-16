import type { SoldierClass } from "./types";

export interface WeaponConfig {
  /** null means this class has no magazine-based weapon. */
  magazineSize: number | null;
  reloadSeconds: number;
}

/** All magazine capacities and reload durations live here, never in the simulation loop. */
export const WEAPON_CONFIG: Record<SoldierClass, WeaponConfig> = {
  rifleman: { magazineSize: 30, reloadSeconds: 1.8 },
  machineGunner: { magazineSize: 60, reloadSeconds: 3.1 },
  flamethrower: { magazineSize: 40, reloadSeconds: 2.4 },
  grenadier: { magazineSize: 6, reloadSeconds: 2.8 },
  medic: { magazineSize: 20, reloadSeconds: 1.5 },
  scout: { magazineSize: 12, reloadSeconds: 1.7 },
  shieldGuard: { magazineSize: null, reloadSeconds: 0 },
  shotgunner: { magazineSize: 8, reloadSeconds: 2.5 },
  sniper: { magazineSize: 5, reloadSeconds: 3.5 },
  engineer: { magazineSize: 15, reloadSeconds: 2 },
  droneScout: { magazineSize: null, reloadSeconds: 0 },
  officer: { magazineSize: 20, reloadSeconds: 1.5 },
  ammoSpecialist: { magazineSize: 12, reloadSeconds: 1.5 },
};

export const AMMO_RULES = {
  ammoSpecialistCooldown: 8,
  ammoSpecialistReloadReduction: 0.8,
  turretMagazineSize: 200,
  turretReloadSeconds: 2.5,
  ammoCrateCooldown: 45,
  ammoCrateRadius: 100,
  ammoCrateInterval: 1,
  ammoCrateReserve: 10000,
} as const;
