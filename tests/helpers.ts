import { clearSkies, legBetween, WORLD as ROUTE } from "../src/data/world";
import { NO_EQUIPMENT } from "../src/data/equipment";
import { createFlight, stepFlight, type FlightState } from "../src/game/flight";
import { autopilot } from "../src/game/planner";
import { createRng } from "../src/model/physics";
import type { AircraftCondition, Equipment, Leg, LegWeather, PitchLevel, Setup, TorqueResult } from "../src/model/types";

export { autopilot };

/** 天気のないルート（ステップ2までのテスト用） */
export const CLEAR_ROUTE = clearSkies(ROUTE);

export function makeSetup(
  pitch: PitchLevel = 3,
  fuelPercent = 100,
  torqueResult: TorqueResult = "ok",
  equipment: Partial<Equipment> = {},
): Setup {
  return { pitch, fuelPercent, torqueResult, equipment: { ...NO_EQUIPMENT, ...equipment } };
}

export const freshCondition = (fuel = 70): AircraftCondition => ({
  boltTightness: 100,
  propEdge: 100,
  edgeAsymmetry: 0,
  vibration: 0,
  engineHealth: 100,
  propDurability: 100,
  propIce: 0,
  carbIce: 0,
  airframe: 100,
  fuelRemaining: fuel,
});

/** 天気を直接指定して飛行を作る */
export function makeFlight(
  opts: {
    leg?: Leg;
    pitch?: PitchLevel;
    fuel?: number;
    condition?: Partial<AircraftCondition>;
    weather?: Partial<LegWeather>;
    equipment?: Partial<Equipment>;
    departureMin?: number;
    fogRoll?: { to: number; from: number };
  } = {},
): FlightState {
  const leg = opts.leg ?? legBetween(CLEAR_ROUTE, "minami", "kawara");
  const weather: LegWeather = {
    winds: [{ altitude: 0, direction: 0, speed: leg.headwindKmh }],
    freezingLevel: 4000,
    clouds: [],
    rain: [],
    turbulence: [],
    cb: [],
    ...opts.weather,
  };
  return createFlight({
    leg,
    setup: makeSetup(opts.pitch ?? 3, 100, "ok", opts.equipment),
    condition: { ...freshCondition(opts.fuel), ...opts.condition },
    departureMin: opts.departureMin ?? 11 * 60,
    sunsetMin: ROUTE.sunsetMin,
    controls: { throttle: 0.75, mixture: 0, carbHeat: false, targetAltitude: leg.cruiseAltitude },
    weather,
    forecast: { period: "morning", winds: weather.winds, freezingLevel: weather.freezingLevel, items: [] },
    fogRoll: opts.fogRoll,
    rng: createRng(1),
  });
}

export function flyLeg(f: FlightState, cruiseThrottle = 0.7, manual = false) {
  for (let i = 0; i < 20000 && f.status === "flying"; i++) {
    if (!manual) autopilot(f, cruiseThrottle);
    stepFlight(f, 0.5);
  }
  return f;
}
