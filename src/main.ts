import "./styles.css";
import { GameLoop } from "./game/GameLoop";
import { getMap } from "./game/config";
import { CLASS_INFO, GAME_MODES, getMode } from "./game/modes";
import { createWorld } from "./game/World";
import { AMMO_RULES, WEAPON_CONFIG } from "./game/weaponConfig";
import { CanvasRenderer } from "./render/CanvasRenderer";
import type { GameModeId, SoldierClass, Tactic, WorldState } from "./game/types";
import { LlmDirector, type LlmDirectorState } from "./ai/LlmDirector";
import { loadLlmSettings, saveLlmSettings, testLlmConnection, type LlmSettings, type LlmTraceEvent } from "./ai/LlmCommander";

const canvas = document.querySelector<HTMLCanvasElement>("#battlefield");
const modeSelect = document.querySelector<HTMLSelectElement>("#mode-select");
if (!canvas || !modeSelect) throw new Error("找不到战场画布或玩法选择器");
const selector = modeSelect;
const pressureSlider = document.querySelector<HTMLInputElement>("#pressure-slider");
let hordePressure = Number(pressureSlider?.value ?? 1);
const rosterStorageKey = "jiuyuan.rosterOverrides.v1";
const allClasses = Object.keys(CLASS_INFO) as SoldierClass[];
type RosterOverrides = Partial<Record<GameModeId, Partial<Record<SoldierClass, number>>>>;
let rosterOverrides: RosterOverrides = {};
try { rosterOverrides = JSON.parse(localStorage.getItem(rosterStorageKey) ?? "{}"); } catch { rosterOverrides = {}; }
const categories: Record<string, string> = {
  rescue: "救援任务", holdout: "据点防守", kill: "兵种火力挑战",
  protect: "平民防守", boss: "首领挑战", chase: "追击挑战", endless: "无尽尸潮防守与救援",
};
const optionGroups = new Map<string, HTMLOptGroupElement>();
for (const mode of GAME_MODES) {
  const label = categories[mode.objective];
  let group = optionGroups.get(label);
  if (!group) { group = document.createElement("optgroup"); group.label = label; optionGroups.set(label, group); }
  const option = document.createElement("option");
  option.value = mode.id;
  option.textContent = mode.name;
  group.append(option);
}
selector.replaceChildren(...optionGroups.values());
selector.value = "rescue";
function defaultClassCounts(modeId: GameModeId): Record<SoldierClass, number> {
  const counts = Object.fromEntries(allClasses.map((classId) => [classId, 0])) as Record<SoldierClass, number>;
  for (const classId of getMode(modeId).roster) counts[classId]++;
  return counts;
}
function classCounts(modeId: GameModeId): Record<SoldierClass, number> {
  const counts = defaultClassCounts(modeId);
  const saved = rosterOverrides[modeId];
  if (saved) for (const classId of allClasses) {
    const value = saved[classId];
    if (Number.isInteger(value) && value! >= 0 && value! <= 500) counts[classId] = value!;
  }
  if (Object.values(counts).reduce((sum, value) => sum + value, 0) > 500) return defaultClassCounts(modeId);
  return counts;
}
function getRoster(modeId: GameModeId): SoldierClass[] {
  const counts = classCounts(modeId);
  return allClasses.flatMap((classId) => Array.from({ length: counts[classId] }, () => classId));
}
let world: WorldState = createWorld(selector.value as GameModeId, undefined, hordePressure, getRoster(selector.value as GameModeId));
const renderer = new CanvasRenderer(canvas);
let loop: GameLoop;
let llmSettings = loadLlmSettings();

