// 旅全体（格納庫 → 行き先を地図で選ぶ → 区間 → 経由地 → … → 目的地）の状態と、経由地での整備。
// 画面からは切り離してあり、テストから直接動かせる。
import {
  BOLT_AFTER_UNDER,
  EQUIPMENT_MAX_KG,
  EQUIPMENT_SLOTS,
  FATIGUE_REST,
  FORCED_LANDING_MIN,
  HASTE_NIGHT_RELIEF,
  HASTE_RELIEF,
  MORNING_MIN,
  PROP_SWAP_MIN,
  REFUEL_MIN,
  RESERVE_FUEL_L,
  SUNSET_MARGIN_MIN,
  SHOP,
  TOOLKIT_RETORQUE_MIN,
  WAIT_MIN,
} from "../config";
import { DIFFICULTY } from "../data/difficulty";
import { equipmentKg, slotsUsed } from "../data/equipment";
import { edgeDistance, field, findEdge, legBetween, neighbors, shortestPath } from "../data/world";
import {
  createRng,
  humidityBoltLoss,
  stoneDamage,
  takeoffDistance,
  totalWeight,
  vibrationOf,
} from "../model/physics";
import { hasteAfter } from "../model/pilot";
import type {
  AircraftCondition,
  Controls,
  Difficulty,
  Forecast,
  Leg,
  LegWeather,
  Pilot,
  Setup,
  TorqueResult,
  Waypoint,
  World,
} from "../model/types";
import { foggedAt, generateWeather, periodOf, surfaceTemp } from "../model/weather";
import { createFlight, groundElevation, overSea, type FlightState } from "./flight";

export interface LegRecord {
  leg: Leg;
  day: number;
  flightMin: number;
  fuelUsed: number;
  /** 実際に飛んだ距離（よけた分や、引き返した分を含む） */
  distanceKm: number;
  returned: boolean;
}

/** 危ない飛び方の記録（評価で使う） */
export interface SafetyLog {
  cloudMinutes: number;
  cbMinutes: number;
  overspeedMinutes: number;
  overVaMinutes: number;
  lowReserveLandings: number;
  hastyMinutes: number;
  tiredMinutes: number;
  /** 旅のあいだでいちばんゆるんだときのボルトの締まり */
  minBolt: number;
}

export interface CampaignState {
  world: World;
  setup: Setup;
  condition: AircraftCondition;
  /** 今いる飛行場 */
  location: string;
  /** 地図で選んだ次の行き先（つながっている飛行場） */
  destination: string | null;
  day: number;
  /** その日の0時からの分 */
  clockMin: number;
  spareAvailable: boolean;
  /** 最後に着いたときの出来事（経由地の画面で見せる） */
  events: string[];
  records: LegRecord[];
  maintenanceCount: number;
  rngState: number;
  /** 天気と霧を決める種（旅のあいだ変わらない） */
  weatherSeed: number;
  /** 前の区間で使った操作（次の区間もそのまま引き継ぐ） */
  controls: Controls;
  /** 引き返した回数・天気を待った回数（勇気ある撤退ボーナス） */
  turnBacks: number;
  waits: number;
  /** E. 操縦者 */
  pilot: Pilot;
  safety: SafetyLog;
  /** ボルトを締め直した回数（4つの学び「木は湿気で変わる」の振り返り用） */
  retorques: number;
  /** 7章 難易度 */
  difficulty: Difficulty;
  /** 今いる飛行場に着いてから、ボルトを締め直したか（点検の通知に使う） */
  retorquedHere: boolean;
}

const clone = <T>(x: T): T => structuredClone(x);

/** 締め付けの結果ごとの締まり具合 */
const boltAfter = (r: TorqueResult) => (r === "under" ? BOLT_AFTER_UNDER : 100);

