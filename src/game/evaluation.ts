// 旅の最終評価（2章「評価」：日数、燃費、機体の状態、安全な判断の数）。
// 引き返した回数・待った回数にはボーナス（勇気ある撤退ボーナス）、危ない飛び方は減点。
import { BOLT_DANGER } from "../config";
import { type CampaignState } from "./campaign";
import { plural, tr } from "../i18n";

export interface ScoreLine {
  label: string;
  detail: string;
  points: number;
  max: number;
}

export interface Lesson {
  title: string;
  ok: boolean;
  text: string;
}

export interface TripEvaluation {
  lines: ScoreLine[];
  total: number;
  rank: "S" | "A" | "B" | "C";
  title: string;
  comment: string;
  lessons: Lesson[];
}

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));
const fmtClock = (min: number) => `${Math.floor(min / 60)}:${String(Math.round(min % 60)).padStart(2, "0")}`;
/** かかった日数ごとの点（1日で着けば満点。泊まるほど下がる） */
const DAY_POINTS = [25, 18, 10];

/** ランクの境目（この点以上） */
export const RANK_FROM = { S: 85, A: 70, B: 50 } as const;

/** 評価の4項目（各25点）。格納庫で、旅の前に見せる */
/** 評価の項目名（records.ts の GROW_HINT もこの名前で引く） */
export const SCORE_LABEL = tr(
  { days: "日数", fuel: "燃費", condition: "機体の状態", safety: "安全な判断", risk: "危ない飛び方" },
  { days: "Days", fuel: "Fuel economy", condition: "Plane condition", safety: "Safe decisions", risk: "Risky flying" },
);
export const SCORE_GUIDE: { label: string; max: number; how: string }[] = [
  {
    label: SCORE_LABEL.days,
    max: 25,
    how: tr(
      `1日で着けば満点（2日 ${DAY_POINTS[1]}・3日 ${DAY_POINTS[2]}）`,
      `Full marks in 1 day (2 days ${DAY_POINTS[1]} · 3 days ${DAY_POINTS[2]})`,
    ),
  },
  { label: SCORE_LABEL.fuel, max: 25, how: tr("1 L の燃料で何 km 飛んだか", "How many km you flew per liter") },
  { label: SCORE_LABEL.condition, max: 25, how: tr("着いたときの機体の傷み", "Wear on the plane when you arrive") },
  { label: SCORE_LABEL.safety, max: 25, how: tr("予備燃料を守る・引き返す／待つ・整備", "Keep the reserve · turn back / wait · maintenance") },
];
export const RISK_GUIDE = tr(
  "雲の中・積乱雲の近く・回転超過・乱気流で速すぎ・予備燃料を割った着陸は減点",
  "Points off for flying in cloud, near thunderstorms, overspeeding, going too fast in turbulence, or landing below the reserve",
);

/** 1章の「4つの学び」。最後にふり返る */
export const LESSON_TITLES = tr<readonly string[]>(
  ["プロペラは一つですべてに最適にはならない", "木は湿気で変わる", "遠くへ飛ぶ鍵は速さより燃費と風", "一番大事なのは引き返す勇気"],
  [
    "No single propeller is best at everything",
    "Wood changes with humidity",
    "The key to flying far is economy and wind, not speed",
    "The most important thing is the courage to turn back",
  ],
);

