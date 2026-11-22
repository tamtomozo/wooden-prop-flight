// 整備士のおすすめセッティング（格納庫）：選んだ最初の行き先から目的地までの道を見て、
// ピッチ・燃料・装備を決める。ボルトの締め付け（A3）は自分でやる。
import { EQUIPMENT_MAX_KG, EQUIPMENT_SLOTS, RESERVE_FUEL_L } from "../config";
import { equipmentKg, NO_EQUIPMENT, slotsUsed } from "../data/equipment";
import { field, legBetween, longestSeaKm, seaKm, shortestPath } from "../data/world";
import { takeoffDistance, totalWeight } from "../model/physics";
import type { Difficulty, Equipment, Leg, PitchLevel, Setup, World } from "../model/types";
import { surfaceTemp } from "../model/weather";
import { chooseDestination, startCampaign } from "./campaign";
import { estimateNextLeg } from "./planner";

export interface Recommendation {
  pitch: PitchLevel;
  fuelPercent: number;
  equipment: Equipment;
  /** なぜそうしたか（整備士の説明。1行ずつ） */
  reasons: string[];
}

/** 予報どおりにいかないときのための余裕（見積もりに掛ける）。海の上は降りられないので多めに */
const MARGIN_LAND = 1.2;
const MARGIN_SEA = 1.35;
/** これより高い尾根がある道なら、上昇型寄りにする */
const MOUNTAIN_M = 1500;
/** これより長い海の上がある道なら、巡航型にする */
const LONG_SEA_KM = 400;
/** 経由地を出るのは、だいたいこの時刻（離陸距離の気温に使う） */
const WAYPOINT_DEPART_MIN = 10 * 60;

const PITCH_NAME: Record<PitchLevel, string> = { 1: "上昇型", 2: "やや上昇", 3: "中間", 4: "やや巡航", 5: "巡航型" };

/** 最初の行き先 destination を通って目的地まで、いちばん近い道順で行くときの区間 */
function plannedLegs(w: World, destination: string): Leg[] {
  const path = [w.startId, ...shortestPath(w, destination, w.goalId)];
  return path.slice(1).map((id, i) => legBetween(w, path[i], id));
}

/** 装備を、優先度の高いものから枠と重さに収まるだけ選ぶ */
function chooseEquipment(w: World, legs: Leg[], dropSpare: boolean): { equipment: Equipment; reasons: string[] } {
  const e: Equipment = { ...NO_EQUIPMENT };
  const reasons: string[] = [];
  const fits = () => slotsUsed(e) <= EQUIPMENT_SLOTS && equipmentKg(e) <= EQUIPMENT_MAX_KG;
  const tryAdd = (apply: () => void, undo: () => void, why: string) => {
    apply();
    if (fits()) reasons.push(why);
    else undo();
  };
  const stops = legs.map((l) => l.from).filter((f) => f.id !== w.startId);
  const unpaved = [...new Set([...legs.map((l) => l.from), ...legs.map((l) => l.to)].filter((f) => f.surface === "unpaved").map((f) => f.id))];
  const rainy = legs.some((l) => l.weather.features.some((f) => f.rain));
  const stormy = legs.some((l) => l.weather.features.some((f) => f.cb));
  const sea = legs.some((l) => l.sea.length > 0);
  const noShop = stops.filter((f) => !f.hasRepairShop);

  if (sea || stormy)
    tryAdd(
      () => (e.weatherRadio = true),
      () => (e.weatherRadio = false),
      `気象ラジオ：${sea ? "海の上では引き返す判断が命だ。" : ""}${stormy ? "積乱雲の出る道だ。" : ""}飛びながら予報を確かめろ`,
    );
  if (unpaved.length || rainy) {
    const gear = unpaved.length >= 3 ? "metal" : "tape";
    tryAdd(
      () => (e.edgeGear = gear),
      () => (e.edgeGear = "none"),
      `${gear === "metal" ? "金属の前縁カバー" : "前縁保護テープ"}：${unpaved.length ? `草地の滑走路が ${unpaved.length} か所` : ""}${unpaved.length && rainy ? "、" : ""}${rainy ? "雨の出る区間がある" : ""}`,
    );
  }
  if (noShop.length)
    tryAdd(
      () => (e.toolKit = true),
      () => (e.toolKit = false),
      `工具セット：${noShop.map((f) => f.name).join("・")}には整備場がない。湿度が変わったら自分で締め直せ`,
    );
  if (!dropSpare && !sea)
    tryAdd(
      () => (e.spareProp = true),
      () => (e.spareProp = false),
      "予備のプロペラ：陸の上なら、割れても畑に降りて付け替えられる",
    );
  return { equipment: e, reasons };
}

