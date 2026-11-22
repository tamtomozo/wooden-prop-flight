// 1区間の飛行シミュレーション。描画とは切り離してあり、テストから直接動かせる。
// 離陸 → 上昇 → 巡航（高度は操縦者が選ぶ）→ 降下 → 着陸。天気・左右へのよけ・引き返し・霧での待機を含む。
import {
  BOLT_DANGER,
  CB_DANGER_KM,
  DESCENT_RATE,
  DESCENT_SPEED_BONUS,
  DETOUR_ANGLE,
  DISORIENT_LIMIT_MIN,
  EMPTY_WEIGHT,
  FATIGUE_PER_FLIGHT_HOUR,
  HASTE_RELIEF,
  MAX_ALTITUDE,
  MAX_LATERAL_KM,
  SUNSET_MARGIN_MIN,
  RADIO_COOLDOWN_MIN,
  RESERVE_FUEL_L,
  SIGHT_KM,
  SIM_SUBSTEP_MIN,
  THROTTLE_MIN,
  VA_KMH,
  VIBRATION_RED,
} from "../config";
import { DIFFICULTY } from "../data/difficulty";
import { equipmentKg } from "../data/equipment";
import { seaAt } from "../data/world";
import {
  boltLossPerHour,
  computePerformance,
  EDGE_PROTECTION,
  mixturePoints,
  propOffChancePerHour,
  rainErosionPerHour,
  totalWeight,
  vibrationOf,
  vibrationWearPerMin,
  type MixtureZone,
  type Performance,
  type Phase,
} from "../model/physics";
import { hasteAfter, isHasty, reactionDelayMin } from "../model/pilot";
import type { AircraftCondition, Controls, Difficulty, Forecast, Leg, LegWeather, Pilot, Setup, Waypoint } from "../model/types";
import {
  airAt,
  carbIceRate,
  carbPowerFactor,
  cbDamagePerMin,
  cbDistance,
  clampLateral,
  cloudAt,
  distanceToArea,
  foggedAt,
  forecastFromActual,
  headwindAt,
  itemArea,
  overcastAt,
  periodOf,
  propIceRate,
  rainAt,
  surfaceTemp,
  turbulenceAt,
  turbulenceDamagePerMin,
} from "../model/weather";

export type FlightStatus =
  | "flying"
  | "arrived"
  | "returned"
  | "fuelOut"
  | "engineStopped"
  | "sunset"
  | "propFailure"
  | "lostControl"
  | "airframe"
  | "terrain";
export type PropFailure = "propOff" | "propBroken";

export interface FlightStats {
  zoneMinutes: Record<MixtureZone, number>;
  throttleMinutes: number; // スロットル×分 の積算（平均を出す用）
  maxRpm: number;
  overspeedMinutes: number;
  maxVibration: number;
  /** 雨の中を飛んだ時間と、そのときの回転数の積算・前縁の削れ */
  rainMinutes: number;
  rainRpmMinutes: number;
  rainEdgeLoss: number;
  cloudMinutes: number;
  holdMinutes: number;
  airframeLoss: number;
  /** 危ない飛び方（評価で使う） */
  cbMinutes: number;
  overVaMinutes: number;
  /** 焦りが高かった時間（整備士のひとことが甘くなっていた）・ひどく疲れていた時間 */
  hastyMinutes: number;
  tiredMinutes: number;
  /** 実際に飛んだ道のり km（よけた分・引き返した分を含む） */
  pathKm: number;
}

/** 今いる場所の天気（画面に見せる用） */
export interface Environment {
  inCloud: boolean;
  overcast: boolean;
  rain: number;
  turbulence: number;
  cbDistance: number;
  headwind: number;
  temp: number;
  spread: number;
  aboveFreezing: boolean;
  terrain: number;
}

export interface FlightState {
  leg: Leg;
  setup: Setup;
  /** 出発時刻（その日の0時からの分） */
  departureMin: number;
  sunsetMin: number;
  controls: Controls;
  condition: AircraftCondition;
  altitude: number;
  phase: Phase;
  elapsedMin: number;
  /** 出発地からコースに沿って進んだ距離 */
  distanceFlown: number;
  /** コースから右へのずれ km（左はマイナス） */
  lateral: number;
  lateralTarget: number;
  /** 目的地が近くてコースに戻っている */
  courseLocked: boolean;
  /** 引き返している（出発地へ向かっている） */
  returning: boolean;
  /** 着陸のための降下に入った */
  approach: boolean;
  /** 霧で降りられず、上空で待っている */
  holding: boolean;
  /** 雲の中にいた時間（方向感覚の狂い）。DISORIENT_LIMIT_MIN で操縦不能 */
  disorientation: number;
  fuelUsed: number;
  status: FlightStatus;
  failure: PropFailure | null;
  perf: Performance;
  env: Environment;
  stats: FlightStats;
  weather: LegWeather;
  /** 今わかっている予報（気象ラジオで更新できる） */
  forecast: Forecast;
  /** 目で見て、または気象ラジオで確かめた予報項目（true＝実際にある、false＝なかった） */
  known: Record<string, boolean>;
  radio: boolean;
  radioReadyAt: number;
  /** 目的地と出発地の霧の乱数（その日ごと） */
  fogRoll: { to: number; from: number };
  /** 画面に知らせたい出来事（UIが取り出して消す） */
  alerts: { text: string; urgent: boolean }[];
  /** E. 操縦者 */
  pilot: Pilot;
  /** 疲れていて、まだ効いていない操作 */
  pending: { at: number; controls?: Partial<Controls>; lateral?: number }[];
  /** 7章 難易度 */
  difficulty: Difficulty;
  /** 雲の中で気づかないうちに入っている旋回降下の強さ 0..1（4.10・付録C） */
  spiral: number;
  /** 海の上で、引き返し限界点を越えた（戻るだけの燃料がもうない） */
  pastNoReturn: boolean;
  rng: () => number;
}

