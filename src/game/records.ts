// 旅をまたいで残る記録：コースごとの自己ベスト、伏せた実績、クリアで使えるようになるもの（増設タンク）。
// 保存（localStorage）は画面の側でする。ここは記録の中身と、旅の結果から記録を更新する計算だけ。
import { BIG_TANK_L } from "../config";
import { COURSES, OWADATSUMI } from "../data/courses";
import { seaKm } from "../data/world";
import type { World } from "../model/types";
import type { CampaignState } from "./campaign";
import { RANK_FROM, type TripEvaluation } from "./evaluation";

export type Rank = TripEvaluation["rank"];

export interface CourseBest {
  rank: Rank;
  total: number;
  /** 何日目に着いたか */
  day: number;
}

export interface Progress {
  /** コースの id ごとの自己ベスト（着いたことのあるコースだけ） */
  best: Record<string, CourseBest>;
  /** 手に入れた実績の id */
  achievements: string[];
}

export const emptyProgress = (): Progress => ({ best: {}, achievements: [] });

/** チュートリアルを除いた、挑戦するコース */
export const challengeCourses = (): World[] => COURSES.filter((w) => !w.tutorial);

/** 旅を終えたときの材料（実績の判定に使う） */
interface TripFacts {
  c: CampaignState;
  ev: TripEvaluation;
  /** 実際に通った区間（引き返した区間は除く） */
  flownSeaKm: number;
  kmPerL: number;
  /** この旅のあとの記録（全コース制覇の判定に使う） */
  after: Progress;
}

export interface Achievement {
  id: string;
  title: string;
  /** 手に入れる前に見せる手がかり（題名は「？？？」で伏せる） */
  hint: string;
  /** 手に入れたときに見せる一文 */
  text: string;
  /** 手に入れると使えるようになるもの（あれば） */
  reward?: string;
  check: (t: TripFacts) => boolean;
}

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: "first",
    title: "はじめての横断",
    hint: "どこかのコースで、目的地まで飛びきる",
    text: "はじめて目的地まで飛びきった。",
    check: () => true,
  },
  {
    id: "oneDay",
    title: "一日で渡りきる",
    hint: "チュートリアルではないコースを、泊まらずに",
    text: "1日目のうちに、海や山の向こうへ着いた。",
    check: ({ c }) => !c.world.tutorial && c.day === 1,
  },
  {
    id: "comeback",
    title: "引き返して、また飛んだ",
    hint: "勇気ある撤退の、その先",
    text: "一度は引き返し、それでも目的地に着いた。",
    check: ({ c }) => c.turnBacks > 0,
  },
  {
    id: "sea500",
    title: "海の上の 500 km",
    hint: "1回の旅で、長い長い海の上を",
    text: "1回の旅で、海の上を 500 km 以上飛んだ。",
    check: ({ flownSeaKm }) => flownSeaKm >= 500,
  },
  {
    id: "summit",
    title: "峰の横を越えて",
    hint: "3000 m を越える山のある区間を",
    text: "3000 m を越える山なみを飛び越えた。",
    check: ({ c }) => c.records.some((r) => !r.returned && r.leg.terrain.some((x) => x.height >= 3000)),
  },
  {
    id: "thrifty",
    title: "燃費名人",
    hint: "1 L の燃料で、できるだけ遠くへ",
    text: "旅全体で、1 L あたり 7 km 以上飛んだ。",
    check: ({ kmPerL }) => kmPerL >= 7,
  },
  {
    id: "ocean",
    title: "大洋を越えた",
    hint: "★★★ のコースを渡りきる",
    text: "おおわだつみを渡りきった。",
    reward: `格納庫で増設タンク（+${BIG_TANK_L} L）が使えるようになった。史実の大洋横断機も、胴体いっぱいに燃料を積んだ`,
    check: ({ c }) => c.world.id === OWADATSUMI.id,
  },
  {
    id: "rankS",
    title: "名パイロット",
    hint: "最高の評価をとる",
    text: "S ランクをとった。",
    check: ({ ev }) => ev.rank === "S",
  },
  {
    id: "real",
    title: "計器だけを信じて",
    hint: "いちばん難しい難易度で",
    text: "難易度リアルで目的地に着いた。",
    check: ({ c }) => c.difficulty === "real",
  },
  {
    id: "all",
    title: "すべての空を越えて",
    hint: "チュートリアルのほかの、すべてのコースで",
    text: "海峡・諸島・山脈・大洋、すべてのコースを渡りきった。",
    check: ({ after }) => challengeCourses().every((w) => after.best[w.id]),
  },
];

/** 増設タンクが使えるか（★★★ おおわだつみを渡りきったら） */
export const bigTankUnlocked = (p: Progress) => p.achievements.includes("ocean");

/** 増設タンクを積んだ機体の舞台（タンクの大きさだけ違う） */
export const withBigTank = (w: World): World => ({ ...w, fuelCapacityL: w.fuelCapacityL + BIG_TANK_L });

const RANK_ORDER: Rank[] = ["C", "B", "A", "S"];
const better = (a: CourseBest, b: CourseBest) => a.total > b.total || (a.total === b.total && a.day < b.day);

export interface TripRecordResult {
  progress: Progress;
  /** この旅で手に入れた実績 */
  newAchievements: Achievement[];
  /** 自己ベストを更新したか（はじめて着いたときも true） */
  newBest: boolean;
  previousBest: CourseBest | null;
}

