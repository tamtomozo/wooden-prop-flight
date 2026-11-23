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
import { tr } from "../i18n";

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
    ${line ? `<p class="pl-line">${tr("整備士：", "Mechanic: ")}${line}</p>` : ""}
  </div>`;
}

export function pilotDiagramHtml(p: Pilot, details: boolean, haste: number): string {
  const delay = reactionDelayMin(p.fatigue);
  const err = readingErrorAmp(p.fatigue);
  const fatigue: GaugeSpec = {
    id: "E1",
    name: tr("疲労", "Fatigue"),
    value: p.fatigue,
    words: tr(["元気", "疲れてきた", "くたくた"], ["Fresh", "Getting tired", "Exhausted"]),
    marks: [
      { at: PILOT_YELLOW, text: tr(`${PILOT_YELLOW} 操作と計器に影響`, `${PILOT_YELLOW} affects controls and gauges`) },
    ],
    moves: [
      { delta: -FATIGUE_REST, label: tr("一晩泊まる", "Stay one night") },
      { delta: FATIGUE_PER_FLIGHT_HOUR, label: tr("1時間飛ぶ", "Fly 1 hour") },
    ],
    effects: [
      tr(
          `操作の効きの遅れ：${delay > 0 ? `<b>約${delay.toFixed(1)}分</b>` : "なし"}`,
          `Control delay: ${delay > 0 ? `<b>about ${delay.toFixed(1)} min</b>` : "none"}`,
        ),
      tr(
          `計器の読みのずれ：${err > 0 ? `<b>最大 ±${(err * 100).toFixed(1)}%</b>（本人は気づきにくい）` : "なし"}`,
          `Gauge misreading: ${err > 0 ? `<b>up to ±${(err * 100).toFixed(1)}%</b> (hard to notice yourself)` : "none"}`,
        ),
    ],
  };
  const hasty = isHasty(p.haste);
  const hasteSpec: GaugeSpec = {
    id: "E2",
    name: tr("焦り", "Haste"),
    value: p.haste,
    words: tr(["落ち着いている", "焦っている", "かなり焦っている"], ["Calm", "In a hurry", "Rushing badly"]),
    marks: [{ at: HASTE_OPTIMISTIC, text: tr(`${HASTE_OPTIMISTIC} 判断が甘くなる`, `${HASTE_OPTIMISTIC} judgment gets sloppy`) }],
    moves: [
      { delta: -HASTE_RELIEF, label: tr("天気を待つ・引き返す", "Wait for weather / turn back") },
      { delta: -HASTE_NIGHT_RELIEF, label: tr("一晩眠る", "Sleep one night") },
      { delta: HASTE_PER_HOUR_BEHIND, label: tr("日没に間に合わないまま1時間", "1 hour behind for sunset") },
    ],
    effects: [
      tr(
          `整備士のひとこと：${hasty ? "<b>「まあ大丈夫だろう」と楽観的に聞こえる</b>" : "ふつうに聞こえる"}`,
          `The mechanic's advice: ${hasty ? "<b>sounds optimistic, like \"it'll probably be fine\"</b>" : "sounds normal"}`,
        ),
      tr("日没に余裕があれば、飛んでいるうちに少しずつ落ち着く。", "With time to spare before sunset, you calm down little by little in flight."),
    ],
  };
  return `<div class="pilot-diagram">
    ${gaugeHtml(fatigue, details, haste)}
    ${gaugeHtml(hasteSpec, details, haste)}
    <p class="fd-note">${tr(
      `物差しの色：緑は ${PILOT_YELLOW} 未満、黄は ${PILOT_YELLOW}〜${PILOT_RED}、赤は ${PILOT_RED} 以上。白い縦線がいまの位置、矢印はその行動でどこまで動くか。`,
      `Scale colors: green below ${PILOT_YELLOW}, yellow ${PILOT_YELLOW}–${PILOT_RED}, red ${PILOT_RED} and up. The white line is where you are now; the arrows show how far each action moves it.`,
    )}</p>
  </div>`;
}