export interface FlightInit {
  leg: Leg;
  setup: Setup;
  condition: AircraftCondition;
  departureMin: number;
  sunsetMin: number;
  controls: Controls;
  weather: LegWeather;
  forecast: Forecast;
  fogRoll?: { to: number; from: number };
  pilot?: Pilot;
  difficulty?: Difficulty;
  rng: () => number;
}

const weightRatio = (s: Pick<FlightState, "setup" | "condition">) =>
  totalWeight(s.condition.fuelRemaining, equipmentKg(s.setup.equipment)) / EMPTY_WEIGHT;

/** 向かっている飛行場 */
export const destination = (s: FlightState): Waypoint => (s.returning ? s.leg.from : s.leg.to);
export const clockMin = (s: FlightState) => s.departureMin + s.elapsedMin;
/** 向かっている飛行場まで（コースに沿った距離） */
export const distanceLeft = (s: FlightState) =>
  s.returning ? Math.max(0, s.distanceFlown) : Math.max(0, s.leg.distanceKm - s.distanceFlown);
export const progress = (s: FlightState) => Math.min(1, Math.max(0, s.distanceFlown / s.leg.distanceKm));

/** コース上のある地点の地面の標高（尾根を含む）。海の上は 0 m */
export function terrainAt(leg: Leg, alongKm: number) {
  if (seaAt(leg, alongKm)) return 0;
  const t = Math.min(1, Math.max(0, alongKm / leg.distanceKm));
  let h = leg.from.elevation + (leg.to.elevation - leg.from.elevation) * t;
  for (const r of leg.terrain) {
    if (alongKm > r.fromKm && alongKm < r.toKm) {
      const u = (alongKm - r.fromKm) / (r.toKm - r.fromKm);
      h = Math.max(h, h + (r.height - h) * Math.sin(Math.PI * u));
    }
  }
  return h;
}
export const groundElevation = (s: FlightState) => terrainAt(s.leg, s.distanceFlown);
/** 今、海の上を飛んでいる（降りられる場所がない） */
export const overSea = (s: Pick<FlightState, "leg" | "distanceFlown">) => seaAt(s.leg, s.distanceFlown);

/**
 * 今すぐ引き返したら、出発地に戻るのに要る燃料の見積もり（L）。
 * 今の対気速度と燃料流量のまま、今の高さの風を背に受けて戻ったとして計算する。
 */
export function returnFuelNeeded(s: FlightState): number {
  const back = s.returning ? distanceLeft(s) : s.distanceFlown;
  const gs = Math.max(30, s.perf.airspeed + (s.returning ? -s.env.headwind : s.env.headwind));
  return (back / gs) * s.perf.fuelBurn;
}

/**
 * 引き返し限界点（出発地からの距離 km）。今の速さと燃料流量のまま進んだとき、
 * そこで引き返せば予備燃料を残して出発地に戻れる、いちばん遠い地点。引き返している最中は null。
 */
export function noReturnKm(s: FlightState): number | null {
  if (s.returning) return null;
  const burn = s.perf.fuelBurn;
  const go = s.perf.groundSpeed;
  const back = s.perf.airspeed + s.env.headwind;
  if (burn <= 0 || go <= 0 || back <= 0) return null;
  const spare = (s.condition.fuelRemaining - RESERVE_FUEL_L) / burn; // 時間
  return Math.max(0, (spare + s.distanceFlown / go) / (1 / go + 1 / back));
}

/** 戻るだけの燃料がある（予備燃料を残して） */
export const canReturn = (s: FlightState) => s.condition.fuelRemaining - RESERVE_FUEL_L >= returnFuelNeeded(s);
/** 今の高さでの外の気温と露点 */
function airHere(s: FlightState) {
  const p = progress(s);
  const clock = clockMin(s);
  const gTemp = surfaceTemp(s.leg.from, clock) * (1 - p) + surfaceTemp(s.leg.to, clock) * p;
  const gDew = s.leg.from.dewPoint * (1 - p) + s.leg.to.dewPoint * p;
  const ground = s.leg.from.elevation * (1 - p) + s.leg.to.elevation * p;
  return airAt(gTemp, gDew, s.altitude - ground);
}

