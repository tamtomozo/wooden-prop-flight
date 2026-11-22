// 次の区間「◯◯飛行場 → △△飛行場」を図で説明する（経由地）。
// ・断面図：横が出発地からの距離、縦が高さ。地形・すすめの飛び方・予報の雲や雨や積乱雲・凍結高度・高度別の風
// ・その下に、到着時刻と日没、燃料、着く先の霧を棒で並べる
// 予報の位置や高さは実際とずれることがある（図も予報どおりに描く）。
import {
  BASE_CLIMB_RATE,
  BASE_SPEED,
  CB_DANGER_KM,
  CLIMB_SPEED_FACTOR,
  DESCENT_RATE,
  DESCENT_SPEED_BONUS,
  RESERVE_FUEL_L,
  SUNSET_MARGIN_MIN,
} from "../config";
import { terrainAt } from "../game/flight";
import type { Forecast, Leg } from "../model/types";
import { fogChance, headwindAt } from "../model/weather";

export interface LegProfileInput {
  leg: Leg;
  forecast: Forecast;
  /** 目安の飛行時間と燃料（計算できないときは null） */
  est: { minutes: number; fuelL: number } | null;
  nowMin: number;
  sunsetMin: number;
  fuelL: number;
  capacityL: number;
  /** 到着予定ごろの、着く先の気温と露点の差 */
  destSpread: number;
}

const fmtClock = (min: number) => {
  const m = Math.floor(min);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};

// ---- 断面図の寸法（viewBox 単位） ----
const W = 640;
const X0 = 40; // 高さの目盛りの右
const X1 = 560; // 風の欄の左
const Y_TOP = 26;
const Y_BASE = 190; // 標高 0 m
const H = 236;

function sideText(lateral: number, half: number) {
  return Math.abs(lateral) <= half ? "" : `・コースの${lateral < 0 ? "左" : "右"} ${Math.round(Math.abs(lateral))} km`;
}

