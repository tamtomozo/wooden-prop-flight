import { describe, expect, it } from "vitest";
import { AdaptiveResolution, STEP, UP_AFTER_WINDOWS, WINDOW_MS } from "../src/ui/resolution";

/** frameMs の速さで ms ミリ秒ぶん飛ばす。frameMs は今の解像度から決めてよい */
function run(r: AdaptiveResolution, ms: number, frameMs: (ratio: number) => number) {
  let t = 0;
  while (t < ms) {
    const dt = frameMs(r.ratio);
    r.sample(dt);
    t += dt;
  }
}
const windows = (n: number) => n * WINDOW_MS + 1;

describe("景色の解像度の自動調整", () => {
  it("速いパソコンでは、いちばん細かいまま変えない", () => {
    const r = new AdaptiveResolution(2);
    run(r, windows(30), () => 1000 / 60);
    expect(r.ratio).toBe(2);
  });

  it("GPU が重くて遅いときは、間に合うまで下げる（下限より下げない）", () => {
    const r = new AdaptiveResolution(2);
    // フレーム時間がピクセル数（比の2乗）に比例する、GPU が足りないパソコン
    run(r, windows(30), (ratio) => 9 * ratio * ratio);
    expect(r.ratio).toBeLessThan(2);
    expect(9 * r.ratio * r.ratio).toBeLessThanOrEqual(1000 / 50);
    expect(r.ratio).toBeGreaterThanOrEqual(0.75);
  });

  it("解像度を下げても速くならない（30fps に絞られている）ときは、元に戻して下げない", () => {
    const r = new AdaptiveResolution(1.5);
    run(r, windows(30), () => 1000 / 30);
    expect(r.ratio).toBe(1.5);
  });

  it("一度下げても、余裕が続けば上げ直す。上げると遅くなるならそこで止める", () => {
    const r = new AdaptiveResolution(2);
    let heavy = true;
    run(r, windows(10), (ratio) => (heavy ? 9 * ratio * ratio : 6 * ratio * ratio));
    const lowered = r.ratio;
    expect(lowered).toBeLessThan(2);
    // 重い場面が終わった：上げても 50fps 以上出る
    heavy = false;
    run(r, windows(UP_AFTER_WINDOWS * 6), (ratio) => 6 * ratio * ratio);
    expect(r.ratio).toBeGreaterThan(lowered);
    // 上げたり下げたりをくり返さない：最後の区間では変わらない
    const settled = r.ratio;
    run(r, windows(UP_AFTER_WINDOWS * 4), (ratio) => 6 * ratio * ratio);
    expect(r.ratio).toBe(settled);
  });

  it("読み込み直後だけ遅く、そのあとは CPU で決まる速さなら、解像度は下げたままにしない", () => {
    const r = new AdaptiveResolution(2);
    run(r, windows(3), () => 45);
    run(r, windows(30), () => 1000 / 30);
    expect(r.ratio).toBe(2);
  });

  it("1秒だけの引っかかりでは下げない", () => {
    const r = new AdaptiveResolution(2);
    run(r, windows(5), () => 1000 / 60);
    run(r, WINDOW_MS, () => 40);
    run(r, windows(5), () => 1000 / 60);
    expect(r.ratio).toBe(2);
  });

  it("タブを切り替えたあとの長い空白は数えない", () => {
    const r = new AdaptiveResolution(2);
    for (let i = 0; i < 20; i++) r.sample(5000);
    expect(r.ratio).toBe(2);
    expect(STEP).toBeLessThan(1);
  });
});