export function recommendSetup(w: World, destination: string, difficulty: Difficulty = "normal"): Recommendation {
  const legs = plannedLegs(w, destination);
  const ridge = Math.max(0, ...legs.flatMap((l) => l.terrain.map((r) => r.height)));
  const longestSea = Math.max(0, ...legs.map((l) => longestSeaKm(l)));

  // ピッチの候補：山があれば上昇型寄り、長い海なら巡航型。離陸できなければ1つずつ上昇型へ
  const first: PitchLevel = ridge >= MOUNTAIN_M ? 2 : longestSea >= LONG_SEA_KM ? 5 : 4;
  const candidates = ([first, 5, 4, 3, 2, 1] as PitchLevel[]).filter((p, i, a) => p <= first && a.indexOf(p) === i);

  for (const dropSpare of [false, true]) {
    const { equipment, reasons: gearReasons } = chooseEquipment(w, legs, dropSpare);
    /** 最初の候補で飛び立てなかった飛行場（ピッチを上昇型に寄せた理由） */
    let tooShort: Leg["from"] | null = null;
    for (const pitch of candidates) {
      const plan = planFuel(w, destination, legs, pitch, equipment, difficulty);
      if ("blocked" in plan) {
        tooShort ??= plan.blocked;
        continue;
      }
      const reasons = [
        tooShort
          ? `ピッチ ${pitch}（${PITCH_NAME[pitch]}）：${tooShort.name}の滑走路は ${tooShort.runwayLength} m しかない。次の区間の燃料を積んでも飛び立てるよう、上昇型に寄せた`
          : ridge >= MOUNTAIN_M
          ? `ピッチ ${pitch}（${PITCH_NAME[pitch]}）：${ridge} m の山を越える。上昇の力を優先した`
          : longestSea >= LONG_SEA_KM
            ? `ピッチ ${pitch}（${PITCH_NAME[pitch]}）：${longestSea} km の海を一気に渡る。速さ＝航続距離だ`
            : `ピッチ ${pitch}（${PITCH_NAME[pitch]}）：山はない。巡航寄りで燃費を稼ぐ`,
        plan.reason,
        ...gearReasons,
        dropSpare ? "予備のプロペラは重すぎて、短い滑走路から飛び立てなくなるので外した" : "",
        "ボルトの締め付けだけは、自分の手で締めろ",
      ].filter(Boolean);
      return { pitch, fuelPercent: plan.fuelPercent, equipment, reasons };
    }
  }
  // どうやっても離陸できない道（ふつうはない）：上昇型・燃料半分
  return {
    pitch: 1,
    fuelPercent: 50,
    equipment: { ...NO_EQUIPMENT },
    reasons: ["この道は、どのピッチでも満足に飛び立てない。上昇型で、燃料は経由地ごとに必要なぶんだけにしろ"],
  };
}

/**
 * 最初の区間に積む燃料と、道の途中の飛行場すべてで飛び立てるかの確認。
 * 経由地では、次の区間に要るぶんだけ積むとして調べる。飛び立てない飛行場があれば、その飛行場を返す。
 */
function planFuel(
  w: World,
  destination: string,
  legs: Leg[],
  pitch: PitchLevel,
  equipment: Equipment,
  difficulty: Difficulty,
): { fuelPercent: number; reason: string } | { blocked: Leg["from"] } {
  const setup: Setup = { pitch, fuelPercent: 100, torqueResult: "ok", equipment };
  const c = startCampaign(w, setup, 1, difficulty, destination);
  const kg = equipmentKg(equipment);
  let firstFuel = 0;
  let reason = "";
  for (const [i, leg] of legs.entries()) {
    c.location = leg.from.id;
    chooseDestination(c, leg.to.id);
    const est = estimateNextLeg(c);
    if (!est) return { blocked: leg.from };
    const margin = leg.sea.length ? MARGIN_SEA : MARGIN_LAND;
    const want = est.fuelL * margin + RESERVE_FUEL_L;
    const load = Math.min(w.fuelCapacityL, want);
    const temp = surfaceTemp(leg.from, i === 0 ? w.startMin : WAYPOINT_DEPART_MIN);
    if (takeoffDistance(pitch, leg.from.elevation, temp, totalWeight(load, kg)) > leg.from.runwayLength) return { blocked: leg.from };
    if (i === 0) {
      // 5% きざみで切り上げる。ただし離陸できる量まで
      let pct = Math.min(100, Math.ceil(((want / w.fuelCapacityL) * 100) / 5) * 5);
      while (pct > 5 && takeoffDistance(pitch, leg.from.elevation, temp, totalWeight((w.fuelCapacityL * pct) / 100, kg)) > leg.from.runwayLength)
        pct -= 5;
      firstFuel = pct;
      const sea = seaKm(leg);
      const where = `${field(w, leg.to.id).name}まで ${leg.distanceKm} km${sea ? `（海の上 ${sea} km）` : ""}`;
      reason =
        want > w.fuelCapacityL
          ? `燃料 満タン：${where}。見積もりは約 ${Math.round(est.fuelL)} L。余裕はあまりない。最良燃費で飛び、引き返し限界点に気をつけろ`
          : `燃料 ${pct}%（${Math.round((w.fuelCapacityL * pct) / 100)} L）：${where}。見積もり約 ${Math.round(est.fuelL)} L に、${sea ? "海の上なので多めの" : ""}余裕と予備 ${RESERVE_FUEL_L} L を足した。軽いほど上昇が楽だ`;
    }
  }
  return { fuelPercent: firstFuel, reason };
}