function profileSvg(i: LegProfileInput): string {
  const { leg, forecast: f } = i;
  const D = leg.distanceKm;
  const items = f.items.filter((it) => it.prob > 0);
  const tops = items.map((it) => it.cloud?.top ?? 0);
  const maxAlt =
    Math.ceil(Math.max(3000, leg.cruiseAltitude + 800, ...leg.terrain.map((r) => r.height + 600), ...tops.map((t) => Math.min(t, 5000) + 300)) / 500) * 500;
  const sx = (km: number) => X0 + ((X1 - X0) * Math.max(0, Math.min(D, km))) / D;
  const sy = (alt: number) => Y_BASE - ((Y_BASE - Y_TOP) * Math.max(0, Math.min(maxAlt, alt))) / maxAlt;

  // 地面：出発地と着く先の標高をつなぎ、尾根を山形に足す。海の上は 0 m
  const ground = (km: number) => terrainAt(leg, km);
  const sea = leg.sea
    .map(
      (r) => `<rect class="lp-sea" x="${sx(r.fromKm).toFixed(1)}" y="${Y_BASE - 5}" width="${(sx(r.toKm) - sx(r.fromKm)).toFixed(1)}" height="5" />
      <text class="lp-t lp-sea-t" x="${sx((r.fromKm + r.toKm) / 2).toFixed(1)}" y="${Y_BASE - 9}" text-anchor="middle">海の上 ${r.toKm - r.fromKm} km（降りられない）</text>`,
    )
    .join("");
  const N = 120;
  const pts = Array.from({ length: N + 1 }, (_, k) => (D * k) / N);
  const groundPath = `M${sx(0)},${Y_BASE} ${pts.map((km) => `L${sx(km).toFixed(1)},${sy(ground(km)).toFixed(1)}`).join(" ")} L${sx(D)},${Y_BASE} Z`;

  // すすめの飛び方：上昇 → 巡航 → 降下（速さと上昇率・降下率からの目安）
  const cruise = leg.cruiseAltitude;
  let climbKm = (Math.max(0, cruise - leg.from.elevation) / BASE_CLIMB_RATE) * ((BASE_SPEED * CLIMB_SPEED_FACTOR) / 60);
  let descKm = (Math.max(0, cruise - leg.to.elevation) / DESCENT_RATE) * ((BASE_SPEED + DESCENT_SPEED_BONUS) / 60);
  if (climbKm + descKm > D) {
    const k = D / (climbKm + descKm);
    climbKm *= k;
    descKm *= k;
  }
  const path = `M${sx(0)},${sy(leg.from.elevation)} L${sx(climbKm).toFixed(1)},${sy(cruise)} L${sx(D - descKm).toFixed(1)},${sy(cruise)} L${sx(D)},${sy(leg.to.elevation)}`;

  // 予報の天気
  const op = (p: number) => (0.25 + 0.6 * p).toFixed(2);
  const pctTxt = (p: number) => `${Math.round(p * 100)}%`;
  const wx: string[] = [];
  const labels: string[] = [];
  for (const it of items) {
    if (it.cloud) {
      const c = it.cloud;
      const off = Math.abs(c.lateralKm) > c.halfWidthKm;
      wx.push(`<rect class="lp-cloud ${off ? "off" : ""}" x="${sx(c.fromKm)}" y="${sy(c.top)}" width="${sx(c.toKm) - sx(c.fromKm)}" height="${sy(c.base) - sy(c.top)}" rx="10" style="opacity:${op(it.prob)}" />`);
      labels.push(`<text class="lp-t lp-cloud-t" x="${sx(c.fromKm) + 5}" y="${sy(c.top) + 11}">${it.rain ? "雨雲" : "雲"} ${pctTxt(it.prob)}${sideText(c.lateralKm, c.halfWidthKm)}</text>`);
    }
    if (it.rain) {
      const r = it.rain;
      const top = it.cloud ? it.cloud.base : 1500;
      const gl = Math.min(ground(r.fromKm), ground(r.toKm));
      wx.push(`<rect class="lp-rain" x="${sx(r.fromKm)}" y="${sy(top)}" width="${sx(r.toKm) - sx(r.fromKm)}" height="${sy(gl) - sy(top)}" style="opacity:${op(it.prob)}" />`);
      if (!it.cloud) labels.push(`<text class="lp-t lp-rain-t" x="${sx(r.fromKm) + 4}" y="${sy(top) - 4}">雨 ${pctTxt(it.prob)}</text>`);
    }
    if (it.cb) {
      const c = it.cb;
      const x = sx(c.alongKm);
      const w = Math.max(6, sx(c.alongKm + c.radiusKm) - x);
      const gy = sy(ground(c.alongKm));
      const ty = Y_TOP + 4;
      wx.push(`<path class="lp-cb" style="opacity:${op(it.prob)}" d="M${x - w},${gy} C${x - w * 0.8},${(gy + ty) / 2} ${x - w * 1.1},${ty + 14} ${x - w * 2.4},${ty + 4} L${x + w * 2.4},${ty + 4} C${x + w * 1.1},${ty + 14} ${x + w * 0.8},${(gy + ty) / 2} ${x + w},${gy} Z" />`);
      const a = sx(c.alongKm - CB_DANGER_KM);
      const b = sx(c.alongKm + CB_DANGER_KM);
      wx.push(`<path class="lp-danger" d="M${a},${Y_TOP - 6} v6 M${a},${Y_TOP - 3} H${b} M${b},${Y_TOP - 6} v6" />`);
      labels.push(`<text class="lp-t lp-cb-t" x="${x}" y="${Y_TOP - 9}" text-anchor="middle">積乱雲 ${pctTxt(it.prob)}${sideText(c.lateralKm, c.radiusKm)}・${CB_DANGER_KM} km 以内に近づかない</text>`);
    }
  }

  // 揺れ（高さの情報はないので、図の下に帯で）
  const turb = items
    .filter((it) => it.turbulence)
    .map((it) => {
      const t = it.turbulence!;
      const a = sx(t.fromKm);
      const b = sx(t.toKm);
      let wave = `M${a},${Y_BASE + 26}`;
      for (let x = a; x < b; x += 8) wave += ` q2,-5 4,0 q2,5 4,0`;
      return `<g style="opacity:${op(it.prob)}"><path class="lp-turb" d="${wave}" /><text class="lp-t lp-turb-t" x="${a}" y="${Y_BASE + 40}">揺れ（強さ${t.intensity}） ${pctTxt(it.prob)}${sideText(t.lateralKm, t.halfWidthKm)}</text></g>`;
    })
    .join("");

  // 目盛り
  const altTicks: string[] = [];
  for (let a = 0; a <= maxAlt; a += 1000)
    altTicks.push(`<line class="lp-grid" x1="${X0}" x2="${X1}" y1="${sy(a)}" y2="${sy(a)}" /><text class="lp-t" x="${X0 - 4}" y="${sy(a) + 3}" text-anchor="end">${a === 0 ? "0" : `${a / 1000}千m`}</text>`);
  const kmStep = D > 150 ? 50 : 25;
  const kmTicks: string[] = [];
  for (let k = 0; k <= D; k += kmStep) kmTicks.push(`<text class="lp-t" x="${sx(k)}" y="${Y_BASE + 12}" text-anchor="middle">${k} km</text>`);
  if (D % kmStep) kmTicks.push(`<text class="lp-t" x="${sx(D)}" y="${Y_BASE + 12}" text-anchor="middle">${D} km</text>`);

  // 凍結高度
  const frz =
    f.freezingLevel < maxAlt
      ? `<line class="lp-frz" x1="${X0}" x2="${X1}" y1="${sy(f.freezingLevel)}" y2="${sy(f.freezingLevel)}" /><text class="lp-t lp-frz-t" x="${X1 - 4}" y="${sy(f.freezingLevel) - 3}" text-anchor="end">凍結高度 ${f.freezingLevel} m（雲の中で着氷）</text>`
      : "";

  // 高度別の風（右の欄）。左向きの矢印＝向かい風、右向き＝追い風
  const winds = [...f.winds]
    .sort((a, b) => a.altitude - b.altitude)
    .filter((w) => w.altitude <= maxAlt)
    .map((w) => {
      const alt = Math.max(w.altitude, leg.from.elevation);
      const hw = Math.round(headwindAt(f.winds, alt));
      const y = sy(alt);
      const len = Math.max(6, Math.min(34, Math.abs(hw) * 0.7));
      const cx = X1 + 40;
      const head = hw >= 0;
      const xA = head ? cx + len / 2 : cx - len / 2;
      const xB = head ? cx - len / 2 : cx + len / 2;
      return `<line class="lp-wind ${head ? "head" : "tail"}" x1="${xA}" y1="${y}" x2="${xB}" y2="${y}" marker-end="url(#lp-arrow-${head ? "head" : "tail"})" /><text class="lp-t lp-wind-t ${head ? "head" : "tail"}" x="${W - 2}" y="${y + 3}" text-anchor="end">${Math.abs(hw)}</text>`;
    })
    .join("");

  return `<svg class="lp-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${leg.from.name}から${leg.to.name}までの断面図">
    <defs>
      <pattern id="lp-rain-pat" width="6" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(12)"><line x1="3" y1="0" x2="3" y2="5" class="lp-rain-line" /></pattern>
      <marker id="lp-arrow-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 Z" class="lp-ah head" /></marker>
      <marker id="lp-arrow-tail" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 Z" class="lp-ah tail" /></marker>
    </defs>
    ${altTicks.join("")}
    ${frz}
    ${wx.join("")}
    <path class="lp-ground" d="${groundPath}" />
    ${sea}
    ${leg.terrain.map((r) => `<text class="lp-t lp-ridge-t" x="${sx((r.fromKm + r.toKm) / 2)}" y="${sy(r.height) - 4}" text-anchor="middle">${r.name} ${r.height} m</text>`).join("")}
    <path class="lp-path" d="${path}" />
    <text class="lp-t lp-path-t" x="${sx(climbKm) + 4}" y="${sy(cruise) - 4}">すすめの巡航高度 ${cruise} m</text>
    ${labels.join("")}
    <circle class="lp-field" cx="${sx(0)}" cy="${sy(leg.from.elevation)}" r="3.5" />
    <circle class="lp-field" cx="${sx(D)}" cy="${sy(leg.to.elevation)}" r="3.5" />
    <text class="lp-t lp-field-t" x="${sx(0) + 6}" y="${sy(leg.from.elevation) - 6}">${leg.from.name}</text>
    <text class="lp-t lp-field-t" x="${sx(D) - 6}" y="${sy(leg.to.elevation) - 6}" text-anchor="end">${leg.to.name}</text>
    ${kmTicks.join("")}
    ${turb}
    <text class="lp-t" x="${X1 + 40}" y="${Y_TOP - 9}" text-anchor="middle">風 km/h</text>
    ${winds}
  </svg>`;
}

