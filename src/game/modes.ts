import type { GameModeId, SoldierClass } from "./types";

export type ObjectiveType = "rescue" | "breakout" | "holdout" | "kill" | "protect" | "boss" | "chase" | "endless";

export interface GameModeConfig {
  id: GameModeId;
  name: string;
  description: string;
  objective: ObjectiveType;
  roster: SoldierClass[];
  civilians: number;
  initialZombies: number;
  spawnInterval: number;
  zombieLimit: number;
  surviveSeconds?: number;
  minimumCombatSeconds?: number;
  escapeRatio?: number;
  survivorRequiredRatio?: number;
  killGoal?: number;
  bossCount?: number;
  bossHealth?: number;
  randomBossHealth?: boolean;
  bossSpawn?: "farNest" | "center";
  infectionSeconds: number;
}

const rifle = (count: number): SoldierClass[] => Array.from({ length: count }, () => "rifleman");
const machineGunner = (count: number): SoldierClass[] => Array.from({ length: count }, () => "machineGunner");
const flamethrower = (count: number): SoldierClass[] => Array.from({ length: count }, () => "flamethrower");
const DEFAULT_HOLD_SECONDS = 600;

export const GAME_MODES: GameModeConfig[] = [
  {
    id: "endlessDefense", name: "无尽尸潮·坚守救援", description: "混编小队守住临时据点，保护 8 名平民，撑到 3 分钟后救援直升机抵达。尸潮会从四面持续涌来并逐步加压。",
    objective: "endless", roster: ["shieldGuard", "shotgunner", "sniper", "engineer", "droneScout", "officer", "ammoSpecialist", "machineGunner", "flamethrower", "medic", "rifleman"],
    civilians: 8, initialZombies: 36, spawnInterval: 0.95, zombieLimit: 520, surviveSeconds: 180, infectionSeconds: 8,
  },
  {
    id: "armoredBreak", name: "装甲突围·尸潮压境", description: "8 人突击小队从中央据点杀出，60 秒内至少 6 人抵达撤离区。",
    objective: "breakout", roster: ["machineGunner", "machineGunner", "grenadier", "grenadier", "flamethrower", "medic", "scout", "rifleman"],
    civilians: 0, initialZombies: 120, spawnInterval: 0.55, zombieLimit: 300, surviveSeconds: 60, escapeRatio: 0.75, infectionSeconds: 8,
  },
  {
    id: "mgFlame", name: "10机枪 + 2喷火 VS尸潮", description: "12 人重火力编队至少交战 35 秒，并击杀 220 只僵尸。",
    objective: "kill", roster: [...machineGunner(10), ...flamethrower(2)],
    civilians: 0, initialZombies: 120, spawnInterval: 0.5, zombieLimit: 320, killGoal: 220, minimumCombatSeconds: 35, infectionSeconds: 8,
  },
  {
    id: "rescue", name: "救援小队 VS无尽尸潮", description: "6 人小队从撤离区出发，前往避难屋接应 10 名平民并护送返回。",
    objective: "rescue", roster: ["scout", "machineGunner", "medic", "flamethrower", "grenadier", "rifleman"],
    civilians: 10, initialZombies: 160, spawnInterval: 0.55, zombieLimit: 520, infectionSeconds: 8,
  },
  {
    id: "giantGuard", name: "8喷火兵 + 三头巨尸守平民", description: "8 名喷火兵保护平民，在三头巨尸和尸潮攻击下坚守 90 秒。",
    objective: "protect", roster: flamethrower(8), civilians: 6, initialZombies: 3, spawnInterval: 1.2, zombieLimit: 45, survivorRequiredRatio: 0.5,
    bossCount: 3, bossHealth: 2200, surviveSeconds: 90, infectionSeconds: 8,
  },
  {
    id: "tailRace", name: "追捕高速感染者", description: "6 名侦察兵追击并击倒高速变异目标。",
    objective: "chase", roster: ["scout", "scout", "scout", "scout", "scout", "scout"],
    civilians: 0, initialZombies: 1, spawnInterval: 1, zombieLimit: 1, bossCount: 1, bossHealth: 900, killGoal: 1, infectionSeconds: 8,
  },
  {
    id: "twelveHeavy", name: "12机枪 + 2喷火 VS尸潮", description: "14 人重型火力组在双层走廊清除 280 只僵尸。",
    objective: "kill", roster: [...machineGunner(12), ...flamethrower(2)],
    civilians: 0, initialZombies: 150, spawnInterval: 0.45, zombieLimit: 360, killGoal: 280, minimumCombatSeconds: 40, infectionSeconds: 8,
  },
  {
    id: "lastDefense", name: "人类最后防线 VS巨尸", description: "20 人混编小队从堡垒阵地出发，推进至远端巢穴迎击巨尸；首领不会在中心开局。",
    objective: "boss", roster: [...machineGunner(5), ...flamethrower(4), ...rifle(7), "medic", "grenadier", "scout", "grenadier"],
    civilians: 0, initialZombies: 46, spawnInterval: 0.75, zombieLimit: 180, bossCount: 1, bossHealth: 18000, bossSpawn: "farNest", killGoal: 1, infectionSeconds: 8,
  },
  {
    id: "mother100k", name: "十万血母体 VS 100人类", description: "100 名步枪手集中火力击败 100,000 生命值的母体。",
    objective: "boss", roster: rifle(100), civilians: 0, initialZombies: 1, spawnInterval: 1, zombieLimit: 1,
    bossCount: 1, bossHealth: 100000, killGoal: 1, infectionSeconds: 8,
  },
  {
    id: "holdout", name: "100人守城·坚守10分钟", description: "100 名守军在动态尸潮中坚守 10 分钟；AI 会在弹药紧张时派队员外出拾取补给。",
    objective: "holdout", roster: [...rifle(72), ...machineGunner(18), ...flamethrower(6), ...["medic", "grenadier", "scout", "grenadier"] as SoldierClass[]],
    civilians: 0, initialZombies: 100, spawnInterval: 0.7, zombieLimit: 520, surviveSeconds: DEFAULT_HOLD_SECONDS, infectionSeconds: 8,
  },
  {
    id: "houseSiege", name: "35人守屋·千尸围攻", description: "35 名守军坚守围屋，抵挡上限 1,000 只的尸潮 90 秒。",
    objective: "holdout", roster: [...rifle(20), ...machineGunner(8), ...flamethrower(4), "medic", "grenadier", "scout"],
    civilians: 0, initialZombies: 360, spawnInterval: 0.35, zombieLimit: 1000, surviveSeconds: 90, infectionSeconds: 8,
  },
  {
    id: "purge", name: "6机枪兵·坚守10分钟", description: "6 名机枪兵顶住持续尸潮 10 分钟，并自主外出搜集弹药补给。",
    objective: "holdout", roster: machineGunner(6), civilians: 0, initialZombies: 45, spawnInterval: 0.6, zombieLimit: 240, surviveSeconds: DEFAULT_HOLD_SECONDS, infectionSeconds: 8,
  },
  {
    id: "army500", name: "500人类 VS随机母体", description: "500 名步枪手围攻生命值随机的母体，尸潮从外围干扰。",
    objective: "boss", roster: rifle(500), civilians: 0, initialZombies: 45, spawnInterval: 0.65, zombieLimit: 120,
    bossCount: 1, bossHealth: 72000, randomBossHealth: true, killGoal: 1, infectionSeconds: 8,
  },
  {
    id: "flamerWaves", name: "10喷火兵·坚守10分钟", description: "10 名喷火兵守住熔炉窄道 10 分钟，面对持续增援的尸潮。",
    objective: "holdout", roster: flamethrower(10), civilians: 0, initialZombies: 50, spawnInterval: 0.6, zombieLimit: 240, surviveSeconds: DEFAULT_HOLD_SECONDS, infectionSeconds: 8,
  },
  {
    id: "rifleWaves", name: "50步枪兵·坚守10分钟", description: "50 名步枪手守住长街阵地 10 分钟，尸潮持续刷新。",
    objective: "holdout", roster: rifle(50), civilians: 0, initialZombies: 80, spawnInterval: 0.6, zombieLimit: 320, surviveSeconds: DEFAULT_HOLD_SECONDS, infectionSeconds: 8,
  },
  {
    id: "infection", name: "感染危机·救援与治疗", description: "8 人小队救援 8 名平民；被咬队员 7 秒内未获治疗就会尸变。",
    objective: "rescue", roster: ["medic", "medic", "machineGunner", "flamethrower", "grenadier", "scout", "rifleman", "rifleman"],
    civilians: 8, initialZombies: 100, spawnInterval: 0.45, zombieLimit: 300, infectionSeconds: 7,
  },
  {
    id: "shockSquad", name: "震荡突击队 VS尸潮", description: "12 人机动队穿过阶梯掩体，击杀 200 只僵尸。",
    objective: "kill", roster: [...machineGunner(4), ...["scout", "scout", "grenadier", "grenadier", "medic", "flamethrower", "rifleman", "rifleman"] as SoldierClass[]],
    civilians: 0, initialZombies: 100, spawnInterval: 0.5, zombieLimit: 320, killGoal: 200, minimumCombatSeconds: 35, infectionSeconds: 8,
  },
  {
    id: "rifleHorde", name: "50步枪兵 VS无尽尸潮", description: "50 名步枪兵组成方阵，自动迎战持续增援的尸潮。",
    objective: "kill", roster: rifle(50), civilians: 0, initialZombies: 150, spawnInterval: 0.4, zombieLimit: 360, killGoal: 300, minimumCombatSeconds: 45, infectionSeconds: 8,
  },
];

