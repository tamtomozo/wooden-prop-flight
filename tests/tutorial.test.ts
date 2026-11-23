import { describe, expect, it } from "vitest";
import { COURSES, TUTORIAL_MOUNTAIN, TUTORIAL_SEA } from "../src/data/courses";
import { DIFFICULTY } from "../src/data/difficulty";
import { legBetween, seaKm } from "../src/data/world";
import { beginLeg, startCampaign } from "../src/game/campaign";
import { setControls, stepFlight, type FlightState } from "../src/game/flight";
import {
  checkTask,
  markShown,
  newTutorial,
  nextTutorialStep,
  TUTORIAL_STEPS,
  type TutorialContext,
  type TutorialState,
} from "../src/game/tutorial";
import { mixturePoints } from "../src/model/physics";
import type { Difficulty, World } from "../src/model/types";
import { makeSetup } from "./helpers";

const ctxOf = (world: World, d: Difficulty = "normal"): TutorialContext => ({
  rule: DIFFICULTY[d],
  world,
  fuelCapacityL: world.fuelCapacityL,
});

/** チュートリアルの説明に言われたとおりに操作する（やってみようを済ませる） */
function obey(f: FlightState, id: string) {
  const mp = mixturePoints(f.altitude);
  switch (id) {
    case "climb-throttle":
      setControls(f, { throttle: 1 });
      break;
    case "climb-mixture":
      setControls(f, { mixture: Math.round(mp.bestPower) });
      break;
    case "cruise-throttle":
      setControls(f, { throttle: 0.72 });
      break;
    case "cruise-mixture":
      setControls(f, { mixture: Math.round(mp.bestEconomy) });
      break;
    case "descent":
    case "overspeed":
      setControls(f, { throttle: 0.5 });
      break;
  }
}

/** はじめの区間を、説明に従いながら飛びきる。出た説明の id を返す */
function flyFirstLeg(world: World, d: Difficulty = "normal") {
  const c = startCampaign(world, makeSetup(3, 100), 7, d);
  const { flight: f } = beginLeg(c);
  const t: TutorialState = newTutorial();
  const ctx = ctxOf(world, d);
  const order: string[] = [];
  for (let i = 0; i < 4000 && f.status === "flying"; i++) {
    checkTask(t, f);
    const step = nextTutorialStep(t, f, ctx);
    if (step) {
      order.push(step.id);
      markShown(t, step, f);
      obey(f, step.id);
    }
    stepFlight(f, 0.25);
  }
  return { f, t, order };
}

describe("チュートリアルのコース", () => {
  it("コース選びのいちばん前に、海ルートと山ルートが並ぶ", () => {
    expect(COURSES.slice(0, 2).map((w) => w.tutorial)).toEqual(["sea", "mountain"]);
    expect(COURSES.filter((w) => w.tutorial)).toHaveLength(2);
  });

  it("海ルートは2区間目だけが湾の上を横切る。山ルートは海がなく、2区間目に山がある", () => {
    const seaLegs = TUTORIAL_SEA.edges.map((e) => [`${e.a}-${e.b}`, seaKm(legBetween(TUTORIAL_SEA, e.a, e.b))] as const);
    expect(seaLegs.filter(([, km]) => km > 0).map(([id]) => id)).toEqual(["hamakaze-numata"]);
    const bay = seaLegs.find(([id]) => id === "hamakaze-numata")![1];
    expect(bay).toBeGreaterThan(40);
    expect(bay).toBeLessThan(90);

    for (const e of TUTORIAL_MOUNTAIN.edges) expect(seaKm(legBetween(TUTORIAL_MOUNTAIN, e.a, e.b))).toBe(0);
    expect(legBetween(TUTORIAL_MOUNTAIN, "kawara", "takane").terrain.length).toBeGreaterThan(0);
  });

  it("はじめの区間は天気がなく、どの区間にも積乱雲は出ない", () => {
    for (const w of [TUTORIAL_SEA, TUTORIAL_MOUNTAIN]) {
      const first = legBetween(w, w.startId, w.fields[1].id);
      expect(first.weather.features).toEqual([]);
      for (const e of w.edges) expect(e.weather.features.some((f) => f.kind === "cb")).toBe(false);
    }
  });
});

