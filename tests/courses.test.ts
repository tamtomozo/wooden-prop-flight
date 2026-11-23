import { describe, expect, it } from "vitest";
import { MAX_ALTITUDE, RESERVE_FUEL_L } from "../src/config";
import { COURSES, HARUKA, KAMOME, KUMOJI, OWADATSUMI, SHIROGANE, TSURANARI } from "../src/data/courses";
import { clearSkies, isLand, legBetween, seaKm, shortestPath, WORLD } from "../src/data/world";
import { canRecoverWithSpare, startCampaign } from "../src/game/campaign";
import { evaluateFlight, overSea, terrainAt } from "../src/game/flight";
import { recommendSetup } from "../src/game/recommend";
import { climbAltitudeFactor, computePerformance, takeoffDistance, totalWeight } from "../src/model/physics";
import { surfaceTemp } from "../src/model/weather";
import type { World } from "../src/model/types";
import { flyLeg, makeFlight, makeSetup } from "./helpers";

/** 海を渡らない道だけで、出発地から目的地へ行けるか */
function reachableOverLand(w: World) {
  const landEdges = w.edges.filter((e) => seaKm(legBetween(w, e.a, e.b)) === 0);
  const seen = new Set([w.startId]);
  const todo = [w.startId];
  while (todo.length) {
    const id = todo.pop()!;
    for (const e of landEdges) {
      const next = e.a === id ? e.b : e.b === id ? e.a : null;
      if (next && !seen.has(next)) (seen.add(next), todo.push(next));
    }
  }
  return seen.has(w.goalId);
}

