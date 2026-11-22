// 機体の点検図：B1〜B6 を「機体の絵のここ」と指して見せる。
// 左に横から見た複葉機、右に正面から見たプロペラの拡大図。各部の色が状態（緑・黄・赤）を表す。
import { paramLine, type ParamId } from "../game/mechanicLines";
import type { AircraftCondition } from "../model/types";
import { conditionRows, type ConditionRow, type Level } from "./dialog";

export interface InspectionOptions {
  /** 数値も出す */
  details: boolean;
  /** 計器も数値だけ（リアル）：色を付けない */
  plain?: boolean;
  /** 焦り。渡すと、気になるところに整備士のひとことを添える（焦っていれば楽観的な文） */
  haste?: number;
}

const COLOR: Record<Level, string> = { green: "#4cc38a", yellow: "#e8c547", red: "#ef5a5a" };
const PLAIN = "#a3a8b0";
const WOOD = "#9a6a3a";

// 横から見た機体の位置と大きさ（点検図の座標）
const SX = 280;
const SY = 165;
const S = 3;
const P = (x: number, y: number) => `${SX + x * S},${SY + y * S}`;
const X = (x: number) => SX + x * S;
const Y = (y: number) => SY + y * S;
// プロペラの拡大図
const IX = 640;
const IY = 158;
const IR = 80;