describe("チュートリアルの説明（飛行中に止めて説明する）", () => {
  it("離陸するとまず進み方の説明。上昇の説明は、スロットルを全開にするまで「やってみよう」が残る", () => {
    const c = startCampaign(TUTORIAL_SEA, makeSetup(3, 100), 1);
    const { flight: f } = beginLeg(c);
    const t = newTutorial();
    const ctx = ctxOf(TUTORIAL_SEA);
    const first = nextTutorialStep(t, f, ctx)!;
    expect(first.id).toBe("welcome");
    markShown(t, first, f);
    const climb = nextTutorialStep(t, f, ctx)!;
    expect(climb.id).toBe("climb-throttle");
    expect(climb.meters.map((m) => m.sel)).toContain("#g-tach");
    markShown(t, climb, f);
    expect(t.task?.stepId).toBe("climb-throttle");
    // やってみようが済むまで、次の順番の説明は出ない
    expect(checkTask(t, f)).toBe(false);
    expect(nextTutorialStep(t, f, ctx)).toBeNull();
    setControls(f, { throttle: 1 });
    expect(checkTask(t, f)).toBe(true);
    expect(t.task).toBeNull();
  });

  it("説明どおりに操作すると、はじめの区間で順番の説明がすべて出て、着陸の降下の説明も出る", () => {
    for (const w of [TUTORIAL_SEA, TUTORIAL_MOUNTAIN]) {
      const { f, order } = flyFirstLeg(w);
      expect(f.status, w.id).toBe("arrived");
      const scripted = TUTORIAL_STEPS.filter((s) => s.kind === "scripted").map((s) => s.id);
      expect(order.filter((id) => scripted.includes(id)), w.id).toEqual(scripted);
      expect(order, w.id).toContain("descent");
      // 同じ説明は2回出ない
      expect(new Set(order).size).toBe(order.length);
    }
  });

  it("かんたんでは、自動になるミクスチャーの説明を飛ばす", () => {
    const { order } = flyFirstLeg(TUTORIAL_MOUNTAIN, "easy");
    expect(order).not.toContain("climb-mixture");
    expect(order).not.toContain("cruise-mixture");
    expect(order).toContain("cruise-throttle");
  });

  it("「説明をとばす」を押したら、もう出ない", () => {
    const c = startCampaign(TUTORIAL_SEA, makeSetup(3, 100), 1);
    const { flight: f } = beginLeg(c);
    const t = newTutorial();
    t.off = true;
    expect(nextTutorialStep(t, f, ctxOf(TUTORIAL_SEA))).toBeNull();
  });

  it("海ルートの2区間目では、海の手前で海の上の説明が出る", () => {
    const c = startCampaign(TUTORIAL_SEA, makeSetup(3, 100), 3, "normal", "hamakaze");
    c.location = "hamakaze";
    c.destination = "numata";
    const { flight: f } = beginLeg(c);
    const t = newTutorial();
    // 順番の説明は済んだことにする
    t.seen.push(...TUTORIAL_STEPS.filter((s) => s.kind === "scripted").map((s) => s.id));
    const ctx = ctxOf(TUTORIAL_SEA);
    let seaAt: number | null = null;
    for (let i = 0; i < 4000 && f.status === "flying" && seaAt === null; i++) {
      const step = nextTutorialStep(t, f, ctx);
      if (step) {
        markShown(t, step, f);
        t.task = null;
        if (step.id === "sea") seaAt = f.distanceFlown;
      }
      stepFlight(f, 0.25);
    }
    expect(seaAt).not.toBeNull();
    expect(seaAt!).toBeLessThanOrEqual(f.leg.sea[0].fromKm);
  });
});
