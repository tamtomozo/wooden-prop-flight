// 4章の計算モデル。状態を持たない純粋な関数だけを置く。
import {
  BASE_BURN,
  BASE_CLIMB_RATE,
  BASE_SPEED,
  BASE_TAKEOFF,
  CLIMB_CEILING,
  CLIMB_FADE_FROM,
  CLIMB_SPEED_FACTOR,
  DESCENT_SPEED_BONUS,
  EMPTY_WEIGHT,
  FUEL_KG_PER_L,
  REDLINE_RPM,
} from "../config";
import type { AircraftCondition, EdgeGear, PitchLevel, TorqueResult } from "./types";

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** x が x0→x1 を動くとき y0→y1 を線形補間（範囲外は端の値） */
const segment = (x: number, x0: number, x1: number, y0: number, y1: number) =>
  lerp(y0, y1, clamp((x - x0) / (x1 - x0), 0, 1));

// ---- 4.1 プロペラのピッチ ----
export interface PitchFactors {
  pitchSpeedFactor: number;
  climbFactor: number;
  takeoffDistFactor: number;
  staticRPM: number;
  rpmPerKmh: number;
}

export function pitchFactors(pitch: PitchLevel): PitchFactors {
  const p = pitch - 1;
  return {
    pitchSpeedFactor: 0.9 + 0.05 * p,
    climbFactor: 1.2 - 0.1 * p,
    takeoffDistFactor: 0.85 + 0.075 * p,
    staticRPM: 2400 - 50 * p,
    rpmPerKmh: 3.0 - 0.3 * p,
  };
}

/** 地上回転数テストの表示（4.1） */
export function staticRpmVerdict(staticRPM: number): "low" | "ok" | "high" {
  if (staticRPM < 2250) return "low";
  if (staticRPM > 2350) return "high";
  return "ok";
}

// ---- 4.3 ミクスチャー ----
export type MixtureZone = "rich" | "power" | "economy" | "tooLean";

export interface MixturePoints {
  bestPower: number;
  bestEconomy: number;
  tooLean: number;
}

/** 適正位置は高度が上がるほど薄い側へ動く */
export function mixturePoints(altitude: number): MixturePoints {
  const bestPower = 35 + altitude / 200;
  const bestEconomy = bestPower + 15;
  return { bestPower, bestEconomy, tooLean: bestEconomy + 8 };
}

export interface MixtureEffect {
  power: number; // 出力係数
  fuel: number; // 燃料係数
  zone: MixtureZone;
  /** 薄すぎるときのエンジンの傷み方（1分あたり） */
  leanDamagePerMin: number;
}

/** 「最大出力」ゾーンとみなす bestPower からの幅 */
const POWER_ZONE_HALF_WIDTH = 6;

export function mixtureEffect(mixture: number, altitude: number): MixtureEffect {
  const { bestPower: bp, bestEconomy: be, tooLean: tl } = mixturePoints(altitude);
  let power: number;
  let fuel: number;
  if (mixture <= bp) {
    // 濃い → 最大出力
    power = segment(mixture, bp - 20, bp, 0.95, 1.0);
    fuel = segment(mixture, bp - 20, bp, 1.25, 1.0);
  } else if (mixture <= be) {
    // 最大出力 → 最良燃費
    power = segment(mixture, bp, be, 1.0, 0.96);
    fuel = segment(mixture, bp, be, 1.0, 0.85);
  } else if (mixture <= tl) {
    // 最良燃費 → 薄すぎの手前（設計書に値がないので仮置き）
    power = segment(mixture, be, tl, 0.96, 0.9);
    fuel = segment(mixture, be, tl, 0.85, 0.8);
  } else {
    // 薄すぎ：出力が急に落ちる
    const over = mixture - tl;
    power = Math.max(0.3, 0.9 - 0.04 * over);
    fuel = Math.max(0.6, 0.8 - 0.01 * over);
  }

  let zone: MixtureZone;
  if (mixture > tl) zone = "tooLean";
  else if (mixture >= bp + POWER_ZONE_HALF_WIDTH) zone = "economy";
  else if (mixture >= bp - POWER_ZONE_HALF_WIDTH) zone = "power";
  else zone = "rich";

  return { power, fuel, zone, leanDamagePerMin: mixture > tl ? 2 : 0 };
}