const labels: Record<Tactic, string> = {
  idle: "等待开始", search: "搜索幸存者", rescue: "执行救援",
  defend: "集结防守", regroup: "队伍集结", evacuate: "全队撤离", finished: "任务结束",
  kiting: "交替掩护·边打边退",
};
const reasons: Record<Tactic, string> = {
  idle: "点击开始后由本地规则 AI 自动指挥队伍。",
  search: "队员正在分头前往最近的幸存者。",
  rescue: "队员正在接应幸存者并准备护送撤离。",
  defend: "附近尸潮威胁升高，队员正在自动交战。",
  regroup: "医疗兵和队员正在处理感染并重新集结。",
  evacuate: "风险升高或救援目标达成，队伍正在撤离。",
  finished: "本局模拟已结束。",
  kiting: "多名火力手同时进入换弹空窗，全队自动拉开距离，等待弹匣恢复。",
};

function log(message: string): void {
  const list = document.querySelector<HTMLOListElement>("#event-log");
  if (!list) return;
  const item = document.createElement("li");
  item.textContent = new Date().toLocaleTimeString("zh-CN", { hour12: false }) + " · " + message;
  list.prepend(item);
  while (list.children.length > 8) list.lastElementChild?.remove();
}

function updateLlmStatus(state: LlmDirectorState, message: string): void {
  const status = document.querySelector<HTMLElement>("#llm-status");
  if (!status) return;
  status.textContent = message;
  status.classList.toggle("is-fallback", state === "fallback");
}

function appendLlmTrace(event: LlmTraceEvent): void {
  const list = document.querySelector<HTMLOListElement>("#llm-trace-log");
  if (!list) return;
  const item = document.createElement("li");
  item.className = `llm-trace-entry is-${event.direction}`;
  const details = document.createElement("details");
  details.open = event.direction !== "input";
  const summary = document.createElement("summary");
  summary.textContent = `${event.timestamp} · #${event.requestId} · ${event.label}`;
  const content = document.createElement("pre");
  content.textContent = event.content;
  details.append(summary, content);
  item.append(details);
  list.prepend(item);
  while (list.children.length > 30) list.lastElementChild?.remove();
}

document.querySelector<HTMLButtonElement>("#llm-trace-clear")?.addEventListener("click", () => {
  document.querySelector<HTMLOListElement>("#llm-trace-log")?.replaceChildren();
});

const llmDirector = new LlmDirector(updateLlmStatus, log, appendLlmTrace);
const llmEnabledInput = document.querySelector<HTMLInputElement>("#llm-enabled")!;
const llmBaseUrlInput = document.querySelector<HTMLInputElement>("#llm-base-url")!;
const llmModelInput = document.querySelector<HTMLInputElement>("#llm-model")!;
const llmApiKeyInput = document.querySelector<HTMLInputElement>("#llm-api-key")!;
llmEnabledInput.checked = llmSettings.enabled;
llmBaseUrlInput.value = llmSettings.baseUrl;
llmModelInput.value = llmSettings.model;
llmApiKeyInput.value = llmSettings.apiKey;
updateLlmStatus("local", llmSettings.enabled ? "LLM 已配置；开始任务后连接模型，本地规则 AI 将作为故障兜底。" : "本地规则 AI 待命。");

function readLlmForm(): LlmSettings {
  return { enabled: llmEnabledInput.checked, baseUrl: llmBaseUrlInput.value.trim(), model: llmModelInput.value.trim(), apiKey: llmApiKeyInput.value.trim() };
}

document.querySelector<HTMLButtonElement>("#llm-apply")?.addEventListener("click", () => {
  llmSettings = readLlmForm();
  saveLlmSettings(llmSettings);
  if (world.running) llmDirector.start(world, llmSettings);
  else updateLlmStatus("local", llmSettings.enabled ? "设置已保存到当前标签页；开始任务后连接模型。" : "本地规则 AI 待命。");
  log(llmSettings.enabled ? "第三方 LLM 指挥设置已应用。" : "已切换为本地规则 AI 指挥。");
});

document.querySelector<HTMLButtonElement>("#llm-test")?.addEventListener("click", async (event) => {
  const button = event.currentTarget as HTMLButtonElement;
  const settings = readLlmForm();
  button.disabled = true;
  updateLlmStatus("connecting", "正在测试第三方模型连接……");
  try {
    await testLlmConnection(settings, appendLlmTrace);
    updateLlmStatus("online", "连接成功：模型服务已返回响应。");
  } catch (error) {
    const message = error instanceof Error ? error.message : "未知连接错误。";
    updateLlmStatus("fallback", `连接测试失败：${message}`);
  } finally {
    button.disabled = false;
  }
});

