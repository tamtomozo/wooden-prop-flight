import { describe, expect, it } from "vitest";
import {
  beginLeg,
  currentPlace,
  departureProblems,
  edgeRepairInfo,
  finishLeg,
  isFinished,
  legWeather,
  recoverWithSpare,
  refuel,
  rest,
  retorque,
  retorqueInfo,
  setupProblems,
  startCampaign,
  takeoffCheck,
} from "../src/game/campaign";
import { WORLD } from "../src/data/world";
import { humidityBoltLoss } from "../src/model/physics";
import { REFUEL_MIN, SHOP } from "../src/config";
import { CLEAR_ROUTE as STEP2_ROUTE, flyLeg, makeSetup } from "./helpers";


describe("格納庫のセッティング", () => {
  it("装備は3枠・25kgまで", () => {
    expect(setupProblems(STEP2_ROUTE, makeSetup(3, 100, "ok", { toolKit: true, spareProp: true }))).toEqual([]);
    expect(
      setupProblems(STEP2_ROUTE, makeSetup(3, 100, "ok", { toolKit: true, spareProp: true, weatherRadio: true })),
    ).toContain("装備の重さは 25 kg まで");
    expect(
      setupProblems(STEP2_ROUTE, makeSetup(3, 100, "ok", { edgeGear: "tape", toolKit: true, weatherRadio: true, spareProp: true })),
    ).toContain("装備は 3 枠まで");
  });

  it("お金はかからない。整備や給油には時間だけがかかる", () => {
    const c = startCampaign(STEP2_ROUTE, makeSetup(3, 50), 1);
    expect("money" in c).toBe(false);
    const t0 = c.clockMin;
    refuel(c, 80);
    expect(c.clockMin).toBe(t0 + REFUEL_MIN);
    retorque(c, "ok"); // みなみの整備場で
    expect(c.clockMin).toBe(t0 + REFUEL_MIN + SHOP.retorque.min);
  });
});

describe("ステップ2の完了条件：2区間以上を飛び、湿度の違う経由地でボルトがゆるむ", () => {
  it("かわら（85%）→ たかね（35%）でボルトが大きくゆるみ、振動が出る", () => {
    const c = startCampaign(STEP2_ROUTE, makeSetup(3, 100, "ok", { toolKit: true }), 7);

    // 1区間目：みなみ（75%）→ かわら（85%）
    let { flight } = beginLeg(c);
    flyLeg(flight, 0.7);
    expect(flight.status).toBe("arrived");
    finishLeg(c, flight);
    expect(currentPlace(c).id).toBe("kawara");
    const boltAtKawara = c.condition.boltTightness;

    // 2区間目：かわら → たかね（山越え）。燃料を減らさないと離陸できない量にしてから、必要なぶんだけ積む
    refuel(c, 60);
    expect(takeoffCheck(c).ok).toBe(true);
    ({ flight } = beginLeg(c));
    const boltBeforeLanding = () => flight.condition.boltTightness;
    flyLeg(flight, 0.7);
    expect(flight.status).toBe("arrived");
    const inFlight = boltBeforeLanding();
    finishLeg(c, flight);

    expect(currentPlace(c).id).toBe("takane");
    expect(c.records).toHaveLength(2);
    // 着いたあとのゆるみは湿度の差（50%）によるもの
    expect(inFlight - c.condition.boltTightness).toBeCloseTo(humidityBoltLoss(85, 35, "ok"));
    expect(c.condition.boltTightness).toBeLessThan(boltAtKawara - 35);
    expect(c.condition.vibration).toBeGreaterThanOrEqual(30);
    expect(c.events.some((e) => e.includes("湿度 85% → 35%"))).toBe(true);

    // 整備場で締め直すとボルトが戻る
    retorque(c, "ok");
    expect(c.condition.boltTightness).toBe(100);
    expect(c.condition.vibration).toBeLessThan(10);
  });

  it("3区間すべて飛べる", () => {
    const c = startCampaign(STEP2_ROUTE, makeSetup(3, 100, "ok", { toolKit: true, edgeGear: "tape" }), 3);
    while (!isFinished(c)) {
      refuel(c, 60);
      if (c.clockMin > 14 * 60) rest(c);
      if (c.condition.boltTightness < 70) retorque(c, "ok");
      expect(departureProblems(c)).toEqual([]);
      const { flight } = beginLeg(c);
      flyLeg(flight, 0.75);
      expect(flight.status).toBe("arrived");
      finishLeg(c, flight);
    }
    expect(currentPlace(c).id).toBe("kita");
  });
});

