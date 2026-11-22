import { describe, expect, it } from "vitest";
import { EQUIPMENT_MAX_KG, EQUIPMENT_SLOTS } from "../src/config";
import { COURSES, KAMOME, OWADATSUMI } from "../src/data/courses";
import { equipmentKg, slotsUsed } from "../src/data/equipment";
import { neighbors, WORLD } from "../src/data/world";
import { setupProblems, startCampaign, takeoffCheck, chooseDestination } from "../src/game/campaign";
import { recommendSetup } from "../src/game/recommend";
import { takeoffDistance, totalWeight } from "../src/model/physics";
import { surfaceTemp } from "../src/model/weather";

describe("整備士のおすすめセッティング", () => {
  it("どのコースのどの最初の行き先でも、装備は枠と重さに収まり、出発地から飛び立てる", () => {
    for (const w of COURSES) {
      for (const dest of neighbors(w, w.startId)) {
        const r = recommendSetup(w, dest);
        expect(slotsUsed(r.equipment), `${w.id}→${dest}`).toBeLessThanOrEqual(EQUIPMENT_SLOTS);
        expect(equipmentKg(r.equipment)).toBeLessThanOrEqual(EQUIPMENT_MAX_KG);
        expect(setupProblems(w, { pitch: r.pitch, fuelPercent: r.fuelPercent, torqueResult: "ok", equipment: r.equipment })).toEqual([]);
        expect(r.reasons.length).toBeGreaterThan(2);
      }
    }
  });

  it("山越えの道は上昇型寄り、長い海を一気に渡る道は巡航型", () => {
    expect(recommendSetup(WORLD, "kawara").pitch).toBeLessThanOrEqual(2);
    expect(recommendSetup(OWADATSUMI, "miyako").pitch).toBe(5);
  });

  it("長い海の直行は満タン、短い陸の区間は必要なぶんだけ", () => {
    expect(recommendSetup(OWADATSUMI, "miyako").fuelPercent).toBe(100);
    expect(recommendSetup(OWADATSUMI, "kitanomisaki").fuelPercent).toBeLessThan(80);
  });

  it("海を渡る道には気象ラジオを積み、海の上では役に立たない予備のプロペラは積まない", () => {
    const r = recommendSetup(KAMOME, "tomari");
    expect(r.equipment.weatherRadio).toBe(true);
    expect(r.equipment.spareProp).toBe(false);
  });

  it("北回りでは、短い滑走路（きたのみさき 380 m）から、海を渡る燃料を積んで飛び立てるピッチにする", () => {
    const r = recommendSetup(OWADATSUMI, "kitanomisaki");
    const f = OWADATSUMI.fields.find((x) => x.id === "kitanomisaki")!;
    // 経由地では満タン近くまで積む見込みなので、そのときも滑走路に収まる
    const d = takeoffDistance(r.pitch, f.elevation, surfaceTemp(f, 10 * 60), totalWeight(70, equipmentKg(r.equipment)));
    expect(d).toBeLessThanOrEqual(f.runwayLength);
    // 出発地からも、そのまま飛び立てる
    const c = startCampaign(OWADATSUMI, { pitch: r.pitch, fuelPercent: r.fuelPercent, torqueResult: "ok", equipment: r.equipment }, 1);
    chooseDestination(c, "kitanomisaki");
    expect(takeoffCheck(c).ok).toBe(true);
  });
});
