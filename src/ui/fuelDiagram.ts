// A2 燃料の量を図で説明する（格納庫）。
// ・タンク：入れた量と、全開で飛べる時間の目安（予備燃料は使わない前提）
// ・重さ：機体と操縦者＋燃料＋装備。離陸距離は重さの2乗で伸びる
// ・滑走路：飛行場ごとに、滑走路の長さと離陸に必要な距離を同じ縮尺で
import { BASE_BURN, EMPTY_WEIGHT, EQUIPMENT_MAX_KG, FUEL_KG_PER_L, RESERVE_FUEL_L } from "../config";
import { takeoffDistance, totalWeight } from "../model/physics";
import type { PitchLevel, Waypoint } from "../model/types";
import { tr } from "../i18n";

interface FuelDiagramInput {
  fuelL: number;
  capacityL: number;
  equipmentKg: number;
  pitch: PitchLevel;
  /** 離陸する可能性のある飛行場 */
  fields: Waypoint[];
}

const pct = (v: number, max: number) => `${Math.max(0, Math.min(100, (100 * v) / max)).toFixed(1)}%`;

function hm(hours: number): string {
  const total = Math.max(0, Math.round((hours * 60) / 10) * 10);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h ? tr(`${h}時間${m ? `${m}分` : ""}`, `${h} h${m ? ` ${m} min` : ""}`) : tr(`${m}分`, `${m} min`);
}

function tankHtml(fuelL: number, cap: number): string {
  const usable = Math.max(0, fuelL - RESERVE_FUEL_L);
  const ticks: string[] = [];
  for (let h = 1; RESERVE_FUEL_L + h * BASE_BURN <= cap; h++) {
    ticks.push(`<span class="fd-tick" style="left:${pct(RESERVE_FUEL_L + h * BASE_BURN, cap)}">${tr(`${h}時間`, `${h} h`)}</span>`);
  }
  const low = fuelL < RESERVE_FUEL_L;
  return `<div class="fd-block">
    <div class="fd-head"><b>${tr("タンク", "Tank")}</b><span>${fuelL.toFixed(0)} / ${cap} L</span></div>
    <div class="fd-tank ${low ? "low" : ""}">
      <i style="width:${pct(fuelL, cap)}"></i>
      <em style="width:${pct(RESERVE_FUEL_L, cap)}"></em>
    </div>
    <div class="fd-ticks"><span class="fd-tick fd-res" style="left:${pct(RESERVE_FUEL_L / 2, cap)}">${tr("予備", "Reserve")}</span>${ticks.join("")}</div>
    <p class="fd-note">${tr(
      `全開で <b>約${hm(usable / BASE_BURN)}</b> 飛べる（赤い斜線の予備燃料 ${RESERVE_FUEL_L} L＝30分ぶんは使わない）。絞ればもっと延びる。`,
      `At full throttle you can fly <b>about ${hm(usable / BASE_BURN)}</b> (the red-striped reserve, ${RESERVE_FUEL_L} L = 30 min, is not to be used). Throttle back and it lasts longer.`,
    )}</p>
  </div>`;
}

function weightHtml(fuelL: number, cap: number, eqKg: number): string {
  const fuelKg = fuelL * FUEL_KG_PER_L;
  const total = totalWeight(fuelL, eqKg);
  const max = EMPTY_WEIGHT + cap * FUEL_KG_PER_L + EQUIPMENT_MAX_KG;
  const ratio = (total / EMPTY_WEIGHT) ** 2;
  return `<div class="fd-block">
    <div class="fd-head"><b>${tr("重さ", "Weight")}</b><span>${total.toFixed(0)} kg</span></div>
    <div class="fd-weight">
      <i class="w-base" style="width:${pct(EMPTY_WEIGHT, max)}"></i><i class="w-fuel" style="width:${pct(fuelKg, max)}"></i><i class="w-eq" style="width:${pct(eqKg, max)}"></i>
    </div>
    <p class="fd-legend"><span><i class="w-base"></i>${tr("機体と操縦者", "Plane and pilot")} ${EMPTY_WEIGHT} kg</span><span><i class="w-fuel"></i>${tr("燃料", "Fuel")} ${fuelKg.toFixed(0)} kg</span><span><i class="w-eq"></i>${tr("装備", "Equipment")} ${eqKg} kg</span></p>
    <p class="fd-note">${tr("離陸距離は重さの<b>2乗</b>で伸びる。燃料も装備もないときと比べて", "Takeoff distance grows with the <b>square</b> of the weight. Compared with no fuel and no equipment:")} <b class="${ratio > 1.15 ? "fd-warn" : ""}">×${ratio.toFixed(2)}</b>${tr("。", ".")}</p>
  </div>`;
}

function runwaysHtml(i: FuelDiagramInput): string {
  // 縮尺は固定（燃料や装備を変えても、物差しが動かないように）：いちばん重く・巡航型のときの最長距離まで
  const worstW = totalWeight(i.capacityL, EQUIPMENT_MAX_KG);
  const scale = Math.max(
    ...i.fields.map((w) => Math.max(w.runwayLength, takeoffDistance(5, w.elevation, w.temperature, worstW))),
  );
  const weight = totalWeight(i.fuelL, i.equipmentKg);
  const rows = i.fields
    .map((w) => {
      const d = takeoffDistance(i.pitch, w.elevation, w.temperature, weight);
      const ok = d <= w.runwayLength;
      const over = ok ? "" : `<b class="fd-over" style="left:${pct(w.runwayLength, scale)};width:${pct(d - w.runwayLength, scale)}"></b>`;
      return `<div class="fd-rw ${ok ? "ok" : "ng"}">
        <span class="fd-rw-name">${w.name}<small>${tr(`${w.surface === "paved" ? "舗装" : "未舗装"}・${w.temperature}℃・標高${w.elevation}m`, `${w.surface === "paved" ? "paved" : "unpaved"} · ${w.temperature}°C · elev. ${w.elevation} m`)}</small></span>
        <span class="fd-rw-track">
          <span class="fd-strip ${w.surface}" style="width:${pct(w.runwayLength, scale)}"></span>
          <span class="fd-roll" style="width:${pct(Math.min(d, w.runwayLength), scale)}"></span>${over}
          <span class="fd-plane" style="left:${pct(d, scale)}"></span>
        </span>
        <span class="fd-rw-val">${Math.round(d)} / ${w.runwayLength} m<small>${ok ? tr("○ 離陸できる", "○ Can take off") : tr("× 長すぎる", "× Too long")}</small></span>
      </div>`;
    })
    .join("");
  return `<div class="fd-block fd-runways">
    <div class="fd-head"><b>${tr("この燃料と装備で離陸すると", "Taking off with this fuel and equipment")}</b></div>
    ${rows}
    <p class="fd-note">${tr(
      "帯が滑走路（緑がかった帯は未舗装）、線と▶が離陸に必要な距離。すべて同じ縮尺。暑い・高い飛行場ほど空気が薄く、距離が伸びる。",
      "The bar is the runway (greenish = unpaved); the line and ▶ show the distance needed to take off. All to the same scale. Hot or high fields have thinner air and need a longer run.",
    )}</p>
  </div>`;
}

export function fuelDiagramHtml(i: FuelDiagramInput): string {
  return `<div class="fuel-diagram">
    <div class="fd-top">${tankHtml(i.fuelL, i.capacityL)}${weightHtml(i.fuelL, i.capacityL, i.equipmentKg)}</div>
    ${runwaysHtml(i)}
  </div>`;
}