/** 雲の外の空気の、気温と露点の差の下限（℃） */
const CLEAR_AIR_MIN_SPREAD = 4;

function environmentOf(s: FlightState): Environment {
  const w = s.weather;
  const air = airHere(s);
  const hw = headwindAt(w.winds, s.altitude);
  const inCloud = cloudAt(w, s.distanceFlown, s.lateral, s.altitude);
  // 雲の中は湿りきっている（差 0）。地面から離れた雲のない空気は、そこまで湿っていない（差 4℃ 以上）
  const agl = s.altitude - groundElevation(s);
  const spread = inCloud ? 0 : agl > 300 ? Math.max(CLEAR_AIR_MIN_SPREAD, air.spread) : air.spread;
  return {
    inCloud,
    overcast: overcastAt(w, s.distanceFlown, s.lateral, s.altitude),
    rain: rainAt(w, s.distanceFlown, s.lateral),
    turbulence: turbulenceAt(w, s.distanceFlown, s.lateral),
    cbDistance: cbDistance(w, s.distanceFlown, s.lateral),
    headwind: s.returning ? -hw : hw,
    temp: air.temp,
    spread,
    aboveFreezing: s.altitude > w.freezingLevel,
    terrain: groundElevation(s),
  };
}

/** 目標の高さ（着陸の降下に入ったら目的地の標高） */
const targetAltitude = (s: FlightState) => (s.approach ? destination(s).elevation : s.controls.targetAltitude);

function phaseOf(s: FlightState): Phase {
  const t = targetAltitude(s);
  if (s.altitude < t - 1) return "climb";
  if (s.altitude > t + 1) return "descent";
  return "cruise";
}

function performanceOf(s: FlightState, env: Environment) {
  const { controls: c, condition: a } = s;
  return computePerformance({
    pitch: s.setup.pitch,
    throttle: c.throttle,
    mixture: c.mixture,
    altitude: s.altitude,
    propEdge: a.propEdge,
    engineHealth: a.engineHealth,
    carbIcePenalty: carbPowerFactor(a.carbIce, c.carbHeat),
    headwindKmh: env.headwind,
    fuelRemaining: a.fuelRemaining,
    phase: s.phase,
    weightRatio: weightRatio(s),
    propIce: a.propIce,
    extraSpeed: s.spiral * SPIRAL_MAX_EXTRA_SPEED,
  });
}

function refresh(s: FlightState) {
  s.env = environmentOf(s);
  s.spiral = spiralOf(s);
  // 旋回降下に入っているあいだ、本人は水平に飛んでいるつもり（速度は extraSpeed でじわじわ上がる）
  s.phase = s.spiral > 0 ? "cruise" : phaseOf(s);
  s.perf = performanceOf(s, s.env);
}

// ---- 空間識失調：雲の中に長くいると、気づかないうちに旋回降下に入る（付録C） ----
/** 旋回降下で増える速度の最大 km/h と、高度が下がる速さの最大 m/分 */
const SPIRAL_MAX_EXTRA_SPEED = 45;
const SPIRAL_MAX_SINK = 300;
/** 方向感覚の狂いがこの割合を超えると旋回降下が始まる */
const SPIRAL_START = 0.35;

function spiralOf(s: FlightState) {
  if (!s.env?.inCloud) return 0;
  const d = s.disorientation / DISORIENT_LIMIT_MIN;
  return d <= SPIRAL_START ? 0 : Math.min(1, (d - SPIRAL_START) / (1 - SPIRAL_START));
}

// ---- 難易度「かんたん」：混合比とキャブヒートは自動（7章） ----
function autoControls(s: FlightState) {
  const rule = DIFFICULTY[s.difficulty];
  if (rule.autoMixture) {
    const m = Math.round(mixturePoints(s.altitude).bestEconomy);
    if (s.controls.mixture !== m) s.controls.mixture = m;
  }
  if (rule.autoCarbHeat) {
    const a = s.condition;
    if (!s.controls.carbHeat && a.carbIce > 3) s.controls.carbHeat = true;
    else if (s.controls.carbHeat && a.carbIce < 0.5) s.controls.carbHeat = false;
  }
}

