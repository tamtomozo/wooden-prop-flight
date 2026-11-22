// E. 操縦者（疲労・焦り）を図で説明する（経由地）。
// 0〜100 の物差しに色の境目（60・80）と今の位置を描き、
// 「何をすると上がる・下がるか」を矢印で、「いまどんな影響が出ているか」を言葉で添える。
import {
  FATIGUE_PER_FLIGHT_HOUR,
  FATIGUE_REST,
  HASTE_NIGHT_RELIEF,
  HASTE_OPTIMISTIC,
  HASTE_PER_HOUR_BEHIND,
  HASTE_RELIEF,
  PILOT_RED,
  PILOT_YELLOW,
} from "../config";
import { paramLine } from "../game/mechanicLines";
import { isHasty, pilotLevel, reactionDelayMin, readingErrorAmp } from "../model/pilot";
import type { Pilot } from "../model/types";

interface Move {
  /** 変化量（負なら下がる） */
  delta: number;
  label: string;
}

interface GaugeSpec {
  id: "E1" | "E2";
  name: string;
  value: number;
  words: [string, string, string];
  /** 物差しの上に書く境目の説明 */
  marks: { at: number; text: string }[];
  moves: Move[];
  effects: string[];
}

/** 矢印1本ぶんの高さ（px） */
const ROW = 14;

const clampPct = (v: number) => Math.max(0, Math.min(100, v));

function gaugeHtml(g: GaugeSpec, details: boolean, haste: number): string {
  const level = pilotLevel(g.value);
  const word = g.words[level === "green" ? 0 : level === "yellow" ? 1 : 2];
  const v = clampPct(g.value);
  // 0 や 100 に張りついて動けない矢印は描かない（行も詰める）
  const visible = g.moves.filter((m) => Math.abs(clampPct(v + m.delta) - v) >= 0.5);
  const arrows = visible
    .map((m, i) => {
      const to = clampPct(v + m.delta);
      const left = Math.min(v, to);
      const width = Math.abs(to - v);
      const dir = m.delta < 0 ? "down" : "up";
      const top = 38 + i * ROW;
      const text = `${m.delta > 0 ? "+" : "−"}${Math.abs(m.delta)}`;
      // 量の文字は矢印の先に。端で入りきらないときは、矢印の根元の反対側に置く
      const atTip = dir === "down" ? to >= 10 : to <= 90;
      const pos =
        dir === "down"
          ? atTip
            ? `right:calc(${100 - to}% + 10px)`
            : `left:calc(${v}% + 6px)`
          : atTip
            ? `left:calc(${to}% + 10px)`
            : `right:calc(${100 - v}% + 6px)`;
      return `<span class="pl-arrow ${dir}" style="left:${left}%;width:${width}%;top:${top}px"></span><span class="pl-amt ${dir}" style="${pos};top:${top - 7}px">${text}</span>`;
    })
    .join("");
  const legend = g.moves
    .map((m) => `<span class="pl-move ${m.delta < 0 ? "down" : "up"}"><i></i>${m.label} <b>${m.delta > 0 ? "+" : "−"}${Math.abs(m.delta)}</b></span>`)
    .join("");
  const marks = g.marks.map((m) => `<span class="pl-mark-label" style="left:${m.at}%">${m.text}</span>`).join("");
  const line = level !== "green" ? paramLine(g.id, haste) : "";
  return `<div class="pl-card ${level}">
    <div class="fd-head"><b><small>${g.id}</small> ${g.name}</b><span class="pl-word">${word}${details ? ` <small>${g.value.toFixed(0)}</small>` : ""}</span></div>
    <div class="pl-gauge" style="height:${40 + visible.length * ROW}px">
      ${marks}
      <span class="pl-track" style="background:linear-gradient(90deg, rgba(76,195,138,.55) 0 ${PILOT_YELLOW}%, rgba(232,197,71,.6) ${PILOT_YELLOW}% ${PILOT_RED}%, rgba(239,90,90,.65) ${PILOT_RED}% 100%)"></span>
      <span class="pl-now" style="left:${v}%"></span>
      ${arrows}
    </div>
    <div class="pl-legend">${legend}</div>
    <ul class="pl-effects">${g.effects.map((e) => `<li>${e}</li>`).join("")}</ul>
    ${line ? `<p class="pl-line">整備士：${line}</p>` : ""}
  </div>`;
}

export function pilotDiagramHtml(p: Pilot, details: boolean, haste: number): string {
  const delay = reactionDelayMin(p.fatigue);
  const err = readingErrorAmp(p.fatigue);
  const fatigue: GaugeSpec = {
    id: "E1",
    name: "疲労",
    value: p.fatigue,
    words: ["元気", "疲れてきた", "くたくた"],
    marks: [
      { at: PILOT_YELLOW, text: `${PILOT_YELLOW} 操作と計器に影響` },
    ],
    moves: [
      { delta: -FATIGUE_REST, label: "一晩泊まる" },
      { delta: FATIGUE_PER_FLIGHT_HOUR, label: "1時間飛ぶ" },
    ],
    effects: [
      `操作の効きの遅れ：${delay > 0 ? `<b>約${delay.toFixed(1)}分</b>` : "なし"}`,
      `計器の読みのずれ：${err > 0 ? `<b>最大 ±${(err * 100).toFixed(1)}%</b>（本人は気づきにくい）` : "なし"}`,
    ],
  };
  const hasty = isHasty(p.haste);
  const hasteSpec: GaugeSpec = {
    id: "E2",
    name: "焦り",
    value: p.haste,
    words: ["落ち着いている", "焦っている", "かなり焦っている"],
    marks: [{ at: HASTE_OPTIMISTIC, text: `${HASTE_OPTIMISTIC} 判断が甘くなる` }],
    moves: [
      { delta: -HASTE_RELIEF, label: "天気を待つ・引き返す" },
      { delta: -HASTE_NIGHT_RELIEF, label: "一晩眠る" },
      { delta: HASTE_PER_HOUR_BEHIND, label: "日没に間に合わないまま1時間" },
    ],
    effects: [
      `整備士のひとこと：${hasty ? "<b>「まあ大丈夫だろう」と楽観的に聞こえる</b>" : "ふつうに聞こえる"}`,
      "日没に余裕があれば、飛んでいるうちに少しずつ落ち着く。",
    ],
  };
  return `<div class="pilot-diagram">
    ${gaugeHtml(fatigue, details, haste)}
    ${gaugeHtml(hasteSpec, details, haste)}
    <p class="fd-note">物差しの色：緑は ${PILOT_YELLOW} 未満、黄は ${PILOT_YELLOW}〜${PILOT_RED}、赤は ${PILOT_RED} 以上。白い縦線がいまの位置、矢印はその行動でどこまで動くか。</p>
  </div>`;
}
