// 経由地：着陸後の点検・整備・給油・宿泊と、次の行き先（地図で選ぶ）への出発。
import { BOLT_DANGER, CB_DANGER_KM, FATIGUE_REST, HASTE_RELIEF, PILOT_RED, VIBRATION_YELLOW } from "../config";
import {
  absNow,
  airframeRepairInfo,
  boltCheckNotice,
  currentPlace,
  chooseDestination,
  foggedNow,
  legWeather,
  rushedToday,
  repairAirframe,
  waitForWeather,
  waitInfo,
  departureProblems,
  edgeRepairInfo,
  engineServiceInfo,
  nextLeg,
  propSwapInfo,
  refuel,
  refuelInfo,
  repairEdge,
  rest,
  restInfo,
  retorque,
  retorqueInfo,
  serviceEngine,
  swapProp,
  takeoffCheck,
  type ActionInfo,
  type CampaignState,
} from "../game/campaign";
import type { FlightResult } from "../game/flight";
import { estimateNextLeg, PLAN_THROTTLE } from "../game/planner";
import { DIFFICULTY } from "../data/difficulty";
import { equipmentKg } from "../data/equipment";
import { isHasty } from "../model/pilot";
import type { Forecast, ForecastItem } from "../model/types";
import { fogChance, headwindAt, spreadAt } from "../model/weather";
import { rumorsFor } from "../game/rumors";
import { fmtDuration, mechanicLine, openDialog, pilotTable, rumorsHtml, setActions, tabsHtml } from "./dialog";
import { pilotDiagramHtml } from "./pilotDiagram";
import { inspectionHtml } from "./inspection";
import { legProfileHtml } from "./legProfile";
import { fmtClock } from "./panel";
import { routePlanHtml } from "./routePlan";
import { runTorque } from "./torque";

export interface ArrivalInfo {
  result: FlightResult;
  flightMin: number;
  fuelUsed: number;
}

/** 経由地の見出しごとのタブ */
type WaypointTab = "check" | "pilot" | "work" | "fuel" | "dest" | "leg";

export interface WaypointOptions {
  arrival?: ArrivalInfo;
  details: () => boolean;
  onDepart: () => void;
}

