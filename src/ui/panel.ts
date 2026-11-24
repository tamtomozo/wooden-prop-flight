// 計器盤：丸い計器・警告灯・飛行メモ（ニーボード）・整備士のひとこと。
import { CB_DANGER_KM, REDLINE_RPM, RESERVE_FUEL_L, VA_KMH, VIBRATION_RED, VIBRATION_YELLOW } from "../config";
import { mechanicAdvice } from "../game/advice";
import {
  clockMin,
  distanceLeft,
  intendedControls,
  intendedLateral,
  knownState,
  radioReady,
  type FlightState,
} from "../game/flight";
import { DIFFICULTY, type DifficultyRule } from "../data/difficulty";
import { PARAM_LINES, paramLine, type ParamId } from "../game/mechanicLines";
import { pilotLevel, readingFactor } from "../model/pilot";
import type { Difficulty } from "../model/types";
import { distanceToArea, itemArea } from "../model/weather";
import type { MixtureZone } from "../model/physics";
import type { Leg } from "../model/types";
import { setDisabled, setHidden, setOneClass, setStyle, setText } from "./dom";
import { BLUE, GREEN, RED, RoundGauge, YELLOW } from "./gauge";
import { tr } from "../i18n";

type Level = "green" | "yellow" | "red";

export const ZONE_LABEL: Record<MixtureZone, { text: string; color: string }> = {
  rich: { text: tr("濃い", "Rich"), color: BLUE },
  power: { text: tr("最大出力", "Best power"), color: GREEN },
  economy: { text: tr("最良燃費", "Best economy"), color: YELLOW },
  tooLean: { text: tr("薄すぎ", "Too lean"), color: RED },
};

export const PHASE_LABEL = tr(
  { climb: "上昇中", cruise: "巡航中", descent: "降下中" },
  { climb: "Climbing", cruise: "Cruising", descent: "Descending" },
);

/** 燃料計の色の境目（タンクに対する割合） */
const FUEL_LOW = 0.15;
const FUEL_HALF = 0.4;

