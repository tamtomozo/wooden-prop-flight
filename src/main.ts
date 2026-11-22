import "./style.css";
import { GAME_MINUTES_PER_SECOND, HASTE_RELIEF } from "./config";
import { DIFFICULTY } from "./data/difficulty";
import { NO_EQUIPMENT } from "./data/equipment";
import { field, legBetween, WORLD } from "./data/world";
import {
  beginLeg,
  finishLeg,
  isFinished,
  newCondition,
  suggestedDestination,
  recoverWithSpare,
  snapshot,
  startCampaign,
  type CampaignState,
} from "./game/campaign";
import { evaluateTrip } from "./game/evaluation";
import {
  clockMin,
  createFlight,
  evaluateFlight,
  intendedControls,
  intendedLateral,
  requestControls,
  requestLateral,
  setControls,
  stepFlight,
  turnBack,
  useRadio,
  type FlightState,
} from "./game/flight";
import { createRng } from "./model/physics";
import type { Setup } from "./model/types";
import { closeDialog, fmtDuration, mechanicLine, openDialog, setActions } from "./ui/dialog";
import { inspectionHtml } from "./ui/inspection";
import { showHangar } from "./ui/hangar";
import { CockpitPanel, fmtClock, PHASE_LABEL } from "./ui/panel";
import { RouteBar } from "./ui/routeBar";
import { SideScene } from "./ui/scene";
import { BackScene } from "./ui/scene3d";
import { Sound } from "./ui/sound";
import { showWaypoint, type ArrivalInfo } from "./ui/waypoint";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

// ---- 状態 ----
const world = WORLD;
let campaign: CampaignState | null = null;
/** 区間を出発する直前の状態（「この区間をやり直す」用） */
let legStart: CampaignState | null = null;
let flight: FlightState = previewFlight();
let running = false;
let paused = false;
let speed = 1;
let showDetails = false;

/** 格納庫にいる間、背景に見せておく機体（滑走路の上） */
function previewFlight(): FlightState {
  const setup: Setup = { pitch: 3, fuelPercent: 100, torqueResult: "ok", equipment: NO_EQUIPMENT };
  const leg = legBetween(world, world.startId, suggestedDestination(world, world.startId));
  return createFlight({
    leg,
    setup,
    condition: newCondition(world, setup),
    departureMin: world.startMin,
    sunsetMin: world.sunsetMin,
    controls: { throttle: 0.75, mixture: 0, carbHeat: false, targetAltitude: leg.cruiseAltitude },
    weather: { winds: leg.weather.winds, freezingLevel: 4000, clouds: [], rain: [], turbulence: [], cb: [] },
    forecast: { period: "morning", winds: leg.weather.winds, freezingLevel: 4000, items: [] },
    rng: createRng(1),
  });
}

// ---- 視点（後ろからの3D／横からの2D） ----
type View = "back" | "side";
const VIEW_KEY = "plane.view";
const sideCanvas = $<HTMLCanvasElement>("#scene");
const backCanvas = $<HTMLCanvasElement>("#scene3d");
const viewBtn = $<HTMLButtonElement>("#view");
const sideScene = new SideScene(sideCanvas);
const routeBar = new RouteBar($<HTMLCanvasElement>("#routebar"));
let backScene: BackScene | null = null;
try {
  backScene = new BackScene(backCanvas);
} catch {
  // WebGL が使えない環境では横の視点だけにする
  viewBtn.hidden = true;
}
let view: View = "side";

function setView(v: View) {
  view = backScene ? v : "side";
  backCanvas.hidden = view !== "back";
  sideCanvas.hidden = view !== "side";
  viewBtn.textContent = view === "back" ? "視点：後ろ" : "視点：横";
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    /* 保存できなくても遊べる */
  }
}
viewBtn.addEventListener("click", () => setView(view === "back" ? "side" : "back"));
let savedView: string | null = null;
try {
  savedView = localStorage.getItem(VIEW_KEY);
} catch {
  /* 読めなければ初期値 */
}
setView(savedView === "side" ? "side" : "back");