export function showWaypoint(c: CampaignState, opts: WaypointOptions) {
  let fuelTarget = Math.round(c.condition.fuelRemaining);
  let arrival = opts.arrival;
  /** 今開いているタブ */
  let tab: WaypointTab = "check";
  render(false);

  function render(keepScroll = true) {
    const here = currentPlace(c);
    const leg = nextLeg(c);
    const d = opts.details();
    const a = c.condition;
    const tc = takeoffCheck(c);
    const problems = departureProblems(c);
    const toSunset = c.world.sunsetMin - c.clockMin;
    const fuelInfo = refuelInfo(c, fuelTarget);

    // 燃料を fuelTarget にしたときの離陸距離（スライダーを動かしながら確かめられる）
    const saved = a.fuelRemaining;
    a.fuelRemaining = fuelTarget;
    const tcTarget = takeoffCheck(c);
    a.fuelRemaining = saved;

    const plain = DIFFICULTY[c.difficulty].plainInstruments;
    const notice = boltCheckNotice(c);
    const btn = (act: string, label: string, info: ActionInfo, extra = "") =>
      `<button data-act="${act}" class="${act === "retorque" && notice ? "attention" : ""}" ${info.ok ? "" : "disabled"}>
        <b>${label}</b><small>${info.min ? fmtDuration(info.min) : ""}${info.reason ? `（${info.reason}）` : ""}${extra}</small>
      </button>`;


    openDialog(
      `<h2>${arrival ? `${here.name}に着陸` : `${here.name}`}</h2>
      <p class="lead">${c.day}日目 ${fmtClock(c.clockMin)}・日没まで ${toSunset > 0 ? fmtDuration(toSunset) : "—（もう暗い）"}</p>
      <p class="small">${here.description}　湿度 ${here.humidity}%・整備場 ${here.hasRepairShop ? "あり" : "なし"}</p>
      ${fogMeter(here.name, spreadAt(here, c.clockMin), foggedNow(c))}

      ${
        arrival
          ? `<div class="arrival ${arrival.result.success ? "ok" : ""}">
              <b>${arrival.result.title}</b>　飛行 ${fmtDuration(arrival.flightMin)}・燃料 ${arrival.fuelUsed.toFixed(1)} L
              <ul>${c.events.map((e) => `<li>${e}</li>`).join("")}</ul>
            </div>`
          : ""
      }

      ${mechanicLine(adviceAtField(c))}
      ${leg ? rumorsHtml(rumorsFor(leg, c.weatherSeed + c.day), `${leg.to.name}への道`) : ""}

      ${tabsHtml<WaypointTab>(
        [
          { id: "check", label: "機体の点検", sub: notice ? "通知あり" : undefined, todo: !!notice },
          { id: "pilot", label: "操縦者" },
          { id: "work", label: "整備と準備" },
          { id: "fuel", label: "給油", sub: `${a.fuelRemaining.toFixed(0)} L` },
          { id: "dest", label: "次の行き先", sub: leg ? leg.to.name : "まだ", todo: !leg },
          { id: "leg", label: "次の区間", sub: leg ? "予報" : undefined },
        ],
        tab,
      )}
      <section class="tab-panel" role="tabpanel">${panelHtml()}</section>

      <p class="small">今の重さ ${Math.round(tc.weight)} kg・気温 ${tc.temperature.toFixed(0)}℃・離陸距離 ${Math.round(tc.distance)} m / 滑走路 ${tc.runway} m ${tc.ok ? "○" : "×（燃料を減らすか、涼しい時間を待つ）"}</p>
      ${problems.length ? `<p class="problems">${problems.join("・")}</p>` : ""}
      <button class="primary" data-act="depart" ${problems.length ? "disabled" : ""}>${leg ? `${leg.to.name}へ出発する` : "行き先を選ぶ"}</button>`,
      { wide: true, keepScroll },
    );

    const root = document.querySelector<HTMLElement>("#dialog")!;
    root.querySelector<HTMLInputElement>("[data-fuel]")?.addEventListener("input", (e) => {
      fuelTarget = Number((e.target as HTMLInputElement).value);
      render();
    });
    root.querySelector<HTMLInputElement>("[data-details]")?.addEventListener("change", (e) => {
      const box = document.querySelector<HTMLInputElement>("#details")!;
      box.checked = (e.target as HTMLInputElement).checked;
      box.dispatchEvent(new Event("change"));
      render();
    });

    /** 選んでいるタブの中身 */
    function panelHtml(): string {
      const detailsToggle = `<p class="tab-tools"><label class="toggle small"><input type="checkbox" data-details ${d ? "checked" : ""} /> 数値</label></p>`;
      switch (tab) {
        case "check":
          return `${detailsToggle}
          ${notice ? `<div class="notice">点検の通知：${notice}</div>` : ""}
          ${inspectionHtml(a, { details: d, plain, haste: c.pilot.haste })}`;
        case "pilot":
          return `${detailsToggle}
          ${plain ? pilotTable(c.pilot, d, { plain, haste: c.pilot.haste }) : pilotDiagramHtml(c.pilot, d, c.pilot.haste)}`;
        case "work":
          return `<div class="actions">
            ${btn("retorque", "ボルトを締め直す", retorqueInfo(c), c.setup.equipment.toolKit ? "・工具セット" : "")}
            ${btn("edge", "前縁を補修する", edgeRepairInfo(c))}
            ${btn("engine", "エンジンを整備する", engineServiceInfo(c))}
            ${btn("frame", "機体を修理する", airframeRepairInfo(c))}
            ${btn("swap", "予備のプロペラに交換", propSwapInfo(c))}
            ${btn("wait", "天気を待つ", waitInfo(c), `・焦り −${HASTE_RELIEF}（勇気ある撤退）・霧が晴れる／午後は天気が変わる`)}
            ${btn("rest", "一晩泊まる（翌朝 8:00）", restInfo(c), `翌朝まで休む・疲労 −${FATIGUE_REST}`)}
          </div>`;
        case "fuel":
          return `<div class="fuel-row">
            <input type="range" min="0" max="${c.world.fuelCapacityL}" step="1" value="${fuelTarget}" data-fuel />
            <span>今 ${a.fuelRemaining.toFixed(0)} L → <b>${fuelTarget} L</b>
              ${fuelTarget < a.fuelRemaining - 0.5 ? "（抜く）" : ""}
              ・離陸距離 <b class="${tcTarget.ok ? "" : "ng-text"}">${Math.round(tcTarget.distance)} m</b> / ${tcTarget.runway} m</span>
            <button data-act="fuel" ${fuelInfo.ok ? "" : "disabled"}>この量にする</button>
          </div>`;
        case "dest":
          return `<p class="small">地図の飛行場をクリックして選ぶ</p>
          ${routePlanHtml(c.world, {
            from: c.location,
            destination: c.destination,
            nowAbs: absNow(c),
            flown: flownEdges(c),
            pitch: c.setup.pitch,
            equipmentKg: equipmentKg(c.setup.equipment),
          })}`;
        case "leg":
          return nextLegHtml(c) || `<p class="small">「次の行き先」で飛行場を選ぶと、区間の断面図と予報が出る。</p>`;
      }
    }
  }

  const torqueThen = (heading: string, apply: (r: Parameters<typeof retorque>[1]) => void) =>
    runTorque({
      heading,
      note: "トルクレンチでボルト3本を締める。",
      onDone: (r) => {
        apply(r);
        render(false);
      },
    });

  setActions({
    tab: (el) => {
      tab = el.dataset.v as WaypointTab;
      render();
    },
    retorque: () => torqueThen("ボルトの締め直し", (r) => retorque(c, r)),
    swap: () => torqueThen("予備のプロペラに交換", (r) => swapProp(c, r)),
    edge: () => {
      repairEdge(c);
      render();
    },
    frame: () => {
      repairAirframe(c);
      render();
    },
    wait: () => {
      waitForWeather(c);
      arrival = undefined;
      render();
    },
    engine: () => {
      serviceEngine(c);
      render();
    },
    rest: () => {
      rest(c);
      arrival = undefined;
      render(false);
    },
    fuel: () => {
      refuel(c, fuelTarget);
      fuelTarget = Math.round(c.condition.fuelRemaining);
      render();
    },
    dest: (el) => {
      chooseDestination(c, el.dataset.id!);
      render();
    },
    depart: () => opts.onDepart(),
  });
}

