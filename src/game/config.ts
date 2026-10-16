import type { GameModeId, Point } from "./types";

export const WORLD_WIDTH = 680;
export const WORLD_HEIGHT = 660;
export const AI_INTERVAL_SECONDS = 0.25;
const MAP_BORDER = 18;

function boundaryWalls(): Rect[] {
  return [
    { x: 0, y: 0, width: WORLD_WIDTH, height: MAP_BORDER },
    { x: 0, y: WORLD_HEIGHT - MAP_BORDER, width: WORLD_WIDTH, height: MAP_BORDER },
    { x: 0, y: 0, width: MAP_BORDER, height: WORLD_HEIGHT },
    { x: WORLD_WIDTH - MAP_BORDER, y: 0, width: MAP_BORDER, height: WORLD_HEIGHT },
  ];
}

export interface Rect { x: number; y: number; width: number; height: number }
export interface MapDefinition {
  name: string;
  description: string;
  walls: readonly Rect[];
  nests: readonly Rect[];
  exit: Point;
  exitArea: Rect;
  exitLabel: string;
  holdPoint: Point;
  shelter?: Rect & { label: string };
  civilianOrigin: Point;
  civilianSpacing: Point;
  objectiveArea?: Rect & { label: string };
  resourcePoints?: readonly Point[];
}

const rescueWalls: Rect[] = [
  { x: 24, y: 20, width: 8, height: 166 }, { x: 24, y: 20, width: 224, height: 8 },
  { x: 240, y: 20, width: 8, height: 166 }, { x: 24, y: 178, width: 62, height: 8 },
  { x: 170, y: 178, width: 78, height: 8 }, { x: 24, y: 270, width: 478, height: 18 },
  { x: 350, y: 290, width: 18, height: 56 }, { x: 165, y: 385, width: 515, height: 18 },
  { x: 255, y: 425, width: 18, height: 55 }, { x: 24, y: 505, width: 478, height: 18 },
];

