// チュートリアルの画面：見る計器だけを明るく残して周りを暗くし、番号の札をつける。
// 説明のカードは、光らせた計器にかぶらない場所に出す。
import { scriptedIndex, type TutorialContext, type TutorialStep } from "../game/tutorial";
import type { FlightState } from "../game/flight";
import { tr } from "../i18n";

const SVG_NS = "http://www.w3.org/2000/svg";
const PAD = 5;
const NUM = ["①", "②", "③", "④", "⑤", "⑥"];

export interface TutorialShowOptions {
  /** 「わかった」：飛行を再開する */
  onClose: () => void;
  /** 「説明をとばす」：この旅ではもう出さない */
  onSkipAll: () => void;
}

export class TutorialView {
  private shade: SVGSVGElement;
  private card: HTMLDivElement;
  private chip = document.querySelector<HTMLElement>("#tut-task")!;
  private step: TutorialStep | null = null;
  private opts: TutorialShowOptions | null = null;
  private chipTimer = 0;

  constructor() {
    this.shade = document.createElementNS(SVG_NS, "svg");
    this.shade.classList.add("tut-shade");
    this.shade.setAttribute("aria-hidden", "true");
    this.card = document.createElement("div");
    this.card.className = "tut-card";
    this.card.setAttribute("role", "dialog");
    this.card.setAttribute("aria-live", "polite");
    this.card.hidden = true;
    this.shade.style.display = "none";
    document.body.append(this.shade, this.card);
    this.card.addEventListener("click", (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>("[data-tut]")?.dataset.tut;
      if (act === "close") this.close();
      if (act === "skip") {
        const o = this.opts;
        this.hide();
        o?.onSkipAll();
      }
    });
    window.addEventListener("resize", () => this.layout());
  }

  isOpen() {
    return this.step !== null;
  }

  show(step: TutorialStep, f: FlightState, ctx: TutorialContext, opts: TutorialShowOptions) {
    this.step = step;
    this.opts = opts;
    const idx = scriptedIndex(step);
    this.card.innerHTML = `
      <div class="tut-head">
        <span class="tut-badge ${step.urgent ? "urgent" : ""}">${idx ? `${tr("チュートリアル", "Tutorial")} ${idx.n} / ${idx.of}` : step.urgent ? tr("注意", "Caution") : tr("チュートリアル", "Tutorial")}</span>
        <span class="tut-paused">${tr("一時停止中", "Paused")}</span>
      </div>
      <h3>${step.title}</h3>
      <p class="tut-intro">${step.intro(f, ctx)}</p>
      <h4>${tr("見る計器・使うもの", "What to look at and use")}</h4>
      <ol class="tut-meters">${step.meters
        .map((m, i) => `<li><span class="tut-num">${NUM[i] ?? i + 1}</span><span><b>${m.name}</b>　${m.text}</span></li>`)
        .join("")}</ol>
      <h4>${tr("正しい操作", "What to do")}</h4>
      <p class="tut-action">${step.action(f, ctx)}</p>
      ${
        !step.task
          ? ""
          : step.task.done(f)
            ? `<p class="tut-try">${tr("今はもうできている。この先も同じようにしよう。", "You are already doing it. Keep it up from here on.")}</p>`
            : `<p class="tut-try">${tr("やってみよう：", "Try it: ")}<b>${step.task.text}</b><small>${tr("再開したあとも、画面の下に出しておく", "This stays at the bottom of the screen after you resume")}</small></p>`
      }
      <div class="tut-buttons">
        <button class="tut-skip" data-tut="skip" title="${tr("この旅では、もう説明を出さない", "No more explanations on this trip")}">${tr("説明をとばす", "Skip explanations")}</button>
        <button class="primary" data-tut="close">${tr("わかった — 飛行を再開", "Got it — resume flight")}<small>${tr("Enter / スペース", "Enter / Space")}</small></button>
      </div>`;
    this.card.hidden = false;
    this.shade.style.display = "";
    this.layout();
    this.card.querySelector<HTMLButtonElement>("[data-tut=close]")?.focus({ preventScroll: true });
  }

  /** 「わかった」 */
  close() {
    const o = this.opts;
    this.hide();
    o?.onClose();
  }

