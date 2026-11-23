// ルートの帯：上は「上から見た地図」、下は「横から見た高度の断面」。
// 予報（点線・確率つき）と、目で見て確かめた実際の天気（塗り）を描き分ける。
import { CB_DANGER_KM, MAX_ALTITUDE } from "../config";
import { destination, distanceLeft, knownState, noReturnKm, terrainAt, type FlightState } from "../game/flight";
import type { Area, ForecastItem } from "../model/types";
import { itemArea } from "../model/weather";
import { tr } from "../i18n";

/** 上の「地図」が帯の高さに占める割合（残りが下の「断面」） */
const MAP_SHARE = 0.54;
const LAT_RANGE = 60; // 地図の上下 ±60 km
const PAD = 54;

const COLORS = {
  cloud: "rgba(200,205,215,",
  rain: "rgba(90,169,239,",
  turbulence: "rgba(232,197,71,",
  cb: "rgba(239,90,90,",
};
const KIND_TEXT = tr(
  { cloud: "雲", rain: "雨", turbulence: "乱気流", cb: "積乱雲" },
  { cloud: "Cloud", rain: "Rain", turbulence: "Turbulence", cb: "Thunderstorm" },
);

export class RouteBar {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }

  private fit() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (w === this.w && h === this.h) return;
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  /** 帯の高さに合わせて、地図と断面の高さを決める */
  private get mapH() {
    return Math.round(this.h * MAP_SHARE);
  }

  draw(s: FlightState) {
    this.fit();
    const MAP_H = this.mapH;
    const { ctx, w } = this;
    ctx.fillStyle = "#20252b";
    ctx.fillRect(0, 0, w, this.h);
    const D = s.leg.distanceKm;
    const x0 = PAD;
    const x1 = w - PAD;
    const xOf = (km: number) => x0 + ((x1 - x0) * km) / D;
    this.drawMap(s, xOf, x0, x1);
    this.drawProfile(s, xOf, x0, x1);
    // 区切り線
    ctx.strokeStyle = "#323840";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, MAP_H + 0.5);
    ctx.lineTo(w, MAP_H + 0.5);
    ctx.stroke();
    void D;
  }

  // ---- 上から見た地図 ----
  private drawMap(s: FlightState, xOf: (km: number) => number, x0: number, x1: number) {
    const { ctx } = this;
    const MAP_H = this.mapH;
    const cy = MAP_H / 2 + 4;
    const yOf = (lat: number) => cy + (lat / LAT_RANGE) * (MAP_H / 2 - 12);
    const kmPx = (x1 - x0) / s.leg.distanceKm;
    const latPx = (MAP_H / 2 - 12) / LAT_RANGE;

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, this.w, MAP_H);
    ctx.clip();

    // 海の上（降りられる場所がない）
    ctx.fillStyle = "rgba(60,120,170,0.22)";
    for (const r of s.leg.sea) ctx.fillRect(xOf(r.fromKm), 0, xOf(r.toKm) - xOf(r.fromKm), MAP_H);

    // 予報と実際の天気
    for (const item of s.forecast.items) this.drawItem(s, item, xOf, yOf, kmPx, latPx);

    // コース
    ctx.strokeStyle = "#59616c";
    ctx.lineWidth = 3;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(x0, cy);
    ctx.lineTo(x1, cy);
    ctx.stroke();

    // 燃料が尽きる地点
    const p = s.perf;
    if (s.status === "flying" && Number.isFinite(p.rangeKm)) {
      const reaches = p.rangeKm >= distanceLeft(s);
      const dir = s.returning ? -1 : 1;
      const end = Math.max(0, Math.min(s.leg.distanceKm, s.distanceFlown + dir * p.rangeKm));
      ctx.strokeStyle = reaches ? "rgba(76,195,138,0.8)" : "rgba(239,90,90,0.9)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(xOf(s.distanceFlown), cy);
      ctx.lineTo(xOf(end), cy);
      ctx.stroke();
      if (!reaches) {
        ctx.fillStyle = "#ef5a5a";
        ctx.font = "bold 10px sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(tr("燃料切れ", "Fuel out"), xOf(end), cy - 8);
      }
    }

    // 引き返し限界点（海の上の区間だけ）。ここを越えると、戻る燃料がない
    const pnr = s.leg.sea.length && s.status === "flying" ? noReturnKm(s) : null;
    if (pnr !== null && pnr < s.leg.distanceKm) {
      const x = xOf(pnr);
      ctx.strokeStyle = "rgba(239,90,90,0.9)";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, cy - 10);
      ctx.lineTo(x, cy + 10);
      ctx.stroke();
      ctx.fillStyle = "#ef5a5a";
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(s.pastNoReturn ? tr("限界点（越えた）", "No return (passed)") : tr("引き返し限界", "Point of no return"), x, cy - 13);
    }

    // 飛行場
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    for (const [km, name] of [[0, s.leg.from.name], [s.leg.distanceKm, s.leg.to.name]] as const) {
      ctx.fillStyle = "#ecebe6";
      ctx.beginPath();
      ctx.arc(xOf(km), cy, 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(name, xOf(km), MAP_H - 4);
    }

    // よける目標
    if (Math.abs(s.lateralTarget) > 0.5) {
      ctx.strokeStyle = "rgba(232,163,92,0.6)";
      ctx.setLineDash([3, 3]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(xOf(s.distanceFlown), yOf(s.lateralTarget));
      ctx.lineTo(xOf(s.distanceFlown) + (s.returning ? -60 : 60), yOf(s.lateralTarget));
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // 機体（進む向きの三角）
    const px = xOf(s.distanceFlown);
    const py = yOf(s.lateral);
    const dir = s.returning ? -1 : 1;
    ctx.fillStyle = "#e8a35c";
    ctx.beginPath();
    ctx.moveTo(px + 8 * dir, py);
    ctx.lineTo(px - 6 * dir, py - 6);
    ctx.lineTo(px - 6 * dir, py + 6);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = "#8d9096";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(tr("上から", "Top view"), 6, 12);
  }

  private drawItem(
    s: FlightState,
    item: ForecastItem,
    xOf: (km: number) => number,
    yOf: (lat: number) => number,
    kmPx: number,
    latPx: number,
  ) {
    const { ctx } = this;
    const state = knownState(s, item.id);
    if (state === false) return; // 近づいてみたら、なかった
    // 確かめたものは実際の位置で描く
    const actual =
      state === true
        ? (s.weather.cb.find((c) => c.id === item.id) ??
          s.weather.clouds.find((c) => c.id === item.id) ??
          s.weather.rain.find((c) => c.id === item.id) ??
          s.weather.turbulence.find((c) => c.id === item.id))
        : undefined;
    const solid = state === true;
    const color = COLORS[item.kind];
    ctx.setLineDash(solid ? [] : [4, 3]);
    ctx.lineWidth = 1.5;

    if (item.kind === "cb") {
      const cb = (actual as typeof item.cb) ?? item.cb!;
      const x = xOf(cb.alongKm);
      const y = yOf(cb.lateralKm);
      // 危険な範囲（37 km）
      ctx.strokeStyle = color + (solid ? "0.8)" : "0.5)");
      ctx.fillStyle = color + (solid ? "0.12)" : "0.05)");
      ctx.beginPath();
      ctx.ellipse(x, y, (cb.radiusKm + CB_DANGER_KM) * kmPx, (cb.radiusKm + CB_DANGER_KM) * latPx, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color + (solid ? "0.9)" : "0.5)");
      ctx.beginPath();
      ctx.ellipse(x, y, Math.max(3, cb.radiusKm * kmPx), Math.max(3, cb.radiusKm * latPx), 0, 0, Math.PI * 2);
      ctx.fill();
      this.label(item, solid, x, y - 6);
    } else {
      const a: Area = (actual as Area) ?? itemArea(item);
      const x = xOf(a.fromKm);
      const y = yOf(a.lateralKm - a.halfWidthKm);
      const ww = (a.toKm - a.fromKm) * kmPx;
      const hh = a.halfWidthKm * 2 * latPx;
      ctx.strokeStyle = color + (solid ? "0.8)" : "0.55)");
      ctx.fillStyle = color + (solid ? (item.kind === "turbulence" ? "0.12)" : "0.28)") : "0.07)");
      ctx.fillRect(x, y, ww, hh);
      ctx.strokeRect(x, y, ww, hh);
      // 雨雲は雨の範囲も描く
      if (item.kind === "rain" && item.cloud) {
        const c = (solid && s.weather.clouds.find((x) => x.id === item.id)) || item.cloud;
        ctx.strokeStyle = COLORS.cloud + "0.4)";
        ctx.strokeRect(xOf(c.fromKm), yOf(c.lateralKm - c.halfWidthKm), (c.toKm - c.fromKm) * kmPx, c.halfWidthKm * 2 * latPx);
      }
      this.label(item, solid, x + ww / 2, y + 10);
    }
    ctx.setLineDash([]);
  }

  private label(item: ForecastItem, solid: boolean, x: number, y: number) {
    const { ctx } = this;
    ctx.fillStyle = "#ecebe6";
    ctx.font = `${solid ? "bold " : ""}10px sans-serif`;
    ctx.textAlign = "center";
    ctx.fillText(solid ? KIND_TEXT[item.kind] : `${KIND_TEXT[item.kind]} ${Math.round(item.prob * 100)}%`, x, y);
  }

  // ---- 横から見た高度の断面（今のコースのずれの線に沿って） ----
  private drawProfile(s: FlightState, xOf: (km: number) => number, x0: number, x1: number) {
    const { ctx } = this;
    const top = this.mapH + 6;
    const bottom = this.h - 6;
    const yOf = (alt: number) => bottom - (Math.min(MAX_ALTITUDE, alt) / MAX_ALTITUDE) * (bottom - top);
    const lat = s.lateralTarget;

    // 雲（予報か実際）
    for (const item of s.forecast.items) {
      const state = knownState(s, item.id);
      if (state === false || !item.cloud) continue;
      const c = (state === true && s.weather.clouds.find((x) => x.id === item.id)) || item.cloud;
      if (Math.abs(lat - c.lateralKm) > c.halfWidthKm) continue;
      ctx.fillStyle = state === true ? "rgba(200,205,215,0.55)" : "rgba(200,205,215,0.15)";
      ctx.strokeStyle = "rgba(200,205,215,0.6)";
      ctx.setLineDash(state === true ? [] : [4, 3]);
      ctx.fillRect(xOf(c.fromKm), yOf(c.top), xOf(c.toKm) - xOf(c.fromKm), yOf(c.base) - yOf(c.top));
      ctx.strokeRect(xOf(c.fromKm), yOf(c.top), xOf(c.toKm) - xOf(c.fromKm), yOf(c.base) - yOf(c.top));
      ctx.setLineDash([]);
    }

    // 凍結高度
    const fz = yOf(s.forecast.freezingLevel);
    if (s.forecast.freezingLevel < MAX_ALTITUDE) {
      ctx.strokeStyle = "rgba(90,169,239,0.8)";
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(x0, fz);
      ctx.lineTo(x1, fz);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#5aa9ef";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "right";
      ctx.fillText(`${tr("凍結", "Freezing")} ${s.forecast.freezingLevel}m`, x1 + PAD - 4, fz + 3);
    }

    // 地形（海の上は青い帯）
    ctx.fillStyle = "#3d5a3a";
    ctx.beginPath();
    ctx.moveTo(x0, bottom);
    for (let km = 0; km <= s.leg.distanceKm; km += 2) ctx.lineTo(xOf(km), yOf(terrainAt(s.leg, km)));
    ctx.lineTo(x1, bottom);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#3c78aa";
    for (const r of s.leg.sea) ctx.fillRect(xOf(r.fromKm), bottom - 4, xOf(r.toKm) - xOf(r.fromKm), 4);

    // 目標高度と機体
    ctx.strokeStyle = "rgba(232,163,92,0.5)";
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    const ty = yOf(s.approach ? destination(s).elevation : s.controls.targetAltitude);
    ctx.moveTo(xOf(s.distanceFlown), ty);
    ctx.lineTo(xOf(s.distanceFlown) + (s.returning ? -80 : 80), ty);
    ctx.stroke();
    ctx.setLineDash([]);
    const px = xOf(s.distanceFlown);
    const py = yOf(s.altitude);
    const dir = s.returning ? -1 : 1;
    ctx.fillStyle = "#e8a35c";
    ctx.beginPath();
    ctx.moveTo(px + 8 * dir, py);
    ctx.lineTo(px - 6 * dir, py - 5);
    ctx.lineTo(px - 6 * dir, py + 5);
    ctx.closePath();
    ctx.fill();

    // 目盛り
    ctx.fillStyle = "#8d9096";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(tr("横から", "Side view"), 6, bottom);
    ctx.textAlign = "right";
    // 帯が低くて目盛りの文字が重なるときは、2km だけ書く
    const roomy = yOf(1000) - yOf(2000) >= 13;
    for (const alt of roomy ? [1000, 2000, 3000] : [2000]) ctx.fillText(`${alt / 1000}km`, x0 - 6, yOf(alt) + 3);
  }
}