const MAPS: Partial<Record<GameModeId, MapDefinition>> = {
  rescue: {
    name: "蛇形救援通道",
    description: "左上避难屋与右下撤离区由多段窄走廊连接，队伍需穿过尸潮往返。",
    walls: rescueWalls,
    nests: [
      { x: 400, y: 35, width: 100, height: 48 }, { x: 585, y: 300, width: 65, height: 62 },
      { x: 32, y: 430, width: 64, height: 64 }, { x: 330, y: 560, width: 112, height: 66 },
    ],
    shelter: { x: 32, y: 28, width: 208, height: 150, label: "避难屋" },
    civilianOrigin: { x: 55, y: 64 }, civilianSpacing: { x: 42, y: 40 },
    exit: { x: 610, y: 610 }, exitArea: { x: 550, y: 572, width: 118, height: 78 }, exitLabel: "撤离区",
    holdPoint: { x: 340, y: 330 },
  },
  holdout: {
    name: "十字据点防线",
    description: "中央据点四周由交错掩体构成环形防线，尸潮从地图四角压进来。",
    walls: [
      { x: 105, y: 108, width: 150, height: 18 }, { x: 425, y: 108, width: 150, height: 18 },
      { x: 105, y: 534, width: 150, height: 18 }, { x: 425, y: 534, width: 150, height: 18 },
      { x: 138, y: 145, width: 18, height: 105 }, { x: 524, y: 145, width: 18, height: 105 },
      { x: 138, y: 410, width: 18, height: 105 }, { x: 524, y: 410, width: 18, height: 105 },
      { x: 292, y: 195, width: 18, height: 105 }, { x: 370, y: 360, width: 18, height: 105 },
    ],
    nests: [
      { x: 28, y: 28, width: 95, height: 52 }, { x: 557, y: 28, width: 95, height: 52 },
      { x: 28, y: 576, width: 95, height: 52 }, { x: 557, y: 576, width: 95, height: 52 },
    ],
    civilianOrigin: { x: 0, y: 0 }, civilianSpacing: { x: 0, y: 0 },
    exit: { x: 340, y: 330 }, exitArea: { x: 278, y: 270, width: 124, height: 120 }, exitLabel: "坚守据点",
    holdPoint: { x: 340, y: 330 },
    objectiveArea: { x: 278, y: 270, width: 124, height: 120, label: "防线核心" },
  },
  purge: {
    name: "双侧夹击战场",
    description: "开阔中央射击区由两道错位隔墙切分，尸群从左右巢穴涌入形成夹击。",
    walls: [
      { x: 175, y: 72, width: 18, height: 205 }, { x: 175, y: 386, width: 18, height: 205 },
      { x: 487, y: 69, width: 18, height: 205 }, { x: 487, y: 382, width: 18, height: 205 },
      { x: 262, y: 172, width: 132, height: 16 }, { x: 286, y: 470, width: 132, height: 16 },
      { x: 322, y: 270, width: 18, height: 72 }, { x: 408, y: 318, width: 18, height: 72 },
    ],
    nests: [
      { x: 22, y: 90, width: 78, height: 80 }, { x: 580, y: 88, width: 78, height: 80 },
      { x: 22, y: 492, width: 78, height: 80 }, { x: 580, y: 492, width: 78, height: 80 },
    ],
    civilianOrigin: { x: 0, y: 0 }, civilianSpacing: { x: 0, y: 0 },
    exit: { x: 340, y: 330 }, exitArea: { x: 285, y: 278, width: 110, height: 104 }, exitLabel: "突击集结点",
    holdPoint: { x: 340, y: 330 },
    objectiveArea: { x: 285, y: 278, width: 110, height: 104, label: "清剿区域" },
  },
  infection: {
    name: "隔离区突破战",
    description: "避难区位于右上角，救援队从左下撤离点突入；中部隔墙形成多个交叉路口。",
    walls: [
      { x: 445, y: 36, width: 18, height: 190 }, { x: 463, y: 36, width: 190, height: 18 },
      { x: 645, y: 36, width: 18, height: 190 },
      // Leave a guarded doorway below the shelter; the garrison covers this opening.
      { x: 463, y: 208, width: 54, height: 18 }, { x: 573, y: 208, width: 80, height: 18 },
      { x: 85, y: 145, width: 270, height: 18 }, { x: 85, y: 163, width: 18, height: 145 },
      { x: 265, y: 250, width: 18, height: 118 }, { x: 283, y: 350, width: 285, height: 18 },
      { x: 548, y: 368, width: 18, height: 150 }, { x: 178, y: 458, width: 255, height: 18 },
      { x: 178, y: 476, width: 18, height: 105 },
    ],
    nests: [
      { x: 28, y: 30, width: 86, height: 60 }, { x: 585, y: 270, width: 68, height: 66 },
      { x: 32, y: 346, width: 68, height: 66 }, { x: 460, y: 574, width: 130, height: 58 },
    ],
    shelter: { x: 470, y: 57, width: 166, height: 132, label: "隔离避难屋" },
    civilianOrigin: { x: 492, y: 78 }, civilianSpacing: { x: 38, y: 36 },
    exit: { x: 75, y: 590 }, exitArea: { x: 28, y: 548, width: 108, height: 82 }, exitLabel: "撤离站",
    holdPoint: { x: 340, y: 330 },
  },
};

const ARENA_INFO: Record<Exclude<GameModeId, "rescue" | "holdout" | "purge" | "infection">, { name: string; description: string }> = {
  endlessDefense: { name: "四面围城·临时救援点", description: "正面与三条侧路同时敞开，队伍要守住中央救援点，直到直升机抵达。" },
  armoredBreak: { name: "装甲突围走廊", description: "多段平行防爆墙构成突围车道，尸群从两翼巢穴夹击。" },
  mgFlame: { name: "机枪喷火交叉阵", description: "中央交叉火力区配短掩体，四角尸潮同时压境。" },
  giantGuard: { name: "三巨尸环形广场", description: "广场中心保护区周围分布环形隔墙和三个进攻缺口。" },
  tailRace: { name: "环形追逐场", description: "环形围墙和多个缺口形成追逐路线，队伍要追上高速目标。" },
  twelveHeavy: { name: "双层火力走廊", description: "两道错位横墙将战场分成三层火力区。" },
  lastDefense: { name: "末日堡垒", description: "多层 U 形防线把队伍和首领隔开，侧翼留有突破口。" },
  mother100k: { name: "母体巢穴核心", description: "开阔的巢穴核心区设有同心掩体，母体从中央出现。" },
  houseSiege: { name: "围屋防守区", description: "中央小屋只有两处入口，外围巢穴形成包围态势。" },
  army500: { name: "广场蜂巢阵地", description: "开阔广场内布置网格掩体，四面巢穴包围人类方阵。" },
  flamerWaves: { name: "熔炉窄道", description: "连续窄通道让尸潮持续从正面进入喷火范围，队伍需坚守十分钟。" },
  rifleWaves: { name: "长街射击场", description: "纵向街垒留出长射界，尸潮沿街道持续推进，队伍需坚守十分钟。" },
  shockSquad: { name: "震荡兵环形阵地", description: "分散的阶梯掩体围绕中央目标点，适合机动突击。" },
  rifleHorde: { name: "步枪方阵尸潮战", description: "大面积网格掩体提供交叉射界，步枪方阵面对持续增援。" },
};

