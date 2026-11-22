import { EQUIPMENT_MAX_KG, EQUIPMENT_SLOTS } from "../config";
import type { EdgeGear, Equipment } from "../model/types";

export interface GearInfo {
  name: string;
  kg: number;
  effect: string;
}

export const EDGE_GEAR: Record<Exclude<EdgeGear, "none">, GearInfo> = {
  tape: { name: "前縁保護テープ", kg: 3, effect: "前縁の傷みを半分に" },
  metal: { name: "金属の前縁カバー", kg: 8, effect: "前縁の傷みを大きく減らす（約1/3）" },
};

export const ITEMS: Record<"toolKit" | "spareProp" | "weatherRadio", GearInfo> = {
  toolKit: { name: "工具セット", kg: 10, effect: "整備場のない経由地でもボルトを締め直せる" },
  spareProp: { name: "予備のプロペラ", kg: 15, effect: "プロペラの致命的な損傷から一度だけ復帰できる" },
  weatherRadio: { name: "携帯気象ラジオ", kg: 3, effect: "飛行中に天気予報を更新できる（30分に1回）" },
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