  hide() {
    this.step = null;
    this.opts = null;
    this.card.hidden = true;
    this.shade.style.display = "none";
    this.shade.replaceChildren();
  }

  /** 再開したあとの「やってみよう」。null で消す */
  setTask(text: string | null) {
    clearTimeout(this.chipTimer);
    this.chip.classList.remove("done");
    this.chip.hidden = !text;
    if (text) this.chip.innerHTML = `<span class="tut-chip-label">${tr("やってみよう", "Try it")}</span>${text}`;
  }

  /** 「やってみよう」ができた */
  taskDone() {
    this.chip.classList.add("done");
    this.chip.innerHTML = `<span class="tut-chip-label">${tr("できた！", "Done!")}</span>${tr("その調子", "Keep it up")}`;
    this.chip.hidden = false;
    clearTimeout(this.chipTimer);
    this.chipTimer = window.setTimeout(() => (this.chip.hidden = true), 2500);
  }

  /** 光らせる場所と、カードの位置を合わせ直す（計器盤が揺れても追いかける） */
  layout() {
    if (!this.step) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    const rects = this.step.meters
      .map((m) => document.querySelector<HTMLElement>(m.sel)?.getBoundingClientRect())
      .map((r) => (r && r.width > 0 ? r : null));
    this.shade.setAttribute("viewBox", `0 0 ${W} ${H}`);
    this.shade.setAttribute("width", String(W));
    this.shade.setAttribute("height", String(H));
    // 画面全体から、光らせる四角をくり抜く（evenodd）
    let d = `M0 0H${W}V${H}H0Z`;
    const holes: { x: number; y: number; w: number; h: number; i: number }[] = [];
    rects.forEach((r, i) => {
      if (!r) return;
      const h = { x: r.left - PAD, y: r.top - PAD, w: r.width + PAD * 2, h: r.height + PAD * 2, i };
      holes.push(h);
      d += `M${h.x} ${h.y}h${h.w}v${h.h}h${-h.w}Z`;
    });
    const parts = [`<path class="tut-dim" fill-rule="evenodd" d="${d}" />`];
    for (const h of holes) {
      parts.push(`<rect class="tut-ring" x="${h.x}" y="${h.y}" width="${h.w}" height="${h.h}" rx="8" />`);
      // 番号の札：四角の左上（画面の上にはみ出すなら内側）
      const tx = Math.max(14, h.x + 2);
      const ty = h.y > 26 ? h.y - 4 : h.y + 20;
      parts.push(`<text class="tut-tag" x="${tx}" y="${ty}">${NUM[h.i] ?? h.i + 1}</text>`);
    }
    this.shade.innerHTML = parts.join("");
    this.placeCard(holes);
  }

  /** カードを、光らせた四角にかぶらない場所に置く（だめなら、かぶりのいちばん少ない場所） */
  private placeCard(holes: { x: number; y: number; w: number; h: number }[]) {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const cw = Math.min(560, W - 24);
    this.card.style.width = `${cw}px`;
    this.card.style.maxHeight = `${Math.max(240, H - 24)}px`;
    const ch = Math.min(this.card.offsetHeight, H - 24);
    const spots = [
      { x: 12, y: 56 },
      { x: (W - cw) / 2, y: 56 },
      { x: W - cw - 12, y: 56 },
      { x: (W - cw) / 2, y: (H - ch) / 2 },
      { x: 12, y: H - ch - 12 },
      { x: W - cw - 12, y: H - ch - 12 },
    ].map((p) => ({ x: Math.max(12, p.x), y: Math.max(12, Math.min(p.y, H - ch - 12)) }));
    const overlap = (p: { x: number; y: number }) =>
      holes.reduce((s, h) => {
        const ox = Math.max(0, Math.min(p.x + cw, h.x + h.w) - Math.max(p.x, h.x));
        const oy = Math.max(0, Math.min(p.y + ch, h.y + h.h) - Math.max(p.y, h.y));
        return s + ox * oy;
      }, 0);
    const best = spots.reduce((a, b) => (overlap(b) < overlap(a) ? b : a));
    this.card.style.left = `${best.x}px`;
    this.card.style.top = `${best.y}px`;
  }
}