export function createFlight(init: FlightInit): FlightState {
  const s = {
    ...init,
    controls: { ...init.controls, targetAltitude: init.leg.cruiseAltitude },
    condition: { ...init.condition },
    altitude: init.leg.from.elevation,
    phase: "climb" as Phase,
    elapsedMin: 0,
    distanceFlown: 0,
    lateral: 0,
    lateralTarget: 0,
    courseLocked: false,
    returning: false,
    approach: false,
    holding: false,
    disorientation: 0,
    fuelUsed: 0,
    status: "flying" as FlightStatus,
    failure: null,
    known: {},
    radio: init.setup.equipment.weatherRadio,
    radioReadyAt: 0,
    fogRoll: init.fogRoll ?? { to: 1, from: 1 },
    alerts: [],
    pilot: { ...(init.pilot ?? { fatigue: 0, haste: 0 }) },
    pending: [],
    difficulty: init.difficulty ?? "normal",
    spiral: 0,
    pastNoReturn: false,
    stats: {
      zoneMinutes: { rich: 0, power: 0, economy: 0, tooLean: 0 },
      throttleMinutes: 0,
      maxRpm: 0,
      overspeedMinutes: 0,
      maxVibration: 0,
      rainMinutes: 0,
      rainRpmMinutes: 0,
      rainEdgeLoss: 0,
      cloudMinutes: 0,
      holdMinutes: 0,
      airframeLoss: 0,
      cbMinutes: 0,
      overVaMinutes: 0,
      hastyMinutes: 0,
      tiredMinutes: 0,
      pathKm: 0,
    },
  } as unknown as FlightState;
  refresh(s);
  return s;
}

// ---- 操作 ----
export function setControls(s: FlightState, c: Partial<Controls>): void {
  if (c.throttle !== undefined) s.controls.throttle = Math.min(1, Math.max(THROTTLE_MIN, c.throttle));
  if (c.mixture !== undefined) s.controls.mixture = Math.min(100, Math.max(0, c.mixture));
  if (c.carbHeat !== undefined) s.controls.carbHeat = c.carbHeat;
  if (c.targetAltitude !== undefined)
    s.controls.targetAltitude = Math.min(MAX_ALTITUDE, Math.max(300, Math.round(c.targetAltitude / 100) * 100));
  refresh(s);
}

/** 旅の始まりからの分 */
/** このままだと、日没の少し前（SUNSET_MARGIN_MIN）までに着けそうにない。焦りの元 */
export function rushed(s: FlightState) {
  const gs = s.perf.groundSpeed;
  const eta = gs > 0 ? clockMin(s) + (distanceLeft(s) / gs) * 60 : Infinity;
  return eta > s.sunsetMin - SUNSET_MARGIN_MIN;
}

/**
 * 操縦者が操作する。疲れていると、効き始めるまでに時間がかかる（E1：操作の反応が遅れる）。
 * テストや自動操縦は setControls で直接操作する。
 */
export function requestControls(s: FlightState, c: Partial<Controls>): void {
  const delay = reactionDelayMin(s.pilot.fatigue);
  if (delay <= 0) setControls(s, c);
  else s.pending.push({ at: s.elapsedMin + delay, controls: c });
}

export function requestLateral(s: FlightState, km: number): void {
  const delay = reactionDelayMin(s.pilot.fatigue);
  if (delay <= 0) setLateralTarget(s, km);
  else s.pending.push({ at: s.elapsedMin + delay, lateral: km });
}

/** まだ効いていない操作を足し合わせた「操縦者がしたつもりの操作」 */
export function intendedControls(s: FlightState): Controls {
  return Object.assign({ ...s.controls }, ...s.pending.map((p) => p.controls ?? {}));
}
export function intendedLateral(s: FlightState): number {
  const last = [...s.pending].reverse().find((p) => p.lateral !== undefined);
  return last?.lateral ?? s.lateralTarget;
}

function applyPending(s: FlightState) {
  if (!s.pending.length) return;
  const due = s.pending.filter((p) => p.at <= s.elapsedMin);
  if (!due.length) return;
  s.pending = s.pending.filter((p) => p.at > s.elapsedMin);
  for (const p of due) {
    if (p.controls) setControls(s, p.controls);
    if (p.lateral !== undefined) setLateralTarget(s, p.lateral);
  }
}

/** 左右によける（コースからのずれの目標） */
export function setLateralTarget(s: FlightState, km: number): void {
  if (s.courseLocked || s.holding) return;
  s.lateralTarget = clampLateral(Math.round(km / 10) * 10, MAX_LATERAL_KM);
}

/** 引き返す。出発地へ向かう */
export function turnBack(s: FlightState): boolean {
  if (s.returning || s.status !== "flying") return false;
  s.returning = true;
  s.approach = false;
  s.holding = false;
  s.courseLocked = false;
  s.lateralTarget = 0;
  s.pending = s.pending.filter((p) => p.lateral === undefined);
  // 勇気ある撤退：焦りが下がる
  s.pilot.haste = Math.max(0, s.pilot.haste - HASTE_RELIEF);
  s.alerts.push({ text: `180度旋回。${s.leg.from.name}へ引き返す（勇気ある撤退：焦り −${HASTE_RELIEF}）`, urgent: false });
  refresh(s);
  return true;
}

