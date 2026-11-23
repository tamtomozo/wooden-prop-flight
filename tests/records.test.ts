import { describe, expect, it } from "vitest";
import { BIG_TANK_L } from "../src/config";
import { COURSES, KAMOME, OWADATSUMI, SHIROGANE, TSURANARI } from "../src/data/courses";
import { legBetween, WORLD } from "../src/data/world";
import { newCondition, startCampaign, type CampaignState } from "../src/game/campaign";
import { evaluateTrip } from "../src/game/evaluation";
import {
  ACHIEVEMENTS,
  bigTankUnlocked,
  challengeCourses,
  emptyProgress,
  nextStep,
  parseProgress,
  recordTrip,
  withBigTank,
  type Progress,
} from "../src/game/records";
import type { World } from "../src/model/types";
import { makeSetup } from "./helpers";

/** 最短の道で目的地まで飛びきったことにした旅（燃費は 1 L で kmPerL km） */
function finishedTrip(w: World, opts: { day?: number; turnBacks?: number; kmPerL?: number; difficulty?: CampaignState["difficulty"] } = {}) {
  const c = startCampaign(w, makeSetup(3, 100), 1, opts.difficulty ?? "normal");
  let from = w.startId;
  const path = [w.startId];
  // 目的地へ向かう道を、出発地から順にたどる
  while (from !== w.goalId) {
    const next = c.world.edges
      .flatMap((e) => (e.a === from ? [e.b] : e.b === from ? [e.a] : []))
      .find((id) => !path.includes(id) && reaches(w, id, w.goalId, [...path, id]))!;
    path.push(next);
    from = next;
  }
  const kmPerL = opts.kmPerL ?? 6;
  c.records = path.slice(1).map((id, i) => {
    const leg = legBetween(w, path[i], id);
    return { leg, day: 1, flightMin: 120, fuelUsed: leg.distanceKm / kmPerL, distanceKm: leg.distanceKm, returned: false };
  });
  c.location = w.goalId;
  c.day = opts.day ?? 1;
  c.clockMin = 15 * 60;
  c.turnBacks = opts.turnBacks ?? 0;
  c.condition = newCondition(w, makeSetup());
  return c;
}

function reaches(w: World, from: string, to: string, seen: string[]): boolean {
  if (from === to) return true;
  return w.edges
    .flatMap((e) => (e.a === from ? [e.b] : e.b === from ? [e.a] : []))
    .some((id) => !seen.includes(id) && reaches(w, id, to, [...seen, id]));
}

const ids = (p: { newAchievements: { id: string }[] }) => p.newAchievements.map((a) => a.id);