function arenaWalls(variant: number): Rect[] {
  const x = 160 + (variant % 3) * 18;
  switch (variant) {
    case 0: return [{ x: 112, y: 110, width: 18, height: 185 }, { x: 200, y: 350, width: 18, height: 200 }, { x: 420, y: 105, width: 18, height: 185 }, { x: 510, y: 360, width: 18, height: 190 }, { x: 245, y: 210, width: 125, height: 16 }, { x: 315, y: 440, width: 125, height: 16 }];
    case 1: return [{ x: 110, y: 145, width: 180, height: 18 }, { x: 390, y: 145, width: 180, height: 18 }, { x: 110, y: 490, width: 180, height: 18 }, { x: 390, y: 490, width: 180, height: 18 }, { x: 218, y: 240, width: 18, height: 170 }, { x: 444, y: 240, width: 18, height: 170 }];
    case 2: return [{ x: 190, y: 125, width: 300, height: 18 }, { x: 190, y: 517, width: 300, height: 18 }, { x: 190, y: 143, width: 18, height: 115 }, { x: 472, y: 143, width: 18, height: 115 }, { x: 190, y: 402, width: 18, height: 115 }, { x: 472, y: 402, width: 18, height: 115 }, { x: 290, y: 260, width: 18, height: 140 }, { x: 370, y: 260, width: 18, height: 140 }];
    case 3: return [{ x: 165, y: 105, width: 350, height: 18 }, { x: 165, y: 537, width: 350, height: 18 }, { x: 165, y: 123, width: 18, height: 120 }, { x: 497, y: 123, width: 18, height: 120 }, { x: 165, y: 417, width: 18, height: 120 }, { x: 497, y: 417, width: 18, height: 120 }, { x: 165, y: 260, width: 120, height: 16 }, { x: 395, y: 384, width: 120, height: 16 }];
    case 4: return [{ x: 105, y: 185, width: 185, height: 18 }, { x: 390, y: 185, width: 185, height: 18 }, { x: 105, y: 455, width: 185, height: 18 }, { x: 390, y: 455, width: 185, height: 18 }, { x: 285, y: 110, width: 18, height: 190 }, { x: 378, y: 360, width: 18, height: 190 }, { x: 285, y: 300, width: 112, height: 16 }];
    case 5: return [{ x: 120, y: 105, width: 420, height: 18 }, { x: 120, y: 123, width: 18, height: 155 }, { x: 522, y: 123, width: 18, height: 155 }, { x: 120, y: 455, width: 18, height: 155 }, { x: 522, y: 455, width: 18, height: 155 }, { x: 120, y: 592, width: 185, height: 18 }, { x: 355, y: 592, width: 185, height: 18 }, { x: 225, y: 300, width: 230, height: 18 }];
    case 6: return [{ x: 160, y: 160, width: 360, height: 18 }, { x: 160, y: 482, width: 360, height: 18 }, { x: 160, y: 178, width: 18, height: 85 }, { x: 502, y: 178, width: 18, height: 85 }, { x: 160, y: 397, width: 18, height: 85 }, { x: 502, y: 397, width: 18, height: 85 }, { x: 275, y: 270, width: 18, height: 120 }, { x: 387, y: 270, width: 18, height: 120 }];
    case 7: return [{ x: 95, y: 120, width: 110, height: 18 }, { x: 475, y: 120, width: 110, height: 18 }, { x: 95, y: 522, width: 110, height: 18 }, { x: 475, y: 522, width: 110, height: 18 }, { x: 250, y: 145, width: 18, height: 110 }, { x: 412, y: 405, width: 18, height: 110 }, { x: 220, y: 320, width: 95, height: 18 }, { x: 365, y: 320, width: 95, height: 18 }];
    case 8: return [
      { x: 250, y: 220, width: 180, height: 18 },
      { x: 412, y: 238, width: 18, height: 180 },
      { x: 250, y: 238, width: 18, height: 58 },
      { x: 250, y: 342, width: 18, height: 76 },
      { x: 268, y: 400, width: 52, height: 18 },
      { x: 370, y: 400, width: 42, height: 18 },
    ];
    case 9: return [{ x: 95, y: 210, width: 170, height: 18 }, { x: 415, y: 210, width: 170, height: 18 }, { x: 95, y: 432, width: 170, height: 18 }, { x: 415, y: 432, width: 170, height: 18 }, { x: 265, y: 210, width: 18, height: 85 }, { x: 397, y: 348, width: 18, height: 102 }, { x: 220, y: 315, width: 115, height: 16 }, { x: 345, y: 315, width: 115, height: 16 }];
    case 10: return [{ x: 140, y: 95, width: 18, height: 190 }, { x: 250, y: 195, width: 18, height: 220 }, { x: 360, y: 95, width: 18, height: 190 }, { x: 470, y: 195, width: 18, height: 220 }, { x: 580, y: 95, width: 18, height: 190 }, { x: 140, y: 475, width: 18, height: 100 }, { x: 360, y: 475, width: 18, height: 100 }, { x: 580, y: 475, width: 18, height: 100 }];
    case 11: return [{ x: 105, y: 100, width: 160, height: 18 }, { x: 415, y: 100, width: 160, height: 18 }, { x: 105, y: 542, width: 160, height: 18 }, { x: 415, y: 542, width: 160, height: 18 }, { x: 180, y: 118, width: 18, height: 125 }, { x: 480, y: 118, width: 18, height: 125 }, { x: 180, y: 417, width: 18, height: 125 }, { x: 480, y: 417, width: 18, height: 125 }, { x: 282, y: 245, width: 18, height: 170 }, { x: 380, y: 245, width: 18, height: 170 }];
    default: return [{ x, y: 88, width: 18, height: 128 }, { x: 310, y: 190, width: 18, height: 128 }, { x: 500, y: 112, width: 18, height: 128 }, { x: 115, y: 355, width: 18, height: 128 }, { x: 280, y: 440, width: 18, height: 128 }, { x: 465, y: 365, width: 18, height: 128 }, { x: 200, y: 285, width: 110, height: 16 }, { x: 385, y: 325, width: 115, height: 16 }];
  }
}