/** 気象ラジオで予報を更新する。実際の天気がすべてわかる */
export function useRadio(s: FlightState): boolean {
  if (!s.radio || s.elapsedMin < s.radioReadyAt) return false;
  s.forecast = forecastFromActual(s.weather, periodOf(clockMin(s)));
  for (const i of s.forecast.items) s.known[i.id] = true;
  // 予報にあったが実際にはなかったもの
  s.radioReadyAt = s.elapsedMin + RADIO_COOLDOWN_MIN;
  s.alerts.push({ text: "気象ラジオで最新の天気を受け取った", urgent: false });
  return true;
}

export const radioReady = (s: FlightState) => s.radio && s.elapsedMin >= s.radioReadyAt;

/** 予報の項目が実際にあるか（まだわからなければ null） */
export const knownState = (s: FlightState, id: string): boolean | null => (id in s.known ? s.known[id] : null);

// ---- 時間を進める ----
/** ゲーム内で dtMin 分だけ進める */
export function stepFlight(s: FlightState, dtMin: number): void {
  let rest = dtMin;
  while (rest > 1e-9 && s.status === "flying") {
    const h = Math.min(SIM_SUBSTEP_MIN, rest);
    substep(s, h);
    rest -= h;
  }
  refresh(s);
}

function substep(s: FlightState, dtMin: number): void {
  applyPending(s);
  autoControls(s);
  refresh(s);
  const perf = s.perf;
  const env = s.env;
  const a = s.condition;
  const dir = s.returning ? -1 : 1;

  // 左右へのよけ：目標のずれに向かって斜めに飛ぶ。そのぶん前へ進むのが遅くなる
  const latErr = s.lateralTarget - s.lateral;
  const theta = s.holding || Math.abs(latErr) < 0.05 ? 0 : (Math.sign(latErr) * DETOUR_ANGLE * Math.PI) / 180;
  const gs = Math.max(0, perf.groundSpeed);
  const alongSpeed = s.holding ? 0 : gs * Math.cos(theta);
  const latSpeed = gs * Math.abs(Math.sin(theta));

  // この刻みの途中で「到着」「燃料切れ」「日没」が起きるなら、そこで止める
  const dtH = dtMin / 60;
  const tArrive = alongSpeed > 0 && !s.holding ? distanceLeft(s) / alongSpeed : Infinity;
  const tFuel = perf.fuelBurn > 0 ? a.fuelRemaining / perf.fuelBurn : Infinity;
  const tSunset = Math.max(0, (s.sunsetMin - clockMin(s)) / 60);
  const t = Math.min(dtH, tArrive, tFuel, tSunset);
  const tMin = t * 60;

  s.distanceFlown += dir * alongSpeed * t;
  if (!s.holding) s.stats.pathKm += gs * t;
  if (latSpeed > 0) s.lateral += Math.sign(latErr) * Math.min(Math.abs(latErr), latSpeed * t);
  const burned = perf.fuelBurn * t;
  a.fuelRemaining -= burned;
  s.fuelUsed += burned;
  a.engineHealth -= (perf.mixture.leanDamagePerMin + perf.overspeedDamagePerMin) * tMin;
  s.elapsedMin += tMin;

  // 高度：目標に向かって上昇・降下する
  const target = targetAltitude(s);
  if (s.spiral > 0) {
    // 旋回降下：気づかないうちに高度が下がっていく（高度計がじわじわ下がる）
    s.altitude -= s.spiral * SPIRAL_MAX_SINK * tMin;
  } else if (s.phase === "climb") s.altitude = Math.min(target, s.altitude + perf.climbRate * tMin);
  else if (s.phase === "descent") s.altitude = Math.max(target, s.altitude - DESCENT_RATE * tMin);
  // 着陸の降下中は、地面に沿って滑走路へ向かう（目的地より手前の地面が高くても潜らない）
  if (s.approach) s.altitude = Math.max(s.altitude, groundElevation(s));

  // 着陸のための降下と、コースへの戻り
  if (!s.approach && distanceLeft(s) <= descentDistanceKm(s, perf)) {
    s.approach = true;
    s.alerts.push({ text: `${destination(s).name}への降下を始めた`, urgent: false });
  }
  const needToReturn = Math.abs(s.lateral) / Math.tan((DETOUR_ANGLE * Math.PI) / 180) + 5;
  if (!s.courseLocked && distanceLeft(s) < needToReturn + 10) {
    s.courseLocked = true;
    s.lateralTarget = 0;
    if (Math.abs(s.lateral) > 1) s.alerts.push({ text: "目的地に向かうため、コースに戻る", urgent: false });
  }

  // 霧：目的地が見えるところまで来て霧なら、上空で待つ
  const dest = destination(s);
  const roll = s.returning ? s.fogRoll.from : s.fogRoll.to;
  const fogged = foggedAt(dest, clockMin(s), roll);
  if (!s.holding && s.approach && distanceLeft(s) < 12 && fogged) {
    s.holding = true;
    s.alerts.push({ text: `${dest.name}は霧で滑走路が見えない。上空で待機する`, urgent: true });
  } else if (s.holding && !fogged) {
    s.holding = false;
    s.alerts.push({ text: "霧が晴れてきた。着陸に向かう", urgent: true });
  }
  if (s.holding) {
    s.stats.holdMinutes += tMin;
    s.altitude = Math.max(s.altitude, dest.elevation + 300);
  }

  // ---- 天気の影響 ----
  // 4.7 雨：前縁が削れる（回転数の2乗に比例）
  if (env.rain > 0) {
    const loss = rainErosionPerHour(env.rain, perf.rpm, s.setup.equipment.edgeGear) * t;
    a.propEdge = Math.max(0, a.propEdge - loss);
    a.edgeAsymmetry = Math.min(1, a.edgeAsymmetry + loss * 0.03 * (1 - EDGE_PROTECTION[s.setup.equipment.edgeGear] * 0.5));
    s.stats.rainMinutes += tMin;
    s.stats.rainRpmMinutes += perf.rpm * tMin;
    s.stats.rainEdgeLoss += loss;
  }
  // 4.10 雲：方向感覚が狂う
  if (env.inCloud) {
    s.disorientation += tMin;
    s.stats.cloudMinutes += tMin;
  } else s.disorientation = Math.max(0, s.disorientation - 2 * tMin);
  // 4.10 着氷・4.9 キャブレター凍結
  a.propIce = Math.min(100, Math.max(0, a.propIce + propIceRate(s.altitude, s.weather.freezingLevel, env.inCloud, env.rain) * t));
  a.carbIce = Math.min(100, Math.max(0, a.carbIce + carbIceRate(env.temp, env.spread, s.controls.throttle, s.controls.carbHeat) * t));
  // 4.10 積乱雲と乱気流：機体が傷む
  // 旋回降下は速度が出て、機体に大きな力がかかる
  const frameLoss =
    (cbDamagePerMin(env.cbDistance) + turbulenceDamagePerMin(env.turbulence, perf.airspeed, VA_KMH) + s.spiral * s.spiral * 8) * tMin;
  a.airframe = Math.max(0, a.airframe - frameLoss);
  s.stats.airframeLoss += frameLoss;

  // プロペラ：ボルトのゆるみ、振動、振動による傷み、外れる危険（4.6・4.8）
  a.boltTightness = Math.max(0, a.boltTightness - boltLossPerHour(s.setup.torqueResult) * t);
  a.vibration = vibrationOf(a);
  a.propDurability = Math.max(0, a.propDurability - vibrationWearPerMin(a.vibration, VIBRATION_RED) * tMin);
  const offChance = propOffChancePerHour(a.boltTightness, BOLT_DANGER) * t;

  // E. 操縦者：飛ぶほど疲れ、日没までに着けそうにないあいだは焦る（4.11）
  const wasHasty = isHasty(s.pilot.haste);
  s.pilot.fatigue = Math.min(100, s.pilot.fatigue + FATIGUE_PER_FLIGHT_HOUR * t);
  s.pilot.haste = hasteAfter(s.pilot.haste, tMin, rushed(s) ? tMin : 0);
  if (!wasHasty && isHasty(s.pilot.haste)) s.alerts.push({ text: "日が暮れる前に着けるだろうか…気持ちが焦ってきた", urgent: false });
  if (isHasty(s.pilot.haste)) s.stats.hastyMinutes += tMin;
  if (s.pilot.fatigue >= 80) s.stats.tiredMinutes += tMin;
  if (env.cbDistance < CB_DANGER_KM) s.stats.cbMinutes += tMin;
  if (env.turbulence > 0 && perf.airspeed > VA_KMH) s.stats.overVaMinutes += tMin;

  s.stats.zoneMinutes[perf.mixture.zone] += tMin;
  s.stats.throttleMinutes += s.controls.throttle * tMin;
  s.stats.maxRpm = Math.max(s.stats.maxRpm, perf.rpm);
  if (perf.overspeedDamagePerMin > 0) s.stats.overspeedMinutes += tMin;
  s.stats.maxVibration = Math.max(s.stats.maxVibration, a.vibration);

  discoverWeather(s);
  watchNoReturn(s);

  const arrivedNow = !s.holding && (t === tArrive || distanceLeft(s) <= 1e-6);
  if (arrivedNow) {
    s.distanceFlown = s.returning ? 0 : s.leg.distanceKm;
    s.lateral = 0;
    s.altitude = dest.elevation;
    s.status = s.returning ? "returned" : "arrived";
  } else if (t === tFuel || a.fuelRemaining <= 1e-6) {
    a.fuelRemaining = 0;
    s.status = "fuelOut";
  } else if (s.altitude < groundElevation(s) - 5) {
    s.status = "terrain";
  } else if (s.disorientation >= DISORIENT_LIMIT_MIN) {
    s.status = "lostControl";
  } else if (a.airframe <= 0) {
    s.status = "airframe";
  } else if (offChance > 0 && s.rng() < offChance) {
    s.status = "propFailure";
    s.failure = "propOff";
  } else if (a.propDurability <= 0) {
    s.status = "propFailure";
    s.failure = "propBroken";
  } else if (a.engineHealth <= 0) {
    a.engineHealth = 0;
    s.status = "engineStopped";
  } else if (t === tSunset || clockMin(s) >= s.sunsetMin) {
    s.status = "sunset";
  }
}

