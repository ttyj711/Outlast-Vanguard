import { getMode } from "../game/modes";
import type { WorldState } from "../game/types";
import { requestCommanderPlan, requestFailureSummary, type LlmSettings, type LlmTraceEvent } from "./LlmCommander";

export type LlmDirectorState = "disabled" | "local" | "connecting" | "online" | "fallback";
type StatusHandler = (state: LlmDirectorState, message: string) => void;
type TraceHandler = (event: LlmTraceEvent) => void;

export class LlmDirector {
  private world?: WorldState;
  private settings?: LlmSettings;
  private timer = 0;
  private controller?: AbortController;
  private generation = 0;
  private lastRequestAt = -Infinity;
  private lastSignature = "";
  private retryAt = 0;
  private failureCount = 0;
  private pendingReason = "";
  private failureSummaryRequested = false;

  constructor(private readonly onStatus: StatusHandler, private readonly onMessage: (message: string) => void, private readonly onTrace?: TraceHandler) {}

  start(world: WorldState, settings: LlmSettings): void {
    this.stop();
    this.world = world;
    this.settings = settings;
    this.failureSummaryRequested = false;
    if (settings.enabled) {
      this.onStatus("connecting", "正在等待 LLM 首次战术评估；本地规则 AI 暂时代行。");
      this.request("战局开始");
    } else this.onStatus("local", "本局由本地规则 AI 指挥；模型配置可用于战败复盘。");
    this.timer = window.setInterval(() => this.observe(), 500);
  }

  stop(): void {
    this.generation++;
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
    this.controller?.abort();
    this.controller = undefined;
    if (this.world) this.world.commanderPlan = undefined;
    this.world = undefined;
    this.settings = undefined;
    this.pendingReason = "";
  }

  private observe(): void {
    const world = this.world;
    if (!world) return;
    if (world.result === "failure") {
      if (!this.failureSummaryRequested) {
        this.failureSummaryRequested = true;
        void this.summarizeFailure();
      }
      return;
    }
    if (!world.running || world.result) return;
    const signature = situationSignature(world);
    if (signature !== this.lastSignature) {
      this.lastSignature = signature;
      this.pendingReason = "战况发生变化";
    }
    const now = performance.now() / 1000;
    const heartbeatDue = now - this.lastRequestAt >= 6;
    if (this.controller || now < this.retryAt) return;
    if (this.pendingReason && now - this.lastRequestAt >= 3) {
      const reason = this.pendingReason;
      this.pendingReason = "";
      this.request(reason);
    } else if (heartbeatDue) this.request("定期复核战术");
  }

  private async summarizeFailure(): Promise<void> {
    const world = this.world, settings = this.settings;
    if (!world || world.result !== "failure") return;
    if (!settings?.baseUrl.trim() || !settings.model.trim() || !settings.apiKey.trim()) {
      this.onMessage("本局任务失败；未配置完整的 LLM，无法生成战败复盘。");
      return;
    }
    const generation = ++this.generation;
    this.controller?.abort();
    const controller = new AbortController();
    this.controller = controller;
    const timeoutId = window.setTimeout(() => controller.abort(), 15000);
    this.onStatus("connecting", "任务失败，LLM 正在分析结算原因与战场态势……");
    try {
      const summary = await requestFailureSummary(settings, world, controller.signal, this.onTrace);
      if (generation !== this.generation || world !== this.world) return;
      this.onMessage(`LLM 战败复盘：${summary}`);
      this.onStatus("online", "LLM 已完成本局战败复盘。");
    } catch (error) {
      if (generation !== this.generation || world !== this.world) return;
      const message = error instanceof Error ? error.message : "未知模型错误。";
      this.onMessage(`LLM 战败复盘生成失败：${message}`);
      this.onStatus("fallback", `本局已结算，战败复盘不可用：${message}`);
    } finally {
      window.clearTimeout(timeoutId);
      if (generation === this.generation) this.controller = undefined;
    }
  }

  private async request(reason: string): Promise<void> {
    const world = this.world, settings = this.settings;
    if (!world || !settings || !settings.enabled || !world.running || this.controller) return;
    const generation = this.generation;
    const controller = new AbortController();
    this.controller = controller;
    this.lastRequestAt = performance.now() / 1000;
    this.onStatus("connecting", "LLM 正在评估战况；本地规则 AI 保持兜底。");
    const timeoutId = window.setTimeout(() => controller.abort(), 10000);
    try {
      const plan = await requestCommanderPlan(settings, world, controller.signal, this.onTrace);
      if (generation !== this.generation || world !== this.world || !world.running || world.result) return;
      world.commanderPlan = plan;
      this.failureCount = 0;
      this.retryAt = 0;
      this.onStatus("online", `LLM 指挥中：${plan.reason}`);
      this.onMessage(`LLM 战术更新（${reason}）：${plan.reason}`);
    } catch (error) {
      if (generation !== this.generation) return;
      world.commanderPlan = undefined;
      this.failureCount++;
      const backoff = Math.min(30, 3 * 2 ** Math.min(this.failureCount - 1, 4));
      this.retryAt = performance.now() / 1000 + backoff;
      const message = error instanceof Error ? error.message : "未知模型错误。";
      this.onStatus("fallback", `本地规则 AI 兜底；${message} ${backoff} 秒后重试。`);
      this.onMessage(`LLM 指挥不可用，已切回本地规则 AI：${message}`);
    } finally {
      window.clearTimeout(timeoutId);
      if (generation === this.generation) this.controller = undefined;
    }
  }
}

function situationSignature(world: WorldState): string {
  const mode = getMode(world.modeId);
  const active = world.team.filter((unit) => unit.state === "active");
  const injured = active.filter((unit) => unit.health < 55).length;
  const infected = active.filter((unit) => unit.infectionTimer > 0).length;
  const waiting = world.survivors.filter((survivor) => survivor.state === "waiting").length;
  const following = world.survivors.filter((survivor) => survivor.state === "following").length;
  const dead = world.survivors.filter((survivor) => survivor.state === "dead").length;
  const closeThreats = world.zombies.filter((zombie) => active.some((unit) => Math.hypot(unit.x - zombie.x, unit.y - zombie.y) < 90)).length;
  const emptyMagazines = active.filter((unit) => unit.magazineSize > 0 && unit.ammo === 0).length;
  return [mode.objective, Math.floor(world.elapsedSeconds / 4), active.length, injured, infected, waiting, following, dead,
    Math.floor(closeThreats / 3), Math.floor(emptyMagazines / 2), Math.floor(world.kills / 10), world.tactic].join(":");
}
