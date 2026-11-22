// D. 天気の計算（4.9・4.10）。状態を持たない純粋な関数だけを置く。
import { CARB_ICE_SCALE, CB_DANGER_KM } from "../config";
import { createRng } from "./physics";
import type {
  Area,
  Forecast,
  ForecastItem,
  LegWeather,
  Period,
  WeatherTemplate,
  Waypoint,
  WindLayer,
} from "./types";

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

export const periodOf = (clockMin: number): Period => (clockMin < 12 * 60 ? "morning" : "afternoon");

// ---- 場所 ----
export function inArea(a: Area, along: number, lateral: number) {
  return along >= a.fromKm && along <= a.toKm && Math.abs(lateral - a.lateralKm) <= a.halfWidthKm;
}

/** 範囲までの距離（中なら0） */
export function distanceToArea(a: Area, along: number, lateral: number) {
  const dx = along < a.fromKm ? a.fromKm - along : along > a.toKm ? along - a.toKm : 0;
  const dy = Math.max(0, Math.abs(lateral - a.lateralKm) - a.halfWidthKm);
  return Math.hypot(dx, dy);
}

// ---- 風（高度ごと） ----
/** その高度での向かい風成分（km/h）。追い風ならマイナス */
export function headwindAt(winds: WindLayer[], altitude: number): number {
  const comp = (w: WindLayer) => w.speed * Math.cos((w.direction * Math.PI) / 180);
  if (!winds.length) return 0;
  const sorted = [...winds].sort((a, b) => a.altitude - b.altitude);
  if (altitude <= sorted[0].altitude) return comp(sorted[0]);
  for (let i = 1; i < sorted.length; i++) {
    if (altitude <= sorted[i].altitude) {
      const a = sorted[i - 1];
      const b = sorted[i];
      const t = (altitude - a.altitude) / (b.altitude - a.altitude);
      return comp(a) + (comp(b) - comp(a)) * t;
    }
  }
  return comp(sorted[sorted.length - 1]);
}

// ---- 雲・雨・乱気流・積乱雲 ----
export function cloudAt(w: LegWeather, along: number, lateral: number, altitude: number) {
  return w.clouds.some((c) => inArea(c, along, lateral) && altitude >= c.base && altitude <= c.top);
}

/** 頭の上に雲がある（どんより暗い） */
export function overcastAt(w: LegWeather, along: number, lateral: number, altitude: number) {
  return w.clouds.some((c) => inArea(c, along, lateral) && altitude < c.base);
}

export function cbDistance(w: LegWeather, along: number, lateral: number) {
  let d = Infinity;
  for (const c of w.cb) d = Math.min(d, Math.max(0, Math.hypot(along - c.alongKm, lateral - c.lateralKm) - c.radiusKm));
  return d;
}

/** 雨の強さ 0..3。積乱雲の近くは強い雨 */
export function rainAt(w: LegWeather, along: number, lateral: number): number {
  let r = 0;
  for (const a of w.rain) if (inArea(a, along, lateral)) r = Math.max(r, a.intensity);
  const d = cbDistance(w, along, lateral);
  if (d < 8) r = 3;
  else if (d < 18) r = Math.max(r, 2);
  return r;
}

/** 乱気流の強さ 0..3。積乱雲の近くは強い */
export function turbulenceAt(w: LegWeather, along: number, lateral: number): number {
  let t = 0;
  for (const a of w.turbulence) if (inArea(a, along, lateral)) t = Math.max(t, a.intensity);
  const d = cbDistance(w, along, lateral);
  if (d < 15) t = 3;
  else if (d < 25) t = Math.max(t, 2);
  return t;
}

/** 積乱雲に近いとき機体が傷む量（1分あたり）。4.10 */
export const cbDamagePerMin = (distanceKm: number) =>
  distanceKm < CB_DANGER_KM ? (CB_DANGER_KM - distanceKm) * 0.12 : 0;

/** 乱気流の中で Va を超えているとき機体が傷む量（1分あたり） */
export const turbulenceDamagePerMin = (turbulence: number, airspeed: number, va: number) =>
  turbulence > 0 && airspeed > va ? turbulence * (airspeed - va) * 0.03 : 0;

// ---- 気温・露点・霧 ----
/** 時刻ごとの地上の気温。14時がいちばん高く、夜中は5℃低い */
export function surfaceTemp(w: Pick<Waypoint, "temperature">, clockMin: number) {
  const phase = (2 * Math.PI * (clockMin - 14 * 60)) / (24 * 60);
  return w.temperature - (5 * (1 - Math.cos(phase))) / 2;
}

export const spreadAt = (w: Pick<Waypoint, "temperature" | "dewPoint">, clockMin: number) =>
  surfaceTemp(w, clockMin) - w.dewPoint;

/** 気温と露点の差から霧の出やすさ（4.10：差が2以下なら6割） */
export function fogChance(spread: number) {
  if (spread <= 2) return 0.6;
  if (spread <= 3) return 0.3;
  return 0;
}

/** その飛行場に、その時刻に霧が出ているか。roll はその日ごとの 0..1 の乱数 */
export const foggedAt = (w: Waypoint, clockMin: number, roll: number) => roll < fogChance(spreadAt(w, clockMin));

/** 上空の気温と露点（地上から 100m ごとに 0.65℃ と 0.2℃ 下がる） */
export function airAt(groundTemp: number, groundDew: number, heightAboveGround: number) {
  const h = Math.max(0, heightAboveGround) / 1000;
  const temp = groundTemp - 6.5 * h;
  const dew = Math.min(temp, groundDew - 2 * h);
  return { temp, dew, spread: temp - dew };
}

