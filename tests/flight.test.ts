import { legBetween } from "../src/data/world";
import { describe, expect, it } from "vitest";
import { BOLT_DANGER, EMPTY_WEIGHT, REDLINE_RPM } from "../src/config";
import { evaluateFlight, setControls, stepFlight, type FlightState } from "../src/game/flight";
import {
  computePerformance,
  createRng,
  exhaustTemp,
  humidityBoltLoss,
  mixtureEffect,
  mixturePoints,
  pitchFactors,
  stoneDamage,
  takeoffDistance,
  vibrationOf,
} from "../src/model/physics";
import type { AircraftCondition, PitchLevel } from "../src/model/types";
import { autopilot, CLEAR_ROUTE, flyLeg, freshCondition, makeFlight } from "./helpers";

const ALT = 1500;
const pts = mixturePoints(ALT);
const LEG1 = legBetween(CLEAR_ROUTE, "minami", "kawara");

function flight(opts: { pitch?: PitchLevel; fuel?: number; condition?: Partial<AircraftCondition> } = {}) {
  return makeFlight(opts);
}

/** 操作を固定して最後まで飛ばす */
function flyFixed(f: FlightState, throttle: number, mixture: number) {
  setControls(f, { throttle, mixture });
  return flyLeg(f, throttle, true);
}

describe("4章の計算モデル", () => {
  it("4.1 ピッチ3は中間の値", () => {
    const f = pitchFactors(3);
    expect(f.pitchSpeedFactor).toBeCloseTo(1.0);
    expect(f.staticRPM).toBe(2300);
  });

  it("4.3 適正位置は高度で薄い側へ動く（3000mで50）", () => {
    expect(mixturePoints(3000).bestPower).toBe(50);
  });

  it("4.3 最大出力・最良燃費の係数が設計書どおり", () => {
    const p = mixtureEffect(pts.bestPower, ALT);
    expect(p.power).toBeCloseTo(1.0);
    expect(p.fuel).toBeCloseTo(1.0);
    const e = mixtureEffect(pts.bestEconomy, ALT);
    expect(e.power).toBeCloseTo(0.96);
    expect(e.fuel).toBeCloseTo(0.85);
    expect(mixtureEffect(0, ALT)).toMatchObject({ power: 0.95, fuel: 1.25, zone: "rich" });
    expect(mixtureEffect(pts.tooLean + 5, ALT).leanDamagePerMin).toBe(2);
  });

  it("排気温度は最良燃費の混合比で一番高く、目盛り（400〜800℃）に収まる", () => {
    const be = pts.bestEconomy;
    expect(exhaustTemp(be, ALT, 0.7)).toBeGreaterThan(exhaustTemp(be - 5, ALT, 0.7));
    expect(exhaustTemp(be, ALT, 0.7)).toBeGreaterThan(exhaustTemp(be + 5, ALT, 0.7));
    for (const alt of [0, 3000])
      for (const m of [0, mixturePoints(alt).bestEconomy, 100])
        for (const t of [0.2, 1]) {
          expect(exhaustTemp(m, alt, t)).toBeGreaterThanOrEqual(400);
          expect(exhaustTemp(m, alt, t)).toBeLessThanOrEqual(800);
        }
  });

  it("4.4 全開・最大出力で150km/h、向かい風30で対地120km/h", () => {
    const p = computePerformance({
      pitch: 3, throttle: 1, mixture: pts.bestPower, altitude: ALT,
      propEdge: 100, engineHealth: 100, carbIcePenalty: 1, headwindKmh: 30, fuelRemaining: 50,
    });
    expect(p.airspeed).toBeCloseTo(150);
    expect(p.groundSpeed).toBeCloseTo(120);
    expect(p.fuelBurn).toBeCloseTo(25);
    expect(p.rangeKm).toBeCloseTo(240);
  });

  it("4.5 離陸距離：重い・暑い・高い・巡航型ほど長い", () => {
    const base = takeoffDistance(3, 0, 15, EMPTY_WEIGHT);
    expect(base).toBeCloseTo(300);
    expect(takeoffDistance(3, 0, 15, EMPTY_WEIGHT * 1.2)).toBeCloseTo(300 * 1.44);
    expect(takeoffDistance(3, 0, 35, EMPTY_WEIGHT)).toBeGreaterThan(base);
    expect(takeoffDistance(3, 900, 20, EMPTY_WEIGHT)).toBeGreaterThan(base);
    expect(takeoffDistance(5, 0, 15, EMPTY_WEIGHT)).toBeGreaterThan(takeoffDistance(1, 0, 15, EMPTY_WEIGHT));
  });

  it("4.6 湿度の差が大きいほどボルトがゆるみ、締め付け不足だと1.5倍", () => {
    expect(humidityBoltLoss(85, 35, "ok")).toBeCloseTo(40);
    expect(humidityBoltLoss(85, 35, "under")).toBeCloseTo(60);
    expect(humidityBoltLoss(75, 80, "ok")).toBeCloseTo(4);
  });

  it("4.7 前縁の保護があると小石の傷が減る", () => {
    expect(stoneDamage(1, "none").edgeLoss).toBeCloseTo(5);
    expect(stoneDamage(1, "tape").edgeLoss).toBeLessThan(stoneDamage(1, "none").edgeLoss);
    expect(stoneDamage(1, "metal").edgeLoss).toBeLessThan(stoneDamage(1, "tape").edgeLoss);
  });

  it("4.8 振動はボルトのゆるみと前縁の傷の左右差で増える", () => {
    const c = freshCondition();
    expect(vibrationOf(c)).toBe(0);
    expect(vibrationOf({ ...c, boltTightness: 50 })).toBeCloseTo(30);
    expect(vibrationOf({ ...c, propEdge: 60, edgeAsymmetry: 1 })).toBeCloseTo(12);
  });
});