/**
 * 排気温度（℃）。最良燃費の混合比で最も高くなり、濃くしても薄くしても下がる。
 * 付録B「最良燃費：排気温度計（EGT）があれば最高温度の点」を計器で再現するための値（仮）。
 */
export function exhaustTemp(mixture: number, altitude: number, throttle: number): number {
  const { bestEconomy } = mixturePoints(altitude);
  const peak = 620 + 130 * throttle;
  const d = mixture - bestEconomy;
  return d < 0 ? peak + 3.2 * d : peak - 4.5 * d;
}

// ---- 4.2 / 4.4 回転数・速度・燃料（上昇と降下を含む） ----
export type Phase = "climb" | "cruise" | "descent";

export interface FlightInputs {
  pitch: PitchLevel;
  throttle: number;
  mixture: number;
  altitude: number;
  propEdge: number;
  engineHealth: number;
  carbIcePenalty: number;
  headwindKmh: number;
  fuelRemaining: number;
  phase?: Phase;
  /** 今の重さ ÷ EMPTY_WEIGHT。上昇率に効く */
  weightRatio?: number;
  /** プロペラの着氷 0..100。プロペラの効率が落ちる */
  propIce?: number;
  /** 気づかないうちの旋回降下で増える速度 km/h（空間識失調） */
  extraSpeed?: number;
}

export interface Performance {
  airspeed: number;
  groundSpeed: number;
  rpm: number;
  fuelBurn: number; // L/h
  /** 今の設定のまま飛び続けたときに届く距離 */
  rangeKm: number;
  mixture: MixtureEffect;
  /** 排気温度（℃） */
  egt: number;
  /** 上昇率 m/分（上昇中だけ） */
  climbRate: number;
  /** レッドライン超えでエンジンが傷む量（1分あたり） */
  overspeedDamagePerMin: number;
}

export function computePerformance(i: FlightInputs): Performance {
  const phase = i.phase ?? "cruise";
  const pf = pitchFactors(i.pitch);
  const mix = mixtureEffect(i.mixture, i.altitude);

  const propEfficiency = (0.7 + 0.3 * (i.propEdge / 100)) * (1 - (i.propIce ?? 0) / 250);
  const engineFactor = 0.6 + 0.4 * (i.engineHealth / 100);
  const powerFactor = (0.5 + 0.5 * i.throttle) * mix.power * engineFactor * i.carbIcePenalty;

  let airspeed = BASE_SPEED * pf.pitchSpeedFactor * propEfficiency * powerFactor;
  if (phase === "climb") airspeed *= CLIMB_SPEED_FACTOR;
  if (phase === "descent") airspeed += DESCENT_SPEED_BONUS;
  airspeed += i.extraSpeed ?? 0;
  const groundSpeed = airspeed - i.headwindKmh;
  const fuelBurn = BASE_BURN * i.throttle * mix.fuel;

  const rangeKm =
    groundSpeed <= 0 ? 0 : fuelBurn <= 0 ? Infinity : (i.fuelRemaining / fuelBurn) * groundSpeed;

  // 固定ピッチなので、速度が上がると回転数も上がる（降下中は特に）。
  // キャブレターが凍ると吸気が詰まり、回転がじわじわ下がる（6章：回転計の針をじわじわ下げる）
  const rpm = i.throttle * i.carbIcePenalty * (pf.staticRPM + airspeed * pf.rpmPerKmh);
  const overspeedDamagePerMin = rpm > REDLINE_RPM ? (rpm - REDLINE_RPM) / 50 : 0;

  // 上昇率：ピッチ（上昇型ほど強い）・出力・重さ・高さ（空気の薄さ）で決まる
  const climbRate =
    phase === "climb"
      ? (BASE_CLIMB_RATE * pf.climbFactor * powerFactor * propEfficiency * climbAltitudeFactor(i.altitude)) / (i.weightRatio ?? 1)
      : 0;

  const egt = exhaustTemp(i.mixture, i.altitude, i.throttle);

  return { airspeed, groundSpeed, rpm, fuelBurn, rangeKm, mixture: mix, egt, climbRate, overspeedDamagePerMin };
}