export function inspectionHtml(c: AircraftCondition, o: InspectionOptions): string {
  const rows = Object.fromEntries(conditionRows(c).map((r) => [r.id, r])) as Record<string, ConditionRow>;
  const col = (id: string) => (o.plain ? PLAIN : COLOR[rows[id].level]);
  const bad = (id: string) => !o.plain && rows[id].level !== "green";

  // ---- 横から見た複葉機 ----
  const frame = col("B6");
  const side = `
    <g class="side">
      <!-- 尾翼 -->
      <ellipse cx="${X(-52)}" cy="${Y(-1)}" rx="${13 * S}" ry="${2.5 * S}" fill="${tint(frame)}" stroke="${frame}" stroke-width="2" />
      <polygon points="${P(-48, -6)} ${P(-62, -26)} ${P(-53, -26)} ${P(-36, -8)}" fill="${tint(frame)}" stroke="${frame}" stroke-width="2" />
      <!-- 翼の間の張り線と支柱 -->
      <line x1="${X(30)}" y1="${Y(-25)}" x2="${X(6)}" y2="${Y(11)}" stroke="${frame}" stroke-width="1.5" opacity="0.8" />
      <line x1="${X(6)}" y1="${Y(-25)}" x2="${X(28)}" y2="${Y(11)}" stroke="${frame}" stroke-width="1.5" opacity="0.8" />
      <line x1="${X(10)}" y1="${Y(11)}" x2="${X(14)}" y2="${Y(-25)}" stroke="${frame}" stroke-width="5" />
      <line x1="${X(26)}" y1="${Y(11)}" x2="${X(30)}" y2="${Y(-25)}" stroke="${frame}" stroke-width="5" />
      <!-- 胴体 -->
      <polygon points="${P(38, -10)} ${P(46, -5)} ${P(46, 6)} ${P(38, 11)} ${P(-42, 4)} ${P(-60, -1)} ${P(-60, -5)} ${P(-38, -10)}"
        fill="#f1e3c3" stroke="${frame}" stroke-width="2.5" />
      <!-- エンジン（カウル） -->
      <polygon points="${P(30, -10)} ${P(38, -10)} ${P(46, -5)} ${P(46, 6)} ${P(38, 11)} ${P(30, 11)}"
        fill="${tint(col("B4"), 0.55)}" stroke="${col("B4")}" stroke-width="3" />
      <!-- 操縦士と風防 -->
      <path d="M${X(-7.5)},${Y(-10)} L${X(-7.5)},${Y(-14)} A${5.5 * S},${5.5 * S} 0 0 1 ${X(3.5)},${Y(-14)} L${X(3.5)},${Y(-10)} Z" fill="#5a3b22" />
      <polygon points="${P(8, -10)} ${P(11, -17)} ${P(14, -10)}" fill="rgba(191,228,247,0.7)" stroke="#3a3530" />
      <!-- 主翼（上下） -->
      <rect x="${X(6)}" y="${Y(-30)}" width="${38 * S}" height="${5 * S}" rx="7" fill="${tint(frame)}" stroke="${frame}" stroke-width="2.5" />
      <rect x="${X(2)}" y="${Y(10)}" width="${34 * S}" height="${5 * S}" rx="7" fill="${tint(frame)}" stroke="${frame}" stroke-width="2.5" />
      <!-- 脚と車輪 -->
      <line x1="${X(12)}" y1="${Y(14)}" x2="${X(18)}" y2="${Y(25)}" stroke="#3a3530" stroke-width="3" />
      <line x1="${X(26)}" y1="${Y(14)}" x2="${X(18)}" y2="${Y(25)}" stroke="#3a3530" stroke-width="3" />
      <circle cx="${X(18)}" cy="${Y(26)}" r="${5.5 * S}" fill="#2b2b2b" />
      <!-- プロペラ（横から）とスピナー -->
      <path d="M${X(46)},${Y(-5)} A${5 * S},${5.5 * S} 0 0 1 ${X(46)},${Y(6)} Z" fill="#c9433a" />
      <line x1="${X(51)}" y1="${Y(-23)}" x2="${X(51)}" y2="${Y(24)}" stroke="${WOOD}" stroke-width="6" stroke-linecap="round" />
      <!-- 振動：機首まわりの波線 -->
      ${vibrationMarks(col("B3"), rows.B3.level, !!o.plain)}
    </g>`;

  // ---- 正面から見たプロペラ（拡大図） ----
  const crack = o.plain ? 0 : rows.B5.level === "red" ? 3 : rows.B5.level === "yellow" ? 1 : 0;
  const blade = (angle: number) => {
    const edge = col("B2");
    const cracks = Array.from({ length: crack }, (_, i) => {
      const y = -30 - i * 14;
      return `<path d="M-5,${y} l4,-5 l-3,-4 l5,-6" fill="none" stroke="#3a2412" stroke-width="2" />`;
    }).join("");
    return `<g transform="translate(${IX},${IY}) rotate(${angle})">
      <path d="M-9,-16 C-12,-40 -10,-62 -3,-72 L3,-72 C10,-62 12,-40 9,-16 Z" fill="${o.plain ? "#8d7a66" : bladeColor(rows.B5.level)}" stroke="#3a2412" stroke-width="1.5" />
      <!-- 前縁（回る向きの先のふち） -->
      <path d="M9,-16 C12,-40 10,-62 3,-72" fill="none" stroke="${edge}" stroke-width="5" stroke-linecap="round" />
      ${cracks}
    </g>`;
  };
  const bolts = Array.from({ length: 6 }, (_, i) => {
    const a = (i * Math.PI) / 3 + Math.PI / 6;
    return `<circle cx="${IX + Math.cos(a) * 11}" cy="${IY + Math.sin(a) * 11}" r="3.6" fill="${col("B1")}" stroke="#1b1f24" stroke-width="1" />`;
  }).join("");
  const inset = `
    <g class="inset">
      <circle cx="${IX}" cy="${IY}" r="${IR}" fill="#1a1e23" stroke="#4a525c" stroke-width="2" />
      ${blade(20)}${blade(200)}
      <circle cx="${IX}" cy="${IY}" r="18" fill="#6b7078" stroke="#2b2e33" stroke-width="2" />
      ${bolts}
      <text class="cap" x="${IX}" y="${IY + IR + 18}" text-anchor="middle">正面から見たプロペラ</text>
    </g>
    <!-- 横の絵のプロペラと、拡大図をつなぐ点線 -->
    <line x1="${X(51) + 6}" y1="${Y(-23)}" x2="${IX - IR * 0.7}" y2="${IY - IR * 0.7}" class="zoom" />
    <line x1="${X(51) + 6}" y1="${Y(24)}" x2="${IX - IR * 0.7}" y2="${IY + IR * 0.7}" class="zoom" />`;

  // ---- 吹き出し（ラベルと、指す点） ----
  const callouts: { id: string; bx: number; by: number; tx: number; ty: number }[] = [
    { id: "B6", bx: 20, by: 14, tx: X(-20), ty: Y(-1) },
    { id: "B3", bx: 320, by: 14, tx: X(56), ty: Y(-12) },
    { id: "B1", bx: 495, by: 14, tx: IX + 11, ty: IY - 6 },
    // 前縁は上の羽根の、回る向きの先のふち。耐久度は下の羽根そのもの
    { id: "B2", bx: 662, by: 14, ...bladePoint(20, 9, -45) },
    { id: "B4", bx: 250, by: 274, tx: X(40), ty: Y(6) },
    { id: "B5", bx: 560, by: 274, ...bladePoint(200, 0, -50) },
  ];
  const BW = 150;
  const BH = 44;
  const labels = callouts
    .map(({ id, bx, by, tx, ty }) => {
      const r = rows[id];
      const c2 = col(id);
      const ax = Math.min(Math.max(tx, bx + 10), bx + BW - 10);
      const ay = by > 150 ? by : by + BH;
      const word = o.plain ? "" : r.word;
      const num = o.details || o.plain ? ` ${Math.round(r.value)}` : "";
      return `<g class="callout ${bad(id) ? "alert" : ""}">
        <line x1="${ax}" y1="${ay}" x2="${tx}" y2="${ty}" stroke="${c2}" stroke-width="2" />
        <circle class="spot" cx="${tx}" cy="${ty}" r="7" fill="none" stroke="${c2}" stroke-width="3" />
        <rect x="${bx}" y="${by}" width="${BW}" height="${BH}" rx="8" fill="#1f2329" stroke="${c2}" stroke-width="2" />
        <text class="lid" x="${bx + 10}" y="${by + 18}">${id} ${shortName(r.name)}</text>
        <text class="lword" x="${bx + 10}" y="${by + 36}" fill="${c2}">${word}${num}</text>
      </g>`;
    })
    .join("");

  // ---- 気になるところ（黄・赤）と、整備士のひとこと ----
  const issues = conditionRows(c).filter((r) => !o.plain && r.level !== "green");
  const notes =
    o.haste === undefined
      ? ""
      : issues.length
        ? `<ul class="issues">${issues
            .map(
              (r) => `<li class="${r.level}"><b>${r.id} ${r.name}：${r.word}${o.details ? `（${Math.round(r.value)}）` : ""}</b>
                <span>整備士：${paramLine(r.id as ParamId, o.haste!)}</span></li>`,
            )
            .join("")}</ul>`
        : o.plain
          ? ""
          : `<p class="issues-none small">気になるところはない。</p>`;

  return `<div class="inspection">
    <svg viewBox="0 0 820 322" role="img" aria-label="機体の点検図">
      ${side}
      ${inset}
      ${labels}
    </svg>
    ${notes}
  </div>`;
}