export const fmtClock = (min: number) => {
  const m = Math.floor(min);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}`;
};

const $ = (sel: string) => document.querySelector<HTMLElement>(sel)!;

export class CockpitPanel {
  private asi: RoundGauge;
  private alt: RoundGauge;
  private tach: RoundGauge;
  private egt: RoundGauge;
  private fuel: RoundGauge;
  private engine: RoundGauge;
  private root = $("#panel");
  private rule: DifficultyRule = DIFFICULTY.normal;
  /** クリックした計器の整備士のひとこと（しばらく出しておく） */
  private pinned: { id: ParamId; until: number } | null = null;

  constructor(private fuelCapacityL: number) {
    const cap = fuelCapacityL;
    const halfSweep: [number, number] = [Math.PI * 1.2, Math.PI * 1.8];
    const canvas = (id: string) => document.querySelector<HTMLCanvasElement>(id)!;

    this.asi = new RoundGauge(canvas("#g-asi"), {
      title: tr("対気速度", "Airspeed"),
      unit: "km/h",
      min: 40,
      max: 240,
      major: 40,
      minor: 10,
      arcs: [
        { from: 80, to: 190, color: GREEN },
        { from: 190, to: 230, color: YELLOW },
        { from: 230, to: 240, color: RED },
        // 設計運動速度 Va の目印（乱気流ではこれ以下）
        { from: VA_KMH - 1.5, to: VA_KMH + 1.5, color: "#ffffff" },
      ],
    });
    this.alt = new RoundGauge(canvas("#g-alt"), {
      title: tr("高度計", "Altimeter"),
      unit: "×100 m",
      min: 0,
      max: 3000,
      major: 500,
      minor: 100,
      label: (v) => String(v / 100),
    });
    this.tach = new RoundGauge(canvas("#g-tach"), {
      title: tr("回転計", "Tachometer"),
      unit: "×100 rpm",
      min: 500,
      max: 3000,
      major: 500,
      minor: 100,
      label: (v) => String(v / 100),
      arcs: [
        { from: 500, to: REDLINE_RPM - 100, color: GREEN },
        { from: REDLINE_RPM - 100, to: REDLINE_RPM, color: YELLOW },
        { from: REDLINE_RPM, to: 3000, color: RED },
      ],
    });
    this.egt = new RoundGauge(canvas("#g-egt"), {
      title: tr("排気温度", "EGT"),
      unit: "℃",
      min: 400,
      max: 800,
      major: 100,
      minor: 25,
    });
    this.fuel = this.makeFuelGauge(cap);
    this.engine = new RoundGauge(canvas("#g-engine"), {
      title: tr("エンジン", "Engine"),
      unit: tr("調子", "health"),
      min: 0,
      max: 100,
      sweep: halfSweep,
      major: 50,
      minor: 10,
      arcs: [
        { from: 0, to: 30, color: RED },
        { from: 30, to: 60, color: YELLOW },
        { from: 60, to: 100, color: GREEN },
      ],
    });
  }

  /** 燃料計（容量で目盛りが変わる） */
  private makeFuelGauge(cap: number): RoundGauge {
    const halfSweep: [number, number] = [Math.PI * 1.2, Math.PI * 1.8];
    return new RoundGauge(document.querySelector<HTMLCanvasElement>("#g-fuel")!, {
      title: tr("燃料", "Fuel"),
      min: 0,
      max: cap,
      sweep: halfSweep,
      major: cap / 2,
      minor: cap / 8,
      label: (v) => (v === 0 ? "E" : v === cap ? "F" : "½"),
      arcs: [
        { from: 0, to: cap * FUEL_LOW, color: RED },
        { from: cap * FUEL_LOW, to: cap * FUEL_HALF, color: YELLOW },
        { from: cap * FUEL_HALF, to: cap, color: GREEN },
      ],
    });
  }

  /** 増設タンクを積んだときなど、燃料の容量が変わったら目盛りを描き直す */
  setFuelCapacity(cap: number) {
    if (cap === this.fuelCapacityL) return;
    this.fuelCapacityL = cap;
    this.fuel = this.makeFuelGauge(cap);
    this.fuel.setPlain(this.rule.plainInstruments);
  }

  /** 難易度に合わせる（リアルは計器も数値だけ） */
  setDifficulty(d: Difficulty) {
    this.rule = DIFFICULTY[d];
    for (const g of [this.asi, this.alt, this.tach, this.egt, this.fuel, this.engine]) g.setPlain(this.rule.plainInstruments);
  }

  /** 計器やレバーをクリックしたら、そのパラメータの整備士のひとことを出す */
  bindParamClicks() {
    document.querySelectorAll<HTMLElement>("[data-param]").forEach((el) =>
      el.addEventListener("click", () => {
        this.pinned = { id: el.dataset.param as ParamId, until: performance.now() + 7000 };
      }),
    );
  }

  setLeg(leg: Leg) {
    $("#kb-title").textContent = `${tr("飛行メモ　", "Flight notes  ")}${leg.from.name} → ${leg.to.name}`;
  }

  update(s: FlightState, details: boolean, running: boolean) {
    const p = s.perf;
    const a = s.condition;
    const left = distanceLeft(s);
    const flying = s.status === "flying";
    const rough = p.mixture.zone === "tooLean" && flying;
    const plain = this.rule.plainInstruments;
    // リアルは計器も数値だけ：いつも数字を出し、色の目安は出さない
    const d = details || plain;
    // 振動：計器の針と計器盤が揺れる（設計書6章「異常は体感で伝える」）
    const shake = running && flying ? Math.max(rough ? 2 : 0, a.vibration / 25, s.env.turbulence * 0.9) : 0;

    // ---- 計器 ----
    // 疲れていると計器の読み取りに誤差が出る（E1）。針も数字も、本人が読んだ値を見せる
    const rf = (key: number) => readingFactor(s.pilot.fatigue, s.elapsedMin, key);
    const asi = p.airspeed * rf(1);
    const altShown = s.altitude * rf(2);
    const rpm = p.rpm * rf(3);
    const egt = p.egt * rf(4);
    this.asi.draw(asi, { readout: d ? `${asi.toFixed(0)} km/h` : undefined, jitter: shake * 2 });
    this.alt.draw(altShown, {
      readout: d ? `${Math.round(altShown)} m` : undefined,
      flag: plain ? undefined : { text: PHASE_LABEL[s.phase], color: "#c9c6bd" },
    });
    this.tach.draw(rpm, {
      readout: d ? `${Math.round(rpm)} rpm` : undefined,
      jitter: (rough && running ? 120 : 0) + shake * 15,
    });
    this.egt.draw(egt, {
      readout: d ? `${Math.round(egt)} ℃` : undefined,
      flag: plain ? undefined : ZONE_LABEL[p.mixture.zone],
      jitter: rough && running ? 25 : 0,
    });
    const fuel = a.fuelRemaining;
    const fuelShown = fuel * rf(5);
    this.fuel.draw(fuelShown, { readout: d ? `${fuelShown.toFixed(1)} L` : undefined });
    this.engine.draw(a.engineHealth, { readout: d ? a.engineHealth.toFixed(0) : undefined });

    // ---- 警告灯 ----
    // 毎フレーム呼ばれるので、変わったところだけ書き換える（dom.ts）
    $("#lamp-rough").classList.toggle("on", rough);
    $("#lamp-fuel").classList.toggle("on", fuel <= this.fuelCapacityL * FUEL_LOW);
    $("#lamp-rpm").classList.toggle("on", p.rpm > REDLINE_RPM);
    const vib = $("#lamp-vib");
    vib.classList.toggle("on", a.vibration >= VIBRATION_YELLOW);
    vib.classList.toggle("red", a.vibration >= VIBRATION_RED);
    vib.classList.toggle("amber", a.vibration < VIBRATION_RED);
    // 難易度で出る警告灯：ボルト点検の通知（かんたん・ふつう）、キャブ凍結（かんたんだけ）
    const boltLamp = $("#lamp-bolt");
    setHidden(boltLamp, !this.rule.boltNotice);
    boltLamp.classList.toggle("on", this.rule.boltNotice && a.boltTightness < 40);
    const carbLamp = $("#lamp-carb");
    setHidden(carbLamp, !this.rule.carbIceLamp);
    carbLamp.classList.toggle("on", this.rule.carbIceLamp && a.carbIce > 3);

    // ---- 飛行メモ ----
    const gs = Math.max(0, p.groundSpeed);
    const hw = Math.round(s.env.headwind);
    this.memo("kb-ground", null, `${gs.toFixed(0)} km/h`, hw >= 0 ? tr(`向かい風 ${hw} km/h`, `headwind ${hw} km/h`) : tr(`追い風 ${-hw} km/h`, `tailwind ${-hw} km/h`));

    // 届く距離：予備燃料ぶんを残して着けるなら緑、ぎりぎりなら黄、届かないなら赤
    const reserveKm = p.fuelBurn > 0 ? (RESERVE_FUEL_L / p.fuelBurn) * p.groundSpeed : 0;
    const rangeLevel: Level = p.rangeKm >= left + reserveKm ? "green" : p.rangeKm >= left ? "yellow" : "red";
    const rangeShown = Number.isFinite(p.rangeKm) ? `${p.rangeKm.toFixed(0)} km` : "∞";
    this.memo(
      "kb-range",
      rangeLevel,
      tr({ green: "余裕あり", yellow: "ぎりぎり", red: "届かない" }, { green: "Plenty", yellow: "Just enough", red: "Can't make it" })[rangeLevel],
      d ? `${rangeShown}${tr("・残り", " · to go")} ${left.toFixed(0)} km` : `${tr("残り", "to go")} ${left.toFixed(0)} km`,
    );

    // 到着予定：日没30分前までなら緑
    const eta = p.groundSpeed > 0 ? clockMin(s) + (left / p.groundSpeed) * 60 : Infinity;
    const etaLevel: Level = eta <= s.sunsetMin - 30 ? "green" : eta <= s.sunsetMin ? "yellow" : "red";
    this.memo("kb-eta", etaLevel, eta < 24 * 60 ? fmtClock(eta) : "--:--", `${tr("日没", "sunset")} ${fmtClock(s.sunsetMin)}`);

    const ahead = aheadWeather(s);
    this.memo("kb-ahead", ahead.level, ahead.text, ahead.note);

    // ---- 飛行中の操作 ----
    // 表示は「操縦者がしたつもりの操作」。疲れていると、効くまでに時間がかかる
    const want = intendedControls(s);
    const lat = intendedLateral(s);
    setText($("#alt-target"), s.approach ? tr("着陸へ", "Landing") : `${want.targetAltitude} m`);
    setText($("#course"), s.courseLocked
      ? tr("コースへ", "To course")
      : lat === 0
        ? Math.abs(s.lateral) > 1
          ? tr("戻り中", "Returning")
          : tr("まっすぐ", "Straight")
        : tr(`${lat < 0 ? "左" : "右"} ${Math.abs(lat)} km`, `${Math.abs(lat)} km ${lat < 0 ? "L" : "R"}`));
    $("#carbheat").classList.toggle("on", want.carbHeat);
    setText($("#carb-note"), this.rule.autoCarbHeat ? tr("自動", "Auto") : "H");
    setDisabled($("#carbheat") as HTMLButtonElement, this.rule.autoCarbHeat || !flying);
    setDisabled($("#mixture") as HTMLInputElement, this.rule.autoMixture);
    const radio = $("#radio") as HTMLButtonElement;
    setDisabled(radio, !radioReady(s) || !flying);
    setText($("#radio-note"), !s.radio
      ? tr("積んでいない", "Not carried")
      : radioReady(s)
        ? tr("予報を更新（P）", "Update forecast (P)")
        : tr(`あと ${Math.ceil(s.radioReadyAt - s.elapsedMin)} 分`, `in ${Math.ceil(s.radioReadyAt - s.elapsedMin)} min`));
    setDisabled($("#turnback") as HTMLButtonElement, s.returning || !flying);
    for (const b of document.querySelectorAll<HTMLButtonElement>(".navbox button"))
      setDisabled(b, !flying || s.approach || (b.dataset.nav!.startsWith("alt") ? false : s.courseLocked || s.holding));

    // ---- レバーと整備士 ----
    setText($("#throttle-out"), `${Math.round(want.throttle * 100)}%`);
    setText($("#mixture-out"), this.rule.autoMixture ? tr("自動", "Auto") : d ? `${want.mixture}` : "");

    // ---- 操縦者 ----
    this.pilotMeter("pilot-fatigue", s.pilot.fatigue, tr(["元気", "疲れてきた", "くたくた"], ["Fresh", "Getting tired", "Exhausted"]), d);
    this.pilotMeter("pilot-haste", s.pilot.haste, tr(["落ち着いている", "焦っている", "かなり焦っている"], ["Calm", "In a hurry", "Rushing badly"]), d);
    // クリックした計器のひとことを優先して出す。着陸の降下に入ったら、整備士のひとことは出さない
    // （着く先の景色を見せる。計器をクリックしたときだけは出す）
    const pin = this.pinned && performance.now() < this.pinned.until ? this.pinned : null;
    setText($("#advice"), pin
      ? `【${PARAM_LINES[pin.id].name}】${paramLine(pin.id, s.pilot.haste)}`
      : flying && !s.approach
        ? mechanicAdvice(s)
        : "");
    this.root.classList.toggle("shake", shake > 0.3);
    setStyle(this.root, "--shake", `${Math.min(4, shake).toFixed(2)}px`);
  }

  private pilotMeter(id: string, value: number, words: [string, string, string], details: boolean) {
    const el = $(`#${id}`);
    const level = pilotLevel(value);
    setOneClass(el, ["green", "yellow", "red", "plain"], this.rule.plainInstruments ? "plain" : level);
    setStyle(el.querySelector(".st-bar i") as HTMLElement, "width", `${Math.min(100, value)}%`);
    const word = words[level === "green" ? 0 : level === "yellow" ? 1 : 2];
    setText(el.querySelector(".pm-word")!, details ? `${word} ${Math.round(value)}` : word);
  }

  private memo(id: string, level: Level | null, value: string, note: string) {
    const row = $(`#${id}`);
    setOneClass(row, ["green", "yellow", "red"], level && !this.rule.plainInstruments ? level : null);
    setText(row.querySelector(".v")!, value);
    setText(row.querySelector(".note")!, note);
  }
}

