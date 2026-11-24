// 丸い針の計器。文字盤（目盛り・色の帯・ネジ）は一度だけ描いてとっておき、
// 毎フレームは針と表示窓だけを描き直す。
import { elementSize, type ElementSize } from "./dom";

export interface Arc {
  from: number;
  to: number;
  color: string;
}

export interface GaugeSpec {
  title: string;
  unit?: string;
  min: number;
  max: number;
  /** 針の振れる範囲（ラジアン、時計回り。0＝右） */
  sweep?: [number, number];
  major: number;
  minor: number;
  /** 大きい目盛りの数字。null なら数字なし */
  label?: (v: number) => string | null;
  arcs?: Arc[];
}

export interface GaugeExtras {
  /** 文字盤の下に出す数値（「数値を表示」のとき） */
  readout?: string;
  /** 文字盤の下の小窓（例：混合比のゾーン） */
  flag?: { text: string; color: string };
  /** 針の震え（値の単位） */
  jitter?: number;
}

export const GREEN = "#4cc38a";
export const YELLOW = "#e8c547";
export const RED = "#ef5a5a";
export const BLUE = "#5aa9ef";

const FULL_SWEEP: [number, number] = [Math.PI * 0.75, Math.PI * 2.25];
// 文字盤の下半分に並べる文字の高さ（中心からの距離 ÷ 半径）
const TITLE_Y = 0.23;
const UNIT_Y = 0.4;
const READOUT_Y = 0.61;
const FLAG_Y = 0.82;
// 文字の高さ（÷ 文字盤の半径）。小さな計器でも読めるように、なるべく大きく
const NUMBER_FONT = 0.23;
const TITLE_FONT = 0.2;
const UNIT_FONT = 0.15;
const READOUT_FONT = 0.21;
const FLAG_FONT = 0.18;
/** 目盛りの数字を置く半径（÷ 文字盤の半径） */
const NUMBER_R = 0.64;
/** 文字盤の半径（÷ 計器の大きさ）。draw でも同じ値を使う */
const DIAL_R = 0.43;

export class RoundGauge {
  private face = document.createElement("canvas");
  private ctx: CanvasRenderingContext2D;
  private size = 0;
  private dpr = 1;
  private shown: number | null = null;
  /** 計器も数値だけ（リアル）：色の帯を描かない */
  private plain = false;
  /** 画面の上での計器の大きさ（変わったときだけ更新される） */
  private cssSize: ElementSize;

  constructor(
    private canvas: HTMLCanvasElement,
    private spec: GaugeSpec,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.cssSize = elementSize(canvas);
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", spec.title);
  }

  setPlain(plain: boolean) {
    if (plain === this.plain) return;
    this.plain = plain;
    this.size = 0; // 文字盤を描き直す
  }

  private angle(v: number) {
    const [a0, a1] = this.spec.sweep ?? FULL_SWEEP;
    const t = Math.min(1, Math.max(0, (v - this.spec.min) / (this.spec.max - this.spec.min)));
    return a0 + (a1 - a0) * t;
  }

  private fit() {
    const size = this.cssSize.w;
    const dpr = window.devicePixelRatio || 1;
    if (!size || (size === this.size && dpr === this.dpr)) return;
    this.size = size;
    this.dpr = dpr;
    for (const c of [this.canvas, this.face]) {
      c.width = Math.round(size * dpr);
      c.height = Math.round(size * dpr);
    }
    this.drawFace();
  }

  private drawFace() {
    const g = this.face.getContext("2d")!;
    const s = this.size;
    const c = s / 2;
    const R = s * 0.49; // ベゼルの外側
    const r = s * DIAL_R; // 文字盤
    const sp = this.spec;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, s, s);

