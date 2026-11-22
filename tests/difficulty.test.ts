import { describe, expect, it } from "vitest";
import { DIFFICULTY } from "../src/data/difficulty";
import { legBetween, WORLD as ROUTE } from "../src/data/world";
import { beginLeg, boltCheckNotice, finishLeg, refuel, retorque, startCampaign } from "../src/game/campaign";
import { setControls, stepFlight } from "../src/game/flight";
import { PARAM_LINES, paramLine, type ParamId } from "../src/game/mechanicLines";
import { mixturePoints } from "../src/model/physics";
import { generateWeather } from "../src/model/weather";
import { CLEAR_ROUTE, flyLeg, makeFlight, makeSetup } from "./helpers";

describe("7章 難易度", () => {
  it("かんたん：混合比はいつもその高度の最良燃費、キャブヒートは凍り始めたら自動で入る", () => {
    const f = makeFlight({ fuel: 80 });
    f.difficulty = "easy";
    setControls(f, { mixture: 0, throttle: 0.7 }); // 操縦者が濃くしても
    for (let i = 0; i < 80 && f.status === "flying"; i++) {
      stepFlight(f, 0.5);
      // 刻みのはじめの高度に合わせるので、上昇中は1だけずれることがある
      expect(Math.abs(f.controls.mixture - mixturePoints(f.altitude).bestEconomy)).toBeLessThanOrEqual(1.5);
    }
    // 湿った空気の中では凍り始めてすぐキャブヒートが入り、凍結はほとんど進まない
    expect(f.condition.carbIce).toBeLessThan(5);
  });

  it("ふつう・リアル：混合比もキャブヒートも自動にならない", () => {
    for (const d of ["normal", "real"] as const) {
      const f = makeFlight({ fuel: 80 });
      f.difficulty = d;
      setControls(f, { mixture: 0, throttle: 0.7 });
      stepFlight(f, 20);
      expect(f.controls.mixture).toBe(0);
      expect(f.controls.carbHeat).toBe(false);
    }
  });

  it("ボルト点検の通知：かんたん・ふつうは出る、リアルは出ない。締め直せば消える", () => {
    const notice = (d: "easy" | "normal" | "real") => {
      const c = startCampaign(CLEAR_ROUTE, makeSetup(), 1, d);
      c.condition.boltTightness = 50;
      c.retorquedHere = false;
      return c;
    };
    expect(boltCheckNotice(notice("easy"))).not.toBeNull();
    expect(boltCheckNotice(notice("normal"))).not.toBeNull();
    expect(boltCheckNotice(notice("real"))).toBeNull();
    const c = notice("normal");
    retorque(c, "ok");
    expect(boltCheckNotice(c)).toBeNull();
  });

  it("湿度の違う土地に着くと、ボルト点検の通知が出る", () => {
    const c = startCampaign(CLEAR_ROUTE, makeSetup(), 1, "normal");
    const { flight } = beginLeg(c);
    flyLeg(flight, 0.7);
    finishLeg(c, flight);
    refuel(c, 60);
    const leg2 = beginLeg(c).flight;
    flyLeg(leg2, 0.7);
    finishLeg(c, leg2); // かわら 85% → たかね 35%
    expect(boltCheckNotice(c)).toContain("湿度");
  });

  it("リアル：予報の外れが大きい（位置のずれと、確率のあてにならなさ）", () => {
    const t = legBetween(ROUTE, "minami", "kawara").weather;
    const spread = (u: number) => {
      let shift = 0;
      let probOff = 0;
      for (let seed = 1; seed <= 200; seed++) {
        const { actual, forecast } = generateWeather(t, seed, "afternoon", u);
        const r = actual.rain[0];
        if (r) shift += Math.abs(r.fromKm - t.features[0].rain!.fromKm);
        probOff += Math.abs(forecast.items[0].prob - t.features[0].prob.afternoon);
      }
      return { shift, probOff };
    };
    const normal = spread(DIFFICULTY.normal.forecastUncertainty);
    const real = spread(DIFFICULTY.real.forecastUncertainty);
    expect(real.shift).toBeGreaterThan(normal.shift * 1.5);
    expect(normal.probOff).toBe(0); // ふつうは確率そのものは正しい
    expect(real.probOff).toBeGreaterThan(0);
  });
});

describe("6章 演出", () => {
  it("整備士のひとこと：すべてのパラメータに一行あり、焦ると楽観的な文に変わる", () => {
    for (const id of Object.keys(PARAM_LINES) as ParamId[]) {
      expect(paramLine(id, 0)).toBe(PARAM_LINES[id].line);
      expect(paramLine(id, 80)).toBe(PARAM_LINES[id].hasty);
      expect(PARAM_LINES[id].hasty).not.toBe(PARAM_LINES[id].line);
    }
    // 設計書3章の例文をそのまま使っている
    expect(PARAM_LINES.B1.line).toBe("気候の違う土地に着いたら、まず締め直せ。");
    expect(PARAM_LINES.C3.line).toBe("晴れていても、湿った日は凍る。回転がじわじわ下がったら疑え。");
  });
});
