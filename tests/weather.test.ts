import { describe, expect, it } from "vitest";
import { legBetween, WORLD as ROUTE } from "../src/data/world";
import {
  beginLeg,
  departureProblems,
  finishLeg,
  foggedNow,
  legWeather,
  startCampaign,
  waitForWeather,
} from "../src/game/campaign";
import { distanceLeft, knownState, setControls, setLateralTarget, stepFlight, turnBack, useRadio } from "../src/game/flight";
import { rainErosionPerHour } from "../src/model/physics";
import { carbIceRate, fogChance, generateWeather, headwindAt, spreadAt, surfaceTemp } from "../src/model/weather";
import type { WeatherTemplate } from "../src/model/types";
import { CLEAR_ROUTE, flyLeg, makeFlight, makeSetup } from "./helpers";

const LEG1 = legBetween(CLEAR_ROUTE, "minami", "kawara");
const rainBand = { fromKm: 50, toKm: 150, lateralKm: 0, halfWidthKm: 30 };

describe("ステップ3の完了条件：雨で前縁が削れ、スロットルを絞ると削れ方が減る", () => {
  const flyThroughRain = (throttle: number, edgeGear: "none" | "tape" = "none") => {
    const f = makeFlight({ fuel: 80, weather: { rain: [{ ...rainBand, intensity: 2, id: "r" }] }, equipment: { edgeGear } });
    flyLeg(f, throttle);
    expect(f.status).toBe("arrived");
    return f;
  };

  it("雨の中を飛ぶと前縁が削れる", () => {
    const f = flyThroughRain(0.8);
    expect(f.stats.rainMinutes).toBeGreaterThan(30);
    expect(f.condition.propEdge).toBeLessThan(100);
    expect(f.stats.rainEdgeLoss).toBeGreaterThan(1);
  });

  it("スロットルを絞ると、雨の中にいる時間が延びても、削れ方は減る", () => {
    const full = flyThroughRain(1.0);
    const low = flyThroughRain(0.55);
    expect(low.stats.rainMinutes).toBeGreaterThan(full.stats.rainMinutes);
    expect(low.stats.rainEdgeLoss).toBeLessThan(full.stats.rainEdgeLoss * 0.6);
  });

  it("4.7 の式：回転数の2乗に比例し、保護テープで半分", () => {
    expect(rainErosionPerHour(2, 2500, "none")).toBeCloseTo(8);
    expect(rainErosionPerHour(2, 1250, "none")).toBeCloseTo(2);
    expect(rainErosionPerHour(2, 2500, "tape")).toBeCloseTo(4);
    expect(flyThroughRain(0.8, "tape").stats.rainEdgeLoss).toBeLessThan(flyThroughRain(0.8).stats.rainEdgeLoss * 0.6);
  });
});

