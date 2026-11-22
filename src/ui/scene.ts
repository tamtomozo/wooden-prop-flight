// 横から見た飛行の様子（2D）。
import { DISORIENT_LIMIT_MIN } from "../config";
import { groundElevation, type FlightState } from "../game/flight";
import { mixRGB, skyAt, type RGB } from "./sky";

const css = (c: RGB, alpha = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha})`;

export class SideScene {
  private ctx: CanvasRenderingContext2D;
  private w = 0;
  private h = 0;
  private propAngle = 0;
  private windOffset = 0;
  private t = 0;
  private streaks = Array.from({ length: 26 }, () => ({
    x: Math.random(),
    y: Math.random(),
    len: 0.3 + Math.random() * 0.7,
  }));

  constructor(private canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext("2d")!;
  }

  private fit() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === this.w && h === this.h) return;
    const dpr = window.devicePixelRatio || 1;
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  draw(s: FlightState, realDt: number, running: boolean) {
    this.fit();
    const { ctx, w, h } = this;
    this.t += realDt;
    const p = s.perf;
    const rough = p.mixture.zone === "tooLean" && s.status === "flying";
    const sky = skyAt(s);
    const dusk = sky.dusk;
    const e = s.env;
    const gloom = Math.min(1, (e.overcast ? 0.45 : 0) + e.rain * 0.15);
    const grayRGB: RGB = [125, 132, 140];

    // 空間識失調：雲の中では画面全体がじわじわ傾く
    const tilt = Math.min(1, s.disorientation / DISORIENT_LIMIT_MIN);
    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.rotate(tilt * tilt * 0.6);
    ctx.translate(-w / 2, -h / 2);

    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, css(mixRGB(sky.top, grayRGB, gloom)));
    g.addColorStop(1, css(mixRGB(sky.bottom, grayRGB, gloom * 0.8)));
    ctx.fillStyle = g;
    ctx.fillRect(-w, -h, w * 3, h * 3);

    // 太陽：日没に向かって地平線へ沈む（どんより曇っていれば見えない）
    if (gloom < 0.3) {
      ctx.fillStyle = css(sky.sunColor, 0.9);
      ctx.beginPath();
      ctx.arc(w * 0.82, h * 0.15 + (1 - sky.sunHeight) * h * 0.75, 18, 0, Math.PI * 2);
      ctx.fill();
    }

    // 山（遠景と近景で流れる速さを変える）
    const scroll = s.distanceFlown * 40; // 1km = 40px
    this.mountains(scroll * 0.15, h * 0.72, 50, css(mixRGB([120, 150, 175], [90, 80, 110], dusk)), 0.004);
    this.mountains(scroll * 0.4, h * 0.84, 34, css(mixRGB([80, 120, 90], [60, 60, 70], dusk)), 0.009);
    ctx.fillStyle = css(mixRGB([95, 140, 80], [50, 55, 50], dusk));
    ctx.fillRect(0, h * 0.9, w, h * 0.1);

    // 晴れた日のわた雲（曇っているときは出さない）
    const span = w + 240;
    for (let i = 0; i < (gloom < 0.3 ? 5 : 0); i++) {
      const x = ((((i * 337 - scroll * 0.25) % span) + span) % span) - 120;
      const y = h * (0.15 + ((i * 53) % 30) / 100);
      this.cloud(x, y, 0.7 + (i % 3) * 0.25, dusk);
    }

    // 向かい風の筋（右から左へ流れる）
    if (running) this.windOffset += realDt * (p.airspeed / 150) * 0.6;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    for (const st of this.streaks) {
      const x = (((st.x - this.windOffset * (0.6 + st.len)) % 1) + 1) % 1;
      ctx.beginPath();
      ctx.moveTo(x * w, st.y * h * 0.85);
      ctx.lineTo(x * w + 20 + st.len * 30, st.y * h * 0.85);
      ctx.stroke();
    }

    // 実際の天気（前後 90 km の範囲）
    const dir = s.returning ? -1 : 1;
    const kmPx = w / 90;
    const xAt = (along: number) => w * 0.38 + (along - s.distanceFlown) * dir * kmPx;
    const ground = groundElevation(s);
    const yAt = (alt: number) => h * 0.8 - ((alt - ground) / 2200) * h * 0.5;
    for (const c of s.weather.clouds) {
      if (Math.abs(s.lateral - c.lateralKm) > c.halfWidthKm) continue;
      const xa = xAt(c.fromKm);
      const xb = xAt(c.toKm);
      ctx.fillStyle = css(mixRGB([225, 228, 233], [190, 160, 160], dusk), 0.85);
      ctx.beginPath();
      ctx.roundRect(Math.min(xa, xb), yAt(c.top), Math.abs(xb - xa), yAt(c.base) - yAt(c.top), 18);
      ctx.fill();
    }
    for (const r of s.weather.rain) {
      if (Math.abs(s.lateral - r.lateralKm) > r.halfWidthKm) continue;
      const xa = xAt(r.fromKm);
      const xb = xAt(r.toKm);
      const cloud = s.weather.clouds.find((c) => c.id === r.id);
      const top = yAt(cloud ? cloud.base : 1500);
      ctx.fillStyle = "rgba(120,135,155,0.25)";
      ctx.fillRect(Math.min(xa, xb), top, Math.abs(xb - xa), h - top);
    }
    for (const cb of s.weather.cb) {
      if (Math.abs(s.lateral - cb.lateralKm) > 40) continue;
      const x = xAt(cb.alongKm);
      const r = Math.max(30, cb.radiusKm * kmPx);
      ctx.fillStyle = "rgba(80,86,100,0.9)";
      ctx.beginPath();
      ctx.moveTo(x - r, h);
      ctx.lineTo(x - r * 0.7, -10);
      ctx.lineTo(x + r * 0.7, -10);
      ctx.lineTo(x + r, h);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(x, 6, r * 2.2, 18, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    // 機体：高さは地面からの高さで決める。薄すぎや振動・乱気流でガタガタ揺れる
    const jitter = running ? (rough ? 3 : 0) + (s.condition.vibration / 100) * 6 + e.turbulence * 3 : 0;
    const agl = Math.max(0, s.altitude - groundElevation(s));
    const px = w * 0.38 + (Math.random() - 0.5) * jitter;
    const py = h * 0.8 - Math.min(1, agl / 2200) * h * 0.5 + Math.sin(this.t * 1.3) * 4 + (Math.random() - 0.5) * jitter;
    if (running) this.propAngle += realDt * p.rpm * 0.012;
    ctx.save();
    if (s.returning) {
      // 引き返しているときは左向き
      ctx.translate(px * 2, 0);
      ctx.scale(-1, 1);
    }
    this.plane(px, py);
    ctx.restore();

    // 雨粒
    if (e.rain > 0) {
      ctx.strokeStyle = `rgba(210,220,235,${0.25 + e.rain * 0.12})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let i = 0; i < 40 + e.rain * 40; i++) {
        const x = ((i * 97.3 + this.t * 900) % (w + 40)) - 20;
        const y = ((i * 53.1 + this.t * 700) % (h + 40)) - 20;
        ctx.moveTo(x, y);
        ctx.lineTo(x - 6, y + 14);
      }
      ctx.stroke();
    }
    ctx.restore();

    // 雲の中：真っ白で何も見えない
    if (e.inCloud) {
      ctx.fillStyle = "rgba(222,226,231,0.88)";
      ctx.fillRect(0, 0, w, h);
    }
  }

  private mountains(offset: number, baseY: number, amp: number, color: string, freq: number) {
    const { ctx, w } = this;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(0, this.h);
    for (let x = 0; x <= w + 8; x += 8) {
      const u = (x + offset) * freq;
      ctx.lineTo(x, baseY - amp * (0.5 + 0.3 * Math.sin(u) + 0.2 * Math.sin(u * 2.7 + 1.3)));
    }
    ctx.lineTo(w, this.h);
    ctx.closePath();
    ctx.fill();
  }

  private cloud(x: number, y: number, s: number, dusk: number) {
    const { ctx } = this;
    ctx.fillStyle = css(mixRGB([255, 255, 255], [250, 200, 180], dusk), 0.85);
    const puffs: [number, number, number][] = [[0, 0, 18], [20, -8, 22], [42, 0, 17], [20, 6, 18]];
    for (const [dx, dy, r] of puffs) {
      ctx.beginPath();
      ctx.arc(x + dx * s, y + dy * s, r * s, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  /** 複葉機（右向き）と木製プロペラ */
  private plane(px: number, py: number) {
    const { ctx } = this;
    const poly = (pts: [number, number][], fill: string) => {
      ctx.fillStyle = fill;
      ctx.beginPath();
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(px + x, py + y) : ctx.moveTo(px + x, py + y)));
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    };
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#3a3530";
    ctx.lineWidth = 1.5;

    // 尾翼
    ctx.fillStyle = "#c9433a";
    ctx.beginPath();
    ctx.ellipse(px - 52, py - 1, 13, 2.5, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    poly([[-48, -6], [-62, -26], [-53, -26], [-36, -8]], "#c9433a");
    // 胴体
    poly([[38, -10], [46, -5], [46, 6], [38, 11], [-42, 4], [-60, -1], [-60, -5], [-38, -10]], "#f1e3c3");
    ctx.strokeStyle = "#c9433a";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(px + 44, py + 1);
    ctx.lineTo(px - 58, py - 2);
    ctx.stroke();
    ctx.strokeStyle = "#3a3530";
    ctx.lineWidth = 1.5;

    // オープンコクピット：革の飛行帽の操縦士、小さな風防、なびくマフラー
    ctx.fillStyle = "#c9433a";
    ctx.beginPath();
    ctx.moveTo(px - 6, py - 13);
    ctx.quadraticCurveTo(px - 18, py - 18 + Math.sin(this.t * 9) * 2, px - 28, py - 12 + Math.sin(this.t * 11) * 3);
    ctx.lineTo(px - 6, py - 10);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#5a3b22";
    ctx.beginPath();
    ctx.arc(px - 2, py - 14, 5.5, Math.PI, 0);
    ctx.lineTo(px + 3.5, py - 10);
    ctx.lineTo(px - 7.5, py - 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#2b2b2b";
    ctx.fillRect(px + 1, py - 15, 4, 2.5); // ゴーグル
    ctx.fillStyle = "rgba(191,228,247,0.75)";
    ctx.beginPath();
    ctx.moveTo(px + 8, py - 10);
    ctx.lineTo(px + 11, py - 17);
    ctx.lineTo(px + 14, py - 10);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();

    // 主翼：上の翼（少し前）と下の翼、翼の間の支柱と張り線
    const wing = (x: number, y: number, w: number) => {
      ctx.fillStyle = "#e9d8b0";
      ctx.beginPath();
      ctx.roundRect(px + x, py + y, w, 5, 2.5);
      ctx.fill();
      ctx.stroke();
    };
    ctx.strokeStyle = "#5a4a3a";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px + 30, py - 25); // 張り線
    ctx.lineTo(px + 6, py + 11);
    ctx.moveTo(px + 6, py - 25);
    ctx.lineTo(px + 28, py + 11);
    ctx.stroke();
    ctx.strokeStyle = "#8b5a2b";
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(px + 10, py + 11); // 翼の間の支柱（N字）
    ctx.lineTo(px + 14, py - 25);
    ctx.moveTo(px + 26, py + 11);
    ctx.lineTo(px + 30, py - 25);
    ctx.stroke();
    ctx.strokeStyle = "#3a3530";
    ctx.lineWidth = 1.5;
    wing(6, -30, 38);
    wing(2, 10, 34);
    ctx.fillStyle = "#c9433a";
    ctx.fillRect(px + 38, py - 29.5, 5, 4); // 翼端の赤

    // 脚と車輪、尾そり
    ctx.beginPath();
    ctx.moveTo(px + 12, py + 14);
    ctx.lineTo(px + 18, py + 25);
    ctx.moveTo(px + 26, py + 14);
    ctx.lineTo(px + 18, py + 25);
    ctx.moveTo(px - 50, py + 1);
    ctx.lineTo(px - 56, py + 7);
    ctx.stroke();
    ctx.fillStyle = "#2b2b2b";
    ctx.beginPath();
    ctx.arc(px + 18, py + 26, 5.5, 0, Math.PI * 2);
    ctx.fill();
    // スピナー
    ctx.fillStyle = "#c9433a";
    ctx.beginPath();
    ctx.ellipse(px + 47, py + 0.5, 5, 5.5, 0, -Math.PI / 2, Math.PI / 2);
    ctx.fill();
    // プロペラ：回転の残像と羽根
    ctx.fillStyle = "rgba(150,100,55,0.22)";
    ctx.beginPath();
    ctx.ellipse(px + 51, py + 0.5, 2.5, 24, 0, 0, Math.PI * 2);
    ctx.fill();
    const L = 24 * Math.cos(this.propAngle);
    ctx.strokeStyle = "#8b5a2b";
    ctx.lineWidth = 3.5;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(px + 51, py + 0.5 - L);
    ctx.lineTo(px + 51, py + 0.5 + L);
    ctx.stroke();
    ctx.lineCap = "butt";
  }
}
