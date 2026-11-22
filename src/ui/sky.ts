// 時刻に合わせた空の色。横の視点と3Dの視点で共通に使う。
import { clockMin, type FlightState } from "../game/flight";

export type RGB = [number, number, number];

export const mixRGB = (a: RGB, b: RGB, t: number): RGB =>
  [0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * t) as RGB;
export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

const SKY_DAY: [RGB, RGB] = [[70, 140, 210], [190, 225, 250]];
const SKY_DUSK: [RGB, RGB] = [[60, 64, 120], [245, 165, 95]];
const SKY_NIGHT: [RGB, RGB] = [[15, 20, 45], [60, 50, 80]];

export interface Sky {
  /** 0＝昼、1＝夕焼け（日没90分前から） */
  dusk: number;
  /** 0＝日没前、1＝夜（日没20分後） */
  night: number;
  top: RGB;
  /** 地平線付近の色 */
  bottom: RGB;
  /** 太陽の高さ 1＝高い、0＝地平線 */
  sunHeight: number;
  sunColor: RGB;
}

export function skyAt(s: FlightState): Sky {
  const toSunset = s.sunsetMin - clockMin(s);
  const dusk = clamp01(1 - toSunset / 90);
  const night = clamp01(-toSunset / 20);
  return {
    dusk,
    night,
    top: mixRGB(mixRGB(SKY_DAY[0], SKY_DUSK[0], dusk), SKY_NIGHT[0], night),
    bottom: mixRGB(mixRGB(SKY_DAY[1], SKY_DUSK[1], dusk), SKY_NIGHT[1], night),
    sunHeight: clamp01(toSunset / 270),
    sunColor: mixRGB([255, 245, 200], [255, 140, 70], dusk),
  };
}