describe("雲・積乱雲・乱気流", () => {
  const cloud = { fromKm: 60, toKm: 140, lateralKm: 0, halfWidthKm: 20, base: 900, top: 2400, id: "c" };

  it("雲に入ったままだと、方向感覚が狂って操縦できなくなる（地面まで雲なら逃げ場がない）", () => {
    const low = { ...cloud, base: 0 };
    const f = flyLeg(makeFlight({ fuel: 80, weather: { clouds: [low] } }), 0.7);
    expect(["lostControl", "terrain"]).toContain(f.status);
  });

  it("雲の中に長くいると、気づかないうちに旋回降下に入る（高度が下がり、速度が上がり、機体が傷む）", () => {
    const thick = { ...cloud, fromKm: 0, toKm: 200, base: 0, top: 3000 };
    const f = makeFlight({ fuel: 80, weather: { clouds: [thick] } });
    f.altitude = 1200;
    setControls(f, { targetAltitude: 1200, throttle: 0.7, mixture: 55 });
    const speed0 = f.perf.airspeed;
    stepFlight(f, 2);
    expect(f.spiral).toBe(0); // はじめは何も起きない
    stepFlight(f, 3);
    expect(f.spiral).toBeGreaterThan(0);
    expect(f.altitude).toBeLessThan(1200);
    expect(f.perf.airspeed).toBeGreaterThan(speed0);
    expect(f.condition.airframe).toBeLessThan(100);
  });

  it("雲の下を飛べば大丈夫", () => {
    const f = makeFlight({ fuel: 80, weather: { clouds: [cloud] } });
    setControls(f, { targetAltitude: 700 });
    flyLeg(f, 0.7);
    expect(f.status).toBe("arrived");
    expect(f.stats.cloudMinutes).toBe(0);
  });

  it("雲を横によけても大丈夫（そのぶん遠回り）", () => {
    const straight = flyLeg(makeFlight({ fuel: 80 }), 0.7);
    const g = makeFlight({ fuel: 80, weather: { clouds: [cloud] } });
    for (let i = 0; i < 20000 && g.status === "flying"; i++) {
      setLateralTarget(g, g.distanceFlown < 150 ? -30 : 0);
      setControls(g, { throttle: 0.7, mixture: 55 });
      stepFlight(g, 0.5);
    }
    expect(g.status).toBe("arrived");
    expect(g.stats.cloudMinutes).toBe(0);
    expect(g.elapsedMin).toBeGreaterThan(straight.elapsedMin);
  });

  it("積乱雲の近くを通ると機体が傷み、37 km 以上離れれば傷まない", () => {
    const cb = { alongKm: 100, lateralKm: 0, radiusKm: 6, id: "cb" };
    const through = flyLeg(makeFlight({ fuel: 80, weather: { cb: [cb] } }), 0.7);
    expect(through.status === "airframe" || through.condition.airframe < 30).toBe(true);

    const g = makeFlight({ fuel: 80, weather: { cb: [cb] } });
    for (let i = 0; i < 20000 && g.status === "flying"; i++) {
      setLateralTarget(g, g.distanceFlown < 150 ? -50 : 0);
      setControls(g, { throttle: 0.75, mixture: 55 });
      stepFlight(g, 0.5);
    }
    expect(g.status).toBe("arrived");
    expect(g.condition.airframe).toBeGreaterThan(90);
  });

  it("乱気流の中は、速度を Va（140 km/h）以下に落とせば機体が傷まない", () => {
    const turb = { fromKm: 30, toKm: 170, lateralKm: 0, halfWidthKm: 30, intensity: 2 as const, id: "t" };
    const fast = makeFlight({ fuel: 80, pitch: 5, weather: { turbulence: [turb], winds: [{ altitude: 0, direction: 0, speed: 0 }] } });
    const slow = makeFlight({ fuel: 80, pitch: 5, weather: { turbulence: [turb], winds: [{ altitude: 0, direction: 0, speed: 0 }] } });
    for (const [f, t] of [[fast, 1], [slow, 0.6]] as const) {
      for (let i = 0; i < 20000 && f.status === "flying"; i++) {
        setControls(f, { throttle: t, mixture: 50 });
        stepFlight(f, 0.5);
      }
    }
    expect(fast.stats.airframeLoss).toBeGreaterThan(5);
    expect(slow.stats.airframeLoss).toBe(0);
  });
});

