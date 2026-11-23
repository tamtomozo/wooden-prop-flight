// A1 プロペラのピッチを図で説明する（格納庫）。
// 左：羽根の角度と「1回転で進む距離」の三角形（ねじのピッチと同じ考え方）。
// 右：巡航速度・上昇力・離陸距離・地上回転数を、選んだピッチで棒グラフに。
import { pitchFactors, staticRpmVerdict } from "../model/physics";
import type { PitchLevel } from "../model/types";
import { tr } from "../i18n";

const LEVELS: PitchLevel[] = [1, 2, 3, 4, 5];
/** 図に描く羽根の角度（見やすさ優先の誇張した値） */
const angleDeg = (p: PitchLevel) => 12 + 3 * (p - 1);

// 三角形の寸法（viewBox 単位）
const X0 = 24;
const X1 = 214;
const BASE_Y = 146;
const rise = (p: PitchLevel) => (X1 - X0) * Math.tan((angleDeg(p) * Math.PI) / 180);

function triangleSvg(pitch: PitchLevel): string {
  const top = BASE_Y - rise(pitch);
  const th = angleDeg(pitch);
  const rad = (th * Math.PI) / 180;

  const ghosts = LEVELS.filter((p) => p !== pitch)
    .map((p) => `<line class="pd-ghost" x1="${X0}" y1="${BASE_Y}" x2="${X1}" y2="${(BASE_Y - rise(p)).toFixed(1)}" />`)
    .join("");

  // 羽根の断面：斜辺の途中に、斜辺の向きに傾けて置く（前縁が進む側）
  const t = 0.62;
  const bx = X0 + (X1 - X0) * t;
  const by = BASE_Y - rise(pitch) * t;
  const blade = `<path class="pd-blade" transform="translate(${bx.toFixed(1)} ${by.toFixed(1)}) rotate(${-th})"
    d="M-28,1 C-14,-3 6,-9 22,-7 C29,-6 31,-1 27,2 C14,4 -8,3 -28,1 Z" />`;

  // 角度の弧
  const r = 40;
  const arc = `<path class="pd-arc" d="M${X0 + r},${BASE_Y} A${r},${r} 0 0 0 ${(X0 + r * Math.cos(rad)).toFixed(1)},${(BASE_Y - r * Math.sin(rad)).toFixed(1)}" />`;

  const ax = X1 + 12;
  return `<svg class="pd-svg" viewBox="0 46 300 130" role="img" aria-label="${tr("羽根の角度と1回転で進む距離の図", "Blade angle and distance moved per turn")}">
    <defs>
      <marker id="pd-head" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
        <path d="M0,0 L10,5 L0,10 Z" class="pd-head" />
      </marker>
    </defs>
    ${ghosts}
    <line class="pd-base" x1="${X0}" y1="${BASE_Y}" x2="${X1}" y2="${BASE_Y}" />
    <line class="pd-now" x1="${X0}" y1="${BASE_Y}" x2="${X1}" y2="${top.toFixed(1)}" />
    <line class="pd-drop" x1="${X1}" y1="${BASE_Y}" x2="${X1}" y2="${top.toFixed(1)}" />
    ${arc}
    <text class="pd-t" x="${X0 + r + 6}" y="${BASE_Y - 5}">${tr("角度", "angle")}</text>
    ${blade}
    <line class="pd-adv" x1="${ax}" y1="${BASE_Y}" x2="${ax}" y2="${(top + 1).toFixed(1)}" marker-end="url(#pd-head)" />
    <text class="pd-t pd-strong" x="${ax + 8}" y="${((BASE_Y + top) / 2 - 2).toFixed(1)}">${tr("1回転で", "distance")}</text>
    <text class="pd-t pd-strong" x="${ax + 8}" y="${((BASE_Y + top) / 2 + 13).toFixed(1)}">${tr("進む距離", "per turn")}</text>
    <line class="pd-rot" x1="${X0}" y1="${BASE_Y + 14}" x2="${X1}" y2="${BASE_Y + 14}" marker-end="url(#pd-head)" />
    <text class="pd-t" x="${(X0 + X1) / 2}" y="${BASE_Y + 28}" text-anchor="middle">${tr("回る向き（羽根の先が1回転でえがく円周）", "direction of turn (path of the blade tip)")}</text>
    <text class="pd-t pd-dim" x="${X0}" y="58">${tr("点線：ほかのピッチ", "dotted: other pitches")}</text>
  </svg>`;
}