const throttleInput = $<HTMLInputElement>("#throttle");
const mixtureInput = $<HTMLInputElement>("#mixture");
const pauseBtn = $<HTMLButtonElement>("#pause");
const cockpit = new CockpitPanel(world.fuelCapacityL);
cockpit.bindParamClicks();

// ---- 音（エンジン音・風・雨・遠雷）。最初にクリックやキーを押したときに鳴らし始める ----
const SOUND_KEY = "plane.sound";
const sound = new Sound();
const soundBtn = $<HTMLButtonElement>("#sound");
function setSound(on: boolean) {
  sound.setEnabled(on);
  soundBtn.textContent = on ? "音：オン" : "音：オフ";
  try {
    localStorage.setItem(SOUND_KEY, on ? "on" : "off");
  } catch {
    /* 保存できなくても遊べる */
  }
}
let soundPref: string | null = null;
try {
  soundPref = localStorage.getItem(SOUND_KEY);
} catch {
  /* 読めなければ初期値 */
}
setSound(soundPref !== "off");
soundBtn.addEventListener("click", () => setSound(!sound.isEnabled()));
for (const ev of ["pointerdown", "keydown"]) window.addEventListener(ev, () => sound.ensure());
$("#sunset").textContent = fmtClock(world.sunsetMin);

function updateHud() {
  const f = flight;
  $("#route").innerHTML = `${f.leg.from.name}<span class="arrow">→</span>${f.leg.to.name}`;
  $("#clock").textContent = fmtClock(campaign && !running && isDialogShowingField() ? campaign.clockMin : clockMin(f));
  $("#day").textContent = `${campaign?.day ?? 1}日目`;
  const w = Math.round(f.env.headwind);
  $("#hud-wind").textContent = w >= 0 ? `向かい風 ${w} km/h` : `追い風 ${-w} km/h`;
  $("#hud-alt").textContent = `高度 ${Math.round(f.altitude)} m・${f.holding ? "霧で待機中" : f.returning ? "引き返し中" : PHASE_LABEL[f.phase]}`;
  $("#hud-oat").textContent = `外気温 ${Math.round(f.env.temp)}℃`;
  cockpit.update(f, showDetails, running && !paused);
}
const isDialogShowingField = () => !$("#overlay").hidden;

// ---- 操作 ----
// レバーは操縦者が動かしたとおりに動く。機体に効くのは、疲れていると少しあと（E1：反応の遅れ）
function applyControls(throttlePct: number, mixture: number, immediate = false) {
  const throttle = Math.min(1, Math.max(0.2, Math.round(throttlePct) / 100));
  const mix = Math.min(100, Math.max(0, Math.round(mixture)));
  if (immediate) setControls(flight, { throttle, mixture: mix });
  else requestControls(flight, { throttle, mixture: mix });
  throttleInput.value = String(Math.round(throttle * 100));
  mixtureInput.value = String(mix);
}

throttleInput.addEventListener("input", () => applyControls(+throttleInput.value, intendedControls(flight).mixture));
mixtureInput.addEventListener("input", () => applyControls(intendedControls(flight).throttle * 100, +mixtureInput.value));

window.addEventListener("keydown", (e) => {
  if (!running) return;
  const want = intendedControls(flight);
  const t = Math.round(want.throttle * 100);
  const m = want.mixture;
  switch (e.key.toLowerCase()) {
    case "v":
      setView(view === "back" ? "side" : "back");
      return;
    case "r":
      nav("alt-up");
      break;
    case "f":
      nav("alt-down");
      break;
    case "q":
      nav("left");
      break;
    case "e":
      nav("right");
      break;
    case "h":
      nav("carb");
      break;
    case "p":
      nav("radio");
      break;
    case "u":
      nav("turn");
      break;
    case "w":
    case "arrowup":
      applyControls(t + 5, m);
      break;
    case "s":
    case "arrowdown":
      applyControls(t - 5, m);
      break;
    case "d":
    case "arrowright":
      applyControls(t, m + 2);
      break;
    case "a":
    case "arrowleft":
      applyControls(t, m - 2);
      break;
    case " ":
      setPaused(!paused);
      break;
    default:
      return;
  }
  e.preventDefault();
});