/** これまでに飛んで着いた道（地図に色を付ける） */
function flownEdges(c: CampaignState): [string, string][] {
  return c.records.filter((r) => !r.returned).map((r) => [r.leg.from.id, r.leg.to.id]);
}

/** 経由地での整備士のひとこと。焦っていると「まあ大丈夫だろう」に聞こえる */
function adviceAtField(c: CampaignState): string {
  const real = realAdviceAtField(c);
  if (isHasty(c.pilot.haste) && real !== CALM) return HASTY_FIELD[Math.floor(c.clockMin / 37) % HASTY_FIELD.length];
  return real;
}

const CALM = "異常なし。燃料と時間を計算して、無理のない計画で出よう。";
const HASTY_FIELD = [
  "点検？ 急いでるんだ。まあ大丈夫だろう、出よう。",
  "細かいことは着いてから見ればいい。遅れを取り戻そう。",
  "多少のことは気にするな。今出れば、まだ間に合う。",
];

function realAdviceAtField(c: CampaignState): string {
  const a = c.condition;
  const humidityEvent = c.events.find((e) => e.startsWith("湿度") && e.includes("ゆるんだ"));
  if (foggedNow(c)) return "霧で滑走路が見えない。晴れるまで待て。朝の霧は、日が高くなれば消える。";
  if (a.airframe < 60) return "機体が揺れで傷んでる。整備場で直しておけ。";
  if (a.propDurability <= 30) return "プロペラがかなり弱ってる。予備があれば交換しろ。";
  if (a.boltTightness < BOLT_DANGER + 10) return "ボルトが危ないところまでゆるんでる。締め直さずに飛ぶのは自殺行為だ。";
  if (humidityEvent && a.boltTightness < 80) return "気候の違う土地に着いたら、まず締め直せ。";
  if (a.vibration >= VIBRATION_YELLOW) return "振動が出てる。原因はボルトのゆるみか、前縁の傷の左右差だ。";
  if (a.propEdge < 85) return "前縁に傷がある。放っておくと効率が落ちて、そのうち振動の元になる。";
  if (a.engineHealth < 70) return "エンジンが疲れてる。整備場があるうちに見ておくと安心だ。";
  if (c.pilot.fatigue >= PILOT_RED) return "くたくたじゃないか。疲れると操作も計器の読みも遅れる。今日はもう休め。";
  if (rushedToday(c)) return "今から出ると、暗くなる前に着けるかぎりぎりだ。焦るな。泊まって朝に出るのも正しい判断だ。";
  return CALM;
}

const KIND_TEXT = { cloud: "雲", rain: "雨", turbulence: "乱気流", cb: "積乱雲" } as const;

function itemText(i: ForecastItem): { where: string; what: string } {
  const side = (lat: number) => (Math.abs(lat) < 3 ? "コース上" : `コースの${lat < 0 ? "左" : "右"} ${Math.abs(Math.round(lat))} km`);
  if (i.cb) return { where: `${i.cb.alongKm} km 付近・${side(i.cb.lateralKm)}`, what: `積乱雲（${CB_DANGER_KM} km 以上離れること）` };
  const a = (i.rain ?? i.cloud ?? i.turbulence)!;
  const where = `${a.fromKm}〜${a.toKm} km・${side(a.lateralKm)}・幅 ${a.halfWidthKm * 2} km`;
  const parts: string[] = [];
  if (i.rain) parts.push(`雨（強さ ${i.rain.intensity}）`);
  if (i.cloud) parts.push(`雲 ${i.cloud.base}〜${i.cloud.top} m`);
  if (i.turbulence) parts.push(`乱気流（強さ ${i.turbulence.intensity}）`);
  return { where, what: parts.join("・") || KIND_TEXT[i.kind] };
}

