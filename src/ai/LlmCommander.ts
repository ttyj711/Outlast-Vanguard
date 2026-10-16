import { getMap } from "../game/config";
import { getMode } from "../game/modes";
import type { CommanderAction, CommanderPlan, Tactic, WorldState } from "../game/types";

export interface LlmSettings {
  enabled: boolean;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export interface LlmTraceEvent {
  requestId: number;
  timestamp: string;
  direction: "input" | "output" | "error";
  label: string;
  content: string;
}
type TraceHandler = (event: LlmTraceEvent) => void;

const SETTINGS_KEY = "jiuyuan.llmSettings.session.v1";
const COMMAND_TACTICS: Tactic[] = ["search", "rescue", "defend", "regroup", "evacuate", "kiting"];
const COMMAND_ACTIONS: CommanderAction[] = ["focus", "rescue", "escort", "hold", "retreat", "resupply", "cover"];
let nextTraceId = 1;

export function loadLlmSettings(): LlmSettings {
  const defaults: LlmSettings = { enabled: false, baseUrl: "https://api.openai.com/v1", model: "", apiKey: "" };
  try {
    const stored = sessionStorage.getItem(SETTINGS_KEY);
    if (!stored) return defaults;
    const parsed = JSON.parse(stored) as Partial<LlmSettings>;
    return { ...defaults, ...parsed, enabled: parsed.enabled === true };
  } catch {
    return defaults;
  }
}

export function saveLlmSettings(settings: LlmSettings): void {
  sessionStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export async function testLlmConnection(settings: LlmSettings, onTrace?: TraceHandler): Promise<void> {
  assertSettings(settings);
  const requestId = nextTraceId++;
  const response = await requestChat(settings, [
    { role: "system", content: "你是连通性测试。只回复 OK。" },
    { role: "user", content: "请确认连接。" },
  ], 32, AbortSignal.timeout(12000), true, onTrace, "连接测试", requestId,
  `连接测试：检查 ${settings.model.trim()} 服务是否可用。`);
  // Some providers can return an empty completion while still proving that the
  // endpoint, model and credentials were accepted. Connection tests care about
  // transport/auth, while commander calls separately validate their JSON.
  void response;
  emitTrace(onTrace, requestId, "output", "连接测试 · 结果", "模型接口已连通并接受请求。");
}

export async function requestCommanderPlan(settings: LlmSettings, world: WorldState, signal: AbortSignal, onTrace?: TraceHandler): Promise<CommanderPlan> {
  assertSettings(settings);
  const requestId = nextTraceId++;
  const snapshot = buildSnapshot(world);
  const raw = await requestChat(settings, [
    { role: "system", content: COMMANDER_SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify(snapshot) },
  ], 700, signal, false, onTrace, "战场指挥", requestId, summarizeBattle(world));
  try {
    const parsed = parseJsonResponse(raw);
    const plan = validatePlan(parsed, world);
    emitTrace(onTrace, requestId, "output", "战场指挥 · 指令摘要", summarizePlan(plan));
    return plan;
  } catch (error) {
    emitTrace(onTrace, requestId, "error", "战场指挥 · 指令校验失败", error instanceof Error ? error.message : "未知指令错误。");
    throw error;
  }
}

export async function requestFailureSummary(settings: LlmSettings, world: WorldState, signal: AbortSignal, onTrace?: TraceHandler): Promise<string> {
  assertSettings(settings);
  const requestId = nextTraceId++;
  const raw = await requestChat(settings, [
    { role: "system", content: FAILURE_REVIEW_SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify(buildFailureReport(world)) },
  ], 360, signal, false, onTrace, "战败复盘", requestId,
  "战败复盘：分析本局结算原因、局势证据，并给出一条下局改进建议。");
  const summary = raw.trim().replace(/^```(?:text|markdown)?\s*/i, "").replace(/\s*```$/, "");
  if (!summary) throw new Error("模型未返回战败复盘内容。");
  emitTrace(onTrace, requestId, "output", "战败复盘 · 摘要", summary);
  return summary.slice(0, 1000);
}

function assertSettings(settings: LlmSettings): void {
  if (!settings.baseUrl.trim()) throw new Error("请填写模型 API Base URL。");
  if (!settings.model.trim()) throw new Error("请填写模型名称。");
  if (!settings.apiKey.trim()) throw new Error("请填写 API Key。");
}

async function requestChat(settings: LlmSettings, messages: { role: string; content: string }[], maxTokens: number, signal: AbortSignal,
  allowEmpty = false, onTrace?: TraceHandler, label = "模型请求", requestId = nextTraceId++, inputSummary = `${label}：向 ${settings.model.trim()} 发送请求。`): Promise<string> {
  const base = settings.baseUrl.trim().replace(/\/+$/, "");
  const url = base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
  const isDeepSeek = new URL(base).hostname === "api.deepseek.com";
  const payload = { model: settings.model.trim(), messages, temperature: 0.2, max_tokens: maxTokens,
    ...(isDeepSeek ? { thinking: { type: "disabled" } } : {}) };
  emitTrace(onTrace, requestId, "input", `${label} · 完整提示词`, `${inputSummary}\n\n完整请求（不含 API Key/认证头）：\n${JSON.stringify({ endpoint: url, payload }, null, 2)}`);
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${settings.apiKey.trim()}` },
      body: JSON.stringify(payload),
      signal,
    });
  } catch (error) {
    const message = error instanceof DOMException && (error.name === "AbortError" || error.name === "TimeoutError")
      ? "请求超时或已取消。" : "无法连接模型服务。请检查网络和服务商 CORS 设置（浏览器直连要求允许跨域）。";
    emitTrace(onTrace, requestId, "error", `${label} · 网络错误`, message);
    throw new Error(message);
  }
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    const message = response.status === 401 || response.status === 403 ? `鉴权失败（HTTP ${response.status}），请检查 API Key 权限。`
      : response.status === 404 ? "接口路径不存在；Base URL 应指向 API 根路径，或直接填写 /chat/completions 完整地址。"
        : `模型服务返回 HTTP ${response.status}${detail ? `：${detail.slice(0, 180)}` : "。"}`;
    const traceMessage = response.status === 401 || response.status === 403 ? "鉴权失败，请检查 API Key 和权限。"
      : response.status === 404 ? "接口地址不存在，请检查 Base URL。" : "服务请求失败，请检查服务状态和模型配置。";
    emitTrace(onTrace, requestId, "error", `${label} · HTTP ${response.status}`, traceMessage);
    throw new Error(message);
  }
  const rawBody = await response.text();
  let data: { model?: string; choices?: { finish_reason?: string; message?: { content?: string | { type?: string; text?: string }[] } }[]; error?: { message?: string }; usage?: unknown };
  try { data = JSON.parse(rawBody); }
  catch {
    emitTrace(onTrace, requestId, "error", `${label} · 响应解析失败`, "模型服务返回内容格式异常。");
    throw new Error("模型服务返回了无效 JSON 响应。");
  }
  const content = data.choices?.[0]?.message?.content;
  emitTrace(onTrace, requestId, "output", `${label} · 模型原始输出`, JSON.stringify({
    model: data.model,
    finishReason: data.choices?.[0]?.finish_reason,
    content: typeof content === "string" ? content
      : Array.isArray(content) ? content.map((part) => part.text ?? "").join("") : content ?? "",
  }, null, 2));
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => part.text ?? "").join("");
  if (allowEmpty && data.choices?.length) return "";
  throw new Error(data.error?.message || "模型响应缺少 choices[0].message.content。");
}

function emitTrace(handler: TraceHandler | undefined, requestId: number, direction: LlmTraceEvent["direction"], label: string, content: string): void {
  handler?.({ requestId, timestamp: new Date().toLocaleTimeString("zh-CN", { hour12: false }), direction, label, content });
}

function summarizeBattle(world: WorldState): string {
  const mode = getMode(world.modeId);
  const active = world.team.filter((unit) => unit.state === "active").length;
  const waiting = world.survivors.filter((survivor) => survivor.state === "waiting").length;
  const following = world.survivors.filter((survivor) => survivor.state === "following").length;
  const infected = world.team.filter((unit) => unit.state === "active" && unit.infectionTimer > 0).length;
  const wounded = world.team.filter((unit) => unit.state === "active" && unit.health < 55).length;
  return `模式：${mode.name}；战斗 ${Math.floor(world.elapsedSeconds)} 秒；存活队员 ${active} 人；待救/护送平民 ${waiting}/${following} 人；僵尸 ${world.zombies.length} 只；感染 ${infected} 人，重伤 ${wounded} 人；尸潮压力 ×${world.hordePressure.toFixed(2)}。`;
}

function buildFailureReport(world: WorldState): unknown {
  const mode = getMode(world.modeId);
  const states = new Map<string, number>();
  for (const unit of world.team) states.set(unit.state, (states.get(unit.state) ?? 0) + 1);
  const active = world.team.filter((unit) => unit.state === "active");
  return {
    mode: { id: world.modeId, name: mode.name, objective: mode.objective },
    result: "failure",
    terminalReason: world.resultReason,
    elapsedSeconds: Math.floor(world.elapsedSeconds),
    kills: world.kills,
    team: {
      total: world.team.length,
      states: Object.fromEntries(states),
      activeHealthAverage: active.length ? Math.round(active.reduce((sum, unit) => sum + unit.health, 0) / active.length) : 0,
      activeInfected: active.filter((unit) => unit.infectionTimer > 0).length,
      activeLowAmmo: active.filter((unit) => unit.magazineSize > 0 && unit.ammo === 0).length,
    },
    survivors: {
      total: world.survivors.length,
      waiting: world.survivors.filter((item) => item.state === "waiting").length,
      following: world.survivors.filter((item) => item.state === "following").length,
      dead: world.survivors.filter((item) => item.state === "dead").length,
      evacuated: world.evacuatedSurvivors,
    },
    enemiesRemaining: world.zombies.length,
    defenses: world.defenses.map((item) => ({ kind: item.kind, health: Math.ceil(item.health), maxHealth: item.maxHealth })),
    hordePressure: Number(world.hordePressure.toFixed(2)),
  };
}

function summarizePlan(plan: CommanderPlan): string {
  const tacticNames: Record<Tactic, string> = { idle: "待命", search: "搜索", rescue: "救援", defend: "防守", regroup: "集结", evacuate: "撤离", finished: "结束", kiting: "交替掩护/后撤" };
  const actionNames: Record<CommanderAction, string> = { focus: "集火", rescue: "接应", escort: "护送", hold: "坚守", retreat: "后撤", resupply: "补给", cover: "掩护" };
  const actionCounts = new Map<CommanderAction, number>();
  for (const order of plan.orders) actionCounts.set(order.action, (actionCounts.get(order.action) ?? 0) + 1);
  const orders = [...actionCounts].map(([action, count]) => `${actionNames[action]} ${count} 人`).join("、") || "无单兵微操";
  const assignments = plan.assignments.length ? `；分配 ${plan.assignments.length} 人执行救援` : "";
  return `建议战术：${tacticNames[plan.tactic]}；${plan.reason}${assignments}；${orders}。`;
}

function buildSnapshot(world: WorldState): unknown {
  const mode = getMode(world.modeId);
  const map = getMap(world.modeId, world.mapSeed);
  const activeTeam = world.team.filter((unit) => unit.state === "active");
  const nearbyZombies = [...world.zombies].sort((a, b) => {
    const nearestA = Math.min(...activeTeam.map((unit) => Math.hypot(unit.x - a.x, unit.y - a.y)), Infinity);
    const nearestB = Math.min(...activeTeam.map((unit) => Math.hypot(unit.x - b.x, unit.y - b.y)), Infinity);
    return nearestA - nearestB;
  }).slice(0, 24).map((zombie) => ({
    id: zombie.id, x: Math.round(zombie.x), y: Math.round(zombie.y), health: Math.ceil(zombie.health),
    elite: zombie.isElite === true, boss: zombie.isBoss === true, turnedClass: zombie.infectedClassId,
  }));
  return {
    game: { modeId: world.modeId, objective: mode.objective, elapsedSeconds: Math.floor(world.elapsedSeconds), tactic: world.tactic,
      hordePressure: world.hordePressure, kills: world.kills, mapSeed: world.mapSeed },
    objectives: { exit: map.exit, shelter: map.shelter ? { x: map.shelter.x, y: map.shelter.y, width: map.shelter.width, height: map.shelter.height } : undefined,
      survivors: world.survivors.map((survivor) => ({ id: survivor.id, state: survivor.state, x: Math.round(survivor.x), y: Math.round(survivor.y) })),
      resources: (map.resourcePoints ?? []).map((point, id) => ({ id, x: Math.round(point.x), y: Math.round(point.y), collected: world.collectedResourceIds.includes(id) })) },
    team: activeTeam.map((unit) => ({ id: unit.id, class: unit.classId, x: Math.round(unit.x), y: Math.round(unit.y),
      health: Math.ceil(unit.health), ammo: unit.magazineSize ? `${unit.ammo}/${unit.magazineSize}` : "n/a",
      reloading: unit.reloadTimer > 0, infectedInSeconds: unit.infectionTimer > 0 ? Math.ceil(unit.infectionTimer) : null,
      carrying: unit.carrierIds })),
    zombies: { total: world.zombies.length, nearest: nearbyZombies },
  };
}

const COMMANDER_SYSTEM_PROMPT = `你是一个俯视角自动救援战术游戏的队伍指挥官。阅读战场 JSON，给出战术和有限微操命令。只能输出一个 JSON 对象，不要 Markdown。
格式：{"tactic":"search|rescue|defend|regroup|evacuate|kiting","reason":"简短中文原因","assignments":[{"soldierId":1,"survivorId":2}],"orders":[{"soldierId":1,"action":"focus|rescue|escort|hold|retreat|resupply|cover","targetId":2}]}
微操要求：orders 是真正下达到单个士兵的行动命令。战场有 3 名以上队员时，每次至少给 3 名不同队员下达明确命令，最多 8 条；按兵种和当前威胁挑选队员，不要只给 tactic。focus 指定需要集火的僵尸，士兵会自主寻路至射程并在视线允许时攻击；cover 的 targetId 是需要掩护的其他队员 ID，执行者会移动到其与最近威胁之间；rescue 的 targetId 是 waiting 幸存者 ID；escort 的 targetId 是 following 幸存者 ID；resupply 的 targetId 是未收集补给点 ID；hold/retreat 不需要 targetId。只引用输入中存在的 ID。assignments 为尚未接应幸存者分配队员。不要生成坐标、血量、移动速度、射击或其他模拟器状态。优先给盾卫/霰弹兵布置掩护，给输出兵种集火，给救援队员接应/护送；撤离条件满足或队伍伤亡严重时优先 evacuate；感染倒计时危险时保护队员；敌人堵住路线时 defend/kiting。非救援目标模式不要输出幸存者分配。`;

const FAILURE_REVIEW_SYSTEM_PROMPT = `你是战术游戏的战后复盘助手。根据输入的结算原因和局势数据，用中文给出简洁复盘，格式为：失败原因、局势证据、下局建议。明确区分结算直接原因与推测因素；只依据输入，不虚构事件或因果。总计不超过 160 字。`;

function parseJsonResponse(content: string): unknown {
  const cleaned = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  try { return JSON.parse(cleaned); }
  catch { throw new Error("模型返回的不是有效 JSON，已切回本地规则 AI。"); }
}

function validatePlan(raw: unknown, world: WorldState): CommanderPlan {
  if (!raw || typeof raw !== "object") throw new Error("模型指令格式无效。");
  const value = raw as Record<string, unknown>;
  if (!COMMAND_TACTICS.includes(value.tactic as Tactic)) throw new Error("模型返回了不支持的战术。");
  if (typeof value.reason !== "string" || !Array.isArray(value.assignments) || !Array.isArray(value.orders)) throw new Error("模型指令缺少必要字段。");
  const objective = getMode(world.modeId).objective;
  const rescueMode = objective === "rescue";
  const allowedTactics: Tactic[] = rescueMode ? ["search", "rescue", "defend", "regroup", "evacuate"]
    : objective === "endless" ? ["defend", "kiting"] : ["defend"];
  if (!allowedTactics.includes(value.tactic as Tactic)) throw new Error(`当前关卡不接受“${String(value.tactic)}”战术。`);
  const activeIds = new Set(world.team.filter((unit) => unit.state === "active").map((unit) => unit.id));
  const waitingSurvivors = new Set(world.survivors.filter((item) => item.state === "waiting").map((item) => item.id));
  const followingSurvivors = new Set(world.survivors.filter((item) => item.state === "following").map((item) => item.id));
  const zombieIds = new Set(world.zombies.map((item) => item.id));
  const resources = new Set((getMap(world.modeId, world.mapSeed).resourcePoints ?? []).map((_, id) => id).filter((id) => !world.collectedResourceIds.includes(id)));
  const assignments = new Map<number, number>();
  for (const item of value.assignments.slice(0, 100)) {
    if (!item || typeof item !== "object") continue;
    const assignment = item as Record<string, unknown>;
    if (Number.isInteger(assignment.soldierId) && Number.isInteger(assignment.survivorId)
      && activeIds.has(assignment.soldierId as number) && waitingSurvivors.has(assignment.survivorId as number)) {
      assignments.set(assignment.soldierId as number, assignment.survivorId as number);
    }
  }
  const orders = new Map<number, { soldierId: number; action: CommanderAction; targetId?: number }>();
  for (const item of value.orders.slice(0, 100)) {
    if (!item || typeof item !== "object") continue;
    const order = item as Record<string, unknown>;
    const soldierId = order.soldierId;
    const action = order.action as CommanderAction;
    const targetId = order.targetId;
    if (!Number.isInteger(soldierId) || !activeIds.has(soldierId as number) || !COMMAND_ACTIONS.includes(action) || orders.has(soldierId as number)) continue;
    const targetValid = action === "focus" ? Number.isInteger(targetId) && zombieIds.has(targetId as number)
      : action === "rescue" ? rescueMode && Number.isInteger(targetId) && waitingSurvivors.has(targetId as number)
        : action === "escort" ? rescueMode && Number.isInteger(targetId) && followingSurvivors.has(targetId as number)
          : action === "resupply" ? Number.isInteger(targetId) && resources.has(targetId as number)
            : action === "cover" ? Number.isInteger(targetId) && targetId !== soldierId && activeIds.has(targetId as number)
              : true;
    if (targetValid) orders.set(soldierId as number, { soldierId: soldierId as number, action, ...(Number.isInteger(targetId) ? { targetId: targetId as number } : {}) });
  }
  if (!rescueMode) assignments.clear();
  const now = world.elapsedSeconds;
  return { tactic: value.tactic as Tactic, reason: value.reason.slice(0, 140),
    assignments: [...assignments].map(([soldierId, survivorId]) => ({ soldierId, survivorId })),
    orders: [...orders.values()], issuedAt: now, expiresAt: now + 7 };
}