/** 高さによる上昇率の倍率。高いほど空気が薄く、上がりにくい */
export const climbAltitudeFactor = (altitude: number) =>
  segment(altitude, CLIMB_FADE_FROM, CLIMB_CEILING, 1, 0);

// ---- 4.5 重さと離陸距離 ----
export function totalWeight(fuelL: number, equipmentKg: number): number {
  return EMPTY_WEIGHT + fuelL * FUEL_KG_PER_L + equipmentKg;
}

/** 国際標準大気の気温 */
export const isaTemp = (elevation: number) => 15 - 0.0065 * elevation;

/** 密度高度（簡易式）。暑いほど・高いほど空気が薄い */
export const densityAltitude = (elevation: number, temperature: number) =>
  elevation + 36 * (temperature - isaTemp(elevation));

export function takeoffDistance(pitch: PitchLevel, elevation: number, temperature: number, weightKg: number) {
  const da = densityAltitude(elevation, temperature);
  return (
    BASE_TAKEOFF *
    pitchFactors(pitch).takeoffDistFactor *
    Math.max(0.7, 1 + (0.12 * da) / 300) *
    (weightKg / EMPTY_WEIGHT) ** 2
  );
}

// ---- 4.6 ボルトの締まり ----
export const INSTALL_FACTOR: Record<TorqueResult, number> = { under: 1.5, ok: 1.0, over: 1.0 };

/** 飛行時間によるゆるみ（1時間あたり） */
export const boltLossPerHour = (torque: TorqueResult) => 1.0 * INSTALL_FACTOR[torque];

/** 湿度の違う土地に着いたときのゆるみ。木が湿気を吸ったり乾いたりして厚みが変わる */
export const humidityBoltLoss = (humidityFrom: number, humidityTo: number, torque: TorqueResult) =>
  0.8 * Math.abs(humidityTo - humidityFrom) * INSTALL_FACTOR[torque];

/** ボルトが危険域のとき、1時間あたりにプロペラが外れる確率 */
export const propOffChancePerHour = (boltTightness: number, danger: number) =>
  boltTightness < danger ? (danger - boltTightness) * 0.01 : 0;

// ---- 4.7 前縁の侵食（未舗装の滑走路の小石。雨はステップ3） ----
export const EDGE_PROTECTION: Record<EdgeGear, number> = { none: 0, tape: 0.5, metal: 0.67 };

/** 雨による前縁の侵食（1時間あたり）。4.7：雨の強さ × 回転数の2乗。回転を下げると水滴の当たる強さが下がる */
export function rainErosionPerHour(rainIntensity: number, rpm: number, edgeGear: EdgeGear) {
  return rainIntensity * 4 * (rpm / 2500) ** 2 * (1 - EDGE_PROTECTION[edgeGear]);
}

/** 未舗装の滑走路で1回離着陸したときの傷。r は 0..1 の乱数 */
export function stoneDamage(r: number, edgeGear: EdgeGear) {
  const edgeLoss = r * 5 * (1 - EDGE_PROTECTION[edgeGear] * 0.5);
  return { edgeLoss, asymmetryGain: edgeLoss * 0.06 };
}

// ---- 4.8 振動 ----
export function vibrationOf(c: Pick<AircraftCondition, "boltTightness" | "propEdge" | "edgeAsymmetry" | "propIce">) {
  return clamp(
    (100 - c.boltTightness) * 0.6 + (100 - c.propEdge) * 0.3 * c.edgeAsymmetry + c.propIce * 0.5,
    0,
    100,
  );
}

/** 振動が赤のあいだ、プロペラ耐久度が下がる量（1分あたり）。赤の入口で約1.5時間、ひどいと1時間足らずで割れる */
export const vibrationWearPerMin = (vibration: number, red: number) =>
  vibration >= red ? (vibration - red) * 0.05 + 1 : 0;

// ---- 乱数（同じ種から同じ結果が出る。テストと「区間のやり直し」用） ----
export function createRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