// ---- 4.9 キャブレターの凍結 ----
/** 1時間あたりの凍結の進み（マイナスなら溶ける） */
export function carbIceRate(temp: number, spread: number, throttle: number, carbHeat: boolean) {
  if (carbHeat) return -30;
  if (temp >= -5 && temp <= 25 && spread <= 5) {
    const lowPowerBonus = throttle < 0.6 ? 1.5 : 1.0;
    return (6 - spread) * 2 * lowPowerBonus * CARB_ICE_SCALE;
  }
  return -5; // 条件から外れれば少しずつ溶ける
}

/** キャブレター凍結とキャブヒートによる出力の係数 */
export const carbPowerFactor = (carbIce: number, carbHeat: boolean) => (1 - carbIce / 200) * (carbHeat ? 0.95 : 1);

// ---- 4.10 着氷 ----
/** プロペラの着氷の進み（1時間あたり）。凍結高度より上で雲か雨に入ると付く */
export function propIceRate(altitude: number, freezingLevel: number, inCloud: boolean, rain: number) {
  if (altitude > freezingLevel && (inCloud || rain > 0)) return (inCloud ? 25 : 12) * (1 + rain * 0.5);
  if (altitude < freezingLevel) return -40;
  return 0;
}

// ---- 実際の天気と予報を作る ----
/**
 * ひな形から、その日・その時間帯の実際の天気と予報を作る。
 * 予報は「起きる確率」と「予想の位置」。実際に起きるかどうかは乱数で決まり、位置や高さも少しずれる。
 */
export function generateWeather(
  t: WeatherTemplate,
  seed: number,
  period: Period,
  /** 予報の外れ方の倍率（難易度。1 がふつう） */
  uncertainty = 1,
): { actual: LegWeather; forecast: Forecast } {
  const rng = createRng(seed);
  const u = uncertainty;
  const jit = (n: number) => (rng() * 2 - 1) * n;
  const windJitter = () => Math.round(jit(5));
  const winds = t.winds.map((w) => ({ ...w, speed: Math.max(0, w.speed + windJitter()) }));
  const freezingLevel = t.freezingLevel + Math.round((jit(150) * u) / 50) * 50;

  const actual: LegWeather = { winds, freezingLevel, clouds: [], rain: [], turbulence: [], cb: [] };
  const items: ForecastItem[] = [];

  for (const f of t.features) {
    const p = f.prob[period];
    const happens = rng() < p;
    // 実際の位置は、ひな形から少しずれる
    const dAlong = Math.round(jit(12 * u));
    const dLat = Math.round(jit(6 * u));
    const dBase = Math.round(jit(200 * u) / 50) * 50;
    // 外れやすい予報（リアル）では、出てくる確率そのものもあてにならない
    const noise = u > 1 ? jit(0.25 * (u - 1)) : 0;
    const shown = p > 0 && p < 1 ? Math.min(0.95, Math.max(0.05, Math.round((p + noise) * 20) / 20)) : p;
    const shift = <A extends { fromKm: number; toKm: number; lateralKm: number }>(a: A): A => ({
      ...a,
      fromKm: a.fromKm + dAlong,
      toKm: a.toKm + dAlong,
      lateralKm: a.lateralKm + dLat,
    });
    items.push({ id: f.id, kind: f.kind, prob: shown, cloud: f.cloud, rain: f.rain, turbulence: f.turbulence, cb: f.cb });
    if (!happens) continue;
    if (f.cloud) actual.clouds.push({ ...shift(f.cloud), base: f.cloud.base + dBase, top: f.cloud.top + dBase, id: f.id });
    if (f.rain) actual.rain.push({ ...shift(f.rain), id: f.id });
    if (f.turbulence) actual.turbulence.push({ ...shift(f.turbulence), id: f.id });
    if (f.cb) actual.cb.push({ ...f.cb, alongKm: f.cb.alongKm + dAlong, lateralKm: f.cb.lateralKm + dLat * 2, id: f.id });
  }

  return {
    actual,
    forecast: { period, winds: t.winds, freezingLevel: t.freezingLevel, items },
  };
}

/** 実際の天気そのものを予報にする（気象ラジオで更新したとき） */
export function forecastFromActual(w: LegWeather, period: Period): Forecast {
  const items: ForecastItem[] = [
    ...w.clouds.map((c) => ({ id: c.id, kind: "cloud" as const, prob: 1, cloud: c })),
    ...w.rain.map((r) => ({ id: r.id, kind: "rain" as const, prob: 1, rain: r })),
    ...w.turbulence.map((r) => ({ id: r.id, kind: "turbulence" as const, prob: 1, turbulence: r })),
    ...w.cb.map((c) => ({ id: c.id, kind: "cb" as const, prob: 1, cb: c })),
  ];
  return { period, winds: w.winds, freezingLevel: w.freezingLevel, items };
}

/** 予報の項目がいる範囲（積乱雲は危険な距離まで含める） */
export function itemArea(i: ForecastItem): Area {
  if (i.cb) {
    const r = i.cb.radiusKm + CB_DANGER_KM;
    return { fromKm: i.cb.alongKm - r, toKm: i.cb.alongKm + r, lateralKm: i.cb.lateralKm, halfWidthKm: r };
  }
  return (i.cloud ?? i.rain ?? i.turbulence)!;
}

export const clampLateral = (x: number, max: number) => clamp(x, -max, max);