function renderModeInfo(): void {
  const mode = getMode(selector.value as GameModeId);
  const map = getMap(mode.id, world.mapSeed);
  document.querySelector("#mode-description")!.textContent = mode.description + " 地图：" + map.description;
  document.querySelector("#map-name")!.textContent = map.name;
  const seedInput = document.querySelector<HTMLInputElement>("#seed-input");
  if (seedInput) seedInput.value = world.mapSeed;
  const counts = new Map<string, number>();
  for (const soldier of world.team) {
    const classId = soldier.classId;
    const info = CLASS_INFO[classId];
    counts.set(info.name, (counts.get(info.name) ?? 0) + 1);
  }
  const roster = document.querySelector<HTMLDivElement>("#roster-display")!;
  roster.replaceChildren(...[...counts].map(([name, count]) => {
    const chip = document.createElement("span");
    chip.className = "roster-chip";
    chip.textContent = `${name} ×${count}`;
    const entry = Object.values(CLASS_INFO).find((value) => value.name === name)!;
    chip.style.setProperty("--unit-color", entry.color);
    chip.title = entry.ability;
    return chip;
  }));
  renderRosterEditor(mode.id);
  const pressureApplicable = mode.objective !== "chase" && (mode.initialZombies > (mode.bossCount ?? 0) || mode.zombieLimit > mode.initialZombies);
  if (pressureSlider) pressureSlider.disabled = world.running || !pressureApplicable;
  const hint = document.querySelector<HTMLElement>("#pressure-hint");
  if (hint) hint.textContent = pressureApplicable
    ? world.running ? "本局进行中，尸潮压力已锁定；结束或重新开始后可调整。" : "影响开局尸量、后续刷新速度和僵尸移速；开始后锁定。"
    : "该关卡没有可调节的普通尸潮。";
  updatePressureControl();
}

function renderRosterEditor(modeId: GameModeId): void {
  const grid = document.querySelector<HTMLDivElement>("#roster-editor-grid");
  if (!grid) return;
  const counts = classCounts(modeId);
  grid.replaceChildren(...allClasses.map((classId) => {
    const item = document.createElement("label");
    item.className = "roster-count-item";
    item.style.setProperty("--unit-color", CLASS_INFO[classId].color);
    item.title = CLASS_INFO[classId].ability;
    const name = document.createElement("span");
    name.textContent = CLASS_INFO[classId].name;
    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = "500";
    input.step = "1";
    input.value = String(counts[classId]);
    input.dataset.classId = classId;
    input.setAttribute("aria-label", CLASS_INFO[classId].name + "人数");
    item.append(name, input);
    return item;
  }));
  updateRosterTotal();
}

function updateRosterTotal(): number {
  const inputs = [...document.querySelectorAll<HTMLInputElement>("#roster-editor-grid input[data-class-id]")];
  const total = inputs.reduce((sum, input) => sum + (Number.parseInt(input.value, 10) || 0), 0);
  const output = document.querySelector<HTMLElement>("#roster-total");
  if (output) {
    output.textContent = `总人数：${total}/500`;
    output.classList.toggle("over-limit", total > 500 || total < 1);
  }
  const apply = document.querySelector<HTMLButtonElement>("#apply-roster");
  if (apply) apply.disabled = total > 500 || total < 1 || world.running;
  return total;
}

function updatePressureControl(): void {
  const label = document.querySelector<HTMLElement>("#pressure-value");
  if (!label) return;
  const names: Record<string, string> = { "0.5": "舒缓", "0.75": "偏低", "1": "标准", "1.25": "偏高", "1.5": "高压", "1.75": "极限", "2": "极限" };
  label.textContent = `${names[String(hordePressure)] ?? "自定义"} · ×${hordePressure.toFixed(2)}`;
}