/**
 * 引き返し限界点：海の上で、出発地に戻るだけの燃料がなくなったら一度だけ知らせる。
 * 上昇中は燃料流量が多く見積もりがぶれるので、巡航に入ってから判断する。
 */
function watchNoReturn(s: FlightState) {
  if (s.pastNoReturn || s.returning || s.phase !== "cruise" || !s.leg.sea.length) return;
  if (canReturn(s)) return;
  s.pastNoReturn = true;
  s.alerts.push({
    text: `引き返し限界点を越えた。もう${s.leg.from.name}へ戻る燃料はない。${s.leg.to.name}へ進むしかない`,
    urgent: true,
  });
}

/** 目で見える距離に入った予報項目を確かめる（実際にあるか、なかったか） */
function discoverWeather(s: FlightState) {
  const actualIds = new Set(
    [...s.weather.clouds, ...s.weather.rain, ...s.weather.turbulence, ...s.weather.cb].map((x) => x.id),
  );
  for (const item of s.forecast.items) {
    if (item.id in s.known) continue;
    // 実際の位置（あれば）か、予報の位置までの距離で判断する
    const actual =
      s.weather.cb.find((c) => c.id === item.id) ??
      s.weather.clouds.find((c) => c.id === item.id) ??
      s.weather.rain.find((c) => c.id === item.id) ??
      s.weather.turbulence.find((c) => c.id === item.id);
    let d: number;
    if (actual && "alongKm" in actual) d = Math.max(0, Math.hypot(s.distanceFlown - actual.alongKm, s.lateral - actual.lateralKm) - actual.radiusKm);
    else if (actual) d = distanceToArea(actual, s.distanceFlown, s.lateral);
    else d = distanceToArea(itemArea(item), s.distanceFlown, s.lateral);
    // 乱気流は目に見えないので、入ってみるまでわからない
    const sight = item.kind === "turbulence" ? 0 : item.kind === "cb" ? SIGHT_KM * 2 : SIGHT_KM;
    if (d <= sight) {
      s.known[item.id] = actualIds.has(item.id);
      if (actualIds.has(item.id)) s.alerts.push({ text: discoveryText(item.kind, d), urgent: item.kind === "cb" || d < 15 });
    }
  }
}

