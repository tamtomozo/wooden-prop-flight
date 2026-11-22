// A3 ボルトの締め付けを図で説明する（格納庫）。
// ・トルクの物差し：ミニゲームと同じ「適正」の範囲
// ・断面図：ボルトが木のハブを金属の板ではさむ様子を、ゆるい／適正／締めすぎで並べる
import { TORQUE_OK_FROM as OK_FROM, TORQUE_OK_TO as OK_TO } from "../config";
import { INSTALL_FACTOR } from "../model/physics";
import type { TorqueResult } from "../model/types";

const STATES: TorqueResult[] = ["under", "ok", "over"];

const TITLE: Record<TorqueResult, string> = { under: "ゆるい（不足）", ok: "適正", over: "締めすぎ" };
const TEXT: Record<TorqueResult, string> = {
  under: `すき間がある。飛ぶほど・湿度が変わるほど、ゆるみが<b>${INSTALL_FACTOR.under}倍</b>速く進む。締め直せば直る。`,
  ok: "板が木をしっかりはさむ。それでも飛ぶほど・湿度が変わるほど、少しずつゆるむ。",
  over: "木のハブがつぶれる。区間ごとにプロペラの耐久度が<b>−10</b>。<b>取り消せない</b>。",
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
    ${gap ? `<path class="td-gap" d="M${c + 16},${headTop + 10} v${gap}" /><text class="td-t td-gap-t" x="${c + 20}" y="${headTop + 10 + gap / 2 + 3.5}">すき間</text>` : ""}
    ${s === "over" ? `<path class="td-crush" d="M${c - 16},31 l4,4 M${c + 16},31 l-4,4 M${c - 16},59 l4,-4 M${c + 16},59 l-4,-4" /><text class="td-t td-crush-t" x="${c}" y="90" text-anchor="middle">木がつぶれる</text>` : ""}
    <text class="td-t" x="10" y="47" text-anchor="middle" transform="rotate(-90 10 45)">木のハブ</text>
  </svg>`;
}

export function torqueDiagramHtml(result: TorqueResult | null): string {
  const cards = STATES.map(
    (s) => `<div class="td-card td-${s} ${result === s ? "on" : ""}">
      ${sectionSvg(s)}
      <b class="torque-${s}">${TITLE[s]}${result === s ? "<small>いまの結果</small>" : ""}</b>
      <p class="fd-note">${TEXT[s]}</p>
    </div>`,
  ).join("");
  return `<div class="torque-diagram">
    <div class="td-scale-wrap">
      <div class="td-scale">
        <span class="td-band" style="left:${OK_FROM}%;width:${OK_TO - OK_FROM}%">カチッ</span>
      </div>
      <div class="tq-scale"><span>← ゆるい</span><span>トルク（締める強さ）</span><span>締めすぎ →</span></div>
    </div>
    <div class="td-cards">${cards}</div>
    <p class="fd-note">木は湿気を吸ったり乾いたりして厚みが変わる。湿度の違う飛行場に着くとボルトがゆるむので、経由地で締め直す。</p>
  </div>`;
}