function render(): void {
  renderer.draw(world);
  const mode = getMode(world.modeId);
  const active = world.team.filter((u) => u.state === "active" || u.state === "ready");
  document.querySelector("#team-count")!.textContent = String(active.length);
  document.querySelector("#survivor-count")!.textContent = mode.civilians
    ? `${world.survivors.filter((u) => u.state === "waiting" || u.state === "following").length}/${world.survivors.length}`
    : mode.surviveSeconds ? `${Math.min(Math.floor(world.elapsedSeconds), mode.surviveSeconds)} / ${mode.surviveSeconds} 秒`
      : mode.killGoal ? `${Math.min(world.kills, mode.killGoal)}/${mode.killGoal}` : `${world.kills} 击杀`;
  document.querySelector("#evacuated-count")!.textContent = mode.civilians
    ? String(world.evacuatedSurvivors) : String(world.kills);
  document.querySelector("#zombie-count")!.textContent = String(world.zombies.length);
  document.querySelector("#survivor-label")!.textContent = mode.civilians ? "平民未撤离" : mode.surviveSeconds ? "坚守进度" : mode.killGoal ? "清剿进度" : "累计击杀";
  document.querySelector("#evacuated-label")!.textContent = mode.civilians ? "平民已撤离" : "击杀数";
  const secs = Math.floor(world.elapsedSeconds);
  document.querySelector("#sim-clock")!.textContent = String(Math.floor(secs / 60)).padStart(2, "0") + ":" + String(secs % 60).padStart(2, "0");
  const remaining = mode.surviveSeconds ? Math.max(0, mode.surviveSeconds - secs) : undefined;
  document.querySelector("#survival-countdown")!.textContent = remaining === undefined ? "—"
    : String(Math.floor(remaining / 60)).padStart(2, "0") + ":" + String(remaining % 60).padStart(2, "0");
  const pressure = Math.min(5, Math.exp(world.elapsedSeconds / 150) * world.hordePressure);
  const pressureLabel = pressure < 1.5 ? "低" : pressure < 2.5 ? "中" : pressure < 4.2 ? "高" : "绝望";
  document.querySelector("#pressure-level")!.textContent = mode.objective === "chase" ? "—" : `${pressureLabel} · ×${world.hordePressure.toFixed(2)}`;
  const defenseHealth = world.defenses.reduce((sum, defense) => sum + defense.health, 0);
  const defenseMaxHealth = world.defenses.reduce((sum, defense) => sum + defense.maxHealth, 0);
  document.querySelector("#defense-integrity")!.textContent = defenseMaxHealth
    ? Math.round(defenseHealth / defenseMaxHealth * 100) + "%" : mode.objective === "endless" ? "施工中" : "—";
  document.querySelector("#tactic-name")!.textContent = labels[world.tactic];
  const activePlan = world.commanderPlan && world.commanderPlan.expiresAt > world.elapsedSeconds ? world.commanderPlan : undefined;
  document.querySelector("#tactic-reason")!.textContent = activePlan ? `第三方 LLM：${activePlan.reason}` : reasons[world.tactic];
  const resultText = world.result === "success" ? "任务成功" : world.result === "failure" ? "任务失败" : "";
  document.querySelector("#game-status")!.textContent = world.running ? "自动指挥中" : resultText || (world.tactic === "idle" ? "待命" : world.tactic === "finished" ? "已结算" : "已暂停");
  document.querySelector(".status-pill")?.classList.toggle("running", world.running);
  renderAmmoOverview();
  (document.querySelector<HTMLButtonElement>("#start-button")!).disabled = world.running || world.tactic === "finished";
  (document.querySelector<HTMLButtonElement>("#pause-button")!).disabled = !world.running;
  const pressureApplicable = mode.objective !== "chase" && (mode.initialZombies > (mode.bossCount ?? 0) || mode.zombieLimit > mode.initialZombies);
  if (pressureSlider) pressureSlider.disabled = world.running || !pressureApplicable;
  document.querySelectorAll<HTMLInputElement>("#roster-editor-grid input").forEach((input) => { input.disabled = world.running; });
  const resetRoster = document.querySelector<HTMLButtonElement>("#reset-roster");
  updateRosterTotal();
  if (resetRoster) resetRoster.disabled = world.running;
  while (world.events.length) log(world.events.shift()!);
}