describe("高度ごとの風・着氷・キャブレター凍結", () => {
  it("高度ごとに風が違い、間はなめらかにつながる", () => {
    const winds = legBetween(ROUTE, "minami", "kawara").weather.winds;
    expect(headwindAt(winds, 0)).toBeCloseTo(15);
    expect(headwindAt(winds, 500)).toBeCloseTo(20, 0);
    expect(headwindAt(legBetween(ROUTE, "takane", "kita").weather.winds, 3000)).toBeCloseTo(-35);
  });

  it("1区間目は低く飛ぶほうが対地速度が速い", () => {
    const winds = legBetween(ROUTE, "minami", "kawara").weather.winds;
    const at = (alt: number) => {
      const f = makeFlight({ weather: { winds } });
      f.altitude = alt;
      setControls(f, { targetAltitude: alt, throttle: 0.7, mixture: 50 });
      return f.perf.groundSpeed;
    };
    expect(at(600)).toBeGreaterThan(at(2500) + 10);
  });

  it("凍結高度より上で雲に入ると着氷して振動が出る。下へ降りれば溶ける", () => {
    const cloud = { fromKm: 0, toKm: 200, lateralKm: 0, halfWidthKm: 40, base: 1000, top: 3000, id: "c" };
    const f = makeFlight({ fuel: 80, weather: { clouds: [cloud], freezingLevel: 1100 } });
    f.altitude = 1200;
    setControls(f, { targetAltitude: 1200, throttle: 0.7, mixture: 50 });
    stepFlight(f, 6);
    expect(f.condition.propIce).toBeGreaterThan(1);
    expect(f.condition.vibration).toBeGreaterThan(0);
    const ice = f.condition.propIce;
    setControls(f, { targetAltitude: 800 });
    stepFlight(f, 6);
    expect(f.condition.propIce).toBeLessThan(ice);
  });

  it("4.9 湿った日はキャブレターが凍り、キャブヒートで溶ける", () => {
    expect(carbIceRate(15, 1, 0.7, false)).toBeGreaterThan(0);
    expect(carbIceRate(15, 1, 0.5, false)).toBeGreaterThan(carbIceRate(15, 1, 0.7, false));
    expect(carbIceRate(15, 10, 0.7, false)).toBeLessThanOrEqual(0);
    expect(carbIceRate(15, 1, 0.7, true)).toBeLessThan(0);
    // 湿ったルートで、キャブヒートを使わずに飛ぶと回転がじわじわ下がる
    const f = makeFlight({ fuel: 80 });
    f.altitude = 1200;
    setControls(f, { targetAltitude: 1200, throttle: 0.7, mixture: 55 });
    const rpm0 = f.perf.rpm;
    stepFlight(f, 40);
    expect(f.condition.carbIce).toBeGreaterThan(5);
    expect(f.perf.rpm).toBeLessThan(rpm0 - 20);
    setControls(f, { carbHeat: true });
    stepFlight(f, 30);
    expect(f.condition.carbIce).toBeLessThan(1);
  });
});

describe("霧・引き返し", () => {
  it("気温と露点の差が小さい朝は霧が出やすく、昼には晴れる", () => {
    const kawara = legBetween(ROUTE, "minami", "kawara").to;
    expect(surfaceTemp(kawara, 14 * 60)).toBeCloseTo(kawara.temperature);
    expect(fogChance(spreadAt(kawara, 8 * 60))).toBeGreaterThan(0);
    expect(fogChance(spreadAt(kawara, 13 * 60))).toBe(0);
  });

  it("目的地が霧なら上空で待ち、晴れたら着陸する", () => {
    // 朝6時にみなみを出ると、かわらには朝のうちに着く（霧の時間）
    const f = makeFlight({ fuel: 80, departureMin: 6 * 60, fogRoll: { to: 0, from: 1 } });
    flyLeg(f, 0.8);
    expect(f.status).toBe("arrived");
    expect(f.stats.holdMinutes).toBeGreaterThan(10);
  });

  it("引き返すと出発地に戻る", () => {
    const f = makeFlight({ fuel: 80 });
    for (let i = 0; i < 200 && f.distanceFlown < 60; i++) {
      setControls(f, { throttle: 0.7, mixture: 55 });
      stepFlight(f, 0.5);
    }
    expect(turnBack(f)).toBe(true);
    expect(distanceLeft(f)).toBeCloseTo(f.distanceFlown);
    flyLeg(f, 0.7);
    expect(f.status).toBe("returned");
    expect(f.distanceFlown).toBe(0);
  });

  it("引き返して戻ると、同じ飛行場から同じ区間をもう一度飛べる", () => {
    const c = startCampaign(CLEAR_ROUTE, makeSetup(), 1);
    const { flight } = beginLeg(c);
    for (let i = 0; i < 100; i++) stepFlight(flight, 0.5);
    turnBack(flight);
    flyLeg(flight, 0.7);
    finishLeg(c, flight);
    expect(c.location).toBe("minami");
    expect(c.turnBacks).toBe(1);
    expect(c.events[0]).toContain("引き返した");
  });

  it("出発地が霧なら出発できず、待てば晴れる", () => {
    const c = startCampaign(ROUTE, makeSetup(), 1);
    const kawara = legBetween(ROUTE, "kawara", "takane").from;
    c.location = "kawara";
    c.destination = "takane";
    c.clockMin = 7 * 60;
    // 霧の乱数を「霧が出る」側にするため、霧が出る日を探す
    for (let day = 1; day < 40 && !foggedNow(c, kawara); day++) c.day = day;
    expect(foggedNow(c, kawara)).toBe(true);
    expect(departureProblems(c).join()).toContain("霧");
    waitForWeather(c);
    waitForWeather(c);
    expect(foggedNow(c, kawara)).toBe(false);
  });
});