describe("コース（海峡・諸島・大洋）", () => {
  it("どのコースも id がちがい、飛行場は陸の上にあり、目的地まで道がある", () => {
    expect(new Set(COURSES.map((c) => c.id)).size).toBe(COURSES.length);
    for (const w of COURSES) {
      for (const f of w.fields) expect(isLand(w, f.x, f.y), `${w.id}/${f.id}`).toBe(true);
      expect(shortestPath(w, w.startId, w.goalId).length).toBeGreaterThan(1);
    }
  });

  it("海を渡るコースは、陸路だけでは目的地へ行けない", () => {
    for (const w of [KAMOME, TSURANARI, OWADATSUMI]) expect(reachableOverLand(w), w.id).toBe(false);
    // 練習の陸の旅には海がない
    expect(reachableOverLand(WORLD)).toBe(true);
    for (const e of WORLD.edges) expect(legBetween(WORLD, e.a, e.b).sea).toEqual([]);
  });

  it("海の上の長さはコースが進むほど長い（海峡 < 諸島 < 大洋）", () => {
    const longest = (w: World) => Math.max(...w.edges.map((e) => seaKm(legBetween(w, e.a, e.b))));
    expect(longest(KAMOME)).toBeLessThan(longest(TSURANARI));
    expect(longest(TSURANARI)).toBeLessThan(longest(OWADATSUMI));
    expect(longest(OWADATSUMI)).toBeGreaterThan(450);
  });

  it("道を逆向きに飛ぶと、海の上の範囲も反転する", () => {
    const go = legBetween(OWADATSUMI, "kitanomisaki", "higashimisaki");
    const back = legBetween(OWADATSUMI, "higashimisaki", "kitanomisaki");
    const D = go.distanceKm;
    expect(back.sea).toHaveLength(1);
    expect(back.sea[0].fromKm).toBeCloseTo(D - go.sea[0].toKm, -0.5);
    expect(back.sea[0].toKm).toBeCloseTo(D - go.sea[0].fromKm, -0.5);
  });

  it("海の上の地面は 0 m", () => {
    const leg = legBetween(KAMOME, "hanasaki", "tomari");
    const mid = (leg.sea[0].fromKm + leg.sea[0].toKm) / 2;
    expect(terrainAt(leg, mid)).toBe(0);
    expect(terrainAt(leg, 0)).toBe(leg.from.elevation);
  });

  it("南回りの直行は、満タンで最良燃費なら予備燃料を残して渡れるが、余裕は少ない", () => {
    const leg = legBetween(clearSkies(OWADATSUMI), "nishihama", "miyako");
    const winds = legBetween(OWADATSUMI, "nishihama", "miyako").weather.winds;
    const f = flyLeg(makeFlight({ leg, fuel: 80, departureMin: 8 * 60, weather: { winds } }), 0.6);
    expect(f.status).toBe("arrived");
    expect(f.condition.fuelRemaining).toBeGreaterThan(RESERVE_FUEL_L);
    expect(f.condition.fuelRemaining).toBeLessThan(30);
    // 燃料が少なければ海の上で尽きる
    const short = flyLeg(makeFlight({ leg, fuel: 45, departureMin: 8 * 60, weather: { winds } }), 0.6);
    expect(short.status).toBe("fuelOut");
    expect(overSea(short)).toBe(true);
    expect(evaluateFlight(short).detail).toContain("着水");
  });

  it("海の上で、戻る燃料がなくなると引き返し限界点の知らせが出る", () => {
    const leg = legBetween(clearSkies(TSURANARI), "nagare", "toono");
    // テストでは知らせを取り出さないので、alerts に残っている
    const f = flyLeg(makeFlight({ leg, fuel: 70, departureMin: 8 * 60 }), 0.6);
    expect(f.status).toBe("arrived");
    expect(f.pastNoReturn).toBe(true);
    expect(f.alerts.some((a) => a.text.includes("引き返し限界点"))).toBe(true);
    // 陸だけの区間では出ない
    const land = flyLeg(makeFlight({ fuel: 40 }), 0.6);
    expect(land.pastNoReturn).toBe(false);
  });

  it("海の上でプロペラが外れたら、予備のプロペラがあっても飛び続けられない", () => {
    const c = startCampaign(KAMOME, makeSetup(3, 100, "ok", { spareProp: true }), 1);
    const leg = legBetween(clearSkies(KAMOME), "hanasaki", "tomari");
    const f = makeFlight({ leg });
    f.status = "propFailure";
    f.failure = "propOff";
    f.distanceFlown = (leg.sea[0].fromKm + leg.sea[0].toKm) / 2;
    expect(canRecoverWithSpare(c, f)).toBe(false);
    expect(evaluateFlight(f).detail).toContain("着水");
    f.distanceFlown = 2; // 岬の上ならまだ畑に降りられる
    expect(canRecoverWithSpare(c, f)).toBe(true);
  });
});

