// 3Dの景色の解像度（ピクセル比）を、そのパソコンの速さに合わせて自動で上げ下げする。
//
// ・1秒ごとに平均のフレーム時間を見る。遅い（50fps を切る）なら解像度を1段下げる。
// ・下げたあと本当に速くなったかを確かめ、速くならなければ（GPU のせいではなかった。
//   ブラウザが 30fps に絞っている、JS が重い など）元に戻して、それより下げない。
// ・しばらく余裕が続いたら1段上げてみる。上げたら遅くなったときは戻して、それより上げない。
// 画面のリフレッシュレートが 60Hz でも 144Hz でも同じように働くよう、「遅い」は絶対時間で決める。

/** これより遅い平均フレーム時間（ms）なら解像度を下げる（50fps） */
export const SLOW_MS = 1000 / 50;
/** これより速い平均フレーム時間（ms）が続いたら解像度を上げてみる（57fps） */
export const FAST_MS = 1000 / 57;
/** 平均をとる長さ（ms） */
export const WINDOW_MS = 1000;
/** 解像度を上げてみるまでに、速い区間がこれだけ続くこと */
export const UP_AFTER_WINDOWS = 5;
/** 1段で変える割合 */
export const STEP = 0.8;
/** 下げたあと、平均フレーム時間がこれだけ縮まらなければ「効かなかった」とみなす */
export const MIN_GAIN = 0.92;
/** 読み込み直後は遅くなりがち（JIT・シェーダーの準備）なので、最初のこれだけの区間は見ない */
export const WARMUP_WINDOWS = 3;
/** 解像度を下げるのは、遅い区間がこれだけ続いたとき（一瞬の引っかかりでは下げない） */
export const DOWN_AFTER_WINDOWS = 2;
/** タブを切り替えたあとなどの長い空白は数えない（ms） */
const GAP_MS = 250;

type Phase = "warmup" | "watch" | "settle" | "verifyDown" | "verifyUp";

export class AdaptiveResolution {
  /** 今のピクセル比 */
  ratio: number;
  private ceiling: number;
  private floor: number;
  private phase: Phase = "warmup";
  private sum = 0;
  private frames = 0;
  private fastWindows = 0;
  private warmupLeft = WARMUP_WINDOWS;
  private slow: number[] = [];
  private before = { ratio: 0, avg: 0 };
  private next: Phase = "watch";

  /**
   * @param max 画面の細かさ（devicePixelRatio、上限2）。これより上げない
   * @param min これより下げない
   */
  constructor(
    max: number,
    min = Math.min(max, 0.75),
  ) {
    this.ratio = max;
    this.ceiling = max;
    this.floor = min;
  }

  /** 1フレームぶんの時間（ms）を渡す。解像度を変えたら true */
  sample(dtMs: number): boolean {
    if (!(dtMs > 0) || dtMs > GAP_MS) return false;
    this.sum += dtMs;
    this.frames++;
    if (this.sum < WINDOW_MS) return false;
    const avg = this.sum / this.frames;
    this.sum = 0;
    this.frames = 0;
    return this.window(avg);
  }

  private window(avg: number): boolean {
    switch (this.phase) {
      case "warmup":
        // 読み込み直後は見ない
        if (--this.warmupLeft <= 0) this.phase = "watch";
        return false;
      case "settle":
        // 解像度を変えた直後の1区間は、作り直しの引っかかりがあるので見ない
        this.phase = this.next;
        return false;
      case "verifyDown":
        this.phase = "watch";
        if (avg <= this.before.avg * MIN_GAIN) return false; // 下げて速くなった
        // 速くならなかった：GPU のせいではない。元に戻して、もう下げない
        this.floor = this.before.ratio;
        return this.set(this.before.ratio);
      case "verifyUp":
        this.phase = "watch";
        if (avg <= SLOW_MS) return false; // 上げても間に合っている
        // 上げたら遅くなった：戻して、もう上げない
        this.ceiling = this.before.ratio;
        return this.set(this.before.ratio);
      case "watch":
        if (avg > SLOW_MS) {
          this.fastWindows = 0;
          this.slow.push(avg);
          if (this.slow.length < DOWN_AFTER_WINDOWS || this.ratio <= this.floor) return false;
          // 下げる前の速さは、遅かった区間の平均（あとで「下げて速くなったか」を比べる）
          const before = this.slow.reduce((a, b) => a + b, 0) / this.slow.length;
          this.slow = [];
          return this.change(Math.max(this.floor, this.ratio * STEP), before, "verifyDown");
        }
        this.slow = [];
        this.fastWindows = avg < FAST_MS ? this.fastWindows + 1 : 0;
        if (this.fastWindows >= UP_AFTER_WINDOWS && this.ratio < this.ceiling) {
          this.fastWindows = 0;
          return this.change(Math.min(this.ceiling, this.ratio / STEP), avg, "verifyUp");
        }
        return false;
    }
  }

  private change(ratio: number, avg: number, verify: Phase): boolean {
    this.before = { ratio: this.ratio, avg };
    this.phase = "settle";
    this.next = verify;
    return this.set(ratio);
  }

  private set(ratio: number): boolean {
    const r = Math.round(ratio * 100) / 100;
    if (r === this.ratio) return false;
    this.ratio = r;
    return true;
  }
}