describe("予報と気象ラジオ", () => {
  const template: WeatherTemplate = {
    winds: [{ altitude: 0, direction: 0, speed: 10 }],
    freezingLevel: 3000,
    features: [
      { id: "always", kind: "rain", prob: { morning: 1, afternoon: 1 }, rain: { ...rainBand, intensity: 1 } },
      { id: "never", kind: "cb", prob: { morning: 0, afternoon: 0 }, cb: { alongKm: 100, lateralKm: 0, radiusKm: 5 } },
      { id: "pm", kind: "cb", prob: { morning: 0, afternoon: 1 }, cb: { alongKm: 120, lateralKm: 0, radiusKm: 5 } },
    ],
  };

  it("予報は確率つきで、実際に起きるかは確率で決まる。午後は積乱雲が増える", () => {
    const am = generateWeather(template, 1, "morning");
    expect(am.forecast.items.map((i) => i.prob)).toEqual([1, 0, 0]);
    expect(am.actual.rain).toHaveLength(1);
    expect(am.actual.cb).toHaveLength(0);
    const pm = generateWeather(template, 1, "afternoon");
    expect(pm.actual.cb.map((c) => c.id)).toEqual(["pm"]);
  });

  it("同じ日・同じ時間帯なら同じ天気。区間のやり直しでも変わらない", () => {
    const c = startCampaign(ROUTE, makeSetup(), 5);
    expect(legWeather(c)).toEqual(legWeather(c));
  });

  it("近づくと、予報の天気が本当にあるかわかる", () => {
    const { actual, forecast } = generateWeather(template, 1, "morning");
    const f = makeFlight({ fuel: 80, weather: actual });
    f.forecast = forecast;
    expect(knownState(f, "always")).toBeNull();
    flyLeg(f, 0.7);
    expect(knownState(f, "always")).toBe(true);
    expect(knownState(f, "never")).toBe(false);
  });

  it("気象ラジオがあれば、飛行中に予報を最新にできる", () => {
    const { actual, forecast } = generateWeather(template, 1, "afternoon");
    const f = makeFlight({ fuel: 80, weather: actual, equipment: { weatherRadio: true } });
    f.forecast = forecast;
    expect(useRadio(f)).toBe(true);
    expect(f.forecast.items.map((i) => i.id).sort()).toEqual(["always", "pm"]);
    expect(knownState(f, "pm")).toBe(true);
    expect(useRadio(f)).toBe(false); // しばらく使えない
    const g = makeFlight({ fuel: 80, weather: actual });
    expect(useRadio(g)).toBe(false); // ラジオを積んでいない
  });
});

void LEG1;
