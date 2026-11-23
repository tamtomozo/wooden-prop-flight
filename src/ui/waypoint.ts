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
import { tr } from "../i18n";

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

/** チュートリアル：経由地でやることの順番（はじめての経由地では開いておく） */
function tutorialNote(c: CampaignState): string {
  if (!c.world.tutorial) return "";
  return `<details class="tut-note" ${c.records.length <= 1 ? "open" : ""}>
    ${tr(
      `<summary><b>チュートリアル：経由地でやること</b></summary>
    <ol>
      <li><b>機体の点検</b>：ボルト・前縁・振動・エンジンを見る。赤いところがあれば直す。</li>
      <li><b>整備と準備</b>：ボルトは飛ぶたびにゆるむ。<b>締め直す</b>。疲れていたら<b>休む</b>（泊まる）。</li>
      <li><b>給油</b>：次の区間に要る燃料＋予備。積みすぎると重くて、短い滑走路から飛び立てない。</li>
      <li><b>次の行き先</b>と<b>次の区間</b>：地図で行き先を選び、予報（雲・雨・風）と断面図（山・海）を見る。</li>
      <li>霧や悪い天気なら<b>待つ</b>のも正しい判断。準備ができたら出発する。</li>
    </ol>`,
      `<summary><b>Tutorial: what to do at a stop</b></summary>
    <ol>
      <li><b>Inspect the plane</b>: look at the bolts, leading edge, vibration and engine. Fix anything that is red.</li>
      <li><b>Repairs and prep</b>: the bolts loosen with every flight. <b>Re-tighten</b> them. If you are tired, <b>rest</b> (stay the night).</li>
      <li><b>Refuel</b>: the fuel for the next leg plus the reserve. Load too much and you are too heavy to take off from a short runway.</li>
      <li><b>Next stop</b> and <b>next leg</b>: choose the destination on the map, then check the forecast (cloud, rain, wind) and the profile (mountains, sea).</li>
      <li>In fog or bad weather, <b>waiting</b> is a right call too. When you are ready, take off.</li>
    </ol>`,
    )}
  </details>`;
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
        <b>${label}</b><small>${info.min ? fmtDuration(info.min) : ""}${info.reason ? tr(`（${info.reason}）`, ` (${info.reason})`) : ""}${extra}</small>
      </button>`;


    openDialog(
      `<h2>${arrival ? tr(`${here.name}に着陸`, `Landed at ${here.name}`) : `${here.name}`}</h2>
      <p class="lead">${tr(
        `${c.day}日目 ${fmtClock(c.clockMin)}・日没まで ${toSunset > 0 ? fmtDuration(toSunset) : "—（もう暗い）"}`,
        `Day ${c.day}, ${fmtClock(c.clockMin)} · ${toSunset > 0 ? `${fmtDuration(toSunset)} to sunset` : "— (already dark)"}`,
      )}</p>
      <p class="small">${here.description}${tr(
        `　湿度 ${here.humidity}%・整備場 ${here.hasRepairShop ? "あり" : "なし"}`,
        `  Humidity ${here.humidity}% · ${here.hasRepairShop ? "repair shop" : "no repair shop"}`,
      )}</p>
      ${fogMeter(here.name, spreadAt(here, c.clockMin), foggedNow(c))}

      ${
        arrival
          ? `<div class="arrival ${arrival.result.success ? "ok" : ""}">
              <b>${arrival.result.title}</b>${tr("　飛行", "  Flight")} ${fmtDuration(arrival.flightMin)}${tr("・燃料", " · fuel")} ${arrival.fuelUsed.toFixed(1)} L
              <ul>${c.events.map((e) => `<li>${e}</li>`).join("")}</ul>
            </div>`
          : ""
      }

      ${mechanicLine(adviceAtField(c))}
      ${tutorialNote(c)}
      ${leg ? rumorsHtml(rumorsFor(leg, c.weatherSeed + c.day), tr(`${leg.to.name}への道`, `the way to ${leg.to.name}`)) : ""}

      ${tabsHtml<WaypointTab>(
        [
          { id: "check", label: tr("機体の点検", "Inspection"), sub: notice ? tr("通知あり", "Notice") : undefined, todo: !!notice },
          { id: "pilot", label: tr("操縦者", "Pilot") },
          { id: "work", label: tr("整備と準備", "Repairs & prep") },
          { id: "fuel", label: tr("給油", "Refuel"), sub: `${a.fuelRemaining.toFixed(0)} L` },
          { id: "dest", label: tr("次の行き先", "Next stop"), sub: leg ? leg.to.name : tr("まだ", "Not yet"), todo: !leg },
          { id: "leg", label: tr("次の区間", "Next leg"), sub: leg ? tr("予報", "Forecast") : undefined },
        ],
        tab,
      )}
      <section class="tab-panel" role="tabpanel">${panelHtml()}</section>

      <p class="small">${tr(
        `今の重さ ${Math.round(tc.weight)} kg・気温 ${tc.temperature.toFixed(0)}℃・離陸距離 ${Math.round(tc.distance)} m / 滑走路 ${tc.runway} m ${tc.ok ? "○" : "×（燃料を減らすか、涼しい時間を待つ）"}`,
        `Weight now ${Math.round(tc.weight)} kg · ${tc.temperature.toFixed(0)}°C · takeoff run ${Math.round(tc.distance)} m / runway ${tc.runway} m ${tc.ok ? "○" : "× (carry less fuel, or wait for a cooler hour)"}`,
      )}</p>
      ${problems.length ? `<p class="problems">${problems.join(tr("・", " · "))}</p>` : ""}
      <button class="primary" data-act="depart" ${problems.length ? "disabled" : ""}>${leg ? tr(`${leg.to.name}へ出発する`, `Take off for ${leg.to.name}`) : tr("行き先を選ぶ", "Choose a destination")}</button>`,
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
      const detailsToggle = `<p class="tab-tools"><label class="toggle small"><input type="checkbox" data-details ${d ? "checked" : ""} /> ${tr("数値", "Numbers")}</label></p>`;
      switch (tab) {
        case "check":
          return `${detailsToggle}
          ${notice ? `<div class="notice">${tr("点検の通知：", "Inspection notice: ")}${notice}</div>` : ""}
          ${inspectionHtml(a, { details: d, plain, haste: c.pilot.haste })}`;
        case "pilot":
          return `${detailsToggle}
          ${plain ? pilotTable(c.pilot, d, { plain, haste: c.pilot.haste }) : pilotDiagramHtml(c.pilot, d, c.pilot.haste)}`;
        case "work":
          return `<div class="actions">
            ${btn("retorque", tr("ボルトを締め直す", "Re-tighten the bolts"), retorqueInfo(c), c.setup.equipment.toolKit ? tr("・工具セット", " · tool kit") : "")}
            ${btn("edge", tr("前縁を補修する", "Repair the leading edge"), edgeRepairInfo(c))}
            ${btn("engine", tr("エンジンを整備する", "Service the engine"), engineServiceInfo(c))}
            ${btn("frame", tr("機体を修理する", "Repair the airframe"), airframeRepairInfo(c))}
            ${btn("swap", tr("予備のプロペラに交換", "Fit the spare propeller"), propSwapInfo(c))}
            ${btn(
              "wait",
              tr("天気を待つ", "Wait for weather"),
              waitInfo(c),
              tr(
                `・焦り −${HASTE_RELIEF}（勇気ある撤退）・霧が晴れる／午後は天気が変わる`,
                ` · haste −${HASTE_RELIEF} (brave retreat) · fog clears / afternoon weather changes`,
              ),
            )}
            ${btn("rest", tr("一晩泊まる（翌朝 8:00）", "Stay the night (until 8:00)"), restInfo(c), tr(`翌朝まで休む・疲労 −${FATIGUE_REST}`, `Rest until morning · fatigue −${FATIGUE_REST}`))}
          </div>`;
        case "fuel":
          return `<div class="fuel-row">
            <input type="range" min="0" max="${c.world.fuelCapacityL}" step="1" value="${fuelTarget}" data-fuel />
            <span>${tr("今", "Now")} ${a.fuelRemaining.toFixed(0)} L → <b>${fuelTarget} L</b>
              ${fuelTarget < a.fuelRemaining - 0.5 ? tr("（抜く）", "(drain)") : ""}
              ${tr("・離陸距離", "· takeoff run")} <b class="${tcTarget.ok ? "" : "ng-text"}">${Math.round(tcTarget.distance)} m</b> / ${tcTarget.runway} m</span>
            <button data-act="fuel" ${fuelInfo.ok ? "" : "disabled"}>${tr("この量にする", "Set this amount")}</button>
          </div>`;
        case "dest":
          return `<p class="small">${tr("地図の飛行場をクリックして選ぶ", "Click a field on the map to choose")}</p>
          ${routePlanHtml(c.world, {
            from: c.location,
            destination: c.destination,
            nowAbs: absNow(c),
            flown: flownEdges(c),
            pitch: c.setup.pitch,
            equipmentKg: equipmentKg(c.setup.equipment),
          })}`;
        case "leg":
          return nextLegHtml(c) || `<p class="small">${tr("「次の行き先」で飛行場を選ぶと、区間の断面図と予報が出る。", "Choose a field under \"Next stop\" to see the leg's profile and forecast.")}</p>`;
      }
    }
  }

  const torqueThen = (heading: string, apply: (r: Parameters<typeof retorque>[1]) => void) =>
    runTorque({
      heading,
      note: tr("トルクレンチでボルト3本を締める。", "Tighten the three bolts with the torque wrench."),
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
    retorque: () => torqueThen(tr("ボルトの締め直し", "Re-tightening the bolts"), (r) => retorque(c, r)),
    swap: () => torqueThen(tr("予備のプロペラに交換", "Fitting the spare propeller"), (r) => swapProp(c, r)),
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

const CALM = tr("異常なし。燃料と時間を計算して、無理のない計画で出よう。", "All good. Work out your fuel and time, and leave with a plan that isn't a stretch.");
const HASTY_FIELD = tr(
  [
    "点検？ 急いでるんだ。まあ大丈夫だろう、出よう。",
    "細かいことは着いてから見ればいい。遅れを取り戻そう。",
    "多少のことは気にするな。今出れば、まだ間に合う。",
  ],
  [
    "Inspection? We're in a hurry. It'll probably be fine, let's go.",
    "We can look at the details when we get there. Let's make up lost time.",
    "Don't worry about the little things. If we leave now, we can still make it.",
  ],
);

function realAdviceAtField(c: CampaignState): string {
  const a = c.condition;
  const humidityEvent = c.events.find((e) => e.startsWith(tr("湿度", "Humidity")) && e.includes(tr("ゆるんだ", "loosened")));
  if (foggedNow(c)) return tr("霧で滑走路が見えない。晴れるまで待て。朝の霧は、日が高くなれば消える。", "Fog hides the runway. Wait until it clears. Morning fog burns off once the sun is high.");
  if (a.airframe < 60) return tr("機体が揺れで傷んでる。整備場で直しておけ。", "The airframe is worn from the shaking. Get it fixed at a repair shop.");
  if (a.propDurability <= 30) return tr("プロペラがかなり弱ってる。予備があれば交換しろ。", "The propeller is quite weak. If you have a spare, fit it.");
  if (a.boltTightness < BOLT_DANGER + 10) return tr("ボルトが危ないところまでゆるんでる。締め直さずに飛ぶのは自殺行為だ。", "The bolts are dangerously loose. Flying without re-tightening them is suicide.");
  if (humidityEvent && a.boltTightness < 80) return tr("気候の違う土地に着いたら、まず締め直せ。", "When you land somewhere with a different climate, re-tighten first.");
  if (a.vibration >= VIBRATION_YELLOW) return tr("振動が出てる。原因はボルトのゆるみか、前縁の傷の左右差だ。", "There's vibration. Either the bolts are loose or the two blades' edges are nicked unevenly.");
  if (a.propEdge < 85) return tr("前縁に傷がある。放っておくと効率が落ちて、そのうち振動の元になる。", "The leading edge is nicked. Leave it and efficiency drops, and sooner or later it causes vibration.");
  if (a.engineHealth < 70) return tr("エンジンが疲れてる。整備場があるうちに見ておくと安心だ。", "The engine is tired. Better have it looked at while there's a repair shop.");
  if (c.pilot.fatigue >= PILOT_RED) return tr("くたくたじゃないか。疲れると操作も計器の読みも遅れる。今日はもう休め。", "You're worn out. Tired pilots are slow on the controls and the gauges. Call it a day.");
  if (rushedToday(c)) return tr("今から出ると、暗くなる前に着けるかぎりぎりだ。焦るな。泊まって朝に出るのも正しい判断だ。", "Leave now and it's touch and go whether you land before dark. Don't rush. Staying the night and leaving in the morning is a right call too.");
  return CALM;
}

const KIND_TEXT = tr(
  { cloud: "雲", rain: "雨", turbulence: "乱気流", cb: "積乱雲" },
  { cloud: "Cloud", rain: "Rain", turbulence: "Turbulence", cb: "Thunderstorm" },
);

function itemText(i: ForecastItem): { where: string; what: string } {
  const side = (lat: number) =>
    Math.abs(lat) < 3
      ? tr("コース上", "on course")
      : tr(`コースの${lat < 0 ? "左" : "右"} ${Math.abs(Math.round(lat))} km`, `${Math.abs(Math.round(lat))} km ${lat < 0 ? "left" : "right"} of course`);
  if (i.cb)
    return {
      where: tr(`${i.cb.alongKm} km 付近・${side(i.cb.lateralKm)}`, `around ${i.cb.alongKm} km · ${side(i.cb.lateralKm)}`),
      what: tr(`積乱雲（${CB_DANGER_KM} km 以上離れること）`, `Thunderstorm (keep at least ${CB_DANGER_KM} km away)`),
    };
  const a = (i.rain ?? i.cloud ?? i.turbulence)!;
  const where = tr(
    `${a.fromKm}〜${a.toKm} km・${side(a.lateralKm)}・幅 ${a.halfWidthKm * 2} km`,
    `${a.fromKm}–${a.toKm} km · ${side(a.lateralKm)} · ${a.halfWidthKm * 2} km wide`,
  );
  const parts: string[] = [];
  if (i.rain) parts.push(tr(`雨（強さ ${i.rain.intensity}）`, `Rain (strength ${i.rain.intensity})`));
  if (i.cloud) parts.push(tr(`雲 ${i.cloud.base}〜${i.cloud.top} m`, `Cloud ${i.cloud.base}–${i.cloud.top} m`));
  if (i.turbulence) parts.push(tr(`乱気流（強さ ${i.turbulence.intensity}）`, `Turbulence (strength ${i.turbulence.intensity})`));
  return { where, what: parts.join(tr("・", " · ")) || KIND_TEXT[i.kind] };
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
        <summary>${tr("予報と区間の数字（文字で見る）", "Forecast and leg numbers (as text)")}</summary>
        ${forecastHtml(wx.forecast, leg.distanceKm, leg.from.elevation)}
        <p class="small">${tr(
          `${leg.distanceKm} km・地上の風 ${leg.headwindKmh >= 0 ? `向かい風 ${leg.headwindKmh}` : `追い風 ${-leg.headwindKmh}`} km/h・すすめの巡航高度 ${leg.cruiseAltitude} m・着く先は ${leg.to.surface === "paved" ? "舗装" : "未舗装"}（湿度 ${leg.to.humidity}%）`,
          `${leg.distanceKm} km · surface wind ${leg.headwindKmh >= 0 ? `headwind ${leg.headwindKmh}` : `tailwind ${-leg.headwindKmh}`} km/h · suggested cruise altitude ${leg.cruiseAltitude} m · destination is ${leg.to.surface === "paved" ? "paved" : "unpaved"} (humidity ${leg.to.humidity}%)`,
        )}</p>
        ${
          est
            ? `<p class="small">${tr(
                `目安（出力${PLAN_THROTTLE * 100}%・最良燃費）：約 ${fmtDuration(est.minutes)}・燃料 約 ${est.fuelL.toFixed(0)} L ＋ 予備 → 到着 ${etaMin < 24 * 60 ? fmtClock(etaMin) : "—"}`,
                `Estimate (${PLAN_THROTTLE * 100}% power, best economy): about ${fmtDuration(est.minutes)} · fuel about ${est.fuelL.toFixed(0)} L + reserve → arrive ${etaMin < 24 * 60 ? fmtClock(etaMin) : "—"}`,
              )}</p>`
            : ""
        }
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
      return `<span class="wind">${wl.altitude === 0 ? tr("地上", "Surface") : `${wl.altitude} m`}${tr("：", ": ")}${hw >= 0 ? tr(`向かい ${hw}`, `head ${hw}`) : tr(`追い ${-hw}`, `tail ${-hw}`)}</span>`;
    })
    .join("");
  return `<div class="forecast">
    <p class="small">${tr(
      `天気予報（${f.period === "morning" ? "午前" : "午後"}の出発）。確率は「その天気になる見込み」。位置や高さは、実際とずれることがある。`,
      `Forecast (for a ${f.period === "morning" ? "morning" : "afternoon"} departure). The percentage is the chance of that weather. Places and heights may be off.`,
    )}</p>
    ${
      rows
        ? `<table class="route-table"><tr><th>${tr("場所（出発地から）", "Where (from departure)")}</th><th>${tr("予報", "Forecast")}</th><th>${tr("確率", "Chance")}</th></tr>${rows}</table>`
        : `<p>${tr("この区間に目立った天気の予報はない。", "No notable weather is forecast for this leg.")}</p>`
    }
    <p class="winds"><b>${tr("高度別の風", "Wind by altitude")}</b> ${winds}<span class="wind">${tr("凍結高度", "Freezing level")} ${f.freezingLevel} m</span></p>
    <p class="small">${tr("区間の長さ", "Leg length")} ${distanceKm} km</p>
  </div>`;
}

/** 霧の出やすさメーター（気温と露点の差） */
function fogMeter(name: string, spread: number, fogged: boolean) {
  const chance = fogChance(spread);
  const level = fogged ? "red" : chance > 0 ? "yellow" : "green";
  const fill = Math.max(0, Math.min(1, 1 - spread / 8));
  return `<div class="fogmeter ${level}">
    <span>${tr(`霧の出やすさ（${name}）`, `Fog chance (${name})`)}</span>
    <span class="st-bar"><i style="width:${fill * 100}%"></i></span>
    <span>${fogged ? tr("霧が出ている", "Foggy now") : chance > 0 ? tr(`出やすい（${Math.round(chance * 100)}%）`, `Likely (${Math.round(chance * 100)}%)`) : tr("出にくい", "Unlikely")}  <small>${tr("気温と露点の差", "Temp–dew point spread")} ${spread.toFixed(1)}${tr("℃", "°C")}</small></span>
  </div>`;
}