/** 目的地に着いた旅を記録に足す（もとの progress は変えない） */
export function recordTrip(p: Progress, c: CampaignState, ev: TripEvaluation): TripRecordResult {
  const flown = c.records.filter((r) => !r.returned);
  const km = c.records.reduce((x, r) => x + r.distanceKm, 0);
  const fuel = c.records.reduce((x, r) => x + r.fuelUsed, 0);
  const mine: CourseBest = { rank: ev.rank, total: ev.total, day: c.day };
  const previousBest = p.best[c.world.id] ?? null;
  const newBest = !previousBest || better(mine, previousBest);
  const after: Progress = {
    best: { ...p.best, [c.world.id]: newBest ? mine : previousBest! },
    achievements: [...p.achievements],
  };
  const facts: TripFacts = {
    c,
    ev,
    flownSeaKm: flown.reduce((s, r) => s + seaKm(r.leg), 0),
    kmPerL: fuel > 0 ? km / fuel : 0,
    after,
  };
  const newAchievements = ACHIEVEMENTS.filter((a) => !after.achievements.includes(a.id) && a.check(facts));
  after.achievements.push(...newAchievements.map((a) => a.id));
  return { progress: after, newAchievements, newBest, previousBest };
}

/** 記録の読み込み：壊れていたり古い形だったりしても、読めるところだけ使う */
export function parseProgress(raw: string | null): Progress {
  const p = emptyProgress();
  if (!raw) return p;
  try {
    const x = JSON.parse(raw);
    if (x && typeof x.best === "object" && x.best) {
      for (const [id, b] of Object.entries(x.best as Record<string, CourseBest>)) {
        if (b && RANK_ORDER.includes(b.rank) && typeof b.total === "number" && typeof b.day === "number") p.best[id] = b;
      }
    }
    if (Array.isArray(x?.achievements)) p.achievements = x.achievements.filter((a: unknown) => ACHIEVEMENTS.some((k) => k.id === a));
  } catch {
    /* 読めなければ空の記録 */
  }
  return p;
}

// ---- 最後の画面：次にすること（14 次の行動の指示） ----

/** 次のランクと、そこに要る点 */
const NEXT_RANK: { rank: Rank; from: number }[] = [
  { rank: "B", from: RANK_FROM.B },
  { rank: "A", from: RANK_FROM.A },
  { rank: "S", from: RANK_FROM.S },
];

/** 評価の項目ごとの、点を伸ばすためのひとこと */
const GROW_HINT: Record<string, string> = {
  日数: "泊まらずに着ければ",
  燃費: "排気温度計で最良燃費を探し、向かい風の弱い高度を選べば",
  機体の状態: "経由地でこまめにボルトを締め直し、整備をしておけば",
  安全な判断: "予備燃料を守り、危ないときは引き返す・待つ・整備を惜しまなければ",
  危ない飛び方: "雲の中・積乱雲の近く・回転超過を避ければ",
};

export interface NextStep {
  /** ランクと、いちばん伸ばしやすい項目（整備士のひとこと） */
  advice: string;
  /** 次にすすめるコース（なければ null） */
  course: World | null;
  /** すすめる理由（短く） */
  courseReason: string;
}

const stars = (w: World) => (w.tutorial ? "" : "★".repeat(w.level));

/**
 * 旅を終えたあと、次に何をするか。
 * p は、この旅を記録したあとの記録（recordTrip の結果）。
 */
export function nextStep(world: World, ev: TripEvaluation, p: Progress): NextStep {
  let advice: string;
  const next = NEXT_RANK.find((r) => ev.total < r.from);
  if (!next) advice = `S ランク（${ev.total} 点）。言うことはない。`;
  else {
    // いちばん点を落とした項目（危ない飛び方は、減点の大きさ）
    const weakest = [...ev.lines].sort((a, b) => b.max - b.points - (a.max - a.points))[0];
    const where = weakest.max > 0 ? `${weakest.label}（${weakest.points} / ${weakest.max}）` : `危ない飛び方（${weakest.points}）`;
    advice = `${ev.rank} ランク（${ev.total} 点）。${next.rank} まであと ${next.from - ev.total} 点。いちばん取りこぼしたのは${where}だ。${GROW_HINT[weakest.label] ?? ""}、届くぞ。`;
  }

  const list = [...challengeCourses()].sort((a, b) => a.level - b.level);
  const untried = list.find((w) => w.id !== world.id && !p.best[w.id]);
  if (untried) {
    return {
      advice,
      course: untried,
      courseReason: world.tutorial ? "チュートリアルはおしまいだ。本番の空へ" : `まだ渡っていない ${stars(untried)} のコースだ`,
    };
  }
  // 全部渡ったら、S をとれていないコースのうち点のいちばん低いもの
  const notS = list
    .filter((w) => w.id !== world.id && p.best[w.id] && p.best[w.id].rank !== "S")
    .sort((a, b) => p.best[a.id].total - p.best[b.id].total)[0];
  if (notS) {
    const b = p.best[notS.id];
    return { advice, course: notS, courseReason: `自己ベストは ${b.rank}（${b.total} 点）。S をねらおう` };
  }
  return { advice, course: null, courseReason: "" };
}

export const courseLabel = (w: World) => `${stars(w)} ${w.title}`.trim();