export function newCondition(world: World, setup: Setup): AircraftCondition {
  const c: AircraftCondition = {
    boltTightness: boltAfter(setup.torqueResult),
    propEdge: 100,
    edgeAsymmetry: 0,
    vibration: 0,
    engineHealth: 100,
    propDurability: 100,
    propIce: 0,
    carbIce: 0,
    airframe: 100,
    fuelRemaining: (world.fuelCapacityL * setup.fuelPercent) / 100,
  };
  c.vibration = vibrationOf(c);
  return c;
}

export function setupProblems(world: World, setup: Setup): string[] {
  const p: string[] = [];
  if (slotsUsed(setup.equipment) > EQUIPMENT_SLOTS) p.push(`装備は ${EQUIPMENT_SLOTS} 枠まで`);
  if (equipmentKg(setup.equipment) > EQUIPMENT_MAX_KG) p.push(`装備の重さは ${EQUIPMENT_MAX_KG} kg まで`);
  const first = field(world, world.startId);
  const fuelL = (world.fuelCapacityL * setup.fuelPercent) / 100;
  const dist = takeoffDistance(
    setup.pitch,
    first.elevation,
    first.temperature,
    totalWeight(fuelL, equipmentKg(setup.equipment)),
  );
  if (dist > first.runwayLength) p.push("重すぎて離陸できない");
  return p;
}

export function startCampaign(
  world: World,
  setup: Setup,
  seed = Date.now(),
  difficulty: Difficulty = "normal",
  destination: string = suggestedDestination(world, world.startId),
): CampaignState {
  return {
    world,
    setup: clone(setup),
    condition: newCondition(world, setup),
    location: world.startId,
    destination,
    day: 1,
    clockMin: world.startMin,
    spareAvailable: setup.equipment.spareProp,
    events: [],
    records: [],
    maintenanceCount: 0,
    rngState: seed >>> 0,
    weatherSeed: (seed * 2654435761) >>> 0,
    controls: {
      throttle: 0.75,
      mixture: 0,
      carbHeat: false,
      targetAltitude: legBetween(world, world.startId, destination).cruiseAltitude,
    },
    turnBacks: 0,
    waits: 0,
    pilot: { fatigue: 0, haste: 0 },
    safety: {
      cloudMinutes: 0,
      cbMinutes: 0,
      overspeedMinutes: 0,
      overVaMinutes: 0,
      lowReserveLandings: 0,
      hastyMinutes: 0,
      tiredMinutes: 0,
      minBolt: newCondition(world, setup).boltTightness,
    },
    retorques: 0,
    difficulty,
    retorquedHere: true,
  };
}

// ---- 見積もりと焦り ----
const DAY_MIN = 24 * 60;
/** 1区間ごとの、離陸と着陸・給油などのぶんの時間（見積もり用） */
const TURNAROUND_MIN = 20;
/** 旅の始まり（1日目の0時）からの分 */
export const absNow = (c: CampaignState) => (c.day - 1) * DAY_MIN + c.clockMin;

/** 地図で、その飛行場から目的地へのいちばん近い道順の次の飛行場 */
export function suggestedDestination(w: World, from: string): string {
  return shortestPath(w, from, w.goalId)[1] ?? neighbors(w, from)[0];
}

/** 1区間をふつうの速さで飛ぶのにかかる時間（分） */
const plannedLegMin = (w: World, from: string, to: string) =>
  (edgeDistance(w, findEdge(w, from, to)!) / w.planSpeedKmh) * 60 + TURNAROUND_MIN;

/**
 * from から、いちばん近い道順で目的地へ行ったときの到着時刻（旅の始まりからの分）。
 * ふつうの速さで飛び、日没までに着けない区間は、泊まって翌朝に飛ぶ。
 */
export function projectedArrivalAbs(w: World, from: string, startAbs: number): number {
  const path = shortestPath(w, from, w.goalId);
  let t = startAbs;
  for (let i = 1; i < path.length; i++) t = plannedLegArrival(w, t, path[i - 1], path[i]);
  return t;
}