/** 拡大図で、角度 angle に回した羽根の上の点（羽根の座標 x, y）の位置 */
function bladePoint(angle: number, x: number, y: number) {
  const a = (angle * Math.PI) / 180;
  return { tx: IX + x * Math.cos(a) - y * Math.sin(a), ty: IY + x * Math.sin(a) + y * Math.cos(a) };
}

/** 色を薄くして塗りに使う */
function tint(hex: string, alpha = 0.25) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function bladeColor(level: Level) {
  return level === "red" ? "#7a3a2a" : level === "yellow" ? "#8a5a32" : WOOD;
}

/** 振動の波線。強いほど本数が多い */
function vibrationMarks(color: string, level: Level, plain: boolean) {
  const n = plain ? 2 : level === "red" ? 3 : level === "yellow" ? 2 : 1;
  return Array.from({ length: n }, (_, i) => {
    const x = X(55) + i * 9;
    return `<path d="M${x},${Y(-14)} q6,6 0,12 q-6,6 0,12 q6,6 0,12" fill="none" stroke="${color}" stroke-width="3" opacity="${level === "green" && !plain ? 0.5 : 1}" />`;
  }).join("");
}

const shortName = (name: string) => name.replace("プロペラの", "").replace("の締まり", "").replace("の調子", "").replace("の強度", "");
