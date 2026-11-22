import { describe, expect, it } from "vitest";
import { WORLD as ROUTE } from "../src/data/world";
import { mechanicAdvice } from "../src/game/advice";
import {
  absNow,
  beginLeg,
  finishLeg,
  projectedArrivalAbs,
  projectedViaAbs,
  refuel,
  rest,
  rushedToday,
  startCampaign,
  waitForWeather,
} from "../src/game/campaign";
import { evaluateTrip } from "../src/game/evaluation";
import { intendedControls, requestControls, rushed, setControls, stepFlight, turnBack } from "../src/game/flight";
import { hasteAfter, isHasty, reactionDelayMin, readingErrorAmp, readingFactor } from "../src/model/pilot";
import { CLEAR_ROUTE, flyLeg, makeFlight, makeSetup } from "./helpers";

describe("E1 疲労", () => {
  it("飛行1時間ごとに +10、一晩休むと −50（4.11）", () => {
    const f = makeFlight({ fuel: 80 });
    flyLeg(f, 0.7);
    expect(f.pilot.fatigue).toBeCloseTo((f.elapsedMin / 60) * 10, 0);

    const c = startCampaign(CLEAR_ROUTE, makeSetup(), 1);
    c.pilot.fatigue = 70;
    rest(c);
    expect(c.pilot.fatigue).toBe(20);
  });

  it("60 を超えると操作の反応が遅れる", () => {
    expect(reactionDelayMin(40)).toBe(0);
    expect(reactionDelayMin(70)).toBeGreaterThan(0);
    expect(reactionDelayMin(100)).toBeGreaterThan(reactionDelayMin(70));

    const f = makeFlight({ fuel: 80 });
    f.pilot.fatigue = 90;
    requestControls(f, { throttle: 0.4 });
    expect(f.controls.throttle).toBe(0.75); // まだ効いていない
    expect(intendedControls(f).throttle).toBe(0.4); // 操縦者は動かしたつもり
    stepFlight(f, reactionDelayMin(90) + 0.5);
    expect(f.controls.throttle).toBe(0.4);

    const g = makeFlight({ fuel: 80 });
    requestControls(g, { throttle: 0.4 });
    expect(g.controls.throttle).toBe(0.4); // 元気ならすぐ効く
  });

  it("60 を超えると計器の読み取りに誤差が出る（ゆっくり揺れる）", () => {
    expect(readingErrorAmp(50)).toBe(0);
    expect(readingFactor(50, 10, 1)).toBe(1);
    const amp = readingErrorAmp(100);
    expect(amp).toBeGreaterThan(0.03);
    const values = Array.from({ length: 60 }, (_, i) => readingFactor(100, i, 1));
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(amp);
    expect(Math.max(...values)).toBeLessThanOrEqual(1 + amp + 1e-9);
  });
});

describe("E2 焦り", () => {
  it("日没までに着けそうにないあいだ1時間ごとに +10、余裕があれば落ち着く", () => {
    expect(hasteAfter(0, 60, 60)).toBeCloseTo(10);
    expect(hasteAfter(30, 60, 0)).toBeCloseTo(25);
    expect(hasteAfter(30, 60, 30)).toBeCloseTo(32.5);
  });

  it("飛行中、日没の30分前までに着けそうにないと焦りが上がる。朝に出れば焦らない", () => {
    const late = makeFlight({ fuel: 80, departureMin: 15 * 60 + 30 }); // 約2時間の区間を15:30に出る
    expect(rushed(late)).toBe(true);
    flyLeg(late, 0.7);
    expect(late.pilot.haste).toBeGreaterThan(10);

    const early = makeFlight({ fuel: 80, departureMin: 9 * 60 });
    expect(rushed(early)).toBe(false);
    flyLeg(early, 0.7);
    expect(early.pilot.haste).toBe(0);
  });

  it("今出ても暗くなる前に着けそうにない時間に地上にいると焦り、天気を待つ・引き返すと −20（勇気ある撤退）", () => {
    const c = startCampaign(ROUTE, makeSetup(), 1);
    expect(rushedToday(c)).toBe(false); // 朝なら余裕
    c.clockMin = 15 * 60; // かわらまで約2時間。15時に出ると日没の30分前を過ぎる
    expect(rushedToday(c)).toBe(true);
    c.pilot.haste = 50;
    waitForWeather(c); // 2時間待つ：+20、待つと決めて −20
    expect(c.pilot.haste).toBeCloseTo(50);
    expect(c.waits).toBe(1);

    const f = makeFlight({ fuel: 80 });
    f.pilot.haste = 50;
    stepFlight(f, 10);
    turnBack(f);
    expect(f.pilot.haste).toBeLessThanOrEqual(30);
  });

  it("焦りが 60 を超えると、整備士のひとことが「まあ大丈夫だろう」に変わる", () => {
    const f = makeFlight({ fuel: 10 }); // 燃料が足りない
    setControls(f, { throttle: 0.7, mixture: 55 });
    f.altitude = f.controls.targetAltitude;
    stepFlight(f, 0.5);
    f.pilot.haste = 30;
    const calm = mechanicAdvice(f);
    expect(calm).toContain("届かない");
    f.pilot.haste = 70;
    expect(isHasty(f.pilot.haste)).toBe(true);
    expect(mechanicAdvice(f)).toContain("大丈夫");
  });

  it("到着の見込み：朝に出れば最短の山越えはその日のうちに着く。昼すぎなら途中で一泊", () => {
    const c = startCampaign(ROUTE, makeSetup(), 1);
    expect(absNow(c)).toBe(9 * 60);
    const fastest = projectedArrivalAbs(ROUTE, "minami", absNow(c));
    expect(fastest).toBeLessThan(ROUTE.sunsetMin);
    expect(projectedArrivalAbs(ROUTE, "minami", 13 * 60)).toBeGreaterThan(24 * 60 + 8 * 60);
    // 海沿いは遠いぶん遅い
    expect(projectedViaAbs(ROUTE, "minami", "hamakaze", absNow(c))).toBeGreaterThan(fastest);
  });
});