// ---- 高度・よける・キャブヒート・ラジオ・引き返す ----
function nav(action: string) {
  const f = flight;
  if (!running || f.status !== "flying") return;
  const want = intendedControls(f);
  switch (action) {
    case "alt-up":
      if (!f.approach) requestControls(f, { targetAltitude: want.targetAltitude + 100 });
      break;
    case "alt-down":
      if (!f.approach) requestControls(f, { targetAltitude: want.targetAltitude - 100 });
      break;
    case "left":
      requestLateral(f, intendedLateral(f) - 10 * (f.returning ? -1 : 1));
      break;
    case "right":
      requestLateral(f, intendedLateral(f) + 10 * (f.returning ? -1 : 1));
      break;
    case "carb":
      requestControls(f, { carbHeat: !want.carbHeat });
      break;
    case "radio":
      useRadio(f);
      break;
    case "turn":
      confirmTurnBack();
      break;
  }
}
document.querySelectorAll<HTMLElement>("[data-nav]").forEach((b) => b.addEventListener("click", () => nav(b.dataset.nav!)));

function confirmTurnBack() {
  setPaused(true);
  const f = flight;
  openDialog(
    `<h2>引き返しますか？</h2>
    <p>180度旋回して、${f.leg.from.name}へ戻ります。ここまで ${f.distanceFlown.toFixed(0)} km 飛んできた。燃料は ${f.condition.fuelRemaining.toFixed(1)} L。</p>
    <p class="small">勇気ある撤退：焦りが ${HASTE_RELIEF} 下がり、最後の評価でボーナスがつく。</p>
    ${mechanicLine("一番大事なのは引き返す勇気だ。降りて待つのも正しい判断だぞ。")}
    <div class="buttons-row">
      <button data-act="cancel">このまま進む</button>
      <button class="primary" data-act="turn">引き返す</button>
    </div>`,
  );
  setActions({
    cancel: () => {
      closeDialog();
      setPaused(false);
    },
    turn: () => {
      turnBack(flight);
      closeDialog();
      setPaused(false);
    },
  });
}

// ---- 天気の知らせ：大事なことが起きたら時間の速さを ×1 に戻す ----
let lastEnv = { inCloud: false, rain: 0, turbulence: 0, ice: false };
function watchFlight() {
  const f = flight;
  const notes: string[] = [];
  let urgent = false;
  for (const a of f.alerts) {
    notes.push(a.text);
    urgent ||= a.urgent;
  }
  f.alerts.length = 0;
  const e = f.env;
  const ice = f.condition.propIce > 5;
  if (e.inCloud && !lastEnv.inCloud) (notes.push("雲に入った！ 何も見えない"), (urgent = true));
  if (e.rain > 0 && lastEnv.rain === 0) notes.push(`雨の中に入った（強さ ${e.rain}）`);
  if (e.turbulence > 0 && lastEnv.turbulence === 0) (notes.push(`乱気流（強さ ${e.turbulence}）`), (urgent = true));
  if (ice && !lastEnv.ice) (notes.push("プロペラに着氷している"), (urgent = true));
  lastEnv = { inCloud: e.inCloud, rain: e.rain, turbulence: e.turbulence, ice };
  if (notes.length) toast(notes);
  if (urgent && speed > 1) setSpeed(1);
}

function setSpeed(v: number) {
  speed = v;
  document.querySelectorAll<HTMLElement>("[data-speed]").forEach((x) => x.classList.toggle("on", Number(x.dataset.speed) === v));
}

