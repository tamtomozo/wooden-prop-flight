// 7章「難易度」。
import type { Difficulty } from "../model/types";
import { tr } from "../i18n";

export interface DifficultyRule {
  label: string;
  description: string;
  /** 自動になるもの */
  autoMixture: boolean;
  autoCarbHeat: boolean;
  boltNotice: boolean;
  /** キャブレター凍結の警告灯（6章：ふつうモード以上では出さない） */
  carbIceLamp: boolean;
  /** 計器も数値だけ（色の帯・3色表示・ゾーンの小窓なし） */
  plainInstruments: boolean;
  /** 予報の外れ方の倍率（位置・高さのずれと、確率の当てにならなさ） */
  forecastUncertainty: number;
}

export const DIFFICULTY: Record<Difficulty, DifficultyRule> = {
  easy: {
    label: tr("かんたん", "Easy"),
    description: tr("混合比とキャブヒートは自動。ボルト点検を知らせてくれる。操作するのは出力・高度・ルート。", "Mixture and carb heat are automatic. You are told when to check the bolts. You handle power, altitude and route."),
    autoMixture: true,
    autoCarbHeat: true,
    boltNotice: true,
    carbIceLamp: true,
    plainInstruments: false,
    forecastUncertainty: 0.6,
  },
  normal: {
    label: tr("ふつう", "Normal"),
    description: tr("ボルト点検の通知だけ自動。ほぼすべてを自分で操作する。", "Only the bolt-check notice is automatic. You do almost everything yourself."),
    autoMixture: false,
    autoCarbHeat: false,
    boltNotice: true,
    carbIceLamp: false,
    plainInstruments: false,
    forecastUncertainty: 1,
  },
  real: {
    label: tr("リアル", "Real"),
    description: tr("自動なし。計器は数値だけで、色の目安は出ない。予報の外れも大きい。", "Nothing automatic. The gauges show numbers only, with no color guides. Forecasts miss by more."),
    autoMixture: false,
    autoCarbHeat: false,
    boltNotice: false,
    carbIceLamp: false,
    plainInstruments: true,
    forecastUncertainty: 2,
  },
};
