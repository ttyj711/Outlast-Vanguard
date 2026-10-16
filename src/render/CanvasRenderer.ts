import { getMap, WORLD_HEIGHT, WORLD_WIDTH } from "../game/config";
import { CLASS_INFO, getMode } from "../game/modes";
import type { WorldState } from "../game/types";

export class CanvasRenderer {
  private readonly context: CanvasRenderingContext2D;

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("当前浏览器无法创建 Canvas 2D 上下文");
    this.context = context;
  }

  draw(world: WorldState): void {
    const ctx = this.context;
    const map = getMap(world.modeId, world.mapSeed);
    const scale = Math.min(this.canvas.clientWidth / WORLD_WIDTH, this.canvas.clientHeight / WORLD_HEIGHT);
    const pixelRatio = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(this.canvas.clientWidth * pixelRatio));
    const height = Math.max(1, Math.floor(this.canvas.clientHeight * pixelRatio));
    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    ctx.setTransform(pixelRatio * scale, 0, 0, pixelRatio * scale, 0, 0);
    if (world.tactic === "finished" && world.evacuatedSurvivors > 0) {
      this.drawEvacuationScene(world);
      return;
    }
    ctx.fillStyle = "#0b1b27";
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    ctx.strokeStyle = "rgba(80, 127, 148, 0.12)";
    ctx.lineWidth = 1;
    for (let x = 0; x < WORLD_WIDTH; x += 32) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, WORLD_HEIGHT); ctx.stroke();
    }
    for (let y = 0; y < WORLD_HEIGHT; y += 32) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(WORLD_WIDTH, y); ctx.stroke();
    }

    // 各玩法使用自己的救援目标区、撤离区或防守目标区。
    ctx.font = "12px sans-serif";
    if (map.shelter) {
      ctx.fillStyle = "rgba(34, 99, 75, 0.28)";
      ctx.fillRect(map.shelter.x, map.shelter.y, map.shelter.width, map.shelter.height);
      ctx.strokeStyle = "rgba(113, 201, 159, .72)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(map.shelter.x, map.shelter.y, map.shelter.width, map.shelter.height);
      ctx.fillStyle = "#71c99f";
      ctx.fillText(map.shelter.label, map.shelter.x + 11, map.shelter.y + 20);
      ctx.fillStyle = "#a5e8c5";
      ctx.font = "9px sans-serif";
      ctx.fillText("驻守 " + world.shelterGuards.filter((guard) => guard.health > 0).length, map.shelter.x + 11, map.shelter.y + 33);
    }
    const goal = map.objectiveArea ?? map.exitArea;
    ctx.fillStyle = map.objectiveArea ? "rgba(227, 179, 64, .14)" : "rgba(33, 176, 120, 0.16)";
    ctx.fillRect(goal.x, goal.y, goal.width, goal.height);
    ctx.strokeStyle = map.objectiveArea ? "#e9c45e" : "#3ed99a";
    ctx.lineWidth = 2;
    ctx.strokeRect(goal.x, goal.y, goal.width, goal.height);
    ctx.fillStyle = map.objectiveArea ? "#f2d67e" : "#61e6a9";
    ctx.fillText(map.objectiveArea?.label ?? map.exitLabel, goal.x + 10, goal.y + 20);

    for (const nest of map.nests) {
      ctx.fillStyle = "rgba(131, 57, 175, 0.12)";
      ctx.fillRect(nest.x, nest.y, nest.width, nest.height);
      ctx.strokeStyle = "rgba(210, 120, 255, 0.76)";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(nest.x, nest.y, nest.width, nest.height);
    }
    for (const wall of map.walls) {
      ctx.fillStyle = "#263c4b";
      ctx.fillRect(wall.x, wall.y, wall.width, wall.height);
      ctx.strokeStyle = "#637d8f";
      ctx.lineWidth = 1;
      ctx.strokeRect(wall.x, wall.y, wall.width, wall.height);
    }
    for (let i = 0; i < (map.resourcePoints?.length ?? 0); i++) {
      if (world.collectedResourceIds.includes(i)) continue;
      const point = map.resourcePoints![i];
      ctx.fillStyle = "rgba(228,233,162,.16)"; ctx.beginPath(); ctx.arc(point.x, point.y, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#e4e9a2"; ctx.fillRect(point.x - 5, point.y - 5, 10, 10);
      ctx.strokeStyle = "#667047"; ctx.strokeRect(point.x - 5, point.y - 5, 10, 10);
    }

    ctx.strokeStyle = "#607b8b";
    ctx.lineWidth = 3;
    ctx.strokeRect(8, 8, WORLD_WIDTH - 16, WORLD_HEIGHT - 16);
    this.drawDefenses(world);
    this.drawAmmoCrates(world);
    this.drawUnits(world);
    this.drawShotEffects(world);
  }

  private drawEvacuationScene(world: WorldState): void {
    const ctx = this.context;
    ctx.fillStyle = "#142129";
    ctx.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    ctx.fillStyle = "#29353a";
    ctx.fillRect(0, 230, WORLD_WIDTH, 220);
    ctx.strokeStyle = "#a1a79d";
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(0, 230); ctx.lineTo(WORLD_WIDTH, 230); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, 450); ctx.lineTo(WORLD_WIDTH, 450); ctx.stroke();
    ctx.setLineDash([42, 35]);
    ctx.strokeStyle = "#c7c1a1";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 340); ctx.lineTo(WORLD_WIDTH, 340); ctx.stroke();
    ctx.setLineDash([]);

    // 简化的撤离巴士，车窗灯光代表已安全登车的平民。
    const bx = 200, by = 265, bw = 310, bh = 145;
    ctx.fillStyle = "rgba(0,0,0,.3)";
    ctx.beginPath(); ctx.roundRect(bx + 8, by + 12, bw, bh, 22); ctx.fill();
    ctx.fillStyle = "#536a70";
    ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 22); ctx.fill();
    ctx.fillStyle = "#293e47";
    ctx.beginPath(); ctx.roundRect(bx + 16, by + 15, bw - 55, bh - 30, 12); ctx.fill();
    ctx.fillStyle = "#172b35";
    ctx.fillRect(bx + bw - 44, by + 24, 29, bh - 48);
    ctx.fillStyle = "#b7c6b7";
    ctx.fillRect(bx + bw - 8, by + 22, 6, 16);
    ctx.fillRect(bx + bw - 8, by + bh - 38, 6, 16);
    ctx.fillStyle = "#101b20";
    ctx.fillRect(bx + 36, by - 5, 25, 7);
    ctx.fillRect(bx + bw - 58, by - 5, 25, 7);
    ctx.fillRect(bx + 36, by + bh - 2, 25, 7);
    ctx.fillRect(bx + bw - 58, by + bh - 2, 25, 7);

    for (let i = 0; i < 10; i++) {
      const row = i < 5 ? 0 : 1;
      const col = i % 5;
      const x = bx + 30 + col * 43;
      const y = by + 42 + row * 52;
      ctx.fillStyle = i < world.evacuatedSurvivors ? (i % 3 === 0 ? "#ffd36b" : "#58e79b") : "#182b32";
      ctx.beginPath(); ctx.arc(x, y, 7, 0, Math.PI * 2); ctx.fill();
    }
    ctx.fillStyle = "#46acff";
    ctx.beginPath(); ctx.arc(bx + 80, by + bh + 32, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#87a2aa";
    ctx.font = "14px sans-serif";
    ctx.fillText("撤离完成 · " + world.evacuatedSurvivors + " 名平民已登车", 220, 485);
  }

  private drawShotEffects(world: WorldState): void {
    const ctx = this.context;
    for (const shot of world.shots) {
      const progress = shot.age / shot.duration;
      const alpha = Math.max(0, 1 - progress);
      const dx = shot.x2 - shot.x1, dy = shot.y2 - shot.y1;
      const length = Math.hypot(dx, dy) || 1;
      const tail = Math.min(38, length * 0.42);
      const sx = shot.x1 + dx / length * tail, sy = shot.y1 + dy / length * tail;
      ctx.save();
      ctx.globalAlpha = alpha;
      if (shot.kind === "explosion") {
        if (progress < 0) { ctx.restore(); continue; }
        ctx.shadowColor = "#ff9a42";
        ctx.shadowBlur = 24;
        ctx.fillStyle = `rgba(255, 126, 43, ${alpha * 0.34})`;
        ctx.beginPath(); ctx.arc(shot.x2, shot.y2, 13 + progress * 42, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = `rgba(255, 218, 120, ${alpha})`;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(shot.x2, shot.y2, 8 + progress * 38, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
        continue;
      }
      if (shot.kind === "melee") {
        ctx.strokeStyle = `rgba(143,225,255,${alpha})`; ctx.lineWidth = 3; ctx.shadowColor = "#7ce5ff"; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.moveTo(shot.x1, shot.y1); ctx.lineTo(shot.x2, shot.y2); ctx.stroke();
        ctx.restore(); continue;
      }
      if (shot.kind === "grenade") {
        const arcX = shot.x1 + dx * progress;
        const arcY = shot.y1 + dy * progress - Math.sin(progress * Math.PI) * 30;
        ctx.setLineDash([4, 6]);
        ctx.strokeStyle = "rgba(255, 205, 93, .55)";
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(shot.x1, shot.y1); ctx.lineTo(arcX, arcY); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = "#4a4030";
        ctx.strokeStyle = "#ffd36a";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(arcX, arcY, 4.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "#fff2a6";
        ctx.beginPath(); ctx.arc(arcX - 1, arcY - 1, 1.5, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
        continue;
      }
      if (shot.kind === "flame") {
        const spread = 9 + progress * 42;
        const px = -dy / length, py = dx / length;
        const flicker = Math.sin(shot.age * 76) * 5;
        const waistX = shot.x1 + dx * .35, waistY = shot.y1 + dy * .35;
        const tipX = shot.x1 + dx * .88, tipY = shot.y1 + dy * .88;
        ctx.globalCompositeOperation = "lighter";
        ctx.shadowColor = "#ff4515";
        ctx.shadowBlur = 28;
        ctx.fillStyle = `rgba(255, 68, 18, ${alpha * .58})`;
        ctx.beginPath();
        ctx.moveTo(shot.x1, shot.y1);
        ctx.quadraticCurveTo(waistX + px * spread, waistY + py * spread, tipX + px * (spread * .28 + flicker), tipY + py * (spread * .28 + flicker));
        ctx.quadraticCurveTo(shot.x2, shot.y2, tipX - px * (spread * .28 - flicker), tipY - py * (spread * .28 - flicker));
        ctx.quadraticCurveTo(waistX - px * spread, waistY - py * spread, shot.x1, shot.y1);
        ctx.closePath(); ctx.fill();

        for (let i = 0; i < 5; i++) {
          const side = i - 2;
          const start = .08 + (i % 2) * .06;
          const end = .58 + (i % 3) * .11;
          const wobble = Math.sin(shot.age * 88 + i * 2.4) * spread * .22;
          ctx.strokeStyle = i === 2 ? "#fff5b7" : i % 2 ? "#ffbf48" : "#ff7928";
          ctx.shadowColor = i === 2 ? "#fff1a0" : "#ff5a18";
          ctx.shadowBlur = i === 2 ? 12 : 20;
          ctx.lineWidth = (i === 2 ? 7 : 4.5) - progress * 2 + Math.abs(flicker) * .18;
          ctx.beginPath();
          ctx.moveTo(shot.x1 + dx * start + px * side * 2, shot.y1 + dy * start + py * side * 2);
          ctx.quadraticCurveTo(waistX + px * (side * spread * .3 + wobble), waistY + py * (side * spread * .3 + wobble), shot.x1 + dx * end + px * (side * spread * .16 + wobble), shot.y1 + dy * end + py * (side * spread * .16 + wobble));
          ctx.stroke();
        }

        // 明亮喷口和飞散火星，让短距离火焰在缩小的战场画布上仍清楚可见。
        ctx.shadowColor = "#ffb52f";
        ctx.shadowBlur = 18;
        ctx.fillStyle = "#fff1a1";
        ctx.beginPath(); ctx.arc(shot.x1, shot.y1, 4 + Math.abs(flicker) * .25, 0, Math.PI * 2); ctx.fill();
        for (let i = 0; i < 6; i++) {
          const p = .24 + i * .105;
          const jitter = Math.sin(shot.age * 62 + i * 3.1) * spread * .45;
          ctx.fillStyle = i % 2 ? "#ff9d2d" : "#fff08a";
          ctx.beginPath(); ctx.arc(shot.x1 + dx * p + px * jitter, shot.y1 + dy * p + py * jitter, 2.1 + (i % 3) * .6, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
        continue;
      }
      if (shot.kind === "sniper") {
        ctx.lineCap = "round";
        ctx.shadowColor = "#9fffea";
        ctx.shadowBlur = 18;
        ctx.strokeStyle = "rgba(109, 255, 232, .86)";
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(shot.x1, shot.y1); ctx.lineTo(shot.x2, shot.y2); ctx.stroke();
        ctx.strokeStyle = "#f2ffff";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(shot.x2, shot.y2); ctx.stroke();
        ctx.strokeStyle = "rgba(124, 255, 236, .85)";
        ctx.lineWidth = 1.2;
        ctx.beginPath(); ctx.arc(shot.x2, shot.y2, 4 + progress * 16, 0, Math.PI * 2); ctx.stroke();
        ctx.restore();
        continue;
      }
      ctx.lineCap = "round";
      const colors = shot.kind === "machineGun" ? ["#ffb238", "#fff2b0"]
        : shot.kind === "scout" ? ["#54e8ff", "#e3ffff"]
        : shot.kind === "medic" ? ["#4de3bf", "#d3fff1"]
        : shot.kind === "shotgun" ? ["#ffc34b", "#fff3c4"]
        : shot.kind === "turret" ? ["#75f0a9", "#e0ffb0"]
        : ["#ffb45c", "#fff1c2"];
      const width = shot.kind === "machineGun" ? 4.4 : shot.kind === "scout" ? 3.6 : shot.kind === "medic" ? 2.3 : shot.kind === "shotgun" ? 3.8 : shot.kind === "turret" ? 3 : 2.8;
      ctx.shadowColor = colors[0];
      ctx.shadowBlur = shot.kind === "scout" ? 13 : 7;
      ctx.strokeStyle = colors[0];
      ctx.lineWidth = width;
      ctx.beginPath(); ctx.moveTo(shot.x1, shot.y1); ctx.lineTo(shot.x2, shot.y2); ctx.stroke();
      ctx.shadowBlur = 2;
      ctx.strokeStyle = colors[1];
      ctx.lineWidth = shot.kind === "machineGun" ? 1.5 : 1;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(shot.x2, shot.y2); ctx.stroke();
      if (shot.kind === "machineGun" || shot.kind === "shotgun") {
        ctx.fillStyle = "#fff5c7";
        ctx.beginPath(); ctx.arc(shot.x2, shot.y2, 2.2, 0, Math.PI * 2); ctx.fill();
      }
      if (shot.kind === "scout" && progress < .45) {
        ctx.strokeStyle = "rgba(92, 240, 255, .8)";
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(shot.x2, shot.y2, 5 + progress * 12, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = colors[1];
      ctx.shadowColor = colors[0];
      ctx.shadowBlur = 12;
      ctx.beginPath(); ctx.arc(shot.x1, shot.y1, shot.kind === "machineGun" ? 3.5 : 2.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
  }

  private drawDefenses(world: WorldState): void {
    const ctx = this.context;
    for (const defense of world.defenses) {
      if (defense.kind === "turret") {
        ctx.save();
        ctx.translate(defense.x, defense.y);
        ctx.fillStyle = "#263a43";
        ctx.fillRect(-10, -8, 20, 16);
        ctx.strokeStyle = "#7ceba7";
        ctx.lineWidth = 2;
        ctx.strokeRect(-10, -8, 20, 16);
        ctx.fillStyle = "#a8f6c2";
        ctx.fillRect(-3, -12, 6, 8);
        ctx.fillStyle = "#d9efff";
        ctx.fillRect(7, -2, 9, 4);
        ctx.restore();
      } else {
        ctx.strokeStyle = "#d6a66d";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(defense.x - 13, defense.y); ctx.lineTo(defense.x + 13, defense.y); ctx.stroke();
        for (let x = defense.x - 12; x <= defense.x + 12; x += 8) {
          ctx.beginPath(); ctx.moveTo(x, defense.y + 4); ctx.lineTo(x + 4, defense.y - 5); ctx.lineTo(x + 8, defense.y + 4); ctx.stroke();
        }
      }
      ctx.fillStyle = "#17252b";
      ctx.fillRect(defense.x - 11, defense.y - 15, 22, 3);
      ctx.fillStyle = defense.kind === "turret" ? "#72eaa2" : "#e5bd84";
      ctx.fillRect(defense.x - 11, defense.y - 15, 22 * defense.health / defense.maxHealth, 3);
      if (defense.kind === "turret") {
        ctx.fillStyle = defense.ammo > 0 ? "#bfe6ff" : "#ff7586";
        ctx.font = "7px sans-serif";
        ctx.fillText(defense.ammo > 0 ? String(defense.ammo) : "空仓", defense.x - 10, defense.y + 18);
      }
    }
  }

  private drawAmmoCrates(world: WorldState): void {
    const ctx = this.context;
    for (const crate of world.ammoCrates) {
      ctx.save(); ctx.translate(crate.x, crate.y);
      ctx.fillStyle = "rgba(225,233,162,.14)"; ctx.beginPath(); ctx.arc(0, 0, 18, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#4b5940"; ctx.strokeStyle = "#e4e9a2"; ctx.lineWidth = 2;
      ctx.fillRect(-9, -8, 18, 16); ctx.strokeRect(-9, -8, 18, 16);
      ctx.fillStyle = "#e4e9a2"; ctx.fillRect(-2, -6, 4, 12); ctx.fillRect(-6, -2, 12, 4);
      ctx.fillStyle = "#dbe69d"; ctx.font = "8px sans-serif"; ctx.fillText(String(crate.reserve), -10, -12);
      ctx.fillStyle = "#33242a"; ctx.fillRect(-10, 11, 20, 3);
      ctx.fillStyle = "#ff7284"; ctx.fillRect(-10, 11, 20 * crate.health / crate.maxHealth, 3);
      ctx.restore();
    }
  }

  private drawUnits(world: WorldState): void {
    const ctx = this.context;
    const commanderPlan = world.commanderPlan && world.commanderPlan.expiresAt > world.elapsedSeconds ? world.commanderPlan : undefined;
    const individualOrders = new Map(commanderPlan?.orders.map((order) => [order.soldierId, order]) ?? []);
    const orderBadges = { focus: "集", rescue: "救", escort: "护", hold: "守", retreat: "撤", resupply: "补", cover: "掩" } as const;
    for (const survivor of world.survivors) {
      if (survivor.state === "evacuated") continue;
      if (survivor.state === "dead") {
        ctx.strokeStyle = "#ff5367";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(survivor.x - 4, survivor.y - 4); ctx.lineTo(survivor.x + 4, survivor.y + 4); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(survivor.x + 4, survivor.y - 4); ctx.lineTo(survivor.x - 4, survivor.y + 4); ctx.stroke();
        continue;
      }
      const color = survivor.state === "following" ? (survivor.id % 2 ? "#f5be48" : "#4de68b") : "#44e795";
      this.circle(survivor.x, survivor.y, 5.2, color);
      ctx.strokeStyle = "rgba(216,255,229,.75)";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(survivor.x, survivor.y, 6.4, 0, Math.PI * 2); ctx.stroke();
    }
    for (const zombie of world.zombies) {
      if ((zombie.burnTimer ?? 0) > 0) {
        const flicker = Math.sin(world.elapsedSeconds * 27 + zombie.id * 3) * 1.5;
        ctx.save();
        ctx.globalCompositeOperation = "lighter";
        ctx.shadowColor = "#ff641f";
        ctx.shadowBlur = 12;
        ctx.fillStyle = "rgba(255,112,34,.68)";
        ctx.beginPath(); ctx.arc(zombie.x, zombie.y - 2, 6 + flicker, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#ffe480";
        ctx.beginPath(); ctx.arc(zombie.x - 2, zombie.y - 5 - Math.abs(flicker), 2, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      }
      if (zombie.infectedClassId) {
        const classId = zombie.infectedClassId;
        const classInfo = CLASS_INFO[classId];
        const angle = zombie.aimAngle ?? 0;
        const gunLength = classId === "sniper" ? 21 : classId === "machineGunner" ? 17 : classId === "shotgunner" ? 15 : 12;
        const miniBoss = zombie.isMiniBoss === true;
        if (miniBoss) {
          ctx.fillStyle = "rgba(255, 57, 75, .2)";
          ctx.beginPath(); ctx.arc(zombie.x, zombie.y, 18, 0, Math.PI * 2); ctx.fill();
        }
        ctx.strokeStyle = classId === "sniper" ? "#c8fff3" : classInfo.color;
        ctx.lineWidth = classId === "machineGunner" ? 4.5 : classId === "grenadier" ? 3.5 : classId === "sniper" ? 2 : 2.8;
        ctx.beginPath(); ctx.moveTo(zombie.x, zombie.y); ctx.lineTo(zombie.x + Math.cos(angle) * gunLength, zombie.y + Math.sin(angle) * gunLength); ctx.stroke();
        this.circle(zombie.x, zombie.y, miniBoss ? 9 : classId === "machineGunner" ? 7 : 6, classInfo.color);
        ctx.strokeStyle = "#ff5269"; ctx.lineWidth = miniBoss ? 2.2 : 1.5;
        ctx.beginPath(); ctx.arc(zombie.x, zombie.y, miniBoss ? 13 : 9, 0, Math.PI * 2); ctx.stroke();
        const barWidth = miniBoss ? 28 : 16;
        const barY = miniBoss ? zombie.y - 20 : zombie.y - 12;
        ctx.fillStyle = "#17354b"; ctx.fillRect(zombie.x - barWidth / 2, barY, barWidth, miniBoss ? 4 : 2.5);
        ctx.fillStyle = "#ff6577"; ctx.fillRect(zombie.x - barWidth / 2, barY, barWidth * Math.max(0, zombie.health / zombie.maxHealth), miniBoss ? 4 : 2.5);
        if (miniBoss) {
          ctx.fillStyle = "#ff9caa"; ctx.font = "bold 8px sans-serif"; ctx.textAlign = "center";
          ctx.fillText("小BOSS", zombie.x, zombie.y - 24);
          ctx.textAlign = "start";
        }
      } else if (zombie.isBoss) {
        ctx.fillStyle = "rgba(255, 55, 77, .16)";
        ctx.beginPath(); ctx.arc(zombie.x, zombie.y, 16, 0, Math.PI * 2); ctx.fill();
        this.circle(zombie.x, zombie.y, 10, "#ff5269");
        ctx.strokeStyle = "#ffc4cc";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(zombie.x, zombie.y, 13, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = "#401d29";
        ctx.fillRect(zombie.x - 15, zombie.y - 19, 30, 3);
        ctx.fillStyle = "#ff687b";
        ctx.fillRect(zombie.x - 15, zombie.y - 19, 30 * Math.max(0, zombie.health / zombie.maxHealth), 3);
      } else if (zombie.isElite) {
        ctx.fillStyle = "rgba(255, 156, 63, .18)";
        ctx.beginPath(); ctx.arc(zombie.x, zombie.y, 13, 0, Math.PI * 2); ctx.fill();
        this.circle(zombie.x, zombie.y, 7.5, "#f08b42");
        ctx.strokeStyle = "#ffd185"; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.arc(zombie.x, zombie.y, 10, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = "#30242c"; ctx.fillRect(zombie.x - 9, zombie.y - 15, 18, 3);
        ctx.fillStyle = "#ffb85d"; ctx.fillRect(zombie.x - 9, zombie.y - 15, 18 * Math.max(0, zombie.health / zombie.maxHealth), 3);
      } else {
        this.circle(zombie.x, zombie.y, 4.5, "#b75cf1");
      }
    }
    for (const guard of world.shelterGuards) {
      if (guard.health <= 0) continue;
      const info = CLASS_INFO[guard.classId];
      const angle = guard.aimAngle;
      ctx.strokeStyle = info.color;
      ctx.lineWidth = guard.classId === "machineGunner" ? 4 : 2.5;
      ctx.beginPath(); ctx.moveTo(guard.x, guard.y); ctx.lineTo(guard.x + Math.cos(angle) * 16, guard.y + Math.sin(angle) * 16); ctx.stroke();
      this.circle(guard.x, guard.y, 6, info.color);
      ctx.strokeStyle = "#f3edbb"; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.arc(guard.x, guard.y, 8, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = "#17354b"; ctx.fillRect(guard.x - 8, guard.y - 12, 16, 2.5);
      ctx.fillStyle = "#75e6a4"; ctx.fillRect(guard.x - 8, guard.y - 12, 16 * Math.max(0, guard.health / guard.maxHealth), 2.5);
    }
    for (const soldier of world.team) {
      if (soldier.state === "down" || soldier.state === "evacuated" || soldier.state === "turned") continue;
      const angle = soldier.aimAngle;
      const gunLength = soldier.classId === "sniper" ? 21 : soldier.classId === "machineGunner" ? 17 : soldier.classId === "shotgunner" ? 15 : 12;
      const gunX = soldier.x + Math.cos(angle) * gunLength;
      const gunY = soldier.y + Math.sin(angle) * gunLength;
      ctx.lineCap = "round";
      const classInfo = CLASS_INFO[soldier.classId];
      ctx.strokeStyle = soldier.classId === "sniper" ? "#c8fff3" : classInfo.color;
      ctx.lineWidth = soldier.classId === "machineGunner" ? 4.5 : soldier.classId === "grenadier" ? 3.5 : soldier.classId === "sniper" ? 2 : 2.8;
      ctx.beginPath(); ctx.moveTo(soldier.x, soldier.y); ctx.lineTo(gunX, gunY); ctx.stroke();
      if (soldier.classId === "shieldGuard") {
        ctx.save(); ctx.translate(soldier.x, soldier.y); ctx.rotate(angle);
        ctx.fillStyle = "rgba(97, 192, 232, .78)"; ctx.strokeStyle = "#c9f2ff"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(8, -9); ctx.lineTo(18, -7); ctx.lineTo(18, 5); ctx.lineTo(12, 11); ctx.lineTo(7, 6); ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
      const individualOrder = individualOrders.get(soldier.id);
      if (individualOrder) {
        ctx.strokeStyle = "#f5d56f";
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(soldier.x, soldier.y, 13, 0, Math.PI * 2); ctx.stroke();
      }
      if (soldier.classId === "sniper") {
        ctx.fillStyle = "#eafffb";
        ctx.fillRect(soldier.x + Math.cos(angle) * 5 - 1, soldier.y + Math.sin(angle) * 5 - 1, 5, 2.5);
      }
      if (soldier.classId === "engineer") {
        ctx.save(); ctx.translate(soldier.x, soldier.y); ctx.rotate(angle);
        ctx.fillStyle = "#9d7549"; ctx.fillRect(-11, -5, 6, 10);
        ctx.strokeStyle = "#f4d09a"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(-9, -3); ctx.lineTo(-14, -8); ctx.moveTo(-14, -8); ctx.lineTo(-17, -5); ctx.stroke();
        ctx.restore();
      }
      if (soldier.classId === "droneScout") {
        const dx = soldier.x + 16, dy = soldier.y - 14 + Math.sin(world.elapsedSeconds * 6 + soldier.id) * 2;
        ctx.strokeStyle = "rgba(112, 240, 224, .5)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(soldier.x, soldier.y - 5); ctx.lineTo(dx, dy); ctx.stroke();
        ctx.fillStyle = "#173c43"; ctx.strokeStyle = "#83fff0"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(dx, dy, 5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(dx - 8, dy); ctx.lineTo(dx + 8, dy); ctx.moveTo(dx, dy - 8); ctx.lineTo(dx, dy + 8); ctx.stroke();
      }
      if (soldier.classId === "officer") {
        ctx.strokeStyle = "rgba(242, 140, 187, .18)"; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(soldier.x, soldier.y, 24, 0, Math.PI * 2); ctx.stroke();
      }
      if (soldier.classId === "flamethrower") {
        ctx.fillStyle = "rgba(255, 119, 43, .18)";
        ctx.beginPath(); ctx.arc(soldier.x, soldier.y, 12, 0, Math.PI * 2); ctx.fill();
      }
      if (soldier.infectionTimer > 0) {
        ctx.strokeStyle = "#ff405d";
        ctx.lineWidth = 2.5;
        const infectionDuration = getMode(world.modeId).infectionSeconds;
        ctx.beginPath(); ctx.arc(soldier.x, soldier.y, 11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (1 - soldier.infectionTimer / infectionDuration)); ctx.stroke();
        ctx.fillStyle = "#ff405d";
        ctx.font = "bold 8px sans-serif";
        ctx.fillText(String(Math.ceil(soldier.infectionTimer)), soldier.x - 2.5, soldier.y - 14);
      }
      this.circle(soldier.x, soldier.y, soldier.classId === "machineGunner" ? 7 : 6, soldier.infectionTimer > 0 ? "#ff667a" : classInfo.color);
      if (soldier.magazineSize > 0) {
        ctx.fillStyle = "rgba(3,10,15,.78)"; ctx.fillRect(soldier.x - 9, soldier.y + 10, 18, 3);
        ctx.fillStyle = soldier.reloadTimer > 0 ? "#ffb15f" : "#e8dc7b";
        ctx.fillRect(soldier.x - 9, soldier.y + 10, 18 * soldier.ammo / soldier.magazineSize, 3);
      }
      if (soldier.reloadTimer > 0) {
        ctx.strokeStyle = "#ffb15f"; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(soldier.x, soldier.y, 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, soldier.reloadTimer / 3.5)); ctx.stroke();
        ctx.fillStyle = "#ffe0ad"; ctx.font = "bold 7px sans-serif"; ctx.fillText("RLD " + soldier.reloadTimer.toFixed(1), soldier.x - 14, soldier.y - 17);
      }
      ctx.strokeStyle = "#c5efff";
      ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.arc(soldier.x, soldier.y, 8, -0.8, 2.8); ctx.stroke();
      ctx.fillStyle = "#17354b";
      ctx.fillRect(soldier.x - 8, soldier.y - 12, 16, 2.5);
      ctx.fillStyle = "#52d4ff";
      ctx.fillRect(soldier.x - 8, soldier.y - 12, 16 * soldier.health / (soldier.classId === "shieldGuard" ? 220 : 100), 2.5);
      if (soldier.classId === "shieldGuard") {
        ctx.fillStyle = "#162c39"; ctx.fillRect(soldier.x - 8, soldier.y - 16, 16, 2);
        ctx.fillStyle = soldier.shieldOverheat > 0 ? "#ff885f" : "#77ddff";
        ctx.fillRect(soldier.x - 8, soldier.y - 16, 16 * soldier.shieldEnergy / 100, 2);
      }
      if (individualOrder) {
        ctx.font = "bold 8px sans-serif";
        ctx.textAlign = "center";
        ctx.fillStyle = "#f5d56f";
        ctx.fillText(orderBadges[individualOrder.action], soldier.x + 12, soldier.y - 12);
        ctx.textAlign = "start";
      }
    }
  }

  private circle(x: number, y: number, radius: number, color: string): void {
    this.context.beginPath();
    this.context.fillStyle = color;
    this.context.arc(x, y, radius, 0, Math.PI * 2);
    this.context.fill();
  }
}