/** 1区間をふつうの速さで飛んだときの到着時刻。日没までに着けなければ、泊まって翌朝に飛ぶ */
function plannedLegArrival(w: World, startAbs: number, from: string, to: string) {
  const min = plannedLegMin(w, from, to);
  let t = startAbs;
  const day = Math.floor(t / DAY_MIN);
  const tod = t - day * DAY_MIN;
  if (tod < MORNING_MIN) t = day * DAY_MIN + MORNING_MIN;
  else if (tod + min > w.sunsetMin) t = (day + 1) * DAY_MIN + MORNING_MIN;
  return t + min;
}

/** 次に via へ飛び、そこから最短で行ったときの目的地への到着時刻 */
export function projectedViaAbs(w: World, from: string, via: string, startAbs: number): number {
  return projectedArrivalAbs(w, via, plannedLegArrival(w, startAbs, from, via));
}

/**
 * 今出ても、日没の少し前（SUNSET_MARGIN_MIN）までに次の行き先へ着けそうにない（でもまだ明るい）。
 * 「暗くなる前に着きたい」という焦りの元。
 */
export function rushedToday(c: CampaignState) {
  if (isFinished(c) || !c.destination || c.clockMin >= c.world.sunsetMin) return false;
  return c.clockMin + plannedLegMin(c.world, c.location, c.destination) > c.world.sunsetMin - SUNSET_MARGIN_MIN;
}

/** 地上で時間が過ぎる。日没までに着けそうにない時間帯に地上で待っていると焦る */
function passTime(c: CampaignState, min: number) {
  c.clockMin += min;
  if (isFinished(c) || min <= 0) return;
  c.pilot.haste = hasteAfter(c.pilot.haste, min, rushedToday(c) ? min : 0);
}

// ---- 行き先（地図で選ぶ） ----
/** ここから飛んで行ける飛行場 */
export const destinations = (c: CampaignState) => neighbors(c.world, c.location);

export function chooseDestination(c: CampaignState, id: string): void {
  if (!destinations(c).includes(id)) return;
  c.destination = id;
  c.controls = { ...c.controls, targetAltitude: legBetween(c.world, c.location, id).cruiseAltitude };
}

// ---- 天気 ----
const mix = (...xs: number[]) => xs.reduce((h, x) => (Math.imul(h ^ (x >>> 0), 2654435761) + 0x9e3779b9) >>> 0, 0x811c9dc5);

/** 次の区間の、今の日・時間帯の天気と予報 */
export function legWeather(c: CampaignState): { actual: LegWeather; forecast: Forecast } | null {
  const leg = nextLeg(c);
  if (!leg) return null;
  const period = periodOf(c.clockMin);
  return generateWeather(
    leg.weather,
    mix(c.weatherSeed, edgeSeed(c), c.day, period === "morning" ? 1 : 2),
    period,
    DIFFICULTY[c.difficulty].forecastUncertainty,
  );
}

/** 道ごと・向きごとに違う天気にするための数 */
function edgeSeed(c: CampaignState) {
  const e = findEdge(c.world, c.location, c.destination!)!;
  return c.world.edges.indexOf(e) * 2 + (e.a === c.location ? 0 : 1);
}

