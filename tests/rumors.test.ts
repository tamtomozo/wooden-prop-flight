import { describe, expect, it } from "vitest";
import { COURSES, OWADATSUMI, SHIROGANE } from "../src/data/courses";
import { legBetween } from "../src/data/world";
import { rumorsFor } from "../src/game/rumors";

describe("経由地のうわさ話", () => {
  it("どのコースのどの区間（両向き）でも、2つまで出て、同じ seed なら同じ", () => {
    for (const w of COURSES) {
      for (const e of w.edges) {
        for (const [a, b] of [[e.a, e.b], [e.b, e.a]]) {
          const leg = legBetween(w, a, b);
          const r = rumorsFor(leg, 7);
          expect(r.length, `${w.id} ${a}→${b}`).toBeLessThanOrEqual(2);
          expect(rumorsFor(leg, 7)).toEqual(r);
          expect(new Set(r.map((x) => x.text)).size).toBe(r.length);
        }
      }
    }
  });

  it("峠の区間では、山で上がりきれなかった話が必ず出る", () => {
    const leg = legBetween(SHIROGANE, "tanima", "kougen");
    for (const seed of [0, 1, 2, 3]) expect(rumorsFor(leg, seed)[0].text).toContain("かざこし峠");
  });

  it("長い海の区間では、沖で止まった機の話が必ず出る", () => {
    const leg = legBetween(OWADATSUMI, OWADATSUMI.startId, OWADATSUMI.goalId);
    expect(leg.sea.length).toBeGreaterThan(0);
    expect(rumorsFor(leg, 3)[0].text).toContain("沖で止まった");
  });

  it("2つ目のうわさは seed によって変わることがある（いつも同じ話にはならない）", () => {
    const leg = legBetween(SHIROGANE, SHIROGANE.startId, SHIROGANE.goalId);
    const seconds = new Set([0, 1, 2, 3, 4, 5].map((s) => rumorsFor(leg, s)[1]?.text));
    expect(seconds.size).toBeGreaterThan(1);
  });
});