/** 予報（確率つき）と高度別の風 */
/**
 * 次の区間「◯◯ → △△」の説明：道のひとこと・断面図（地形と予報）・文字の予報。
 * 経由地と格納庫（最初の区間）で同じものを出す。行き先を選んでいなければ空。
 */
export function nextLegHtml(c: CampaignState, heading = (from: string, to: string) => `<h3>${from} → ${to}</h3>`): string {
  const leg = nextLeg(c);
  const wx = legWeather(c);
  if (!leg || !wx) return "";
  const est = estimateNextLeg(c);
  const etaMin = est ? c.clockMin + est.minutes : Infinity;
  const destSpread = Number.isFinite(etaMin) ? spreadAt(leg.to, etaMin) : 99;
  return `${heading(leg.from.name, leg.to.name)}
      <p class="small">${leg.note}</p>
      ${legProfileHtml({
        leg,
        forecast: wx.forecast,
        est,
        nowMin: c.clockMin,
        sunsetMin: c.world.sunsetMin,
        fuelL: c.condition.fuelRemaining,
        capacityL: c.world.fuelCapacityL,
        destSpread,
      })}
      <details class="howto">
        <summary>予報と区間の数字（文字で見る）</summary>
        ${forecastHtml(wx.forecast, leg.distanceKm, leg.from.elevation)}
        <p class="small">${leg.distanceKm} km・地上の風 ${leg.headwindKmh >= 0 ? `向かい風 ${leg.headwindKmh}` : `追い風 ${-leg.headwindKmh}`} km/h・すすめの巡航高度 ${leg.cruiseAltitude} m・着く先は ${leg.to.surface === "paved" ? "舗装" : "未舗装"}（湿度 ${leg.to.humidity}%）</p>
        ${est ? `<p class="small">目安（出力${PLAN_THROTTLE * 100}%・最良燃費）：約 ${fmtDuration(est.minutes)}・燃料 約 ${est.fuelL.toFixed(0)} L ＋ 予備 → 到着 ${etaMin < 24 * 60 ? fmtClock(etaMin) : "—"}</p>` : ""}
      </details>`;
}

function forecastHtml(f: Forecast, distanceKm: number, fieldElevation: number) {
  const rows = f.items
    .filter((i) => i.prob > 0)
    .map((i) => {
      const t = itemText(i);
      const pct = Math.round(i.prob * 100);
      return `<tr><td>${t.where}</td><td>${t.what}</td><td class="${pct >= 60 ? "ng-text" : ""}">${pct}%</td></tr>`;
    })
    .join("");
  const winds = [...f.winds]
    .sort((a, b) => a.altitude - b.altitude)
    .map((wl) => {
      const hw = Math.round(headwindAt(f.winds, Math.max(wl.altitude, fieldElevation)));
      return `<span class="wind">${wl.altitude === 0 ? "地上" : `${wl.altitude} m`}：${hw >= 0 ? `向かい ${hw}` : `追い ${-hw}`}</span>`;
    })
    .join("");
  return `<div class="forecast">
    <p class="small">天気予報（${f.period === "morning" ? "午前" : "午後"}の出発）。確率は「その天気になる見込み」。位置や高さは、実際とずれることがある。</p>
    ${rows ? `<table class="route-table"><tr><th>場所（出発地から）</th><th>予報</th><th>確率</th></tr>${rows}</table>` : "<p>この区間に目立った天気の予報はない。</p>"}
    <p class="winds"><b>高度別の風</b> ${winds}<span class="wind">凍結高度 ${f.freezingLevel} m</span></p>
    <p class="small">区間の長さ ${distanceKm} km</p>
  </div>`;
}

/** 霧の出やすさメーター（気温と露点の差） */
function fogMeter(name: string, spread: number, fogged: boolean) {
  const chance = fogChance(spread);
  const level = fogged ? "red" : chance > 0 ? "yellow" : "green";
  const fill = Math.max(0, Math.min(1, 1 - spread / 8));
  return `<div class="fogmeter ${level}">
    <span>霧の出やすさ（${name}）</span>
    <span class="st-bar"><i style="width:${fill * 100}%"></i></span>
    <span>${fogged ? "霧が出ている" : chance > 0 ? `出やすい（${Math.round(chance * 100)}%）` : "出にくい"}　<small>気温と露点の差 ${spread.toFixed(1)}℃</small></span>
  </div>`;
}