function discoveryText(kind: string, d: number) {
  const where = d < 1 ? "入った" : `${Math.round(d)} km 先に見える`;
  switch (kind) {
    case "cb":
      return `積乱雲が${where}！ 37 km 以上離れろ`;
    case "cloud":
      return `雲が${where}。雲の下か上を飛ぶか、横によけろ`;
    case "rain":
      return `雨雲が${where}`;
    default:
      return `乱気流に${where}。速度を落とせ`;
  }
}

/** 今の高度から目的地へ降りるのに必要な距離 */
function descentDistanceKm(s: FlightState, perf: Performance) {
  const minutes = Math.max(0, s.altitude - destination(s).elevation) / DESCENT_RATE;
  const gs = Math.max(30, perf.airspeed + (s.phase === "descent" ? 0 : DESCENT_SPEED_BONUS) - s.env.headwind);
  return (minutes / 60) * gs + 3;
}

// ---- 結果 ----
export interface FlightResult {
  success: boolean;
  title: string;
  detail: string;
  mechanic: string;
}

export function evaluateFlight(s: FlightState): FlightResult {
  const r = evaluateFlightBase(s);
  if (!r.success && s.stats.hastyMinutes > 0)
    r.mechanic += " …それに、焦っていたな。焦ると、危ないサインまで「まあ大丈夫だろう」に聞こえてしまう。";
  return r;
}