function timeCard(i: LegProfileInput): string {
  if (!i.est) return "";
  const eta = i.nowMin + i.est.minutes;
  const limit = i.sunsetMin - SUNSET_MARGIN_MIN;
  const end = Math.max(i.sunsetMin, eta) + 20;
  const span = end - i.nowMin;
  const p = (t: number) => `${Math.max(0, Math.min(100, (100 * (t - i.nowMin)) / span)).toFixed(1)}%`;
  const ok = eta <= limit;
  return `<div class="lp-card">
    <div class="fd-head"><b>時間</b><span class="${ok ? "" : "ng-text"}">約${Math.round(i.est.minutes)}分・到着 ${eta < 24 * 60 ? fmtClock(eta) : "—"}</span></div>
    <div class="lp-bar">
      <i class="${ok ? "ok" : "ng"}" style="width:${p(eta)}"></i>
      <em class="limit" style="left:${p(limit)}"></em><em class="sunset" style="left:${p(i.sunsetMin)}"></em>
    </div>
    <div class="lp-scale"><span>いま ${fmtClock(i.nowMin)}</span><span>日没 ${fmtClock(i.sunsetMin)}</span></div>
    <p class="fd-note">黄の線は日没の${SUNSET_MARGIN_MIN}分前。そこまでに着きたい。${ok ? "" : "<b class=\"ng-text\">間に合わない</b>：泊まって朝に出るのも手。"}よける遠回りや待ち時間は入っていない。</p>
  </div>`;
}