describe("最終評価", () => {
  function fullTrip(options: { wait?: boolean; throttle?: number } = {}) {
    const c = startCampaign(CLEAR_ROUTE, makeSetup(3, 100, "ok", { toolKit: true, edgeGear: "tape" }), 3);
    for (let i = 0; i < 3; i++) {
      if (i === 2) rest(c); // たかねで一泊
      if (options.wait && i === 1) waitForWeather(c);
      refuel(c, 70);
      const { flight } = beginLeg(c);
      flyLeg(flight, options.throttle ?? 0.7);
      expect(flight.status).toBe("arrived");
      finishLeg(c, flight);
    }
    return c;
  }

  it("日数・燃費・機体の状態・安全な判断で100点満点", () => {
    const e = evaluateTrip(fullTrip());
    expect(e.lines.map((l) => l.label)).toEqual(["日数", "燃費", "機体の状態", "安全な判断", "危ない飛び方"]);
    expect(e.total).toBeGreaterThan(0);
    expect(e.total).toBeLessThanOrEqual(100);
    expect(["S", "A", "B", "C"]).toContain(e.rank);
    expect(e.lessons).toHaveLength(4);
  });

  it("天気を待つと、勇気ある撤退ボーナスがつく", () => {
    const plain = evaluateTrip(fullTrip());
    const waited = evaluateTrip(fullTrip({ wait: true }));
    const bravery = (e: typeof plain) => e.lines.find((l) => l.label === "安全な判断")!.points;
    expect(bravery(waited)).toBeGreaterThan(bravery(plain));
  });

  it("全開で飛ぶと燃費の点が下がる", () => {
    const eco = evaluateTrip(fullTrip({ throttle: 0.65 }));
    const fast = evaluateTrip(fullTrip({ throttle: 1 }));
    const fuel = (e: typeof eco) => e.lines.find((l) => l.label === "燃費")!.points;
    expect(fuel(eco)).toBeGreaterThan(fuel(fast));
  });

  it("危ない飛び方は減点される", () => {
    const c = fullTrip();
    const before = evaluateTrip(c).total;
    c.safety.cloudMinutes = 5;
    c.safety.lowReserveLandings = 1;
    // 雲の中 5分で −10、予備燃料割れで −5 と「予備燃料を守った」の 10 点がなくなる
    expect(evaluateTrip(c).total).toBe(Math.max(0, before - 25));
  });
});

describe("締め切りはない", () => {
  it("評価の日数は、かかった日数で決まる（1日 25・2日 18・3日 10）", () => {
    const c = startCampaign(CLEAR_ROUTE, makeSetup(), 1);
    c.location = c.world.goalId;
    const days = (d: number) => {
      c.day = d;
      return evaluateTrip(c).lines.find((l) => l.label === "日数")!.points;
    };
    expect([1, 2, 3, 4].map(days)).toEqual([25, 18, 10, 0]);
    expect("schedule" in c.world).toBe(false);
  });
});