/** 選んだピッチの値を、1〜5の範囲の中の位置として棒で示す */
function barRow(label: string, hint: string, values: number[], v: number, betterHigh: boolean): string {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pct = 20 + (80 * (v - lo)) / (hi - lo); // いちばん小さくても棒が見えるよう 20% から
  const mid = 20 + (80 * (1 - lo)) / (hi - lo); // 中間（×1.00）の位置
  const good = betterHigh ? v > 1.001 : v < 0.999;
  const bad = betterHigh ? v < 0.999 : v > 1.001;
  return `<div class="pd-row ${good ? "good" : bad ? "bad" : ""}">
    <span class="pd-label">${label}<small>${hint}</small></span>
    <span class="pd-track"><i style="width:${pct.toFixed(1)}%"></i><b style="left:${mid.toFixed(1)}%"></b></span>
    <span class="pd-val">×${v.toFixed(2)}</span>
  </div>`;
}

const RPM_LO = 2150;
const RPM_HI = 2450;
const VERDICT = tr(
  { low: "低い（上昇が弱い）", ok: "適正", high: "高い（回りすぎ注意）" },
  { low: "Low (weak climb)", ok: "Just right", high: "High (watch for overspeed)" },
);

function rpmRow(rpm: number): string {
  const at = (x: number) => ((100 * (x - RPM_LO)) / (RPM_HI - RPM_LO)).toFixed(1);
  const verdict = staticRpmVerdict(rpm);
  return `<div class="pd-row pd-rpm ${verdict}">
    <span class="pd-label">${tr("地上回転数", "Static RPM")}<small class="pd-verdict">${VERDICT[verdict]}</small></span>
    <span class="pd-track">
      <em style="left:${at(2250)}%;width:${(+at(2350) - +at(2250)).toFixed(1)}%"></em>
      <u style="left:${at(rpm)}%"></u>
    </span>
    <span class="pd-val">${rpm}<small>rpm</small></span>
  </div>`;
}

export function pitchDiagramHtml(pitch: PitchLevel): string {
  const all = LEVELS.map(pitchFactors);
  const pf = pitchFactors(pitch);
  return `<div class="pitch-diagram">
    <figure>
      ${triangleSvg(pitch)}
      <figcaption>${tr(
      `ピッチは<b>羽根のねじれの角度</b>。ねじと同じで、角度が大きいほど1回転で前へ進もうとする距離が長い。
      自転車でいえば、上昇型は<b>軽いギア</b>（よく回って力強いが速さは出ない）、巡航型は<b>重いギア</b>（速いが出だしが重い）。`,
      `Pitch is the <b>twist angle of the blades</b>. Like a screw, the bigger the angle, the farther it tries to move forward in one turn.
      On a bicycle, a climb prop is a <b>low gear</b> (spins easily and pulls hard, but isn't fast) and a cruise prop is a <b>high gear</b> (fast, but slow to get going).`,
    )}
  </figcaption>
    </figure>
    <div class="pd-bars">
      ${barRow(tr("巡航速度", "Cruise speed"), tr("長いほど速い", "longer = faster"), all.map((f) => f.pitchSpeedFactor), pf.pitchSpeedFactor, true)}
      ${barRow(tr("上昇力", "Climb"), tr("長いほど強い", "longer = stronger"), all.map((f) => f.climbFactor), pf.climbFactor, true)}
      ${barRow(tr("離陸距離", "Takeoff run"), tr("短いほど良い", "shorter = better"), all.map((f) => f.takeoffDistFactor), pf.takeoffDistFactor, false)}
      ${rpmRow(pf.staticRPM)}
      <p class="small">${tr(
      "縦線は「中間」の位置。地上回転数（止めたまま全開にしたときの回転）は、緑の帯に入れば適正。",
      "The vertical line marks the middle pitch. Static RPM (full throttle while held still) is right if it is in the green band.",
    )}</p>
    </div>
  </div>`;
}
