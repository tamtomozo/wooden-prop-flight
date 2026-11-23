// 4章「計算モデル」の定数と、ゲームの仮の値。すべて遊びやすさ優先。
// 単位：速度 km/h、距離 km、時間 h（分は min）、燃料 L、高度 m、重さ kg、回転数 rpm。

// ---- 4.1〜4.4 プロペラ・エンジン・速度 ----
/** 最大回転数（レッドライン） */
export const REDLINE_RPM = 2700;
/** 基準の巡航速度（全開・最大出力の混合比・ピッチ3・新品のプロペラ） */
export const BASE_SPEED = 150;
/** 基準の燃料消費（全開・最大出力の混合比） L/h */
export const BASE_BURN = 25;
/** スロットルの下限（アイドルで燃料0なのに飛べてしまうのを防ぐ） */
export const THROTTLE_MIN = 0.2;

// ---- 上昇と降下 ----
/** 基準の上昇率 m/分（全開・ピッチ3・空の重さ） */
export const BASE_CLIMB_RATE = 250;
/**
 * 高いほど空気が薄く、上昇率が落ちる。CLIMB_FADE_FROM m から落ち始め、CLIMB_CEILING m で 0 になる（上昇限度）。
 * 高度の上限（MAX_ALTITUDE）あたりでは、海面の 3分の1 ほどしか上がらない。
 */
export const CLIMB_FADE_FROM = 1000;
export const CLIMB_CEILING = 5000;
/** 上昇中は速度が落ちる */
export const CLIMB_SPEED_FACTOR = 0.75;
/** 降下率 m/分 */
export const DESCENT_RATE = 180;
/** 降下中は重力で速度が増える（固定ピッチなので回転数も上がる） */
export const DESCENT_SPEED_BONUS = 30;

// ---- 4.5 重さと離陸 ----
/** 機体と操縦者の重さ。離陸距離の基準（設計書の EMPTY_WEIGHT） */
export const EMPTY_WEIGHT = 500;
export const FUEL_KG_PER_L = 0.72;
/** 基準の離陸距離 m（海面・標準気温・EMPTY_WEIGHT・ピッチ3） */
export const BASE_TAKEOFF = 300;

// ---- 装備 ----
export const EQUIPMENT_SLOTS = 3;
export const EQUIPMENT_MAX_KG = 25;
/** 増設タンク（★★★ おおわだつみを渡りきると使える）で増える燃料 L。タンクそのものの重さは入れていない */
export const BIG_TANK_L = 40;

// ---- 4.6〜4.8 プロペラの状態 ----
/** ボルトがこれを下回ると、外れる確率が出てくる */
export const BOLT_DANGER = 20;
/** 振動の色の境目 */
export const VIBRATION_YELLOW = 30;
export const VIBRATION_RED = 60;
/** 締め付けが「不足」だったときの締まり具合 */
export const BOLT_AFTER_UNDER = 85;
/** ボルト締め付けミニゲームの「適正」の範囲（トルク 0..100） */
export const TORQUE_OK_FROM = 62;
export const TORQUE_OK_TO = 82;

// ---- 経由地 ----
/** 朝の出発時刻（0時からの分） */
export const MORNING_MIN = 8 * 60;
/** 整備場での作業にかかる時間（分） */
export const SHOP = {
  retorque: { min: 60 },
  edge: { min: 120 },
  engine: { min: 180 },
  airframe: { min: 180 },
} as const;
export const TOOLKIT_RETORQUE_MIN = 30;
export const REFUEL_MIN = 20;
export const PROP_SWAP_MIN = 90;
/** 予備プロペラで不時着から復帰するのにかかる時間 */
export const FORCED_LANDING_MIN = 180;

// ---- 判定と時間 ----
/** 予備燃料の目安（L）。最良燃費の巡航で約30分ぶん */
export const RESERVE_FUEL_L = 8;
/** 現実の1秒で進むゲーム内の分数（倍速ボタンで掛け算される）。2 だと速すぎたので、現実の時間を1.5倍にした */
export const GAME_MINUTES_PER_SECOND = 2 / 1.5;
/** シミュレーションの1刻み（ゲーム内の分） */
export const SIM_SUBSTEP_MIN = 0.25;

// ---- 天気（ステップ3） ----
/** 天気が目で見える距離 km（これより遠くは予報でしかわからない） */
export const SIGHT_KM = 35;
/** 積乱雲からこれより近いと機体が傷む km（米国FAAの指針 20海里） */
export const CB_DANGER_KM = 37;
/** 雲の中にこれだけ（ゲーム内の分）いると操縦できなくなる */
export const DISORIENT_LIMIT_MIN = 8;
/** 設計運動速度 Va。乱気流ではこれ以下に落とす km/h */
export const VA_KMH = 140;
/** キャブレター凍結の進み方の倍率（設計書 4.9 の式のままだと区間の中でほとんど効かないため） */
export const CARB_ICE_SCALE = 2;
/** 左右によけるときの角度（度） */
export const DETOUR_ANGLE = 30;
/** コースのずれの上限 km */
export const MAX_LATERAL_KM = 60;
/** 気象ラジオで予報を更新したあと、次に使えるまで（ゲーム内の分） */
export const RADIO_COOLDOWN_MIN = 30;
/** 経由地で天気を待つ時間（分） */
export const WAIT_MIN = 120;
/** 高度の上限 m */
export const MAX_ALTITUDE = 3600;

// ---- 操縦者（ステップ4・4.11） ----
/** 疲労：飛行1時間ごとに増える量、一晩休んで減る量 */
export const FATIGUE_PER_FLIGHT_HOUR = 10;
export const FATIGUE_REST = 50;
/** 疲労・焦りの色の境目 */
export const PILOT_YELLOW = 60;
export const PILOT_RED = 80;
/** 焦り：日没までに着けそうにないあいだ1時間ごとに増える量、余裕があるとき1時間ごとに落ち着く量 */
export const HASTE_PER_HOUR_BEHIND = 10;
export const HASTE_CALM_PER_HOUR = 5;
/** 日没の何分前までに着きたいか。これに間に合いそうにないと焦る */
export const SUNSET_MARGIN_MIN = 30;
/** 引き返す・天気を待つと下がる量（勇気ある撤退） */
export const HASTE_RELIEF = 20;
/** 一晩眠ると落ち着く量 */
export const HASTE_NIGHT_RELIEF = 10;
/** これ以上焦ると、整備士のひとことが「まあ大丈夫だろう」に変わる */
export const HASTE_OPTIMISTIC = 60;
/** 疲労による反応の遅れの最大（ゲーム内の分）と、計器の読み取り誤差の最大（割合） */
export const FATIGUE_MAX_DELAY_MIN = 3;
export const FATIGUE_MAX_READING_ERROR = 0.06;