describe("旅をまたいで残る記録", () => {
  it("はじめて着いたら自己ベストと「はじめての横断」。大洋を越えると増設タンクが使える", () => {
    const c = finishedTrip(OWADATSUMI);
    const r = recordTrip(emptyProgress(), c, evaluateTrip(c));
    expect(r.newBest).toBe(true);
    expect(r.previousBest).toBeNull();
    expect(r.progress.best[OWADATSUMI.id].day).toBe(1);
    expect(ids(r)).toEqual(expect.arrayContaining(["first", "ocean", "oneDay"]));
    expect(bigTankUnlocked(r.progress)).toBe(true);
    expect(bigTankUnlocked(emptyProgress())).toBe(false);
  });

  it("前より悪い旅では自己ベストは変わらず、同じ実績は二度もらえない", () => {
    const good = finishedTrip(KAMOME, { kmPerL: 7 });
    const first = recordTrip(emptyProgress(), good, evaluateTrip(good));
    const bad = finishedTrip(KAMOME, { day: 3, kmPerL: 5 });
    const second = recordTrip(first.progress, bad, evaluateTrip(bad));
    expect(second.newBest).toBe(false);
    expect(second.progress.best[KAMOME.id]).toEqual(first.progress.best[KAMOME.id]);
    expect(ids(second)).not.toContain("first");
    expect(new Set(second.progress.achievements).size).toBe(second.progress.achievements.length);
  });

  it("もとの記録は書き換えない", () => {
    const p = emptyProgress();
    const c = finishedTrip(KAMOME);
    recordTrip(p, c, evaluateTrip(c));
    expect(p).toEqual(emptyProgress());
  });

  it("練習コースは「一日で渡りきる」にならない。引き返して着けば「引き返して、また飛んだ」", () => {
    const practice = finishedTrip(WORLD);
    expect(ids(recordTrip(emptyProgress(), practice, evaluateTrip(practice)))).not.toContain("oneDay");
    const back = finishedTrip(KAMOME, { turnBacks: 1 });
    expect(ids(recordTrip(emptyProgress(), back, evaluateTrip(back)))).toContain("comeback");
  });

  it("山越えでは「峰の横を越えて」、リアルでは「計器だけを信じて」", () => {
    const c = finishedTrip(SHIROGANE, { difficulty: "real" });
    const got = ids(recordTrip(emptyProgress(), c, evaluateTrip(c)));
    expect(got).toContain("summit");
    expect(got).toContain("real");
  });

  it("練習のほかの4コースをすべて渡ると「すべての空を越えて」", () => {
    let p: Progress = emptyProgress();
    const got: string[] = [];
    for (const w of challengeCourses()) {
      const c = finishedTrip(w);
      const r = recordTrip(p, c, evaluateTrip(c));
      p = r.progress;
      got.push(...ids(r));
    }
    expect(got.filter((id) => id === "all")).toHaveLength(1);
    expect(challengeCourses()).toHaveLength(COURSES.length - 1);
  });

  it("保存した記録が壊れていても読める（知らない実績や形の違う記録は捨てる）", () => {
    expect(parseProgress(null)).toEqual(emptyProgress());
    expect(parseProgress("{こわれた")).toEqual(emptyProgress());
    const p = parseProgress(
      JSON.stringify({ best: { kamome: { rank: "A", total: 75, day: 1 }, bad: { rank: "Z" } }, achievements: ["first", "nope"] }),
    );
    expect(p.best).toEqual({ kamome: { rank: "A", total: 75, day: 1 } });
    expect(p.achievements).toEqual(["first"]);
    expect(ACHIEVEMENTS.every((a) => a.hint && a.title)).toBe(true);
  });

  it("増設タンク：容量だけが増え、満タンならそのぶん多く積む", () => {
    const big = withBigTank(OWADATSUMI);
    expect(big.fuelCapacityL).toBe(OWADATSUMI.fuelCapacityL + BIG_TANK_L);
    expect(big.id).toBe(OWADATSUMI.id);
    expect(startCampaign(big, makeSetup(5, 100)).condition.fuelRemaining).toBe(OWADATSUMI.fuelCapacityL + BIG_TANK_L);
  });
});

describe("最後の画面：次にすること", () => {
  it("練習のあとは、いちばんやさしい本番のコースをすすめる", () => {
    const c = finishedTrip(WORLD);
    const ev = evaluateTrip(c);
    const s = nextStep(WORLD, ev, recordTrip(emptyProgress(), c, ev).progress);
    expect(s.course?.id).toBe(KAMOME.id);
  });

  it("まだ渡っていないコースを、やさしい順にすすめる", () => {
    const c = finishedTrip(KAMOME);
    const ev = evaluateTrip(c);
    const s = nextStep(KAMOME, ev, recordTrip(emptyProgress(), c, ev).progress);
    expect(s.course?.level).toBe(2);
    expect([TSURANARI.id, SHIROGANE.id]).toContain(s.course?.id);
  });

  it("全部渡ったら、S をとれていない点のいちばん低いコース。全部 S なら、すすめない", () => {
    const p: Progress = {
      best: {
        kamome: { rank: "S", total: 90, day: 1 },
        tsuranari: { rank: "B", total: 55, day: 2 },
        owadatsumi: { rank: "A", total: 72, day: 1 },
        shirogane: { rank: "S", total: 88, day: 1 },
      },
      achievements: [],
    };
    const c = finishedTrip(KAMOME);
    const ev = evaluateTrip(c);
    expect(nextStep(KAMOME, ev, p).course?.id).toBe(TSURANARI.id);
    for (const id of Object.keys(p.best)) p.best[id] = { rank: "S", total: 90, day: 1 };
    expect(nextStep(KAMOME, ev, p).course).toBeNull();
  });

  it("S でなければ、次のランクまでの点と、いちばん取りこぼした項目を言う", () => {
    const c = finishedTrip(KAMOME, { day: 4, kmPerL: 7 });
    const ev = evaluateTrip(c);
    expect(ev.rank).not.toBe("S");
    const s = nextStep(KAMOME, ev, recordTrip(emptyProgress(), c, ev).progress);
    expect(s.advice).toMatch(/まであと \d+ 点/);
    // 4日かかったので、日数（0 / 25）がいちばんの取りこぼし
    expect(s.advice).toContain("日数（0 / 25）");
  });
});