const KIND_TEXT = tr(
  { cloud: "雲", rain: "雨", turbulence: "乱気流", cb: "積乱雲" },
  { cloud: "Cloud", rain: "Rain", turbulence: "Turbulence", cb: "Thunderstorm" },
);

/** 進む先 120 km で、いちばん近い天気（予報か、確かめた実際の天気） */
function aheadWeather(s: FlightState): { level: Level | null; text: string; note: string } {
  const e = s.env;
  if (e.inCloud) return { level: "red", text: tr("雲の中！", "In cloud!"), note: tr("すぐ雲から出ろ", "Get out now") };
  if (e.cbDistance < CB_DANGER_KM) return { level: "red", text: tr("積乱雲が近い", "Storm close"), note: `${Math.round(e.cbDistance)} km` };
  if (s.holding) return { level: "yellow", text: tr("霧で待機中", "Holding for fog"), note: tr("晴れるのを待つ", "Wait for it to clear") };
  const dir = s.returning ? -1 : 1;
  let best: { d: number; text: string; note: string; level: Level } | null = null;
  for (const item of s.forecast.items) {
    const state = knownState(s, item.id);
    if (state === false) continue;
    const a = itemArea(item);
    // 進む向きの先にあるものだけ
    const center = (a.fromKm + a.toKm) / 2;
    if ((center - s.distanceFlown) * dir < -((a.toKm - a.fromKm) / 2)) continue;
    const d = distanceToArea(a, s.distanceFlown, s.lateral);
    if (d > 120) continue;
    const here = d < 0.5;
    const level: Level = item.kind === "cb" || item.kind === "cloud" ? "red" : "yellow";
    const text = `${KIND_TEXT[item.kind]}${here ? tr("の中", " here") : tr(` ${Math.round(d)} km 先`, ` in ${Math.round(d)} km`)}`;
    const note = state === true ? tr("見えている", "in sight") : `${tr("予報", "forecast")} ${Math.round(item.prob * 100)}%`;
    if (!best || d < best.d) best = { d, text, note, level };
  }
  if (e.rain > 0) return { level: "yellow", text: tr(`雨（強さ ${e.rain}）`, `Rain (${e.rain})`), note: tr("スロットルを絞れ", "Throttle back") };
  if (e.turbulence > 0) return { level: "yellow", text: tr(`乱気流（${e.turbulence}）`, `Turbulence (${e.turbulence})`), note: tr(`${VA_KMH} km/h 以下に`, `below ${VA_KMH} km/h`) };
  if (best) return best;
  return { level: "green", text: tr("晴れ", "Clear"), note: tr("120 km 先まで予報なし", "nothing forecast for 120 km") };
}
