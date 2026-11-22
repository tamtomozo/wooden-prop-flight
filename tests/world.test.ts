import { describe, expect, it } from "vitest";
import { edgeDistance, legBetween, neighbors, shortestPath, WORLD } from "../src/data/world";
import {
  beginLeg,
  chooseDestination,
  currentPlace,
  departureProblems,
  destinations,
  finishLeg,
  isFinished,
  refuel,
  rest,
  startCampaign,
} from "../src/game/campaign";
import { headwindAt } from "../src/model/weather";
import { CLEAR_ROUTE, flyLeg, makeSetup } from "./helpers";

describe("地図（2章 ルート計画）", () => {
  it("7つの飛行場が道でつながり、どこからでも目的地へ行ける", () => {
    expect(WORLD.fields).toHaveLength(7);
    for (const f of WORLD.fields) expect(shortestPath(WORLD, f.id, WORLD.goalId).length).toBeGreaterThan(0);
    for (const e of WORLD.edges) expect(edgeDistance(WORLD, e)).toBeGreaterThan(80);
  });

  it("いちばん近い道順は山越え（みなみ → かわら → たかね → きた）", () => {
    expect(shortestPath(WORLD, "minami", "kita")).toEqual(["minami", "kawara", "takane", "kita"]);
    expect(neighbors(WORLD, "minami").sort()).toEqual(["hamakaze", "kawara"]);
  });

  it("道を逆向きに飛ぶと、天気と山の位置は反転し、風は逆から吹く", () => {
    const go = legBetween(WORLD, "kawara", "takane");
    const back = legBetween(WORLD, "takane", "kawara");
    expect(back.distanceKm).toBe(go.distanceKm);
    expect(back.from.id).toBe("takane");
    const D = go.distanceKm;
    expect(back.terrain[0].fromKm).toBe(D - go.terrain[0].toKm);
    const cbGo = go.weather.features.find((f) => f.cb)!.cb!;
    const cbBack = back.weather.features.find((f) => f.cb)!.cb!;
    expect(cbBack.alongKm).toBe(D - cbGo.alongKm);
    expect(cbBack.lateralKm).toBe(-cbGo.lateralKm);
    expect(headwindAt(back.weather.winds, 2000)).toBeCloseTo(-headwindAt(go.weather.winds, 2000));
  });
});

describe("行き先を地図で選ぶ", () => {
  it("最初は、目的地へのいちばん近い道順の次の飛行場が選ばれている", () => {
    const c = startCampaign(CLEAR_ROUTE, makeSetup(), 1);
    expect(c.destination).toBe("kawara");
    expect(destinations(c).sort()).toEqual(["hamakaze", "kawara"]);
  });

  it("選べるのは、つながっている飛行場だけ", () => {
    const c = startCampaign(CLEAR_ROUTE, makeSetup(), 1);
    chooseDestination(c, "kita"); // みなみ から きた へは直接行けない
    expect(c.destination).toBe("kawara");
    chooseDestination(c, "hamakaze");
    expect(c.destination).toBe("hamakaze");
  });

  it("海沿いの道（みなみ → はまかぜ → ぬまた → きた）でも目的地に着ける", () => {
    const c = startCampaign(CLEAR_ROUTE, makeSetup(3, 100, "ok", { toolKit: true }), 2, "normal", "hamakaze");
    const visited: string[] = [c.location];
    while (!isFinished(c)) {
      if (c.location === "hamakaze") chooseDestination(c, "numata"); // いちばん近い道は山越えに戻るので、自分で選ぶ
      refuel(c, 70);
      if (c.clockMin > 14 * 60) rest(c);
      expect(departureProblems(c)).toEqual([]);
      const { flight } = beginLeg(c);
      flyLeg(flight, 0.75);
      expect(flight.status).toBe("arrived");
      finishLeg(c, flight);
      visited.push(c.location);
    }
    expect(visited).toEqual(["minami", "hamakaze", "numata", "kita"]);
    expect(currentPlace(c).id).toBe("kita");
  });

  it("とうげ は滑走路がとても短く、満タンでは飛び立てない", () => {
    const c = startCampaign(CLEAR_ROUTE, makeSetup(3, 100), 1);
    c.location = "touge";
    c.destination = "takane";
    refuel(c, 80);
    expect(departureProblems(c).join()).toContain("離陸できない");
    refuel(c, 30);
    expect(departureProblems(c)).toEqual([]);
  });
});