function resetWorld(modeId: GameModeId, message: string, seed?: string): void {
  llmDirector.stop();
  loop?.pause();
  world = createWorld(modeId, seed, hordePressure, getRoster(modeId));
  createLoop();
  updateLlmStatus("local", llmSettings.enabled ? "LLM 已配置；开始任务后连接模型，本地规则 AI 将作为故障兜底。" : "本地规则 AI 待命。");
  renderModeInfo();
  log(message);
  render();
}
function createLoop(): void { loop = new GameLoop(world, render); }

selector.addEventListener("change", () => resetWorld(selector.value as GameModeId, "已切换到「" + getMode(selector.value as GameModeId).name + "」。"));
pressureSlider?.addEventListener("input", () => {
  hordePressure = Number(pressureSlider.value);
  updatePressureControl();
});
pressureSlider?.addEventListener("change", () => {
  hordePressure = Number(pressureSlider.value);
  resetWorld(selector.value as GameModeId, `尸潮压力已调整为 ×${hordePressure.toFixed(2)}，战局已重新初始化。`, world.mapSeed);
});
document.querySelector("#roster-editor-grid")?.addEventListener("input", () => updateRosterTotal());
document.querySelector("#apply-roster")?.addEventListener("click", () => {
  const total = updateRosterTotal();
  if (total < 1 || total > 500) { log("队伍人数须为 1 至 500 人，请调整编制后再应用。"); return; }
  const selected = Object.fromEntries(allClasses.map((classId) => [classId, 0])) as Record<SoldierClass, number>;
  for (const input of document.querySelectorAll<HTMLInputElement>("#roster-editor-grid input[data-class-id]")) {
    const classId = input.dataset.classId as SoldierClass;
    const value = Number(input.value);
    if (!Number.isInteger(value) || value < 0 || value > 500) { log("兵种人数请输入 0 至 500 的整数。"); return; }
    selected[classId] = value;
  }
  const modeId = selector.value as GameModeId;
  rosterOverrides[modeId] = selected;
  localStorage.setItem(rosterStorageKey, JSON.stringify(rosterOverrides));
  resetWorld(modeId, `已应用「${getMode(modeId).name}」编制：${total} 人，配置已保存在本地。`, world.mapSeed);
});
document.querySelector("#reset-roster")?.addEventListener("click", () => {
  const modeId = selector.value as GameModeId;
  delete rosterOverrides[modeId];
  localStorage.setItem(rosterStorageKey, JSON.stringify(rosterOverrides));
  resetWorld(modeId, `「${getMode(modeId).name}」已恢复关卡默认编制。`, world.mapSeed);
});
document.querySelector("#start-button")?.addEventListener("click", () => {
  if (world.tactic === "idle") log("任务开始，AI 接管指挥。");
  loop.start();
  llmDirector.start(world, llmSettings);
  render();
});
document.querySelector("#pause-button")?.addEventListener("click", () => {
  llmDirector.stop();
  loop.pause();
  updateLlmStatus("local", "模拟已暂停；继续任务后会重新连接并评估战况。");
  log("模拟已暂停。");
});
document.querySelector("#restart-button")?.addEventListener("click", () => resetWorld(selector.value as GameModeId, "新一局战场已初始化。"));
document.querySelector("#apply-seed")?.addEventListener("click", () => {
  const seed = document.querySelector<HTMLInputElement>("#seed-input")?.value.trim();
  if (!seed) { log("请输入地图种子后再应用。"); return; }
  resetWorld(selector.value as GameModeId, "已按种子「" + seed + "」生成可复现的新地图。", seed);
});
document.querySelector("#copy-seed")?.addEventListener("click", async () => {
  try { await navigator.clipboard.writeText(world.mapSeed); log("地图种子已复制：" + world.mapSeed); }
  catch { const field = document.querySelector<HTMLInputElement>("#seed-input"); field?.select(); log("请从地图种子输入框手动复制。"); }
});