/** 飛行場ごと・日ごとの霧の乱数 */
export function fogRoll(c: CampaignState, w: Waypoint) {
  let h = 0;
  for (const ch of w.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return createRng(mix(c.weatherSeed, h, c.day))();
}

export const foggedNow = (c: CampaignState, w: Waypoint = currentPlace(c)) => foggedAt(w, c.clockMin, fogRoll(c, w));

const nextRandom = (c: CampaignState) => {
  const r = createRng(c.rngState)();
  c.rngState = (c.rngState + 0x9e3779b9) >>> 0;
  return r;
};

export const isFinished = (c: CampaignState) => c.location === c.world.goalId;
/** 選んだ行き先への区間（行き先を選んでいなければ null） */
export const nextLeg = (c: CampaignState): Leg | null =>
  !isFinished(c) && c.destination ? legBetween(c.world, c.location, c.destination) : null;
export const currentPlace = (c: CampaignState): Waypoint => field(c.world, c.location);

export function currentWeight(c: CampaignState) {
  return totalWeight(c.condition.fuelRemaining, equipmentKg(c.setup.equipment));
}

/** 今の重さで、ここから離陸するのに必要な距離 */
export function takeoffCheck(c: CampaignState) {
  const w = currentPlace(c);
  const temperature = surfaceTemp(w, c.clockMin);
  const distance = takeoffDistance(c.setup.pitch, w.elevation, temperature, currentWeight(c));
  return { distance, runway: w.runwayLength, ok: distance <= w.runwayLength, weight: currentWeight(c), temperature };
}

export function departureProblems(c: CampaignState): string[] {
  const p: string[] = [];
  if (isFinished(c)) return ["旅は終わっている"];
  if (!nextLeg(c)) return ["行き先を選んでいない"];
  if (!takeoffCheck(c).ok) p.push("重すぎて離陸できない（燃料を減らす）");
  if (c.clockMin >= c.world.sunsetMin) p.push("日が暮れている（泊まって朝を待つ）");
  else if (foggedNow(c)) p.push("霧で滑走路が見えない（晴れるのを待つ）");
  if (c.condition.propDurability <= 0) p.push("プロペラが割れている");
  if (c.condition.engineHealth <= 0) p.push("エンジンが動かない");
  return p;
}

/** 区間を始める。未舗装の滑走路なら離陸の小石で前縁が傷む */
export function beginLeg(c: CampaignState): { flight: FlightState; notes: string[] } {
  const leg = nextLeg(c)!;
  const notes: string[] = [];
  const cond = clone(c.condition);
  if (leg.from.surface === "unpaved") {
    const d = stoneDamage(nextRandom(c), c.setup.equipment.edgeGear);
    cond.propEdge = Math.max(0, cond.propEdge - d.edgeLoss);
    cond.edgeAsymmetry = Math.min(1, cond.edgeAsymmetry + d.asymmetryGain);
    cond.vibration = vibrationOf(cond);
    notes.push(`未舗装の滑走路で小石が当たり、前縁が傷んだ（−${d.edgeLoss.toFixed(1)}）`);
  }
  const wx = legWeather(c)!;
  const flight = createFlight({
    difficulty: c.difficulty,
    pilot: c.pilot,
    leg,
    setup: c.setup,
    condition: cond,
    departureMin: c.clockMin,
    sunsetMin: c.world.sunsetMin,
    controls: c.controls,
    weather: wx.actual,
    forecast: wx.forecast,
    fogRoll: { to: fogRoll(c, leg.to), from: fogRoll(c, leg.from) },
    rng: createRng(c.rngState ^ 0x5bd1e995),
  });
  nextRandom(c);
  return { flight, notes };
}

/** 予備プロペラで不時着から復帰できるか（海の上では降りる畑がないのでできない） */
export const canRecoverWithSpare = (c: CampaignState, f: FlightState) =>
  c.spareAvailable && f.status === "propFailure" && !overSea(f);

/** 予備プロペラで不時着から復帰する。復帰できたら true */
export function recoverWithSpare(c: CampaignState, f: FlightState): boolean {
  if (!canRecoverWithSpare(c, f)) return false;
  c.spareAvailable = false;
  const a = f.condition;
  a.propEdge = 100;
  a.edgeAsymmetry = 0;
  a.propDurability = 100;
  a.boltTightness = 100;
  a.vibration = vibrationOf(a);
  f.setup = { ...f.setup, torqueResult: "ok" };
  f.status = "flying";
  f.failure = null;
  f.elapsedMin += FORCED_LANDING_MIN;
  f.altitude = groundElevation(f);
  f.approach = false;
  f.holding = false;
  f.disorientation = 0;
  f.phase = "climb";
  return true;
}

/** 区間を終えて着陸したあとの処理。湿度の差でボルトがゆるむのはここ */
export function finishLeg(c: CampaignState, f: FlightState): void {
  const returned = f.status === "returned";
  const leg = returned ? { ...f.leg, from: f.leg.to, to: f.leg.from } : f.leg;
  const events: string[] = [];
  const cond = clone(f.condition);
  c.setup = { ...c.setup, torqueResult: f.setup.torqueResult };
  if (returned) events.push(`${f.leg.to.name}へは行かず、${f.leg.from.name}に引き返した`);

  // 飛行中の天気の影響
  if (f.stats.rainMinutes > 0) {
    const avgRpm = f.stats.rainRpmMinutes / f.stats.rainMinutes;
    events.push(
      `雨の中を ${Math.round(f.stats.rainMinutes)} 分飛んだ（平均 ${Math.round(avgRpm)} rpm）。前縁が削れた（−${f.stats.rainEdgeLoss.toFixed(1)}）。回転数を下げるほど削れ方は減る`,
    );
  }
  if (f.stats.airframeLoss > 0.5) events.push(`揺れで機体が傷んだ（強度 −${f.stats.airframeLoss.toFixed(0)}）`);
  if (cond.propIce > 1) events.push("プロペラに氷が残っている。地上で溶けた");
  cond.propIce = 0;
  cond.carbIce = 0;
  if (f.stats.holdMinutes > 0) events.push(`霧が晴れるまで上空で ${Math.round(f.stats.holdMinutes)} 分待った`);

  // 未舗装の滑走路への着陸
  if (leg.to.surface === "unpaved") {
    const d = stoneDamage(nextRandom(c), c.setup.equipment.edgeGear);
    cond.propEdge = Math.max(0, cond.propEdge - d.edgeLoss);
    cond.edgeAsymmetry = Math.min(1, cond.edgeAsymmetry + d.asymmetryGain);
    events.push(`未舗装の滑走路に着陸。小石で前縁が傷んだ（−${d.edgeLoss.toFixed(1)}）`);
  }

  // 湿度の違う土地での滞在（4.6）。引き返したなら同じ土地なので変わらない
  const dh = returned ? 0 : leg.to.humidity - leg.from.humidity;
  const loss = returned ? 0 : humidityBoltLoss(leg.from.humidity, leg.to.humidity, c.setup.torqueResult);
  cond.boltTightness = Math.max(0, cond.boltTightness - loss);
  if (Math.abs(dh) >= 5) {
    const why = dh < 0 ? "空気が乾いていて、木のプロペラが縮んだ" : "空気が湿っていて、木のプロペラの厚みが変わった";
    events.push(
      `湿度 ${leg.from.humidity}% → ${leg.to.humidity}%。${why}。ボルトがゆるんだ（−${loss.toFixed(1)}）`,
    );
  } else if (!returned) {
    events.push(`湿度は ${leg.from.humidity}% → ${leg.to.humidity}% とあまり変わらない（ボルト −${loss.toFixed(1)}）`);
  }

  // 締めすぎは区間ごとに木を傷める
  if (c.setup.torqueResult === "over") {
    cond.propDurability = Math.max(0, cond.propDurability - 10);
    events.push("ボルトの締めすぎで、木のハブがつぶれてきている（耐久度 −10）");
  }
  cond.vibration = vibrationOf(cond);


  // 操縦者と、危ない飛び方の記録
  c.pilot = { ...f.pilot };
  const s = c.safety;
  s.cloudMinutes += f.stats.cloudMinutes;
  s.cbMinutes += f.stats.cbMinutes;
  s.overspeedMinutes += f.stats.overspeedMinutes;
  s.overVaMinutes += f.stats.overVaMinutes;
  s.hastyMinutes += f.stats.hastyMinutes;
  s.tiredMinutes += f.stats.tiredMinutes;
  s.minBolt = Math.min(s.minBolt, f.condition.boltTightness, cond.boltTightness);
  if (!returned && f.condition.fuelRemaining < RESERVE_FUEL_L) {
    s.lowReserveLandings += 1;
    events.push(`予備燃料（${RESERVE_FUEL_L} L）を割って着陸した`);
  }
  if (c.pilot.fatigue >= 60) events.push(`疲れがたまっている（疲労 ${Math.round(c.pilot.fatigue)}）。一晩休めば楽になる`);

  c.records.push({ leg, day: c.day, flightMin: f.elapsedMin, fuelUsed: f.fuelUsed, distanceKm: f.stats.pathKm, returned });
  c.condition = cond;
  c.clockMin = f.departureMin + f.elapsedMin;
  c.controls = { ...f.controls };
  if (returned) {
    // 出発地に戻った。行き先はそのまま（選び直してもいい）
    c.turnBacks += 1;
  } else {
    c.location = f.leg.to.id;
    c.destination = isFinished(c) ? null : suggestedDestination(c.world, c.location);
  }
  c.controls.targetAltitude = nextLeg(c)?.cruiseAltitude ?? c.controls.targetAltitude;
  c.events = events;
  c.retorquedHere = false;
}

// ---- 経由地での行動 ----
export interface ActionInfo {
  min: number;
  ok: boolean;
  reason?: string;
}

/** 経由地での作業には時間がかかる */
function spend(c: CampaignState, min: number) {
  passTime(c, min);
}

export function refuelInfo(c: CampaignState, targetL: number): ActionInfo {
  const add = targetL - c.condition.fuelRemaining;
  if (Math.abs(add) < 0.05) return { min: 0, ok: false, reason: "量が同じ" };
  return { min: REFUEL_MIN, ok: true };
}

/** 燃料を targetL にする（減らすときは抜く） */
export function refuel(c: CampaignState, targetL: number): void {
  const info = refuelInfo(c, targetL);
  if (!info.ok) return;
  spend(c, info.min);
  c.condition.fuelRemaining = Math.max(0, Math.min(c.world.fuelCapacityL, targetL));
}

export function retorqueInfo(c: CampaignState): ActionInfo {
  if (c.setup.equipment.toolKit) return { min: TOOLKIT_RETORQUE_MIN, ok: true };
  if (currentPlace(c).hasRepairShop) return { ...SHOP.retorque, ok: true };
  return { min: 0, ok: false, reason: "工具セットも整備場もない" };
}

/** ボルトを締め直す（結果はミニゲームで決まる） */
export function retorque(c: CampaignState, result: TorqueResult): void {
  const info = retorqueInfo(c);
  if (!info.ok) return;
  spend(c, info.min);
  applyTorque(c, result);
  c.maintenanceCount += 1;
  c.retorques += 1;
  c.retorquedHere = true;
}

function applyTorque(c: CampaignState, result: TorqueResult) {
  // 締めすぎは取り消せない（木がつぶれる）。一度締めすぎたら、その後も「締めすぎ」のまま
  const torque: TorqueResult = c.setup.torqueResult === "over" ? "over" : result;
  c.setup = { ...c.setup, torqueResult: torque };
  c.condition.boltTightness = Math.max(c.condition.boltTightness, boltAfter(result));
  c.condition.vibration = vibrationOf(c.condition);
}

export function edgeRepairInfo(c: CampaignState): ActionInfo {
  if (!currentPlace(c).hasRepairShop) return { min: 0, ok: false, reason: "整備場がない" };
  if (c.condition.propEdge >= 99.9) return { ...SHOP.edge, ok: false, reason: "傷んでいない" };
  return { ...SHOP.edge, ok: true };
}

export function repairEdge(c: CampaignState): void {
  const info = edgeRepairInfo(c);
  if (!info.ok) return;
  spend(c, info.min);
  c.condition.propEdge = 100;
  c.condition.edgeAsymmetry = 0;
  c.condition.vibration = vibrationOf(c.condition);
  c.maintenanceCount += 1;
}

export function engineServiceInfo(c: CampaignState): ActionInfo {
  if (!currentPlace(c).hasRepairShop) return { min: 0, ok: false, reason: "整備場がない" };
  if (c.condition.engineHealth >= 99.9) return { ...SHOP.engine, ok: false, reason: "調子は良い" };
  return { ...SHOP.engine, ok: true };
}

export function serviceEngine(c: CampaignState): void {
  const info = engineServiceInfo(c);
  if (!info.ok) return;
  spend(c, info.min);
  c.condition.engineHealth = 100;
  c.maintenanceCount += 1;
}

export function airframeRepairInfo(c: CampaignState): ActionInfo {
  if (!currentPlace(c).hasRepairShop) return { min: 0, ok: false, reason: "整備場がない" };
  if (c.condition.airframe >= 99.9) return { ...SHOP.airframe, ok: false, reason: "傷んでいない" };
  return { ...SHOP.airframe, ok: true };
}

export function repairAirframe(c: CampaignState): void {
  const info = airframeRepairInfo(c);
  if (!info.ok) return;
  spend(c, info.min);
  c.condition.airframe = 100;
  c.maintenanceCount += 1;
}

export function waitInfo(c: CampaignState): ActionInfo {
  if (c.clockMin + WAIT_MIN >= c.world.sunsetMin) return { min: WAIT_MIN, ok: false, reason: "待つと日が暮れる" };
  return { min: WAIT_MIN, ok: true };
}

/** 天気が変わるのを待つ（午後になれば天気が入れ替わり、霧は晴れていく） */
export function waitForWeather(c: CampaignState): void {
  if (!waitInfo(c).ok) return;
  spend(c, WAIT_MIN);
  c.waits += 1;
  // 勇気ある撤退：待つと決めると、気持ちが落ち着く
  c.pilot.haste = Math.max(0, c.pilot.haste - HASTE_RELIEF);
}

export function propSwapInfo(c: CampaignState): ActionInfo {
  if (!c.spareAvailable) return { min: 0, ok: false, reason: "予備のプロペラがない" };
  return { min: PROP_SWAP_MIN, ok: true };
}

/** 予備プロペラに交換する（新しいプロペラのボルトはミニゲームで締める） */
export function swapProp(c: CampaignState, result: TorqueResult): void {
  if (!propSwapInfo(c).ok) return;
  spend(c, PROP_SWAP_MIN);
  c.spareAvailable = false;
  Object.assign(c.condition, { propEdge: 100, edgeAsymmetry: 0, propDurability: 100, boltTightness: 0 });
  c.setup = { ...c.setup, torqueResult: result };
  c.condition.boltTightness = boltAfter(result);
  c.condition.vibration = vibrationOf(c.condition);
  c.maintenanceCount += 1;
}

/** 泊まるのはいつでもできる（次の朝になる） */
export function restInfo(_c: CampaignState): ActionInfo {
  return { min: 0, ok: true };
}

/** 一晩泊まって、次の日の朝にする */
export function rest(c: CampaignState): void {
  if (!restInfo(c).ok) return;
  c.day += 1;
  c.clockMin = MORNING_MIN;
  c.pilot.fatigue = Math.max(0, c.pilot.fatigue - FATIGUE_REST);
  c.pilot.haste = Math.max(0, c.pilot.haste - HASTE_NIGHT_RELIEF);
}

/**
 * ボルト点検の通知（7章：かんたん・ふつうで自動）。湿度の違う土地に着いたか、ゆるみ気味なら知らせる。
 * 通知しないなら null。
 */
export function boltCheckNotice(c: CampaignState): string | null {
  if (!DIFFICULTY[c.difficulty].boltNotice || c.retorquedHere || isFinished(c)) return null;
  const humid = c.events.find((e) => e.startsWith("湿度") && e.includes("ゆるんだ"));
  if (humid) return "湿度の違う土地に着いた。ボルトの点検の時期だ。";
  if (c.condition.boltTightness < 70) return "ボルトがゆるみ気味だ。点検しよう。";
  return null;
}

export const snapshot = (c: CampaignState): CampaignState => clone(c);
