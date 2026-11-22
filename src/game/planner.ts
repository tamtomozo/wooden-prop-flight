// 飛行計画の目安。「教科書どおりに飛んだら」を実際にシミュレーションして求める。
import { REDLINE_RPM } from "../config";
import { createRng, mixturePoints } from "../model/physics";
import type { CampaignState } from "./campaign";
import { legWeather, nextLeg } from "./campaign";
import { createFlight, setControls, stepFlight, type FlightState } from "./flight";

/** 計画で使う巡航出力 */
export const PLAN_THROTTLE = 0.7;

/**
 * 教科書どおりに飛ぶ自動操縦：
 * 上昇は全開（回転が上がりすぎないところまで）、巡航は cruiseThrottle、降下は絞る。
 * 混合比はいつもその高度の最良燃費に合わせる。
 */
export function autopilot(f: FlightState, cruiseThrottle = PLAN_THROTTLE) {
  const mixture = mixturePoints(f.altitude).bestEconomy;
  let throttle = f.phase === "climb" ? 1 : f.phase === "descent" ? 0.55 : cruiseThrottle;
  // キャブレターが凍り始めたらキャブヒートを入れ、溶けたら切る
  const carbHeat = f.condition.carbIce > 8 ? true : f.condition.carbIce < 0.5 ? false : f.controls.carbHeat;
  setControls(f, { throttle, mixture, carbHeat });
  while (f.perf.rpm > REDLINE_RPM - 20 && throttle > 0.3) {
    throttle -= 0.05;
    setControls(f, { throttle });
  }
}

export interface LegEstimate {
  minutes: number;
  fuelL: number;
}

/**
 * 次の区間を、今の機体で教科書どおりに飛んだときの時間と燃料。
 * 風は予報の値。雲や積乱雲をよける距離や、霧で待つ時間は入っていない。
 */
export function estimateNextLeg(c: CampaignState, cruiseAltitude?: number): LegEstimate | null {
  const leg = nextLeg(c);
  const wx = legWeather(c);
  if (!leg || !wx) return null;
  const f = createFlight({
    leg,
    setup: c.setup,
    condition: { ...c.condition, fuelRemaining: 999, boltTightness: 100 },
    departureMin: 0,
    sunsetMin: 48 * 60,
    controls: { ...c.controls, carbHeat: false },
    weather: { winds: wx.forecast.winds, freezingLevel: wx.forecast.freezingLevel, clouds: [], rain: [], turbulence: [], cb: [] },
    forecast: { ...wx.forecast, items: [] },
    rng: createRng(1),
  });
  if (cruiseAltitude) setControls(f, { targetAltitude: cruiseAltitude });
  for (let i = 0; i < 4000 && f.status === "flying"; i++) {
    autopilot(f);
    stepFlight(f, 1);
  }
  return { minutes: f.elapsedMin, fuelL: f.fuelUsed };
}
