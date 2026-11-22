import { describe, expect, it } from "vitest";
import { RESERVE_FUEL_L } from "../src/config";
import { COURSES, KAMOME, OWADATSUMI, TSURANARI } from "../src/data/courses";
import { clearSkies, isLand, legBetween, seaKm, shortestPath, WORLD } from "../src/data/world";
import { canRecoverWithSpare, startCampaign } from "../src/game/campaign";
import { evaluateFlight, overSea, terrainAt } from "../src/game/flight";
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