describe("しろがね山脈を越える（山越えコース）", () => {
  const W = SHIROGANE;
  const ridgeOf = (a: string, b: string) => Math.max(0, ...legBetween(W, a, b).terrain.map((r) => r.height));

  it("海はなく、目的地へのどの道も山を越える。いちばん高い山は 3000 m を超えるが、高度の上限より低い", () => {
    expect(W.land).toBeUndefined();
    for (const e of W.edges) {
      expect(legBetween(W, e.a, e.b).sea).toEqual([]);
      // すすめの巡航高度なら、その道の山を越えられる
      expect(e.cruiseAltitude, `${e.a}-${e.b}`).toBeGreaterThan(ridgeOf(e.a, e.b));
      expect(e.cruiseAltitude).toBeLessThanOrEqual(MAX_ALTITUDE);
    }
    const into = W.edges.filter((e) => e.a === W.goalId || e.b === W.goalId);
    for (const e of into) expect(ridgeOf(e.a, e.b), `${e.a}-${e.b}`).toBeGreaterThanOrEqual(1800);
    const highest = Math.max(...W.edges.map((e) => ridgeOf(e.a, e.b)));
    expect(highest).toBeGreaterThan(3000);
    expect(highest).toBeLessThan(MAX_ALTITUDE);
  });

  it("高いほど空気が薄く、上昇率が落ちる（1000 m までは変わらず、3000 m で半分）", () => {
    expect(climbAltitudeFactor(0)).toBe(1);
    expect(climbAltitudeFactor(1000)).toBe(1);
    expect(climbAltitudeFactor(3000)).toBeCloseTo(0.5);
    expect(climbAltitudeFactor(MAX_ALTITUDE)).toBeLessThan(0.4);
    const climb = (altitude: number) =>
      computePerformance({
        pitch: 2, throttle: 1, mixture: 40, altitude, propEdge: 100, engineHealth: 100,
        carbIcePenalty: 1, headwindKmh: 0, fuelRemaining: 50, phase: "climb",
      }).climbRate;
    expect(climb(3000) / climb(500)).toBeLessThan(0.6);
  });

  it("かざこし峠：上昇型なら越えられるが、巡航型で満タンだと上昇が間に合わず山にぶつかる", () => {
    const leg = legBetween(clearSkies(W), "tanima", "kougen");
    const winds = legBetween(W, "tanima", "kougen").weather.winds;
    const climber = flyLeg(makeFlight({ leg, pitch: 2, fuel: 40, departureMin: 8 * 60, weather: { winds } }), 0.6);
    expect(climber.status).toBe("arrived");
    const heavy = flyLeg(makeFlight({ leg, pitch: 5, fuel: 80, departureMin: 8 * 60, weather: { winds } }), 0.6);
    expect(heavy.status).toBe("terrain");
    expect(heavy.distanceFlown).toBeLessThan(30);
  });

  it("こうげん（標高 1700 m）は空気が薄く、ふもとより飛び立つのに長い距離がいる", () => {
    const susono = W.fields.find((f) => f.id === "susono")!;
    const kougen = W.fields.find((f) => f.id === "kougen")!;
    const at = (f: typeof kougen, pitch: 1 | 3 | 5, fuel: number) => takeoffDistance(pitch, f.elevation, surfaceTemp(f, 10 * 60), totalWeight(fuel, 8));
    expect(at(kougen, 3, 40) / at(susono, 3, 40)).toBeGreaterThan(1.3);
    // 巡航型で多めに積むと飛び立てない。上昇型なら満タンでも飛び立てる
    expect(at(kougen, 5, 60)).toBeGreaterThan(kougen.runwayLength);
    expect(at(kougen, 1, 80)).toBeLessThanOrEqual(kougen.runwayLength);
  });

  it("整備士のおすすめは、どの道でも上昇型寄り", () => {
    for (const dest of ["tanima", "asahi", "hikune"]) expect(recommendSetup(W, dest).pitch, dest).toBeLessThanOrEqual(2);
  });

  it("峰をまっすぐ越える直行は、満タンなら届くが、半分では山の向こうまで届かない", () => {
    const leg = legBetween(clearSkies(W), "susono", "asahi");
    const winds = legBetween(W, "susono", "asahi").weather.winds;
    expect(flyLeg(makeFlight({ leg, pitch: 2, fuel: 80, departureMin: 7 * 60, weather: { winds } }), 0.6).status).toBe("arrived");
    expect(flyLeg(makeFlight({ leg, pitch: 2, fuel: 40, departureMin: 7 * 60, weather: { winds } }), 0.6).status).toBe("fuelOut");
  });
});