    // 取り付けネジ（四隅）
    for (const [x, y] of [[0.09, 0.09], [0.91, 0.09], [0.09, 0.91], [0.91, 0.91]]) {
      const sx = x * s;
      const sy = y * s;
      const sr = s * 0.028;
      const grad = g.createRadialGradient(sx - sr / 3, sy - sr / 3, 0, sx, sy, sr);
      grad.addColorStop(0, "#9aa0a6");
      grad.addColorStop(1, "#3b3f44");
      g.fillStyle = grad;
      g.beginPath();
      g.arc(sx, sy, sr, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = "#202326";
      g.lineWidth = s * 0.008;
      g.beginPath();
      g.moveTo(sx - sr * 0.7, sy + sr * 0.3);
      g.lineTo(sx + sr * 0.7, sy - sr * 0.3);
      g.stroke();
    }

    // ベゼル（金属の縁）
    const bezel = g.createLinearGradient(0, c - R, 0, c + R);
    bezel.addColorStop(0, "#6c7177");
    bezel.addColorStop(0.5, "#2c2f33");
    bezel.addColorStop(1, "#4a4e53");
    g.fillStyle = bezel;
    g.beginPath();
    g.arc(c, c, R, 0, Math.PI * 2);
    g.fill();

    // 文字盤
    const dial = g.createRadialGradient(c, c - r * 0.3, r * 0.1, c, c, r);
    dial.addColorStop(0, "#22252a");
    dial.addColorStop(1, "#0d0e10");
    g.fillStyle = dial;
    g.beginPath();
    g.arc(c, c, r, 0, Math.PI * 2);
    g.fill();

    // 色の帯
    for (const arc of this.plain ? [] : (sp.arcs ?? [])) {
      g.strokeStyle = arc.color;
      g.lineWidth = r * 0.09;
      g.beginPath();
      g.arc(c, c, r * 0.9, this.angle(arc.from), this.angle(arc.to));
      g.stroke();
    }

    // 目盛りと数字
    g.strokeStyle = "#ecebe6";
    g.fillStyle = "#ecebe6";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = `700 ${Math.round(r * NUMBER_FONT)}px system-ui, sans-serif`;
    const steps = Math.round((sp.max - sp.min) / sp.minor);
    for (let i = 0; i <= steps; i++) {
      const v = sp.min + i * sp.minor;
      const a = this.angle(v);
      const isMajor = Math.abs(((v - sp.min) / sp.major) % 1) < 1e-6 || Math.abs(v - sp.max) < 1e-6;
      const len = isMajor ? r * 0.15 : r * 0.08;
      g.lineWidth = isMajor ? r * 0.035 : r * 0.018;
      g.beginPath();
      g.moveTo(c + Math.cos(a) * r * 0.97, c + Math.sin(a) * r * 0.97);
      g.lineTo(c + Math.cos(a) * (r * 0.97 - len), c + Math.sin(a) * (r * 0.97 - len));
      g.stroke();
      if (isMajor) {
        const text = sp.label ? sp.label(v) : String(v);
        if (text) g.fillText(text, c + Math.cos(a) * r * NUMBER_R, c + Math.sin(a) * r * NUMBER_R);
      }
    }

    // 計器の名前と単位（文字盤の下半分。上半分は目盛りと針の場所）
    g.fillStyle = "#c9c6bd";
    g.font = `700 ${Math.round(r * TITLE_FONT)}px system-ui, sans-serif`;
    g.fillText(sp.title, c, c + r * TITLE_Y);
    if (sp.unit) {
      g.fillStyle = "#a3a6ab";
      g.font = `600 ${Math.round(r * UNIT_FONT)}px system-ui, sans-serif`;
      g.fillText(sp.unit, c, c + r * UNIT_Y);
    }

    // 縁の内側の影
    const shade = g.createRadialGradient(c, c, r * 0.85, c, c, r);
    shade.addColorStop(0, "rgba(0,0,0,0)");
    shade.addColorStop(1, "rgba(0,0,0,0.55)");
    g.fillStyle = shade;
    g.beginPath();
    g.arc(c, c, r, 0, Math.PI * 2);
    g.fill();
  }

  draw(value: number, extras: GaugeExtras = {}) {
    this.fit();
    if (!this.size) return;
    // 針は少し遅れてなめらかに動く
    this.shown = this.shown === null ? value : this.shown + (value - this.shown) * 0.2;
    const v = this.shown + (extras.jitter ? (Math.random() - 0.5) * extras.jitter : 0);

    const g = this.ctx;
    const s = this.size;
    const c = s / 2;
    const r = s * DIAL_R;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    g.drawImage(this.face, 0, 0);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

    g.textAlign = "center";
    g.textBaseline = "middle";
    if (extras.flag) {
      const w = r * 0.82;
      const h = r * 0.25;
      g.fillStyle = "#050607";
      g.beginPath();
      g.roundRect(c - w / 2, c + r * FLAG_Y - h / 2, w, h, h * 0.25);
      g.fill();
      g.fillStyle = extras.flag.color;
      g.font = `700 ${Math.round(r * FLAG_FONT)}px system-ui, sans-serif`;
      g.fillText(extras.flag.text, c, c + r * FLAG_Y + r * 0.005);
    }
    if (extras.readout) {
      g.fillStyle = "#e8a35c";
      g.font = `700 ${Math.round(r * READOUT_FONT)}px ui-monospace, monospace`;
      g.fillText(extras.readout, c, c + r * READOUT_Y);
    }

    // 針
    const a = this.angle(v);
    g.save();
    g.translate(c, c);
    g.rotate(a);
    g.shadowColor = "rgba(0,0,0,0.6)";
    g.shadowBlur = r * 0.06;
    g.shadowOffsetY = r * 0.03;
    g.fillStyle = "#f4f1e8";
    g.beginPath();
    g.moveTo(-r * 0.18, -r * 0.035);
    g.lineTo(r * 0.86, -r * 0.012);
    g.lineTo(r * 0.9, 0);
    g.lineTo(r * 0.86, r * 0.012);
    g.lineTo(-r * 0.18, r * 0.035);
    g.closePath();
    g.fill();
    g.restore();
    // 針の軸
    g.fillStyle = "#3a3d42";
    g.beginPath();
    g.arc(c, c, r * 0.09, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#16181b";
    g.beginPath();
    g.arc(c, c, r * 0.045, 0, Math.PI * 2);
    g.fill();

    // ガラスの映り込み（文字盤の内側だけ）
    g.save();
    g.beginPath();
    g.arc(c, c, r, 0, Math.PI * 2);
    g.clip();
    const glare = g.createLinearGradient(c - r, c - r, c, c);
    glare.addColorStop(0, "rgba(255,255,255,0.13)");
    glare.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = glare;
    g.beginPath();
    g.ellipse(c - r * 0.25, c - r * 0.35, r * 0.75, r * 0.45, -Math.PI / 4, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
}