const variantIds = Object.keys(ARENA_INFO) as Exclude<GameModeId, "rescue" | "holdout" | "purge" | "infection">[];
const variantMaps = Object.fromEntries(variantIds.map((id, index) => {
  const info = ARENA_INFO[id];
  const nestLayouts = [
    [{ x: 25, y: 25, width: 78, height: 68 }, { x: 577, y: 25, width: 78, height: 68 }, { x: 25, y: 565, width: 78, height: 68 }, { x: 577, y: 565, width: 78, height: 68 }],
    [{ x: 292, y: 24, width: 92, height: 54 }, { x: 590, y: 285, width: 62, height: 90 }, { x: 292, y: 582, width: 92, height: 54 }, { x: 28, y: 285, width: 62, height: 90 }],
    [{ x: 42, y: 52, width: 75, height: 60 }, { x: 563, y: 115, width: 82, height: 58 }, { x: 65, y: 540, width: 90, height: 72 }, { x: 525, y: 520, width: 95, height: 82 }],
    [{ x: 155, y: 25, width: 80, height: 58 }, { x: 445, y: 25, width: 80, height: 58 }, { x: 155, y: 577, width: 80, height: 58 }, { x: 445, y: 577, width: 80, height: 58 }],
  ];
  const nests = nestLayouts[index % nestLayouts.length];
  const holdPoint = { x: 340, y: 330 };
  const map: MapDefinition = {
    name: info.name, description: info.description, walls: arenaWalls(index), nests,
    civilianOrigin: id === "giantGuard" ? { x: 310, y: 300 } : { x: 306, y: 300 },
    civilianSpacing: id === "giantGuard" ? { x: 12, y: 20 } : { x: 20, y: 20 },
    exit: { x: 340, y: 585 }, exitArea: { x: 284, y: 546, width: 112, height: 84 }, exitLabel: "集合点",
    holdPoint, objectiveArea: { x: 286, y: 276, width: 108, height: 108, label: "目标区" },
  };
  return [id, map];
})) as Record<Exclude<GameModeId, "rescue" | "holdout" | "purge" | "infection">, MapDefinition>;

const mapCache = new Map<string, MapDefinition>();

