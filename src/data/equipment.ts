import { EQUIPMENT_MAX_KG, EQUIPMENT_SLOTS } from "../config";
import type { EdgeGear, Equipment } from "../model/types";
import { tr } from "../i18n";

export interface GearInfo {
  name: string;
  kg: number;
  effect: string;
}

export const EDGE_GEAR: Record<Exclude<EdgeGear, "none">, GearInfo> = {
  tape: { name: tr("前縁保護テープ", "Leading-edge tape"), kg: 3, effect: tr("前縁の傷みを半分に", "Halves leading-edge wear") },
  metal: { name: tr("金属の前縁カバー", "Metal edge cover"), kg: 8, effect: tr("前縁の傷みを大きく減らす（約1/3）", "Cuts leading-edge wear a lot (to about 1/3)") },
};

export const ITEMS: Record<"toolKit" | "spareProp" | "weatherRadio", GearInfo> = {
  toolKit: { name: tr("工具セット", "Tool kit"), kg: 10, effect: tr("整備場のない経由地でもボルトを締め直せる", "Re-tighten the bolts even at stops without a repair shop") },
  spareProp: { name: tr("予備のプロペラ", "Spare propeller"), kg: 15, effect: tr("プロペラの致命的な損傷から一度だけ復帰できる", "Recover once from fatal propeller damage") },
  weatherRadio: { name: tr("携帯気象ラジオ", "Weather radio"), kg: 3, effect: tr("飛行中に天気予報を更新できる（30分に1回）", "Update the forecast in flight (once every 30 min)") },
};

export function equipmentList(e: Equipment): GearInfo[] {
  const list: GearInfo[] = [];
  if (e.edgeGear !== "none") list.push(EDGE_GEAR[e.edgeGear]);
  if (e.toolKit) list.push(ITEMS.toolKit);
  if (e.spareProp) list.push(ITEMS.spareProp);
  if (e.weatherRadio) list.push(ITEMS.weatherRadio);
  return list;
}

export const equipmentKg = (e: Equipment) => equipmentList(e).reduce((s, g) => s + g.kg, 0);
export const slotsUsed = (e: Equipment) => equipmentList(e).length;
export const equipmentFits = (e: Equipment) => slotsUsed(e) <= EQUIPMENT_SLOTS && equipmentKg(e) <= EQUIPMENT_MAX_KG;

export const NO_EQUIPMENT: Equipment = { edgeGear: "none", toolKit: false, spareProp: false, weatherRadio: false };