function setPaused(v: boolean) {
  paused = v;
  pauseBtn.textContent = paused ? "再開" : "一時停止";
  pauseBtn.classList.toggle("on", paused);
}
pauseBtn.addEventListener("click", () => running && setPaused(!paused));

document.querySelectorAll<HTMLButtonElement>("[data-speed]").forEach((b) =>
  b.addEventListener("click", () => setSpeed(Number(b.dataset.speed))),
);

$<HTMLInputElement>("#details").addEventListener("change", (e) => {
  showDetails = (e.target as HTMLInputElement).checked;
});

// ---- 短いお知らせ（画面の上に数秒だけ出す） ----
let toastTimer = 0;
function toast(lines: string[]) {
  if (!lines.length) return;
  const el = $("#toast");
  el.innerHTML = lines.map((l) => `<div>${l}</div>`).join("");
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 6000);
}

// ---- 流れ：格納庫 → 区間 → 経由地 → … → 目的地 ----
function goHangar() {
  running = false;
  campaign = null;
  legStart = null;
  flight = previewFlight();
  applyControls(75, 0, true);
  showHangar(world, (setup, difficulty, destination) => {
    campaign = startCampaign(world, setup, Date.now(), difficulty, destination);
    cockpit.setDifficulty(difficulty);
    departLeg();
  });
}

function departLeg() {
  const c = campaign!;
  legStart = snapshot(c);
  const { flight: f, notes } = beginLeg(c);
  flight = f;
  cockpit.setLeg(f.leg);
  applyControls(f.controls.throttle * 100, f.controls.mixture, true);
  closeDialog();
  running = true;
  setPaused(false);
  lastEnv = { inCloud: false, rain: 0, turbulence: 0, ice: false };
  toast([`${f.leg.from.name}を離陸。目標高度 ${f.controls.targetAltitude} m まで上昇する`, ...notes]);
}

function onFlightEnded() {
  running = false;
  const c = campaign!;
  const f = flight;
  if (f.status === "arrived" || f.status === "returned") {
    const arrival: ArrivalInfo = { result: evaluateFlight(f), flightMin: f.elapsedMin, fuelUsed: f.fuelUsed };
    finishLeg(c, f);
    if (isFinished(c)) showFinal();
    else showFieldScreen(arrival);
    return;
  }
  if (f.status === "propFailure" && c.spareAvailable) {
    const r = evaluateFlight(f);
    openDialog(
      `<h2 class="ng">${r.title}</h2>
      <p>${r.detail}</p>
      <p>でも、予備のプロペラを積んでいる。畑の持ち主に手伝ってもらって交換し、もう一度離陸できる（約3時間かかる）。</p>
      ${mechanicLine(r.mechanic)}
      <button class="primary" data-act="recover">予備のプロペラに交換して飛び続ける</button>`,
    );
    setActions({
      recover: () => {
        recoverWithSpare(c, f);
        closeDialog();
        running = true;
        setPaused(false);
        toast(["予備のプロペラに交換して、畑から離陸した"]);
      },
    });
    return;
  }
  showFailure();
}

function showFieldScreen(arrival?: ArrivalInfo) {
  showWaypoint(campaign!, { arrival, details: () => showDetails, onDepart: departLeg });
}

function showFailure() {
  const f = flight;
  const r = evaluateFlight(f);
  openDialog(
    `<h2 class="ng">${r.title}</h2>
    <p>${r.detail}</p>
    <table>
      <tr><td>区間</td><td>${f.leg.from.name} → ${f.leg.to.name}</td></tr>
      <tr><td>飛んだ距離</td><td>${f.distanceFlown.toFixed(0)} / ${f.leg.distanceKm} km</td></tr>
      <tr><td>飛行時間</td><td>${fmtDuration(f.elapsedMin)}</td></tr>
    </table>
    ${inspectionHtml(f.condition, { details: showDetails, plain: DIFFICULTY[campaign!.difficulty].plainInstruments, haste: f.pilot.haste })}
    ${mechanicLine(r.mechanic)}
    <div class="buttons-row">
      <button data-act="retry">この区間をやり直す（出発前に戻る）</button>
      <button class="primary" data-act="restart">格納庫からやり直す</button>
    </div>`,
  );
  setActions({
    retry: () => {
      campaign = snapshot(legStart!);
      flight = previewAt(campaign);
      showFieldScreen();
    },
    restart: goHangar,
  });
}