export function getMap(modeId: GameModeId, seed?: string): MapDefinition {
  const base = MAPS[modeId] ?? variantMaps[modeId as keyof typeof variantMaps];
  if (!seed) return { ...base, walls: [...base.walls, ...boundaryWalls()] };
  const key = modeId + ":" + seed;
  const cached = mapCache.get(key);
  if (cached) return cached;
  const rng = seededRandom(seed);
  const walls = [...base.walls, ...boundaryWalls()];
  const required = [base.exit, base.holdPoint, ...base.nests.map((nest) => ({ x: nest.x + nest.width / 2, y: nest.y + nest.height / 2 }))];
  if (modeId === "rescue" || modeId === "infection") {
    for (let i = 0; i < 10; i++) required.push({ x: base.civilianOrigin.x + (i % 4) * base.civilianSpacing.x, y: base.civilianOrigin.y + Math.floor(i / 4) * base.civilianSpacing.y });
  }
  if (base.shelter) required.push({ x: base.shelter.x + 20, y: base.shelter.y + base.shelter.height / 2 });
  // Add deterministic tactical cover. Each proposed block is retained only if all objectives remain reachable.
  for (let attempt = 0, accepted = 0; attempt < 180 && accepted < 12; attempt++) {
    const width = rng() < .6 ? 18 : 30;
    const height = rng() < .6 ? 18 : 30;
    const candidate: Rect = { x: 45 + rng() * (WORLD_WIDTH - width - 90), y: 42 + rng() * (WORLD_HEIGHT - height - 84), width, height };
    const keepClear = required.some((point) => point.x > candidate.x - 48 && point.x < candidate.x + width + 48 && point.y > candidate.y - 48 && point.y < candidate.y + height + 48);
    if (keepClear || intersectsAny(candidate, walls)) continue;
    walls.push(candidate);
    if (allReachable(required, walls)) accepted++;
    else walls.pop();
  }
  const resourcePoints: Point[] = [];
  for (let attempt = 0; attempt < 80 && resourcePoints.length < 5; attempt++) {
    const point = { x: 50 + rng() * (WORLD_WIDTH - 100), y: 50 + rng() * (WORLD_HEIGHT - 100) };
    if (walls.some((wall) => point.x > wall.x - 15 && point.x < wall.x + wall.width + 15 && point.y > wall.y - 15 && point.y < wall.y + wall.height + 15)) continue;
    if (required.some((target) => Math.hypot(point.x - target.x, point.y - target.y) < 55)) continue;
    if (resourcePoints.some((other) => Math.hypot(point.x - other.x, point.y - other.y) < 60)) continue;
    resourcePoints.push(point);
  }
  const generated = { ...base, name: base.name + " · " + seed.slice(0, 6), walls, resourcePoints };
  mapCache.set(key, generated);
  return generated;
}

function seededRandom(seed: string): () => number {
  let state = 2166136261;
  for (let i = 0; i < seed.length; i++) state = Math.imul(state ^ seed.charCodeAt(i), 16777619);
  return () => { state += 0x6d2b79f5; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function intersectsAny(rect: Rect, walls: readonly Rect[]): boolean {
  return walls.some((wall) => rect.x < wall.x + wall.width && rect.x + rect.width > wall.x && rect.y < wall.y + wall.height && rect.y + rect.height > wall.y);
}

function allReachable(points: readonly Point[], walls: readonly Rect[]): boolean {
  const cell = 20, cols = Math.floor(WORLD_WIDTH / cell), rows = Math.floor(WORLD_HEIGHT / cell);
  const blocked = (x: number, y: number) => x <= 0 || y <= 0 || x >= cols - 1 || y >= rows - 1 || walls.some((wall) => x * cell + cell / 2 > wall.x - 8 && x * cell + cell / 2 < wall.x + wall.width + 8 && y * cell + cell / 2 > wall.y - 8 && y * cell + cell / 2 < wall.y + wall.height + 8);
  const toCell = (point: Point) => ({ x: Math.max(1, Math.min(cols - 2, Math.floor(point.x / cell))), y: Math.max(1, Math.min(rows - 2, Math.floor(point.y / cell))) });
  const start = toCell(points[0]);
  if (blocked(start.x, start.y)) return false;
  const seen = new Set([start.y * cols + start.x]), queue = [start];
  for (let i = 0; i < queue.length; i++) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const x = queue[i].x + dx, y = queue[i].y + dy, key = y * cols + x;
    if (!blocked(x, y) && !seen.has(key)) { seen.add(key); queue.push({ x, y }); }
  }
  return points.every((point) => { const c = toCell(point); return seen.has(c.y * cols + c.x); });
}