describe("海と山の複合コース（くもじ峠と島・はるか海と山脈）", () => {
  const ridgeOf = (w: World, a: string, b: string) => Math.max(0, ...legBetween(w, a, b).terrain.map((r) => r.height));
  /** 晴れの道を、予報の風だけ入れて、教科書どおりに飛ぶ */
  const fly = (w: World, a: string, b: string, pitch: 1 | 2 | 3 | 4 | 5, fuel: number, departureMin = 8 * 60) => {
    const leg = legBetween(clearSkies(w), a, b);
    const winds = legBetween(w, a, b).weather.winds;
    return flyLeg(makeFlight({ leg, pitch, fuel, departureMin, weather: { winds } }), 0.6);
  };

  it("どちらも海と高い山の両方があり、陸路だけでは目的地へ行けない", () => {
    for (const w of [KUMOJI, HARUKA]) {
      expect(reachableOverLand(w), w.id).toBe(false);
      expect(Math.max(...w.edges.map((e) => ridgeOf(w, e.a, e.b))), w.id).toBeGreaterThanOrEqual(2500);
      expect(Math.max(...w.edges.map((e) => seaKm(legBetween(w, e.a, e.b)))), w.id).toBeGreaterThanOrEqual(120);
      for (const e of w.edges) {
        expect(e.cruiseAltitude, `${w.id} ${e.a}-${e.b}`).toBeGreaterThan(ridgeOf(w, e.a, e.b));
        expect(e.cruiseAltitude).toBeLessThanOrEqual(MAX_ALTITUDE);
      }
    }
  });

  it("くもじ峠：谷を出てすぐの上りは、巡航型では越えられないが、中間なら満タンでも越えられる", () => {
    expect(fly(KUMOJI, "yamaai", "urano", 5, 40, 9 * 60).status).toBe("terrain");
    expect(fly(KUMOJI, "yamaai", "urano", 3, 80, 9 * 60).status).toBe("arrived");
    // 峰の横をまっすぐ越える道は、山が遠いので巡航型でも越えられる
    expect(fly(KUMOJI, "akeno", "urano", 5, 60, 9 * 60).status).toBe("arrived");
  });

  it("くもじ峠と島：山を避けて南の浜から小島づたいに行くと、海の上が長くなる", () => {
    const south = seaKm(legBetween(KUMOJI, "minamiura", "kobato")) + seaKm(legBetween(KUMOJI, "kobato", "akane"));
    expect(south).toBeGreaterThan(1.5 * seaKm(legBetween(KUMOJI, "urano", "akane")));
    // 南の浜までは山がない
    expect(ridgeOf(KUMOJI, "akeno", "minamiura")).toBe(0);
  });

  it("はるか海：まっすぐ渡ると、巡航型なら満タンで余裕があるが、上昇型では予備燃料ぎりぎり", () => {
    const cruise = fly(HARUKA, "nishinominato", "mukouhama", 5, 80);
    const climber = fly(HARUKA, "nishinominato", "mukouhama", 2, 80);
    expect(seaKm(cruise.leg)).toBeGreaterThan(350);
    expect(cruise.status).toBe("arrived");
    expect(cruise.condition.fuelRemaining).toBeGreaterThan(RESERVE_FUEL_L + 10);
    expect(climber.condition.fuelRemaining).toBeLessThan(RESERVE_FUEL_L + 4);
    expect(fly(HARUKA, "nishinominato", "mukouhama", 1, 80).condition.fuelRemaining).toBeLessThan(RESERVE_FUEL_L);
  });

  it("ゆきがね峠：上昇型なら越えられ、中間は軽ければ越えられ、巡航型は越えられない。巡航型は にしの峠 へ回る", () => {
    expect(fly(HARUKA, "mukouhama", "takamachi", 2, 80).status).toBe("arrived");
    expect(fly(HARUKA, "mukouhama", "takamachi", 3, 40).status).toBe("arrived");
    expect(fly(HARUKA, "mukouhama", "takamachi", 3, 80).status).toBe("terrain");
    expect(fly(HARUKA, "mukouhama", "takamachi", 5, 40).status).toBe("terrain");
    expect(fly(HARUKA, "sawabe", "takamachi", 5, 80).status).toBe("arrived");
  });

  it("整備士のおすすめ：長い海と高い山が続く道は中間、島づたいなら上昇型寄り", () => {
    expect(recommendSetup(HARUKA, "mukouhama").pitch).toBe(3);
    expect(recommendSetup(HARUKA, "mukouhama").fuelPercent).toBe(100);
    expect(recommendSetup(HARUKA, "nakanoshima").pitch).toBeLessThanOrEqual(2);
    expect(recommendSetup(KUMOJI, "yamaai").pitch).toBeLessThanOrEqual(2);
  });
});