/** 経由地にいる間、背景に見せておく機体 */
function previewAt(c: CampaignState): FlightState {
  const { flight: f } = beginLeg(snapshot(c));
  return f;
}

function showFinal() {
  const c = campaign!;
  const totalMin = c.records.reduce((s, r) => s + r.flightMin, 0);
  const dest = field(world, world.goalId);
  // 実際に通った道順（引き返した区間は除く）
  const flown = c.records.filter((r) => !r.returned);
  const path = [world.startId, ...flown.map((r) => r.leg.to.id)].map((id) => field(world, id).name.replace("飛行場", ""));
  const ev = evaluateTrip(c);
  openDialog(
    `<h2 class="ok">${dest.name}に到着！</h2>
    <p>${path.join(" → ")}、${flown.length}区間・${flown.reduce((s, r) => s + r.leg.distanceKm, 0)} km の旅を終えた。</p>
    <div class="rank rank-${ev.rank}">
      <span class="rank-letter">${ev.rank}</span>
      <span><b>${ev.title}</b><br /><span class="rank-total">${ev.total} 点 / 100</span></span>
    </div>
    <table class="score">
      ${ev.lines
        .map(
          (l) => `<tr class="${l.points < 0 ? "minus" : ""}"><td>${l.label}<small>${l.detail}</small></td>
          <td>${l.points > 0 ? "+" : ""}${l.points}${l.max ? ` / ${l.max}` : ""}</td></tr>`,
        )
        .join("")}
    </table>
    ${mechanicLine(ev.comment)}

    <h3>4つの学び</h3>
    <ul class="lessons">${ev.lessons
      .map((l) => `<li class="${l.ok ? "ok" : "ng"}"><b>${l.ok ? "○" : "△"} ${l.title}</b><br />${l.text}</li>`)
      .join("")}</ul>

    <h3>旅の記録</h3>
    <table>
      <tr><td>難易度</td><td>${DIFFICULTY[c.difficulty].label}</td></tr>
      <tr><td>かかった日数</td><td>${c.day}日（${fmtClock(c.clockMin)} 着）</td></tr>
      <tr><td>飛行時間の合計</td><td>${fmtDuration(totalMin)}</td></tr>
      <tr><td>操縦者</td><td>疲労 ${Math.round(c.pilot.fatigue)}・焦り ${Math.round(c.pilot.haste)}</td></tr>
    </table>
    <h3>着いたときの機体</h3>
    ${inspectionHtml(c.condition, { details: showDetails, plain: DIFFICULTY[c.difficulty].plainInstruments })}
    <ul>${c.events.map((e) => `<li>${e}</li>`).join("")}</ul>
    ${mechanicLine("おつかれさん。帰ったら、トルク・傷・バランスを点検しておこう。")}
    <button class="primary" data-act="again">格納庫からもう一度</button>`,
    { wide: true },
  );
  setActions({ again: goHangar });
}

// ---- ループ ----
let last = performance.now();
function frame(now: number) {
  const realDt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const active = running && !paused;
  if (active) {
    stepFlight(flight, realDt * GAME_MINUTES_PER_SECOND * speed);
    watchFlight();
    if (flight.status !== "flying") onFlightEnded();
  }
  updateHud();
  sound.update(flight, active);
  if (view === "back" && backScene) backScene.draw(flight, realDt, active);
  else sideScene.draw(flight, realDt, active);
  routeBar.draw(flight);
  requestAnimationFrame(frame);
}

goHangar();
requestAnimationFrame(frame);
