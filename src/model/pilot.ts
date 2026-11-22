// E. 操縦者の計算（4.11）。状態を持たない純粋な関数だけを置く。
import {
  FATIGUE_MAX_DELAY_MIN,
  FATIGUE_MAX_READING_ERROR,
  HASTE_CALM_PER_HOUR,
  HASTE_OPTIMISTIC,
  HASTE_PER_HOUR_BEHIND,
  PILOT_RED,
  PILOT_YELLOW,
} from "../config";

export type PilotLevel = "green" | "yellow" | "red";

const clamp100 = (x: number) => Math.min(100, Math.max(0, x));

export const pilotLevel = (v: number): PilotLevel => (v >= PILOT_RED ? "red" : v >= PILOT_YELLOW ? "yellow" : "green");

/**
 * 焦りの変化。totalMin 分のうち rushedMin 分は日没までに着けそうになく（1時間ごとに +10）、残りは余裕がある（1時間ごとに −5）。
 */
export function hasteAfter(haste: number, totalMin: number, rushedMin: number) {
  const b = Math.min(totalMin, Math.max(0, rushedMin));
  return clamp100(haste + (HASTE_PER_HOUR_BEHIND * b) / 60 - (HASTE_CALM_PER_HOUR * (totalMin - b)) / 60);
}

/** 焦りが高いと、整備士のひとことが楽観的になる */
export const isHasty = (haste: number) => haste >= HASTE_OPTIMISTIC;

/** 疲労による反応の遅れ（ゲーム内の分）。60 を超えると出始め、100 で最大 */
export function reactionDelayMin(fatigue: number) {
  if (fatigue < PILOT_YELLOW) return 0;
  return 0.5 + ((Math.min(100, fatigue) - PILOT_YELLOW) / (100 - PILOT_YELLOW)) * (FATIGUE_MAX_DELAY_MIN - 0.5);
}

/** 疲労による計器の読み取り誤差の大きさ（割合） */
export function readingErrorAmp(fatigue: number) {
  if (fatigue < PILOT_YELLOW) return 0;
  return ((Math.min(100, fatigue) - PILOT_YELLOW) / (100 - PILOT_YELLOW)) * FATIGUE_MAX_READING_ERROR;
}

/**
 * 計器ごとの読み取りの倍率。ゆっくり揺れる誤差なので、本人は気づきにくい。
 * t はゲーム内の分、key は計器ごとに違う数。
 */
export function readingFactor(fatigue: number, t: number, key: number) {
  const amp = readingErrorAmp(fatigue);
  return 1 + amp * (0.6 * Math.sin(t * 0.13 + key * 1.7) + 0.4 * Math.sin(t * 0.31 + key * 3.1));
}
