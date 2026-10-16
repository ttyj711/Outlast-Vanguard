import { WORLD_HEIGHT, WORLD_WIDTH } from "./config";
import type { SoldierClass } from "./types";

export type AttackKind = "rifle" | "machineGun" | "flame" | "grenade" | "medic" | "scout" | "shotgun" | "sniper" | "melee";
export interface AttackProfile { range: number; damage: number; cooldown: number; kind: AttackKind }

export function attackProfile(classId: SoldierClass): AttackProfile {
  switch (classId) {
    case "machineGunner": return { range: 190, damage: 10, cooldown: 0.14, kind: "machineGun" };
    case "flamethrower": return { range: 132, damage: 10, cooldown: 0.2, kind: "flame" };
    case "grenadier": return { range: 185, damage: 36, cooldown: 2.4, kind: "grenade" };
    case "medic": return { range: 105, damage: 6, cooldown: 0.82, kind: "medic" };
    case "scout": return { range: 148, damage: 16, cooldown: 0.36, kind: "scout" };
    case "shieldGuard": return { range: 50, damage: 20, cooldown: 0.65, kind: "melee" };
    case "shotgunner": return { range: 110, damage: 10, cooldown: 0.95, kind: "shotgun" };
    case "sniper": return { range: Math.hypot(WORLD_WIDTH, WORLD_HEIGHT), damage: 120, cooldown: 2.4, kind: "sniper" };
    case "engineer": return { range: 155, damage: 14, cooldown: 0.65, kind: "rifle" };
    case "droneScout": return { range: 270, damage: 16, cooldown: 0.35, kind: "scout" };
    case "officer": return { range: 155, damage: 15, cooldown: 0.46, kind: "rifle" };
    case "ammoSpecialist": return { range: 100, damage: 6, cooldown: 0.82, kind: "rifle" };
    default: return { range: 140, damage: 17, cooldown: 0.42, kind: "rifle" };
  }
}