function renderAmmoOverview(): void {
  const grouped = new Map<string, { name: string; ammo: number; capacity: number; reloads: number; reloadRatio: number; count: number }>();
  for (const soldier of world.team) {
    if (soldier.state !== "active" && soldier.state !== "ready") continue;
    const info = CLASS_INFO[soldier.classId];
    const row = grouped.get(soldier.classId) ?? { name: info.name, ammo: 0, capacity: 0, reloads: 0, reloadRatio: 0, count: 0 };
    row.count++;
    row.ammo += soldier.ammo;
    row.capacity += soldier.magazineSize;
    if (soldier.reloadTimer > 0) {
      row.reloads++;
      row.reloadRatio += soldier.reloadTimer / WEAPON_CONFIG[soldier.classId].reloadSeconds;
    }
    grouped.set(soldier.classId, row);
  }
  const container = document.querySelector<HTMLDivElement>("#ammo-overview");
  if (container) container.replaceChildren(...[...grouped].map(([classId, row]) => {
    const item = document.createElement("div");
    const loading = row.reloads > 0;
    item.className = "ammo-row" + (loading ? " is-reloading" : "");
    item.style.borderLeft = "2px solid " + CLASS_INFO[classId as keyof typeof CLASS_INFO].color;
    item.innerHTML = `<span>${row.name} ×${row.count}</span><strong>${row.capacity ? `${row.ammo}/${row.capacity} · ∞备弹${loading ? ` · ${row.reloads}人换弹` : ""}` : "无弹匣"}${loading ? `<i class="reload-progress"><b style="width:${Math.max(0, Math.min(100, (1 - row.reloadRatio / row.reloads) * 100))}%"></b></i>` : ""}`;
    return item;
  }));
  const totalAmmo = world.team.reduce((sum, soldier) => sum + (soldier.state === "active" ? soldier.ammo : 0), 0);
  const reloadCount = world.team.filter((soldier) => soldier.state === "active" && soldier.reloadTimer > 0).length;
  document.querySelector("#ammo-total")!.textContent = `当前弹匣余弹：${totalAmmo} · 备弹 ∞ · 已射击 ${world.totalShotsFired}`;
  document.querySelector("#reload-count")!.textContent = `换弹中：${reloadCount}`;
  const crate = world.ammoCrates[0];
  const rearming = world.team.find((soldier) => soldier.rearmTargetId !== undefined);
  document.querySelector("#ammo-logistics")!.textContent = crate
    ? `弹药箱耐久 ${crate.health}/${crate.maxHealth} · 储备 ${crate.reserve} · ${crate.duration === null ? "持续至本阵地阶段结束" : `剩余 ${Math.ceil(crate.duration)}s`} · 再部署 ${Math.ceil(world.ammoCrateCooldown)}s${rearming ? ` · 工兵重装填 ${Math.floor(rearming.rearmProgress / AMMO_RULES.turretReloadSeconds * 100)}%` : ""}`
    : world.team.some((soldier) => soldier.classId === "ammoSpecialist")
      ? `补给箱冷却 ${Math.ceil(world.ammoCrateCooldown)}s · 快速补弹冷却 ${Math.max(0, ...world.team.filter((soldier) => soldier.classId === "ammoSpecialist").map((soldier) => Math.ceil(soldier.specialCooldown)))}s${rearming ? ` · 工兵重装填 ${Math.floor(rearming.rearmProgress / AMMO_RULES.turretReloadSeconds * 100)}%` : ""}`
      : "弹药兵未编入本局队伍";
}

createLoop();
renderModeInfo();
render();
window.addEventListener("resize", render);