describe("経由地での判断", () => {
  it("巡航型（ピッチ5）は満タンだと、かわらの短い滑走路から離陸できない", () => {
    const c = startCampaign(STEP2_ROUTE, makeSetup(5, 100), 1);
    const { flight } = beginLeg(c);
    flyLeg(flight, 0.7);
    finishLeg(c, flight);
    refuel(c, 80);
    expect(takeoffCheck(c).ok).toBe(false);
    expect(departureProblems(c)[0]).toContain("離陸できない");
    refuel(c, 45);
    expect(takeoffCheck(c).ok).toBe(true);
  });

  it("工具セットがなければ、整備場のない飛行場ではボルトを締め直せない", () => {
    const c = startCampaign(STEP2_ROUTE, makeSetup(), 1);
    expect(retorqueInfo(c).ok).toBe(true); // みなみには整備場がある
    const { flight } = beginLeg(c);
    flyLeg(flight, 0.7);
    finishLeg(c, flight);
    expect(currentPlace(c).hasRepairShop).toBe(false);
    expect(retorqueInfo(c).ok).toBe(false);
    expect(edgeRepairInfo(c).ok).toBe(false);
  });

  it("日が暮れたら出発できず、泊まると次の朝になる", () => {
    const c = startCampaign(STEP2_ROUTE, makeSetup(), 1);
    c.clockMin = STEP2_ROUTE.sunsetMin + 10;
    expect(departureProblems(c)).toContain("日が暮れている（泊まって朝を待つ）");
    rest(c);
    expect(c.day).toBe(2);
    expect(departureProblems(c)).toEqual([]);
  });

  it("予備のプロペラがあれば、プロペラの事故から一度だけ復帰できる", () => {
    const c = startCampaign(STEP2_ROUTE, makeSetup(3, 100, "ok", { spareProp: true }), 1);
    const { flight } = beginLeg(c);
    flight.status = "propFailure";
    flight.failure = "propOff";
    expect(recoverWithSpare(c, flight)).toBe(true);
    expect(flight.status).toBe("flying");
    expect(flight.condition.boltTightness).toBe(100);
    flight.status = "propFailure";
    expect(recoverWithSpare(c, flight)).toBe(false);
  });

  it("未舗装の滑走路では前縁が傷み、保護テープがあると傷が減る", () => {
    const loss = (edgeGear: "none" | "tape") => {
      let total = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const c = startCampaign(STEP2_ROUTE, makeSetup(3, 100, "ok", { edgeGear }), seed);
        const { flight } = beginLeg(c);
        flyLeg(flight, 0.7);
        finishLeg(c, flight); // かわら（未舗装）に着陸
        total += 100 - c.condition.propEdge;
      }
      return total;
    };
    expect(loss("none")).toBeGreaterThan(0);
    expect(loss("tape")).toBeLessThan(loss("none"));
  });

  it("格納庫で見る最初の区間の予報は、同じ種なら、出発したあとの予報と同じ（ピッチ・燃料・装備では変わらない）", () => {
    const seed = 12345;
    const hangar = startCampaign(WORLD, makeSetup(3, 100), seed, "normal", "kawara");
    const trip = startCampaign(WORLD, makeSetup(1, 40, "ok", { weatherRadio: true }), seed, "normal", "kawara");
    expect(legWeather(trip)).toEqual(legWeather(hangar));
    // 行き先が変われば、別の道の予報になる
    const other = startCampaign(WORLD, makeSetup(3, 100), seed, "normal", "hamakaze");
    expect(legWeather(other)!.forecast).not.toEqual(legWeather(hangar)!.forecast);
  });
});
