// 画面の上に重ねるダイアログ（格納庫・経由地・結果など）と、共通の小物。
import { BOLT_DANGER, VIBRATION_RED, VIBRATION_YELLOW } from "../config";
import { paramLine, type ParamId } from "../game/mechanicLines";
import { pilotLevel } from "../model/pilot";
import type { AircraftCondition, Pilot } from "../model/types";

const overlay = document.querySelector<HTMLElement>("#overlay")!;
const dialog = document.querySelector<HTMLElement>("#dialog")!;

/** ダイアログを開く（すでに開いていれば中身を差し替える。スクロール位置は保つ） */
export function openDialog(html: string, opts: { wide?: boolean; keepScroll?: boolean } = {}): HTMLElement {
  const scroll = opts.keepScroll ? dialog.scrollTop : 0;
  dialog.innerHTML = html;
  dialog.classList.toggle("wide", !!opts.wide);
  overlay.hidden = false;
  dialog.scrollTop = scroll;
  return dialog;
}

export function closeDialog() {
  overlay.hidden = true;
  dialog.innerHTML = "";
}

export const isDialogOpen = () => !overlay.hidden;

export const fmtDuration = (min: number) => {
  const m = Math.round(min);
  return m >= 60 ? `${Math.floor(m / 60)}時間${String(m % 60).padStart(2, "0")}分` : `${m}分`;
};

export const mechanicLine = (text: string) =>
  `<p class="mechanic"><span class="who">整備士</span><span>${text}</span></p>`;

export interface TabItem<T extends string> {
  id: T;
  label: string;
  /** 見出しの下に小さく出す今の値 */
  sub?: string;
  /** まだ済んでいない・気をつけること（印をつける） */
  todo?: boolean;
}

/** 見出しごとのタブ（ボタンは data-act="tab" data-v="id"） */
export function tabsHtml<T extends string>(tabs: TabItem<T>[], current: T): string {
  return `<div class="tabs" role="tablist">${tabs
    .map(
      (t) =>
        `<button role="tab" data-act="tab" data-v="${t.id}" class="${t.id === current ? "on" : ""}${t.todo ? " todo" : ""}" aria-selected="${t.id === current}">${t.label}${t.sub ? `<small>${t.sub}</small>` : ""}</button>`,
    )
    .join("")}</div>`;
}

// ダイアログ内のボタンは data-act で振り分ける。リスナーは1つだけにして、画面ごとに中身を差し替える
type Handlers = Record<string, (el: HTMLElement) => void>;
let actions: Handlers = {};
dialog.addEventListener("click", (e) => {
  const el = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
  if (!el || (el as HTMLButtonElement).disabled) return;
  actions[el.dataset.act!]?.(el);
});

/** 今の画面のボタンの動きを登録する */
export function setActions(h: Handlers) {
  actions = h;
}

// ---- 機体の状態（B1〜B6）を3色で並べる ----
export type Level = "green" | "yellow" | "red";
export interface ConditionRow {
  id: string;
  name: string;
  value: number;
  level: Level;
  word: string;
  /** バーの長さ 0..1 */
  bar: number;
}

/** 機体の状態 B1〜B6 の、色（3段階）と言葉 */
export function conditionRows(c: AircraftCondition): ConditionRow[] {
  const lv = (good: boolean, warn: boolean): Level => (good ? "green" : warn ? "yellow" : "red");
  const words = (l: Level, w: [string, string, string]) => (l === "green" ? w[0] : l === "yellow" ? w[1] : w[2]);
  const bolt = lv(c.boltTightness >= 60, c.boltTightness >= BOLT_DANGER + 10);
  const edge = lv(c.propEdge >= 85, c.propEdge >= 60);
  const vib = lv(c.vibration < VIBRATION_YELLOW, c.vibration < VIBRATION_RED);
  const eng = lv(c.engineHealth >= 60, c.engineHealth >= 30);
  const dur = lv(c.propDurability >= 60, c.propDurability >= 30);
  const frame = lv(c.airframe >= 70, c.airframe >= 40);
  return [
    { id: "B1", name: "ボルトの締まり", value: c.boltTightness, level: bolt, word: words(bolt, ["しっかり", "ゆるみ気味", "危ない"]), bar: c.boltTightness / 100 },
    { id: "B2", name: "プロペラの前縁", value: c.propEdge, level: edge, word: words(edge, ["きれい", "傷あり", "傷だらけ"]), bar: c.propEdge / 100 },
    { id: "B3", name: "振動", value: c.vibration, level: vib, word: words(vib, ["静か", "少し揺れる", "激しい"]), bar: c.vibration / 100 },
    { id: "B4", name: "エンジンの調子", value: c.engineHealth, level: eng, word: words(eng, ["良好", "荒れ気味", "危険"]), bar: c.engineHealth / 100 },
    { id: "B5", name: "プロペラ耐久度", value: c.propDurability, level: dur, word: words(dur, ["丈夫", "弱ってきた", "割れそう"]), bar: c.propDurability / 100 },
    { id: "B6", name: "機体の強度", value: c.airframe, level: frame, word: words(frame, ["丈夫", "傷みあり", "危ない"]), bar: c.airframe / 100 },
  ];
}

/** 表の見せ方：リアルは数値だけ（色なし）。haste を渡すと、黄・赤の項目に整備士のひとことを添える */
export interface TableOptions {
  plain?: boolean;
  haste?: number;
}

function rowHtml(id: string, name: string, level: Level, word: string, bar: number, value: number, details: boolean, o: TableOptions) {
  const plain = !!o.plain;
  const showNum = details || plain;
  const line = o.haste !== undefined && level !== "green" ? paramLine(id as ParamId, o.haste) : "";
  return `<div class="st-row ${plain ? "plain" : level}">
    <span class="st-name"><small>${id}</small> ${name}</span>
    <span class="st-bar"><i style="width:${Math.max(0, Math.min(1, bar)) * 100}%"></i></span>
    <span class="st-word">${plain ? "" : word}${showNum ? ` <small>${value.toFixed(0)}</small>` : ""}</span>
    ${line ? `<span class="st-line">整備士：${line}</span>` : ""}
  </div>`;
}

/** E. 操縦者（疲労・焦り）を3色で並べる */
export function pilotTable(p: Pilot, details: boolean, o: TableOptions = {}): string {
  const row = (id: string, name: string, v: number, words: [string, string, string]) => {
    const level = pilotLevel(v);
    return rowHtml(id, name, level, words[level === "green" ? 0 : level === "yellow" ? 1 : 2], v / 100, v, details, o);
  };
  return `<div class="status">${row("E1", "疲労", p.fatigue, ["元気", "疲れてきた", "くたくた"])}${row("E2", "焦り", p.haste, ["落ち着いている", "焦っている", "かなり焦っている"])}</div>`;
}
