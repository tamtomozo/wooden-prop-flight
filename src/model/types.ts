// 5章「データ構造」。

export type PitchLevel = 1 | 2 | 3 | 4 | 5;
export type TorqueResult = "under" | "ok" | "over";
export type EdgeGear = "none" | "tape" | "metal";
export type RunwaySurface = "unpaved" | "paved";

/** A. 出発前のセッティング */
export interface Setup {
  pitch: PitchLevel;
  fuelPercent: number; // 0..100（出発時）
  torqueResult: TorqueResult;
  equipment: Equipment;
}

export interface Equipment {
  edgeGear: EdgeGear;
  toolKit: boolean;
  spareProp: boolean;
  weatherRadio: boolean;
}

/** B. 機体の状態 */
export interface AircraftCondition {
  boltTightness: number; // 0..100
  propEdge: number; // 0..100
  edgeAsymmetry: number; // 0..1
  vibration: number; // 0..100（自動計算）
  engineHealth: number; // 0..100
  propDurability: number; // 0..100
  propIce: number; // 0..100 プロペラの着氷
  carbIce: number; // 0..100 キャブレターの凍結
  /** 機体の強度 0..100（設計書の structureDamage を残りの強さで表したもの。積乱雲と乱気流で減る） */
  airframe: number;
  fuelRemaining: number; // L
}

/** C. 飛行中の操作 */
export interface Controls {
  throttle: number; // THROTTLE_MIN..1
  mixture: number; // 0（濃い）..100（薄い）
  carbHeat: boolean;
  targetAltitude: number; // m
}

/** 経由地（飛行場） */
export interface Waypoint {
  id: string;
  name: string;
  elevation: number; // m
  runwayLength: number; // m
  surface: RunwaySurface;
  hasRepairShop: boolean;
  humidity: number; // 地域の平均湿度 %
  temperature: number; // その日の最高気温 ℃（朝は5℃ほど低い）
  dewPoint: number; // 露点 ℃。気温との差が小さいと霧が出る
  description: string;
  /** 地図の上の位置 km（東が +x、北が +y） */
  x: number;
  y: number;
  /** 地図で名前を書く側（書かなければ自動） */
  labelSide?: "left" | "right";
}

/** 海の上の範囲（区間の出発地からの距離 km）。ここでは降りられる場所がない */
export interface SeaStretch {
  fromKm: number;
  toKm: number;
}

/** 1区間 */
export interface Leg {
  from: Waypoint;
  to: Waypoint;
  distanceKm: number;
  /** 地上付近の向かい風（km/h）。追い風ならマイナス。上空の風は weather で決まる */
  headwindKmh: number;
  cruiseAltitude: number; // m（最初の目標高度）
  note: string;
  /** 山の尾根（区間の途中の地形） */
  terrain: Ridge[];
  weather: WeatherTemplate;
  /** 海の上を飛ぶ範囲（陸だけの区間なら空） */
  sea: SeaStretch[];
}

export interface Ridge {
  fromKm: number;
  toKm: number;
  /** いちばん高いところの標高 m */
  height: number;
  name: string;
}

// ---- D. 天気 ----
/** 区間の上の範囲。along は出発地からの距離、lateral はコースから右へのずれ（km） */
export interface Area {
  fromKm: number;
  toKm: number;
  lateralKm: number;
  halfWidthKm: number;
}
export interface CloudArea extends Area {
  base: number; // 雲底 m
  top: number; // 雲頂 m
}
export interface RainArea extends Area {
  intensity: 1 | 2 | 3;
}
export interface TurbulenceArea extends Area {
  intensity: 1 | 2 | 3;
}
export interface CbCell {
  alongKm: number;
  lateralKm: number;
  radiusKm: number;
}
export interface WindLayer {
  altitude: number;
  /** コースに対する風の向き（度）。0 = 正面から（向かい風）、180 = 真後ろから（追い風） */
  direction: number;
  speed: number; // km/h
}

export type Period = "morning" | "afternoon";
export type WeatherKind = "cloud" | "rain" | "turbulence" | "cb";

/** 起きるかもしれない天気（確率つき） */
export interface WeatherFeature {
  id: string;
  kind: WeatherKind;
  prob: Record<Period, number>;
  cloud?: CloudArea;
  rain?: RainArea;
  turbulence?: TurbulenceArea;
  cb?: CbCell;
}

/** 区間ごとの天気のひな形。日と時間帯ごとに、ここから実際の天気と予報を作る */
export interface WeatherTemplate {
  winds: WindLayer[];
  freezingLevel: number;
  features: WeatherFeature[];
}

/** 実際の天気（飛んでみてわかる） */
export interface LegWeather {
  winds: WindLayer[];
  freezingLevel: number;
  clouds: (CloudArea & { id: string })[];
  rain: (RainArea & { id: string })[];
  turbulence: (TurbulenceArea & { id: string })[];
  cb: (CbCell & { id: string })[];
}

/** 予報（出発前に見える。確率つきで、位置や高さがずれていることがある） */
export interface ForecastItem {
  id: string;
  kind: WeatherKind;
  prob: number;
  /** 予報での位置（実際とずれることがある） */
  cloud?: CloudArea;
  rain?: RainArea;
  turbulence?: TurbulenceArea;
  cb?: CbCell;
}
export interface Forecast {
  period: Period;
  winds: WindLayer[];
  freezingLevel: number;
  items: ForecastItem[];
}

/** 地図の上の、2つの飛行場をつなぐ道。どちら向きにも飛べる */
export interface Edge {
  a: string;
  b: string;
  /** すすめの巡航高度 m */
  cruiseAltitude: number;
  note: string;
  /** 山の尾根（a から b へ向かうときの距離で書く） */
  terrain: Ridge[];
  /** 天気のひな形（a から b へ向かうときの向きで書く。逆向きに飛ぶときは反転する） */
  weather: WeatherTemplate;
}

/** 旅の舞台（地図）。コースごとに1つ */
export interface World {
  /** コースの id */
  id: string;
  /** コースの名前（「かもめ海峡を渡る」など） */
  title: string;
  /** 出発地 → 目的地 */
  name: string;
  /** コースの説明（何が難しいか） */
  description: string;
  /** もとにした史実 */
  history: string;
  /** 難しさ 1..3 */
  level: number;
  /** 陸地の形（地図の km。[x, y] の並び）。書かなければ全部が陸 */
  land?: [number, number][][];
  fields: Waypoint[];
  edges: Edge[];
  startId: string;
  goalId: string;
  fuelCapacityL: number;
  /** 1日目の出発時刻（0時からの分） */
  startMin: number;
  /** 日没（0時からの分）。有視界飛行なので毎日これまでに着く必要がある */
  sunsetMin: number;
  /** 見積もりに使う、ふつうの対地速度 km/h */
  planSpeedKmh: number;
}

/** E. 操縦者 */
export interface Pilot {
  fatigue: number; // 0..100
  haste: number; // 0..100
}

/** 7章 難易度 */
export type Difficulty = "easy" | "normal" | "real";
