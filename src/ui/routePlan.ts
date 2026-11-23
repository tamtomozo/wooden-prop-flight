// 「次の行き先」：地図と、行ける飛行場の一覧。格納庫と経由地の画面で使う。
import { MORNING_MIN } from "../config";
import { projectedViaAbs } from "../game/campaign";
import { takeoffDistance, totalWeight } from "../model/physics";
import { surfaceTemp } from "../model/weather";
import { field, legBetween, longestSeaKm, neighbors, seaKm, shortestPath } from "../data/world";
import type { PitchLevel, World } from "../model/types";
import { mapLegend, mapSvg } from "./mapView";
import { fmtClock } from "./panel";
import { plural, tr } from "../i18n";

const fmtDayTime = (abs: number) => tr(`${Math.floor(abs / 1440) + 1}日目 ${fmtClock(abs % 1440)}`, `day ${Math.floor(abs / 1440) + 1}, ${fmtClock(abs % 1440)}`);

export function routePlanHtml(
  w: World,
  o: {
    from: string;
    destination: string | null;
    nowAbs: number;
    flown?: [string, string][];
    /** この機体で、着いたあと飛び立てるかを確かめる */
    pitch: PitchLevel;
    equipmentKg: number;
  },
): string {
  const options = neighbors(w, o.from);
  const suggested = shortestPath(w, o.from, w.goalId);

  const list = options
    .map((id) => {
      const f = field(w, id);
      const leg = legBetween(w, o.from, id);
      const eta = projectedViaAbs(w, o.from, id, o.nowAbs);
      const nights = Math.floor(eta / 1440) - Math.floor(o.nowAbs / 1440);
      // 着いたあと、朝のうちに燃料を少しだけ積んでも飛び立てないなら知らせる
      const minTakeoff = takeoffDistance(o.pitch, f.elevation, surfaceTemp(f, MORNING_MIN), totalWeight(15, o.equipmentKg));
      const stuck = id !== w.goalId && minTakeoff > f.runwayLength;
      const mountain = leg.terrain.length ? tr(`・山越え（${Math.max(...leg.terrain.map((r) => r.height))} m）`, ` · over mountains (${Math.max(...leg.terrain.map((r) => r.height))} m)`) : "";
      const sea = seaKm(leg);
      const seaText = sea
        ? `<small class="sea-note">${tr(
            `海の上 ${longestSeaKm(leg) < sea ? `${sea} km（いちばん長く続くところ ${longestSeaKm(leg)} km）` : `${sea} km`}。降りられる場所はない`,
            `Over water ${longestSeaKm(leg) < sea ? `${sea} km (longest stretch ${longestSeaKm(leg)} km)` : `${sea} km`}. Nowhere to land`,
          )}</small>`
        : "";
      return `<button data-act="dest" data-id="${id}" class="${id === o.destination ? "on" : ""}">
        <b>${f.name}${id === suggested[1] ? `<span class="tag">${tr("最短", "Shortest")}</span>` : ""}${id === w.goalId ? `<span class="tag">${tr("目的地", "Goal")}</span>` : ""}</b>
        <small>${leg.distanceKm} km${mountain}${tr(
          `・滑走路 ${f.runwayLength} m（${f.surface === "paved" ? "舗装" : "未舗装"}）・整備場${f.hasRepairShop ? "あり" : "なし"}・湿度 ${f.humidity}%`,
          ` · runway ${f.runwayLength} m (${f.surface === "paved" ? "paved" : "unpaved"}) · ${f.hasRepairShop ? "repair shop" : "no repair shop"} · humidity ${f.humidity}%`,
        )}</small>
        ${seaText}
        <small>${leg.note}</small>
        ${stuck ? `<small class="late">${tr(
          `この機体（ピッチ ${o.pitch}）では、着いたあと飛び立てないおそれがある（滑走路 ${f.runwayLength} m）`,
          `With this plane (pitch ${o.pitch}) you may not be able to take off again after landing (runway ${f.runwayLength} m)`,
        )}</small>` : ""}
        <small>${tr(
          `この道で行くと、目的地に ${fmtDayTime(eta)} ごろ着く見込み（${nights > 0 ? `途中で ${nights} 泊` : "今日のうちに"}）`,
          `This way, you should reach the goal around ${fmtDayTime(eta)} (${nights > 0 ? `${plural(nights, "night")} on the way` : "today"})`,
        )}</small>
      </button>`;
    })
    .join("");

  return `<div class="route-plan">
    <div>
      ${mapSvg(w, { current: o.from, destination: o.destination, selectable: options, suggested, flown: o.flown })}
      ${mapLegend(w)}
    </div>
    <div class="dest-list">${list}</div>
  </div>`;
}

