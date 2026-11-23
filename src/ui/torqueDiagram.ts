// A3 ボルトの締め付けを図で説明する（格納庫）。
// ・断面図：ボルトが木のハブを金属の板ではさむ様子を、ゆるい／適正／締めすぎで並べる
import { INSTALL_FACTOR } from "../model/physics";
import type { TorqueResult } from "../model/types";
import { tr } from "../i18n";

const STATES: TorqueResult[] = ["under", "ok", "over"];

const TITLE: Record<TorqueResult, string> = tr(
  { under: "ゆるい（不足）", ok: "適正", over: "締めすぎ" },
  { under: "Loose (too little)", ok: "Just right", over: "Too tight" },
);
const TEXT: Record<TorqueResult, string> = {
  under: tr(
    `すき間がある。飛ぶほど・湿度が変わるほど、ゆるみが<b>${INSTALL_FACTOR.under}倍</b>速く進む。締め直せば直る。`,
    `There is a gap. With every flight and every change in humidity it loosens <b>${INSTALL_FACTOR.under}× faster</b>. Re-tightening fixes it.`,
  ),
  ok: tr("板が木をしっかりはさむ。それでも飛ぶほど・湿度が変わるほど、少しずつゆるむ。", "The plates grip the wood firmly. Even so, it loosens little by little with flying and changes in humidity."),
  over: tr("木のハブがつぶれる。区間ごとにプロペラの耐久度が<b>−10</b>。<b>取り消せない</b>。", "The wooden hub is crushed. Propeller durability <b>−10</b> every leg. <b>Can't be undone</b>."),
};

/** ボルトと木のハブの断面（横から見た図） */
function sectionSvg(s: TorqueResult): string {
  const dip = s === "over" ? 6 : 0; // 板が木にめり込む深さ
  const gap = s === "under" ? 7 : 0; // ボルトの頭と板のすき間
  const c = 60;
  const flange = (y: number, dir: 1 | -1) =>
    `<path class="td-plate" d="M18,${y} Q${c},${y + dir * 2 * dip} 102,${y} L102,${y + 6} Q${c},${y + 6 + dir * 2 * dip} 18,${y + 6} Z" />`;
  const headTop = 19 + dip - 10 - gap;
  const nutTop = 71 - dip;
  const grain = [33, 41, 49, 57]
    .map((y) => `<path class="td-grain" d="M28,${y} Q${c},${y + (dip * (y < 45 ? 1.2 : -1.2))} 92,${y}" />`)
    .join("");
  return `<svg viewBox="0 0 120 92" class="td-svg" aria-hidden="true">
    <path class="td-wood" d="M28,25 Q${c},${25 + 2 * dip} 92,25 L92,65 Q${c},${65 - 2 * dip} 28,65 Z" />
    ${grain}
    ${flange(19, 1)}
    ${flange(65, -1)}
    <rect class="td-bolt" x="${c - 3}" y="${headTop + 4}" width="6" height="${nutTop + 12 - headTop - 4}" />
    <rect class="td-bolt" x="${c - 12}" y="${headTop}" width="24" height="10" rx="1.5" />
    <rect class="td-bolt" x="${c - 11}" y="${nutTop}" width="22" height="9" rx="1.5" />
    ${gap ? `<path class="td-gap" d="M${c + 16},${headTop + 10} v${gap}" /><text class="td-t td-gap-t" x="${c + 20}" y="${headTop + 10 + gap / 2 + 3.5}">${tr("すき間", "gap")}</text>` : ""}
    ${s === "over" ? `<path class="td-crush" d="M${c - 16},31 l4,4 M${c + 16},31 l-4,4 M${c - 16},59 l4,-4 M${c + 16},59 l-4,-4" /><text class="td-t td-crush-t" x="${c}" y="90" text-anchor="middle">${tr("木がつぶれる", "wood crushed")}</text>` : ""}
    <text class="td-t" x="10" y="47" text-anchor="middle" transform="rotate(-90 10 45)">${tr("木のハブ", "wood hub")}</text>
  </svg>`;
}

export function torqueDiagramHtml(result: TorqueResult | null): string {
  const cards = STATES.map(
    (s) => `<div class="td-card td-${s} ${result === s ? "on" : ""}">
      ${sectionSvg(s)}
      <b class="torque-${s}">${TITLE[s]}${result === s ? `<small>${tr("いまの結果", "your result")}</small>` : ""}</b>
      <p class="fd-note">${TEXT[s]}</p>
    </div>`,
  ).join("");
  return `<div class="torque-diagram">
    <div class="td-cards">${cards}</div>
    <p class="fd-note">${tr(
      "木は湿気を吸ったり乾いたりして厚みが変わる。湿度の違う飛行場に着くとボルトがゆるむので、経由地で締め直す。",
      "Wood swells and shrinks as it takes in and loses moisture. Landing at a field with different humidity loosens the bolts, so re-tighten them at each stop.",
    )}</p>
  </div>`;
}