function fuelCard(i: LegProfileInput): string {
  if (!i.est) return "";
  const need = i.est.fuelL;
  const p = (l: number) => `${Math.max(0, Math.min(100, (100 * l) / i.capacityL)).toFixed(1)}%`;
  const ok = i.fuelL >= need + RESERVE_FUEL_L;
  return `<div class="lp-card">
    <div class="fd-head"><b>燃料</b><span class="${ok ? "" : "ng-text"}">今 ${i.fuelL.toFixed(0)} L ${ok ? "○" : "足りないかも"}</span></div>
    <div class="lp-bar lp-fuel">
      <i class="have" style="width:${p(i.fuelL)}"></i>
      <span class="need" style="width:${p(need)}"></span><span class="res" style="left:${p(need)};width:${p(RESERVE_FUEL_L)}"></span>
    </div>
    <div class="lp-scale"><span>0</span><span>${i.capacityL} L</span></div>
    <p class="fd-note">白い枠がこの区間で使う目安（約${need.toFixed(0)} L）、赤い斜線が予備 ${RESERVE_FUEL_L} L。青い棒がそこまで届けば足りる。</p>
  </div>`;
}

function fogCard(i: LegProfileInput): string {
  const chance = fogChance(i.destSpread);
  const fill = Math.max(0, Math.min(1, 1 - i.destSpread / 8));
  return `<div class="lp-card">
    <div class="fd-head"><b>着く先の霧</b><span class="${chance > 0 ? "ng-text" : ""}">${Math.round(chance * 100)}%</span></div>
    <div class="lp-bar"><i class="${chance > 0 ? "ng" : "ok"}" style="width:${(fill * 100).toFixed(0)}%"></i></div>
    <div class="lp-scale"><span>出にくい</span><span>出やすい</span></div>
    <p class="fd-note">到着予定ごろの気温と露点の差 ${i.destSpread.toFixed(1)}℃。差が小さいほど霧が出る。${chance > 0 ? "霧なら上空で待つか、引き返す。" : ""}</p>
  </div>`;
}

export function legProfileHtml(i: LegProfileInput): string {
  return `<div class="leg-profile">
    <div class="lp-scroll">${profileSvg(i)}</div>
    <p class="fd-note">横から見た図（出発地 → 着く先）。破線がすすめの飛び方、雲や雨は濃いほど確率が高い。予報なので位置や高さは実際とずれることがある。右の欄の矢印は高度ごとの風（<span class="lp-key head">←向かい風</span>・<span class="lp-key tail">追い風→</span>）。</p>
    <div class="lp-cards">${timeCard(i)}${fuelCard(i)}${fogCard(i)}</div>
  </div>`;
}