export function evaluateTrip(c: CampaignState): TripEvaluation {
  const s = c.safety;
  const a = c.condition;

  // 1. 日数（何日目に着いたか）
  const dayPoints = DAY_POINTS[c.day - 1] ?? 0;
  const dayDetail = tr(
    `${c.day}日目の ${fmtClock(c.clockMin)} に着いた（途中で ${c.day - 1} 泊）`,
    `Arrived on day ${c.day} at ${fmtClock(c.clockMin)} (${plural(c.day - 1, "night")} on the way)`,
  );

  // 2. 燃費（実際に飛んだ道のり ÷ 使った燃料）
  const km = c.records.reduce((x, r) => x + r.distanceKm, 0);
  const fuel = c.records.reduce((x, r) => x + r.fuelUsed, 0);
  const kmPerL = fuel > 0 ? km / fuel : 0;
  const fuelPoints = Math.round(clamp((kmPerL - 5) * 12, 0, 25));

  // 3. 機体の状態（着いたとき）
  const parts = [a.boltTightness, a.propEdge, a.engineHealth, a.propDurability, a.airframe, 100 - a.vibration];
  const avg = parts.reduce((x, y) => x + y, 0) / parts.length;
  const conditionPoints = Math.round(clamp((avg / 100) * 25, 0, 25));

  // 4. 安全な判断：予備燃料を守った（10）＋ 勇気ある撤退ボーナス（引き返す 10・待つ 5、最大 10）＋ 整備（1回 2、最大 5）
  const reservePoints = s.lowReserveLandings === 0 ? 10 : 0;
  const retreatPoints = Math.min(10, c.turnBacks * 10 + c.waits * 5);
  const maintenancePoints = Math.min(5, c.maintenanceCount * 2);
  const braveryPoints = reservePoints + retreatPoints + maintenancePoints;

  // 5. 危ない飛び方（減点）
  const risk =
    s.cloudMinutes * 2 + s.cbMinutes * 1 + s.overspeedMinutes * 1 + s.overVaMinutes * 1 + s.lowReserveLandings * 5;
  const riskPoints = -Math.round(Math.min(30, risk));
  const riskParts = [
    s.cloudMinutes > 0 && tr(`雲の中 ${Math.round(s.cloudMinutes)} 分`, `in cloud ${Math.round(s.cloudMinutes)} min`),
    s.cbMinutes > 0 && tr(`積乱雲の近く ${Math.round(s.cbMinutes)} 分`, `near thunderstorms ${Math.round(s.cbMinutes)} min`),
    s.overspeedMinutes > 0 && tr(`回転超過 ${Math.round(s.overspeedMinutes)} 分`, `overspeed ${Math.round(s.overspeedMinutes)} min`),
    s.overVaMinutes > 0 && tr(`乱気流で速すぎ ${Math.round(s.overVaMinutes)} 分`, `too fast in turbulence ${Math.round(s.overVaMinutes)} min`),
    s.lowReserveLandings > 0 && tr(`予備燃料を割った着陸 ${s.lowReserveLandings} 回`, `landings below reserve: ${s.lowReserveLandings}`),
  ].filter(Boolean) as string[];

  const lines: ScoreLine[] = [
    { label: SCORE_LABEL.days, detail: dayDetail, points: dayPoints, max: 25 },
    {
      label: SCORE_LABEL.fuel,
      detail: tr(
        `${Math.round(km)} km を ${fuel.toFixed(1)} L（1 L で ${kmPerL.toFixed(1)} km）`,
        `${Math.round(km)} km on ${fuel.toFixed(1)} L (${kmPerL.toFixed(1)} km per L)`,
      ),
      points: fuelPoints,
      max: 25,
    },
    { label: SCORE_LABEL.condition, detail: tr(`着いたときの平均 ${Math.round(avg)} / 100`, `Average on arrival ${Math.round(avg)} / 100`), points: conditionPoints, max: 25 },
    {
      label: SCORE_LABEL.safety,
      detail: tr(
        `予備燃料を守った ${reservePoints}・勇気ある撤退ボーナス ${retreatPoints}（引き返す ${c.turnBacks} 回・待つ ${c.waits} 回）・整備 ${maintenancePoints}（${c.maintenanceCount} 回）`,
        `Kept the reserve ${reservePoints} · brave retreat bonus ${retreatPoints} (turned back ${c.turnBacks}, waited ${c.waits}) · maintenance ${maintenancePoints} (${c.maintenanceCount} times)`,
      ),
      points: braveryPoints,
      max: 25,
    },
    { label: SCORE_LABEL.risk, detail: riskParts.length ? riskParts.join(tr("・", " · ")) : tr("なし", "none"), points: riskPoints, max: 0 },
  ];
  const total = clamp(lines.reduce((x, l) => x + l.points, 0), 0, 100);
  const rank = total >= RANK_FROM.S ? "S" : total >= RANK_FROM.A ? "A" : total >= RANK_FROM.B ? "B" : "C";
  const title = tr(
    { S: "名パイロット", A: "腕のいいパイロット", B: "一人前のパイロット", C: "見習いパイロット" },
    { S: "Ace pilot", A: "Skilled pilot", B: "Capable pilot", C: "Trainee pilot" },
  )[rank];

  // 4つの学び（1章）をふり返る
  const lessons: Lesson[] = [
    {
      title: LESSON_TITLES[0],
      ok: s.overspeedMinutes < 1,
      text:
        s.overspeedMinutes < 1
          ? tr("回転をレッドラインの内側に収めて飛べた。", "You kept the RPM inside the red line.")
          : tr(
              `回転超過が ${Math.round(s.overspeedMinutes)} 分あった。上昇型は回りやすい。全開や降下では回転計を見て絞ろう。`,
              `You overspeeded for ${Math.round(s.overspeedMinutes)} min. A climb prop spins up easily. At full throttle and in the descent, watch the tachometer and throttle back.`,
            ),
    },
    {
      title: LESSON_TITLES[1],
      ok: s.minBolt >= BOLT_DANGER + 20,
      text:
        s.minBolt >= BOLT_DANGER + 20
          ? tr(
              `ボルトの締まりは最低でも ${Math.round(s.minBolt)}。締め直し ${c.retorques} 回。気候の違う土地でちゃんと見ていた。`,
              `Bolt tightness never dropped below ${Math.round(s.minBolt)}. Re-tightened ${c.retorques} times. You kept an eye on it in different climates.`,
            )
          : tr(
              `ボルトが ${Math.round(s.minBolt)} までゆるんだ。気候の違う土地に着いたら、まず締め直そう。`,
              `The bolts loosened to ${Math.round(s.minBolt)}. When you land somewhere with a different climate, re-tighten first.`,
            ),
    },
    {
      title: LESSON_TITLES[2],
      ok: kmPerL >= 6,
      text:
        kmPerL >= 6
          ? tr(`1 L で ${kmPerL.toFixed(1)} km。混合比と高度をうまく使えた。`, `${kmPerL.toFixed(1)} km per L. You used mixture and altitude well.`)
          : tr(
              `1 L で ${kmPerL.toFixed(1)} km。排気温度計で最良燃費を探し、風の弱い（追い風の）高度を選ぼう。`,
              `${kmPerL.toFixed(1)} km per L. Find best economy with the EGT gauge, and pick the altitude with the weakest headwind (or a tailwind).`,
            ),
    },
    {
      title: LESSON_TITLES[3],
      ok: s.cloudMinutes + s.cbMinutes < 1 && s.hastyMinutes < 30,
      text:
        s.hastyMinutes > 0
          ? tr(
              `焦っていた時間が ${Math.round(s.hastyMinutes)} 分あった。焦りが高いあいだ、整備士のひとことは「まあ大丈夫だろう」に変わっていた。気づけたかな？`,
              `You were in a hurry for ${Math.round(s.hastyMinutes)} min. While haste was high, the mechanic's advice turned into "it'll probably be fine". Did you notice?`,
            )
          : c.turnBacks + c.waits > 0
            ? tr(
                `引き返す・待つを ${c.turnBacks + c.waits} 回選べた。降りて待つのも正しい判断だ。`,
                `You chose to turn back or wait ${c.turnBacks + c.waits} times. Landing and waiting is a right call too.`,
              )
            : tr(
                "焦らずに飛べた。危ないと思ったら、引き返す・待つを選べるようにしておこう。",
                "You flew without rushing. When something looks dangerous, be ready to turn back or wait.",
              ),
    },
  ];

  const comment =
    rank === "S"
      ? tr("文句なしだ。天気を読んで、機体をいたわって、無理なく早く着いた。", "Flawless. You read the weather, looked after the plane, and got there quickly without pushing it.")
      : rank === "A"
        ? tr("いい旅だった。あと一歩、燃費か機体の手入れを詰めれば名パイロットだ。", "A good trip. A bit more care with fuel or the plane and you'll be an ace.")
        : rank === "B"
          ? tr("無事に着いたのが一番だ。ふり返りを見て、次はもっと上手く飛ぼう。", "Getting there safely is what matters most. Look back over it and fly better next time.")
          : tr("着いたのは立派だが、危ない場面が多かった。焦らず、引き返す勇気を持とう。", "Well done for getting there, but there were too many close calls. Don't rush, and have the courage to turn back.");

  return { lines, total, rank, title, comment, lessons };
}
