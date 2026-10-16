import { stepWorld } from "./World";
import type { WorldState } from "./types";

const FIXED_STEP_SECONDS = 1 / 60;
const MAX_FRAME_DELTA = 0.25;

export class GameLoop {
  private frameId = 0;
  private lastTime = 0;
  private accumulator = 0;

  constructor(private readonly world: WorldState, private readonly onUpdate: () => void) {}

  start(): void {
    if (this.frameId) return;
    this.world.running = true;
    for (const soldier of this.world.team) if (soldier.state === "ready") soldier.state = "active";
    this.lastTime = 0;
    this.accumulator = 0;
    this.frameId = requestAnimationFrame(this.frame);
  }

  pause(): void {
    this.world.running = false;
    cancelAnimationFrame(this.frameId);
    this.frameId = 0;
    this.accumulator = 0;
    this.onUpdate();
  }

  private readonly frame = (now: number): void => {
    if (!this.world.running) return;
    const frameDelta = this.lastTime ? Math.min((now - this.lastTime) / 1000, MAX_FRAME_DELTA) : 0;
    this.lastTime = now;
    this.accumulator += frameDelta;
    while (this.accumulator >= FIXED_STEP_SECONDS && this.world.running) {
      stepWorld(this.world, FIXED_STEP_SECONDS);
      this.accumulator -= FIXED_STEP_SECONDS;
    }
    this.onUpdate();
    if (this.world.running) this.frameId = requestAnimationFrame(this.frame);
    else this.frameId = 0;
  };
}