export function getMode(id: GameModeId): GameModeConfig {
  return GAME_MODES.find((mode) => mode.id === id) ?? GAME_MODES[0];
}

export const CLASS_INFO: Record<SoldierClass, { name: string; color: string; ability: string }> = {
  rifleman: { name: "步枪手", color: "#65c7ff", ability: "中距离稳定单体输出，伤害、射速和射程均衡。" },
  machineGunner: { name: "机枪手", color: "#4caeff", ability: "高射速压制；子弹可沿射线穿透，最多命中 4 只排成一线的僵尸。" },
  flamethrower: { name: "喷火兵", color: "#ff9c50", ability: "近距离扇形喷火，覆盖成片敌人；命中后持续灼烧，墙体会挡火。" },
  grenadier: { name: "榴弹兵", color: "#f2cc58", ability: "向密集尸群投掷榴弹，爆炸中心伤害最高，周围溅射；墙体阻挡爆炸伤害。" },
  medic: { name: "医疗兵", color: "#62e59b", ability: "攻击能力较弱，优先治疗队友并解除感染，维持队伍持续作战。" },
  scout: { name: "侦察兵", color: "#c98aff", ability: "移动和射击节奏快；针对首领弱点造成额外伤害。" },
  shieldGuard: { name: "盾卫", color: "#73d8ff", ability: "正面能量盾吸收伤害；近身挥击可伤害并击退前方一小片敌人。" },
  shotgunner: { name: "霰弹兵", color: "#ffdc78", ability: "近距离扇形散射；贴近时爆发更高，并击退前方敌人。" },
  sniper: { name: "狙击手", color: "#a9e4d0", ability: "全地图射程、高伤害单发；必须有清晰视线，墙体会阻挡射击。" },
  engineer: { name: "工兵", color: "#e9b86e", ability: "中距离精准射击；架设机枪塔、铁丝网并维修和补给防线。" },
  droneScout: { name: "无人机侦察员", color: "#72f0e0", ability: "飞行单位可越过墙体移动和侦测；远程快速点射。" },
  officer: { name: "军官", color: "#f28cbb", ability: "中距离输出，并为附近队友提高射速和移动效率。" },
  ammoSpecialist: { name: "弹药兵", color: "#e4e9a2", ability: "自卫火力较弱；自动为队友快速补弹并部署弹药箱。" },
};