function evaluateFlightBase(s: FlightState): FlightResult {
  const left = distanceLeft(s).toFixed(0);
  const z = s.stats.zoneMinutes;
  const avgThrottle = s.elapsedMin > 0 ? s.stats.throttleMinutes / s.elapsedMin : 0;
  const richMostly = z.rich > s.elapsedMin * 0.5;
  const dest = destination(s);
  // 海の上では降りる場所がない。着水して、船に助けられる
  const sea = overSea(s);
  const ditch = "海に着水した。通りかかった漁船に助けられたが、機体は波にのまれた";
  const down = sea ? ditch : "畑に不時着した";

  switch (s.status) {
    case "arrived": {
      const reserve = s.condition.fuelRemaining;
      return reserve >= RESERVE_FUEL_L
        ? {
            success: true,
            title: "安全に到着",
            detail: `${dest.name}に着陸。燃料は ${reserve.toFixed(1)} L 残っている。`,
            mechanic: "いい飛び方だ。遠くへ飛ぶ鍵は、速さより燃費と風だ。",
          }
        : {
            success: true,
            title: "到着（燃料ギリギリ）",
            detail: `${dest.name}に着陸。でも燃料は ${reserve.toFixed(1)} L しか残っていない。`,
            mechanic: `着いたのはいいが、予備燃料は30分ぶん（${RESERVE_FUEL_L} L くらい）は残しておけ。`,
          };
    }
    case "returned":
      return {
        success: true,
        title: "引き返して着陸",
        detail: `${dest.name}に戻ってきた。`,
        mechanic: "引き返すのも立派な判断だ。降りて待つのも正しい。",
      };
    case "fuelOut":
      return {
        success: false,
        title: "燃料切れ",
        detail: `${dest.name}まであと ${left} km のところで燃料が尽き、${down}。`,
        mechanic: sea && s.pastNoReturn
          ? "海の上では、引き返し限界点を越える前に決めるんだ。燃料の残りと、戻るのに要る量を見比べろ。"
          : richMostly
          ? "混合比が濃いままだったな。ちょうどよく薄くするだけで、燃費は2割近く良くなる。"
          : avgThrottle > 0.85
            ? "出力を上げすぎだ。向かい風の日は、速さより燃費を考えろ。"
            : "積む燃料が足りなかったか、燃費が悪かった。よけた距離や待った時間のぶんも、燃料は減る。",
      };
    case "engineStopped":
      return {
        success: false,
        title: "エンジン停止",
        detail: `エンジンが傷んで止まってしまった。${dest.name}まであと ${left} km。${sea ? `${ditch}。` : ""}`,
        mechanic:
          s.stats.overspeedMinutes > 3
            ? "回転数がレッドラインを超えていた。降下や全開のときは回転計を見て絞れ。"
            : "エンジンが荒れたら薄すぎの合図だ。荒れ始める手前で止めろ。",
      };
    case "sunset":
      return {
        success: false,
        title: "日没",
        detail: sea
          ? `${dest.name}まであと ${left} km の海の上で日が暮れた。暗い海では陸の方向もわからない。${ditch}。`
          : `${dest.name}まであと ${left} km のところで日が暮れた。暗くなる前に近くの原っぱへ降りた。`,
        mechanic: "出発が遅かったか、絞りすぎた。日の入りに間に合わないなら、泊まって朝に出るのも正しい判断だ。",
      };
    case "propFailure":
      return s.failure === "propOff"
        ? {
            success: false,
            title: "プロペラが外れた",
            detail: `ゆるんだボルトが抜け、プロペラが外れた。${dest.name}まであと ${left} km。${down}。`,
            mechanic: "気候の違う土地に着いたら、まず締め直せ。木は湿気で縮んだりふくらんだりする。",
          }
        : {
            success: false,
            title: "プロペラが割れた",
            detail: `強い振動が続いて、木のプロペラが割れた。${dest.name}まであと ${left} km。${down}。`,
            mechanic: "振動は総合的な警告だ。出たら原因を探せ。ボルトのゆるみか、前縁の傷か、着氷か。",
          };
    case "lostControl":
      return {
        success: false,
        title: "雲の中で迷った",
        detail: `雲の中で上下がわからなくなり、気づいたら急な旋回降下に入っていた。なんとか雲の下に出て、${down}。`,
        mechanic: "計器飛行の訓練がないなら、雲には入るな。雲が低くなってきたら、早めに引き返せ。",
      };
    case "airframe":
      return {
        success: false,
        title: "機体が壊れた",
        detail: `${s.env.cbDistance < 40 ? "積乱雲の近くの激しい揺れ" : "乱気流の中を速いまま飛んだ"}せいで、機体が傷んで飛べなくなった。${down}。`,
        mechanic:
          s.env.cbDistance < 40
            ? "積乱雲には近づくな。37 km 以上離れるか、消えるまで待て。"
            : "揺れたら速度を落とせ。設計運動速度（140 km/h）より遅くすれば、機体は耐えられる。",
      };
    case "terrain":
      return {
        success: false,
        title: "山にぶつかりそうになった",
        detail: "高度が足りず、山の斜面が目の前に迫った。急旋回でかわして、谷あいの畑に不時着した。",
        mechanic: "山越えには十分な高度が要る。雲に押されて低く飛ぶくらいなら、引き返せ。",
      };
    case "flying":
      return { success: false, title: "飛行中", detail: "", mechanic: "" };
  }
}
