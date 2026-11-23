// 旅の最終評価（2章「評価」：日数、燃費、機体の状態、安全な判断の数）。
// 引き返した回数・待った回数にはボーナス（勇気ある撤退ボーナス）、危ない飛び方は減点。
import { BOLT_DANGER } from "../config";
import { type CampaignState } from "./campaign";

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
export const SCORE_GUIDE: { label: string; max: number; how: string }[] = [
  { label: "日数", max: 25, how: `1日で着けば満点（2日 ${DAY_POINTS[1]}・3日 ${DAY_POINTS[2]}）` },
  { label: "燃費", max: 25, how: "1 L の燃料で何 km 飛んだか" },
  { label: "機体の状態", max: 25, how: "着いたときの機体の傷み" },
  { label: "安全な判断", max: 25, how: "予備燃料を守る・引き返す／待つ・整備" },
];
export const RISK_GUIDE = "雲の中・積乱雲の近く・回転超過・乱気流で速すぎ・予備燃料を割った着陸は減点";

/** 1章の「4つの学び」。最後にふり返る */
export const LESSON_TITLES = [
  "プロペラは一つですべてに最適にはならない",
  "木は湿気で変わる",
  "遠くへ飛ぶ鍵は速さより燃費と風",
  "一番大事なのは引き返す勇気",
] as const;

export function evaluateTrip(c: CampaignState): TripEvaluation {
  const s = c.safety;
  const a = c.condition;

  // 1. 日数（何日目に着いたか）
  const dayPoints = DAY_POINTS[c.day - 1] ?? 0;
  const dayDetail = `${c.day}日目の ${fmtClock(c.clockMin)} に着いた（途中で ${c.day - 1} 泊）`;

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
    s.cloudMinutes > 0 && `雲の中 ${Math.round(s.cloudMinutes)} 分`,
    s.cbMinutes > 0 && `積乱雲の近く ${Math.round(s.cbMinutes)} 分`,
    s.overspeedMinutes > 0 && `回転超過 ${Math.round(s.overspeedMinutes)} 分`,
    s.overVaMinutes > 0 && `乱気流で速すぎ ${Math.round(s.overVaMinutes)} 分`,
    s.lowReserveLandings > 0 && `予備燃料を割った着陸 ${s.lowReserveLandings} 回`,
  ].filter(Boolean) as string[];

  const lines: ScoreLine[] = [
    { label: "日数", detail: dayDetail, points: dayPoints, max: 25 },
    { label: "燃費", detail: `${Math.round(km)} km を ${fuel.toFixed(1)} L（1 L で ${kmPerL.toFixed(1)} km）`, points: fuelPoints, max: 25 },
    { label: "機体の状態", detail: `着いたときの平均 ${Math.round(avg)} / 100`, points: conditionPoints, max: 25 },
    {
      label: "安全な判断",
      detail: `予備燃料を守った ${reservePoints}・勇気ある撤退ボーナス ${retreatPoints}（引き返す ${c.turnBacks} 回・待つ ${c.waits} 回）・整備 ${maintenancePoints}（${c.maintenanceCount} 回）`,
      points: braveryPoints,
      max: 25,
    },
    { label: "危ない飛び方", detail: riskParts.length ? riskParts.join("・") : "なし", points: riskPoints, max: 0 },
  ];
  const total = clamp(lines.reduce((x, l) => x + l.points, 0), 0, 100);
  const rank = total >= RANK_FROM.S ? "S" : total >= RANK_FROM.A ? "A" : total >= RANK_FROM.B ? "B" : "C";
  const title = { S: "名パイロット", A: "腕のいいパイロット", B: "一人前のパイロット", C: "見習いパイロット" }[rank];

  // 4つの学び（1章）をふり返る
  const lessons: Lesson[] = [
    {
      title: LESSON_TITLES[0],
      ok: s.overspeedMinutes < 1,
      text:
        s.overspeedMinutes < 1
          ? "回転をレッドラインの内側に収めて飛べた。"
          : `回転超過が ${Math.round(s.overspeedMinutes)} 分あった。上昇型は回りやすい。全開や降下では回転計を見て絞ろう。`,
    },
    {
      title: LESSON_TITLES[1],
      ok: s.minBolt >= BOLT_DANGER + 20,
      text:
        s.minBolt >= BOLT_DANGER + 20
          ? `ボルトの締まりは最低でも ${Math.round(s.minBolt)}。締め直し ${c.retorques} 回。気候の違う土地でちゃんと見ていた。`
          : `ボルトが ${Math.round(s.minBolt)} までゆるんだ。気候の違う土地に着いたら、まず締め直そう。`,
    },
    {
      title: LESSON_TITLES[2],
      ok: kmPerL >= 6,
      text:
        kmPerL >= 6
          ? `1 L で ${kmPerL.toFixed(1)} km。混合比と高度をうまく使えた。`
          : `1 L で ${kmPerL.toFixed(1)} km。排気温度計で最良燃費を探し、風の弱い（追い風の）高度を選ぼう。`,
    },
    {
      title: LESSON_TITLES[3],
      ok: s.cloudMinutes + s.cbMinutes < 1 && s.hastyMinutes < 30,
      text:
        s.hastyMinutes > 0
          ? `焦っていた時間が ${Math.round(s.hastyMinutes)} 分あった。焦りが高いあいだ、整備士のひとことは「まあ大丈夫だろう」に変わっていた。気づけたかな？`
          : c.turnBacks + c.waits > 0
            ? `引き返す・待つを ${c.turnBacks + c.waits} 回選べた。降りて待つのも正しい判断だ。`
            : "焦らずに飛べた。危ないと思ったら、引き返す・待つを選べるようにしておこう。",
    },
  ];

  const comment =
    rank === "S"
      ? "文句なしだ。天気を読んで、機体をいたわって、無理なく早く着いた。"
      : rank === "A"
        ? "いい旅だった。あと一歩、燃費か機体の手入れを詰めれば名パイロットだ。"
        : rank === "B"
          ? "無事に着いたのが一番だ。ふり返りを見て、次はもっと上手く飛ぼう。"
          : "着いたのは立派だが、危ない場面が多かった。焦らず、引き返す勇気を持とう。";

  return { lines, total, rank, title, comment, lessons };
}
