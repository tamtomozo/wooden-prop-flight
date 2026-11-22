// A4 装備を図で説明する（格納庫）。
// ・積み込み：3つの枠と、25 kg までの重さの棒。何が場所と重さを取っているか
// ・選ぶカード：装備ごとの絵。前縁の保護は「傷みの速さ」を棒で比べる
import { EQUIPMENT_MAX_KG, EQUIPMENT_SLOTS } from "../config";
import { EDGE_GEAR, equipmentKg, ITEMS, slotsUsed } from "../data/equipment";
import { EDGE_PROTECTION } from "../model/physics";
import type { EdgeGear, Equipment } from "../model/types";

type ItemKey = keyof typeof ITEMS;
type GearKey = Exclude<EdgeGear, "none"> | ItemKey;

const ITEM_KEYS: ItemKey[] = ["toolKit", "spareProp", "weatherRadio"];
const EDGE_KEYS: EdgeGear[] = ["none", "tape", "metal"];

const info = (k: GearKey) => (k === "tape" || k === "metal" ? EDGE_GEAR[k] : ITEMS[k]);

// ---- 絵（24×24。色は CSS の currentColor） ----
const blade = (edge: EdgeGear) => `<svg viewBox="0 0 24 24" class="eq-icon">
  <path d="M3 13.5 C7 10 14 8.5 21 9.5 C21.8 10.5 21.6 12 20.6 12.6 C14 13.6 8 15 3 15.5 Z" fill="var(--wood)" />
  ${edge === "none" ? "" : `<path d="M3.4 13.3 C7 10.2 14 8.7 20.8 9.7" fill="none" stroke="${edge === "tape" ? "#e6cf7e" : "#d4dae2"}" stroke-width="${edge === "tape" ? 1.8 : 2.4}" stroke-linecap="round" />`}
  <circle cx="3.4" cy="14.5" r="2" fill="#6b737e" />
</svg>`;

const ICONS: Record<ItemKey, string> = {
  toolKit: `<svg viewBox="0 0 24 24" class="eq-icon"><path d="M14.5 3.5a5 5 0 0 0-4.6 6.9L3.6 16.7a2 2 0 0 0 2.8 2.8l6.3-6.3a5 5 0 0 0 6.9-4.6l-2.9 2.9-2.8-.7-.7-2.8z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" /></svg>`,
  spareProp: `<svg viewBox="0 0 24 24" class="eq-icon"><path d="M12 12 C9 9 5.5 3.5 7 2.5 C8.5 1.8 11 7 12 12 C15 15 18.5 20.5 17 21.5 C15.5 22.2 13 17 12 12 Z" fill="var(--wood)" /><circle cx="12" cy="12" r="2.2" fill="#6b737e" /></svg>`,
  weatherRadio: `<svg viewBox="0 0 24 24" class="eq-icon"><rect x="3" y="9" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="1.6" /><path d="M7 9 L17 3" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /><circle cx="15.5" cy="15" r="3" fill="none" stroke="currentColor" stroke-width="1.6" /><path d="M6 13h4M6 16h4" stroke="currentColor" stroke-width="1.4" /></svg>`,
};

const icon = (k: GearKey | "none") => (k === "none" || k === "tape" || k === "metal" ? blade(k) : ICONS[k]);

/** 積んでいる装備（枠の順） */
function loaded(e: Equipment): GearKey[] {
  const list: GearKey[] = [];
  if (e.edgeGear !== "none") list.push(e.edgeGear);
  for (const k of ITEM_KEYS) if (e[k]) list.push(k);
  return list;
}

function loadHtml(e: Equipment): string {
  const list = loaded(e);
  const kg = equipmentKg(e);
  const slots = Array.from({ length: EQUIPMENT_SLOTS }, (_, i) => {
    const k = list[i];
    return k
      ? `<div class="eq-slot c-${k}">${icon(k)}<span>${info(k).name}<small>${info(k).kg} kg</small></span></div>`
      : `<div class="eq-slot empty"><span>空き</span></div>`;
  }).join("");
  const segs = list.map((k) => `<i class="c-${k}" style="width:${((100 * info(k).kg) / EQUIPMENT_MAX_KG).toFixed(1)}%" title="${info(k).name}"></i>`).join("");
  return `<div class="eq-load">
    <div class="fd-head"><b>積み込み</b><span>${list.length} / ${EQUIPMENT_SLOTS} 枠</span></div>
    <div class="eq-slots">${slots}</div>
    <div class="fd-head eq-kg"><span>重さ</span><span>${kg} / ${EQUIPMENT_MAX_KG} kg</span></div>
    <div class="eq-weight">${segs}</div>
    <p class="fd-note">積めるのは<b>3つまで</b>、重さは<b>${EQUIPMENT_MAX_KG} kg まで</b>。重いほど離陸距離が伸びる（A2の図）。</p>
  </div>`;
}

/** 選べない理由（枠か重さか） */
function blocked(trial: Equipment): string {
  if (slotsUsed(trial) > EQUIPMENT_SLOTS) return "枠が足りない";
  if (equipmentKg(trial) > EQUIPMENT_MAX_KG) return "重すぎる";
  return "";
}

function edgeCard(e: Equipment, k: EdgeGear): string {
  const on = e.edgeGear === k;
  const why = on ? "" : blocked({ ...e, edgeGear: k });
  const g = k === "none" ? null : EDGE_GEAR[k];
  const wear = 1 - EDGE_PROTECTION[k];
  return `<label class="gear eq-card ${why ? "disabled" : ""}">
    <input type="radio" name="edge" data-edge="${k}" ${on ? "checked" : ""} ${why ? "disabled" : ""} />
    ${icon(k)}
    <span class="eq-body"><b>${g ? g.name : "保護なし"}</b> <small>${g ? `${g.kg} kg` : "0 kg"}</small>
      <span class="eq-wear"><small>雨での傷み</small><span class="eq-wear-bar"><i style="width:${(wear * 100).toFixed(0)}%"></i></span><small>${wear === 1 ? "そのまま" : `約${Math.round(wear * 100)}%`}</small></span>
      ${why ? `<small class="eq-why">${why}</small>` : ""}</span>
  </label>`;
}

function itemCard(e: Equipment, k: ItemKey): string {
  const on = e[k];
  const why = on ? "" : blocked({ ...e, [k]: true });
  const g = ITEMS[k];
  return `<label class="gear eq-card c-${k} ${why ? "disabled" : ""}">
    <input type="checkbox" data-gear="${k}" ${on ? "checked" : ""} ${why ? "disabled" : ""} />
    ${icon(k)}
    <span class="eq-body"><b>${g.name}</b> <small>${g.kg} kg</small><br /><small>${g.effect}</small>
      ${why ? `<small class="eq-why">${why}</small>` : ""}</span>
  </label>`;
}

export function equipmentDiagramHtml(e: Equipment): string {
  return `<div class="eq-diagram">
    ${loadHtml(e)}
    <div class="eq-groups">
      <div><p class="eq-group">前縁の保護 <small>どれか1つ・雨の多い旅に</small></p>
        <div class="eq-cards">${EDGE_KEYS.map((k) => edgeCard(e, k)).join("")}</div></div>
      <div><p class="eq-group">持ち物 <small>いくつでも（枠と重さの範囲で）</small></p>
        <div class="eq-cards">${ITEM_KEYS.map((k) => itemCard(e, k)).join("")}</div></div>
    </div>
  </div>`;
}