describe("プロペラのピッチの得失", () => {
  it("上昇型は上昇が速い、巡航型は巡航が速い", () => {
    const climb1 = flight({ pitch: 1 }).perf.climbRate;
    const climb5 = flight({ pitch: 5 }).perf.climbRate;
    expect(climb1).toBeGreaterThan(climb5 * 1.3);
    const cruise = (pitch: PitchLevel) => {
      const f = flight({ pitch });
      f.altitude = f.controls.targetAltitude;
      setControls(f, { throttle: 0.7 });
      return f.perf.airspeed;
    };
    expect(cruise(5)).toBeGreaterThan(cruise(1));
  });

  it("上昇型は全開だと回転が上がりすぎる。降下ではさらに上がる（付録B）", () => {
    const f = flight({ pitch: 1 });
    f.altitude = f.controls.targetAltitude;
    setControls(f, { throttle: 1, mixture: 40 });
    expect(f.phase).toBe("cruise");
    expect(f.perf.rpm).toBeGreaterThan(REDLINE_RPM);
    const cruiseRpm = f.perf.rpm;
    setControls(f, { targetAltitude: 500 });
    expect(f.phase).toBe("descent");
    expect(f.perf.rpm).toBeGreaterThan(cruiseRpm);
    // 巡航型なら全開の巡航でもレッドライン以下
    const g = flight({ pitch: 5 });
    g.altitude = g.controls.targetAltitude;
    setControls(g, { throttle: 1, mixture: 40 });
    expect(g.perf.rpm).toBeLessThan(REDLINE_RPM);
  });
});

describe("1区間の飛行", () => {
  it("上昇 → 巡航 → 降下 → 着陸の順に進む", () => {
    const f = flight();
    const phases: string[] = [];
    for (let i = 0; i < 2000 && f.status === "flying"; i++) {
      if (phases[phases.length - 1] !== f.phase) phases.push(f.phase);
      autopilot(f, 0.75);
      stepFlight(f, 0.5);
    }
    // 降下のあと、滑走路の手前で水平になることがある
    expect(phases.slice(0, 3)).toEqual(["climb", "cruise", "descent"]);
    expect(f.status).toBe("arrived");
    expect(f.altitude).toBe(LEG1.to.elevation);
  });

  it("濃いままでは燃料切れ、最良燃費なら到着（ステップ1と同じ学び）", () => {
    expect(flyFixed(flight({ fuel: 32 }), 0.75, 0).status).toBe("fuelOut");
    expect(flyLeg(flight({ fuel: 32 }), 0.7).status).toBe("arrived");
  });

  it("ボルトが危険域だとプロペラが外れることがある", () => {
    let off = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const f = flight({ condition: { boltTightness: 2 } });
      f.rng = createRng(seed);
      flyLeg(f, 0.7);
      if (f.failure === "propOff") off++;
    }
    expect(off).toBeGreaterThan(5);
    // 危険域でなければ外れない
    const safe = flyLeg(flight({ condition: { boltTightness: BOLT_DANGER + 10 } }), 0.7);
    expect(safe.status).toBe("arrived");
  });

  it("強い振動が続くとプロペラが割れる", () => {
    const f = flight({ condition: { boltTightness: 25, propEdge: 0, edgeAsymmetry: 1 }, fuel: 80 });
    f.rng = () => 0.999; // 外れはしないことにする
    flyLeg(f, 0.7);
    expect(f.status).toBe("propFailure");
    expect(f.failure).toBe("propBroken");
    expect(evaluateFlight(f).title).toBe("プロペラが割れた");
  });
});
