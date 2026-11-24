import "./style.css";
import { localizeStatic, plural, tr } from "./i18n";

localizeStatic();
import { GAME_MINUTES_PER_SECOND, HASTE_RELIEF, RESERVE_FUEL_L } from "./config";
import { DIFFICULTY } from "./data/difficulty";
import { NO_EQUIPMENT } from "./data/equipment";
import { courseById } from "./data/courses";
import { field, legBetween, seaKm } from "./data/world";
import {
  beginLeg,
  canRecoverWithSpare,
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
import { autopilot } from "./game/planner";
import { recommendSetup } from "./game/recommend";
import { showAchievementPopups } from "./ui/achievementPopup";
import { courseLabel, nextStep, parseProgress, recordTrip, type Progress } from "./game/records";
import {
  canReturn,
  clockMin,
  createFlight,
  evaluateFlight,
  intendedControls,
  intendedLateral,
  requestControls,
  requestLateral,
  returnFuelNeeded,
  setControls,
  stepFlight,
  turnBack,
  useRadio,
  type FlightState,
} from "./game/flight";
import { createRng } from "./model/physics";
import type { Setup, World } from "./model/types";
import { showCourseSelect } from "./ui/courseSelect";
import { showTitle } from "./ui/titleScreen";
import { closeDialog, fmtDuration, mechanicLine, openDialog, setActions } from "./ui/dialog";
import { inspectionHtml } from "./ui/inspection";
import { showHangar } from "./ui/hangar";
import { CockpitPanel, fmtClock, PHASE_LABEL } from "./ui/panel";
import { RouteBar } from "./ui/routeBar";
import { setHtml, setText } from "./ui/dom";
import { BackScene } from "./ui/scene3d";
import { Sound } from "./ui/sound";
import { showWaypoint, type ArrivalInfo } from "./ui/waypoint";
import { checkTask, markShown, newTutorial, nextTutorialStep, type TutorialContext, type TutorialState } from "./game/tutorial";
import { TutorialView } from "./ui/tutorial";

const $ = <T extends HTMLElement = HTMLElement>(sel: string) => document.querySelector<T>(sel)!;

// ---- 状態 ----
const COURSE_KEY = "plane.course";
let savedCourse: string | null = null;
try {
  savedCourse = localStorage.getItem(COURSE_KEY);
} catch {
  /* 読めなければ最初のコース */
}
// ---- 旅をまたいで残る記録（自己ベスト・実績）。保存できなくても遊べる ----
const PROGRESS_KEY = "plane.progress";
let progress: Progress = parseProgress(null);
try {
  progress = parseProgress(localStorage.getItem(PROGRESS_KEY));
} catch {
  /* 読めなければ空の記録 */
}
function saveProgress() {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(progress));
  } catch {
    /* 保存できなくても遊べる */
  }
}

/** 選んでいるコース（旅の舞台） */
let world: World = courseById(savedCourse ?? "");
let campaign: CampaignState | null = null;
/** 区間を出発する直前の状態（「この区間をやり直す」用） */
let legStart: CampaignState | null = null;
let flight: FlightState = previewFlight();
let running = false;
/** コース選びの後ろで、機体をひとりでに飛ばして見せている */
let attract = false;
let paused = false;
let speed = 1;
/** チュートリアルのコースを飛んでいるあいだの進み具合（それ以外は null） */
let tutorial: TutorialState | null = null;
const tutView = new TutorialView();
/** 急ぎでない説明は、前の説明からこの時刻（performance.now）まで出さない */
let tutCooldownUntil = 0;
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

// ---- 景色（機体を後ろから追いかける3D） ----
const routeBar = new RouteBar($<HTMLCanvasElement>("#routebar"));
let backScene: BackScene | null = null;
try {
  backScene = new BackScene($<HTMLCanvasElement>("#scene3d"));
} catch {
  // WebGL が使えない環境では景色を出さない（計器とルートバーだけで飛べる）
  $(".stage").insertAdjacentHTML("afterbegin", tr(`<p class="no-webgl">この環境では3Dの景色を表示できません（WebGL が使えません）。計器とルートバーで飛べます。</p>`, `<p class="no-webgl">This browser cannot show the 3D view (WebGL is not available). You can still fly with the gauges and the route bar.</p>`));
}

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
  soundBtn.textContent = on ? tr("音：オン", "Sound: on") : tr("音：オフ", "Sound: off");
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

function updateHud() {
  const f = flight;
  // 毎フレーム呼ばれるので、変わったところだけ書き換える（dom.ts）
  setHtml($("#route"), `${f.leg.from.name}<span class="arrow">→</span>${f.leg.to.name}`);
  setText($("#clock"), fmtClock(campaign && !running && isDialogShowingField() ? campaign.clockMin : clockMin(f)));
  setText($("#day"), tr(`${campaign?.day ?? 1}日目`, `Day ${campaign?.day ?? 1}`));
  const w = Math.round(f.env.headwind);
  setText($("#hud-wind"), w >= 0 ? tr(`向かい風 ${w} km/h`, `Headwind ${w} km/h`) : tr(`追い風 ${-w} km/h`, `Tailwind ${-w} km/h`));
  setText($("#hud-alt"), `${tr("高度", "Alt")} ${Math.round(f.altitude)} m${tr("・", " · ")}${f.holding ? tr("霧で待機中", "Holding for fog") : f.returning ? tr("引き返し中", "Turning back") : PHASE_LABEL[f.phase]}`);
  setText($("#hud-oat"), tr(`外気温 ${Math.round(f.env.temp)}℃`, `OAT ${Math.round(f.env.temp)}°C`));
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
  // チュートリアルの説明が出ているあいだは、Enter / スペースで「わかった」（飛行を再開）
  if (tutView.isOpen() && (e.key === " " || e.key === "Enter")) {
    e.preventDefault();
    tutView.close();
    return;
  }
  const want = intendedControls(flight);
  const t = Math.round(want.throttle * 100);
  const m = want.mixture;
  switch (e.key.toLowerCase()) {
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
  const need = returnFuelNeeded(f);
  // 海の上の区間では、戻るだけの燃料があるかを見せる（引き返し限界点）
  const fuelCheck = f.leg.sea.length
    ? `<p class="${canReturn(f) ? "ok" : "ng"}">${tr(
        `戻るのに要る燃料の見積もり：約 ${need.toFixed(0)} L（予備 ${RESERVE_FUEL_L} L は別）。`,
        `Estimated fuel to get back: about ${need.toFixed(0)} L (plus the ${RESERVE_FUEL_L} L reserve). `,
      )}${
        canReturn(f)
          ? tr("まだ戻れる。", "You can still make it back.")
          : f.condition.fuelRemaining >= need
            ? tr("戻れても、予備燃料はほとんど残らない。", "You might make it back, but with almost no reserve left.")
            : tr("<b>引き返し限界点を越えている。戻る途中で燃料が尽きる。</b>", "<b>You are past the point of no return. The fuel will run out on the way back.</b>")
      }</p>`
    : "";
  openDialog(
    `<h2>${tr("引き返しますか？", "Turn back?")}</h2>
    <p>${tr(
      `180度旋回して、${f.leg.from.name}へ戻ります。ここまで ${f.distanceFlown.toFixed(0)} km 飛んできた。燃料は ${f.condition.fuelRemaining.toFixed(1)} L。`,
      `Turn 180° and fly back to ${f.leg.from.name}. You have flown ${f.distanceFlown.toFixed(0)} km so far. Fuel: ${f.condition.fuelRemaining.toFixed(1)} L.`,
    )}</p>
    ${fuelCheck}
    <p class="small">${tr(
      `勇気ある撤退：焦りが ${HASTE_RELIEF} 下がり、最後の評価でボーナスがつく。`,
      `A brave retreat: haste drops by ${HASTE_RELIEF}, and you get a bonus in the final score.`,
    )}</p>
    ${mechanicLine(tr("一番大事なのは引き返す勇気だ。降りて待つのも正しい判断だぞ。", "The most important thing is the courage to turn back. Landing and waiting is a right call too."))}
    <div class="buttons-row">
      <button data-act="cancel">${tr("このまま進む", "Keep going")}</button>
      <button class="primary" data-act="turn">${tr("引き返す", "Turn back")}</button>
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
  if (e.inCloud && !lastEnv.inCloud) (notes.push(tr("雲に入った！ 何も見えない", "Into the cloud! You can't see a thing")), (urgent = true));
  if (e.rain > 0 && lastEnv.rain === 0) notes.push(tr(`雨の中に入った（強さ ${e.rain}）`, `Into the rain (strength ${e.rain})`));
  if (e.turbulence > 0 && lastEnv.turbulence === 0) (notes.push(tr(`乱気流（強さ ${e.turbulence}）`, `Turbulence (strength ${e.turbulence})`)), (urgent = true));
  if (ice && !lastEnv.ice) (notes.push(tr("プロペラに着氷している", "Ice is building up on the propeller")), (urgent = true));
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
  pauseBtn.textContent = paused ? tr("再開", "Resume") : tr("一時停止", "Pause");
  pauseBtn.classList.toggle("on", paused);
}
pauseBtn.addEventListener("click", () => {
  if (!running) return;
  if (tutView.isOpen()) tutView.close();
  else setPaused(!paused);
});

// ---- チュートリアル：場面ごとに止めて、見る計器と正しい操作を説明する ----
function tutorialContext(): TutorialContext {
  const c = campaign!;
  return { rule: DIFFICULTY[c.difficulty], world: c.world, fuelCapacityL: c.world.fuelCapacityL };
}

function tickTutorial(now: number) {
  const t = tutorial;
  if (!t || !campaign || flight.status !== "flying") return;
  if (checkTask(t, flight)) {
    tutView.taskDone();
    tutCooldownUntil = now + 2500;
  }
  if (tutView.isOpen()) return;
  const ctx = tutorialContext();
  const step = nextTutorialStep(t, flight, ctx, now >= tutCooldownUntil);
  if (!step) return;
  markShown(t, step, flight);
  setPaused(true);
  setSpeed(1);
  tutView.setTask(null);
  tutView.show(step, flight, ctx, {
    onClose: () => {
      setPaused(false);
      tutView.setTask(t.task?.text ?? null);
      tutCooldownUntil = performance.now() + 3500;
    },
    onSkipAll: () => {
      t.off = true;
      t.task = null;
      tutView.setTask(null);
      setPaused(false);
      toast([tr("チュートリアルの説明をとばした。この旅では、もう止まらない", "Tutorial explanations skipped. The flight won't stop again on this trip")]);
    },
  });
}

/** チュートリアルの画面を片づける（旅の進み具合は残す） */
function clearTutorialView() {
  tutView.hide();
  tutView.setTask(null);
  if (tutorial) tutorial.task = null;
}

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

// ---- 流れ：タイトル → コース → 格納庫 → 区間 → 経由地 → … → 目的地 ----
/** 旅を片づけて、後ろの景色で機体をひとりでに飛ばす（タイトルとコース選び） */
function startAttract() {
  running = false;
  campaign = null;
  clearTutorialView();
  tutorial = null;
  legStart = null;
  // 後ろの景色：選んでいるコースの最初の区間を、機体がひとりでに飛んでいく
  flight = previewFlight();
  attract = true;
}

function goTitle() {
  startAttract();
  closeDialog();
  showTitle(chooseCourse, progress);
}

function chooseCourse() {
  if (!attract) startAttract();
  showCourseSelect({
    onChoose: (w) => {
      selectWorld(w);
      goHangar();
    },
    onQuick: quickStart,
    onTitle: goTitle,
    current: world.id,
    progress,
  });
}

function selectWorld(w: World) {
  world = w;
  savedCourse = w.id;
  try {
    localStorage.setItem(COURSE_KEY, w.id);
  } catch {
    /* 保存できなくても遊べる */
  }
}

/** 格納庫を飛ばして、整備士のおすすめセッティング（ふつう）ですぐ出発する */
function quickStart(w: World) {
  selectWorld(w);
  attract = false;
  $("#sunset").textContent = fmtClock(world.sunsetMin);
  const destination = suggestedDestination(world, world.startId);
  const rec = recommendSetup(world, destination, "normal");
  const setup: Setup = { pitch: rec.pitch, fuelPercent: rec.fuelPercent, torqueResult: "ok", equipment: rec.equipment };
  campaign = startCampaign(world, setup, Date.now(), "normal", destination);
  tutorial = world.tutorial ? newTutorial() : null;
  cockpit.setDifficulty("normal");
  cockpit.setFuelCapacity(world.fuelCapacityL);
  departLeg([
    tr(
      "整備士のおすすめセッティングで出発。ボルトは整備士が締めておいた（経由地からは自分で締める）",
      "Off with the mechanic's recommended setup. The mechanic tightened the bolts (from the next stop on, you do it yourself)",
    ),
    tr("W / S でスロットル、A / D でミクスチャー。スペースで一時停止", "W / S: throttle, A / D: mixture. Space: pause"),
  ]);
}

function goHangar() {
  running = false;
  attract = false;
  campaign = null;
  clearTutorialView();
  tutorial = null;
  legStart = null;
  flight = previewFlight();
  $("#sunset").textContent = fmtClock(world.sunsetMin);
  applyControls(75, 0, true);
  // 格納庫で見せる予報と、出発してからの天気を同じにするため、旅の乱数の種はここで決める
  const seed = Date.now();
  cockpit.setFuelCapacity(world.fuelCapacityL);
  showHangar({
    world,
    seed,
    progress,
    // 増設タンクを積んだときは、タンクの大きい舞台（w）で旅をする
    onDepart: (setup, difficulty, destination, w) => {
      campaign = startCampaign(w, setup, seed, difficulty, destination);
      tutorial = w.tutorial ? newTutorial() : null;
      cockpit.setDifficulty(difficulty);
      cockpit.setFuelCapacity(w.fuelCapacityL);
      departLeg();
    },
    onChangeCourse: chooseCourse,
  });
}

function departLeg(extraNotes: string[] = []) {
  const c = campaign!;
  legStart = snapshot(c);
  const { flight: f, notes } = beginLeg(c);
  flight = f;
  cockpit.setLeg(f.leg);
  applyControls(f.controls.throttle * 100, f.controls.mixture, true);
  closeDialog();
  clearTutorialView();
  running = true;
  setPaused(false);
  lastEnv = { inCloud: false, rain: 0, turbulence: 0, ice: false };
  toast([
    tr(
      `${f.leg.from.name}を離陸。目標高度 ${f.controls.targetAltitude} m まで上昇する`,
      `Took off from ${f.leg.from.name}. Climbing to ${f.controls.targetAltitude} m`,
    ),
    ...extraNotes,
    ...notes,
  ]);
}

function onFlightEnded() {
  running = false;
  clearTutorialView();
  const c = campaign!;
  const f = flight;
  if (f.status === "arrived" || f.status === "returned") {
    const arrival: ArrivalInfo = { result: evaluateFlight(f), flightMin: f.elapsedMin, fuelUsed: f.fuelUsed };
    finishLeg(c, f);
    if (isFinished(c)) showFinal();
    else showFieldScreen(arrival);
    return;
  }
  if (canRecoverWithSpare(c, f)) {
    const r = evaluateFlight(f);
    openDialog(
      `<h2 class="ng">${r.title}</h2>
      <p>${r.detail}</p>
      <p>${tr(
        "でも、予備のプロペラを積んでいる。畑の持ち主に手伝ってもらって交換し、もう一度離陸できる（約3時間かかる）。",
        "But you carry a spare propeller. With the farmer's help you can swap it and take off again (about 3 hours).",
      )}</p>
      ${mechanicLine(r.mechanic)}
      <button class="primary" data-act="recover">${tr("予備のプロペラに交換して飛び続ける", "Fit the spare propeller and fly on")}</button>`,
    );
    setActions({
      recover: () => {
        recoverWithSpare(c, f);
        closeDialog();
        running = true;
        setPaused(false);
        toast([tr("予備のプロペラに交換して、畑から離陸した", "Fitted the spare propeller and took off from the field")]);
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
      <tr><td>${tr("区間", "Leg")}</td><td>${f.leg.from.name} → ${f.leg.to.name}</td></tr>
      <tr><td>${tr("飛んだ距離", "Distance flown")}</td><td>${f.distanceFlown.toFixed(0)} / ${f.leg.distanceKm} km</td></tr>
      <tr><td>${tr("飛行時間", "Flight time")}</td><td>${fmtDuration(f.elapsedMin)}</td></tr>
    </table>
    ${inspectionHtml(f.condition, { details: showDetails, plain: DIFFICULTY[campaign!.difficulty].plainInstruments, haste: f.pilot.haste })}
    ${mechanicLine(r.mechanic)}
    <div class="buttons-row">
      <button data-act="retry">${tr("この区間をやり直す（出発前に戻る）", "Retry this leg (back to before departure)")}</button>
      <button class="primary" data-act="restart">${tr("格納庫からやり直す", "Start over from the hangar")}</button>
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
  const path = [world.startId, ...flown.map((r) => r.leg.to.id)].map((id) => field(world, id).name.replace(tr("飛行場", " Field"), ""));
  const ev = evaluateTrip(c);
  const seaFlown = flown.reduce((s, r) => s + seaKm(r.leg), 0);
  // 記録に残す（自己ベスト・実績）
  const rec = recordTrip(progress, c, ev);
  progress = rec.progress;
  saveProgress();
  const next = nextStep(world, ev, progress);
  openDialog(
    `<h2 class="ok">${tr(`${dest.name}に到着！`, `Arrived at ${dest.name}!`)}</h2>
    <p><b>${world.title}</b>${tr("：", ": ")}${path.join(" → ")}${tr(
      `、${flown.length}区間・${flown.reduce((s, r) => s + r.leg.distanceKm, 0)} km の旅を終えた。`,
      `. You finished a ${flown.reduce((s, r) => s + r.leg.distanceKm, 0)} km trip in ${plural(flown.length, "leg")}. `,
    )}${seaFlown > 0 ? tr(`そのうち海の上は ${seaFlown} km。`, `${seaFlown} km of it over the sea.`) : ""}</p>
    <div class="rank rank-${ev.rank}">
      <span class="rank-letter">${ev.rank}</span>
      <span><b>${ev.title}</b><br /><span class="rank-total">${ev.total} ${tr("点", "pts")} / 100</span></span>
    </div>
    <table class="score">
      ${ev.lines
        .map(
          (l) => `<tr class="${l.points < 0 ? "minus" : ""}"><td>${l.label}<small>${l.detail}</small></td>
          <td>${l.points > 0 ? "+" : ""}${l.points}${l.max ? ` / ${l.max}` : ""}</td></tr>`,
        )
        .join("")}
    </table>
    ${
      rec.newBest
        ? `<p class="new-best">${
            rec.previousBest
              ? tr(
                  `自己ベスト更新！（これまでは ${rec.previousBest.rank}・${rec.previousBest.total} 点）`,
                  `New personal best! (before: ${rec.previousBest.rank}, ${rec.previousBest.total} pts)`,
                )
              : tr("このコースをはじめて渡りきった！", "Your first time across this course!")
          }</p>`
        : `<p class="small">${tr(
            `このコースの自己ベストは ${progress.best[world.id].rank}・${progress.best[world.id].total} 点。`,
            `Your best on this course: ${progress.best[world.id].rank}, ${progress.best[world.id].total} pts.`,
          )}</p>`
    }
    ${mechanicLine(ev.comment)}
    ${
      rec.newAchievements.length
        ? `<div class="new-achievements"><h3>${tr("新しい実績", "New achievements")}</h3><ul>${rec.newAchievements
            .map((a) => `<li><b>${a.title}</b><small>${a.text}</small>${a.reward ? `<span class="reward">${a.reward}</span>` : ""}</li>`)
            .join("")}</ul></div>`
        : ""
    }

    <h3>${tr("4つの学び", "Four lessons")}</h3>
    <ul class="lessons">${ev.lessons
      .map((l) => `<li class="${l.ok ? "ok" : "ng"}"><b>${l.ok ? "○" : "△"} ${l.title}</b><br />${l.text}</li>`)
      .join("")}</ul>

    <h3>${tr("旅の記録", "Trip log")}</h3>
    <table>
      <tr><td>${tr("難易度", "Difficulty")}</td><td>${DIFFICULTY[c.difficulty].label}</td></tr>
      <tr><td>${tr("かかった日数", "Days taken")}</td><td>${tr(`${c.day}日（${fmtClock(c.clockMin)} 着）`, `${plural(c.day, "day")} (arrived ${fmtClock(c.clockMin)})`)}</td></tr>
      <tr><td>${tr("飛行時間の合計", "Total flight time")}</td><td>${fmtDuration(totalMin)}</td></tr>
      <tr><td>${tr("操縦者", "Pilot")}</td><td>${tr("疲労", "Fatigue")} ${Math.round(c.pilot.fatigue)}${tr("・焦り", " · Haste")} ${Math.round(c.pilot.haste)}</td></tr>
    </table>
    <h3>${tr("着いたときの機体", "The plane on arrival")}</h3>
    ${inspectionHtml(c.condition, { details: showDetails, plain: DIFFICULTY[c.difficulty].plainInstruments })}
    <ul>${c.events.map((e) => `<li>${e}</li>`).join("")}</ul>
    ${mechanicLine(tr("おつかれさん。帰ったら、トルク・傷・バランスを点検しておこう。", "Good work. Back home, let's check the torque, the nicks and the balance."))}
    <div class="next-step">
      <h3>${tr("次の旅", "Next trip")}</h3>
      ${mechanicLine(next.advice)}
      <div class="buttons-row">
        <button data-act="courses">${tr("別のコースを選ぶ", "Choose another course")}</button>
        <button class="${next.course ? "" : "primary"}" data-act="again">${tr("このコースをもう一度", "Fly this course again")}</button>
        ${
          next.course
            ? `<button class="primary" data-act="next">${tr(`次は ${courseLabel(next.course)} へ`, `Next: ${courseLabel(next.course)}`)}<small>${next.courseReason}</small></button>`
            : ""
        }
      </div>
    </div>`,
    { wide: true },
  );
  // 手に入れた実績は、画面のまん中に1つずつ知らせる（一覧は評価の下にも残す）
  showAchievementPopups(rec.newAchievements, () => sound.chime());
  setActions({
    again: goHangar,
    courses: chooseCourse,
    next: () => {
      selectWorld(next.course!);
      goHangar();
    },
  });
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
    else tickTutorial(now);
  } else if (attract) {
    // コース選びの後ろの景色：速めに飛ばし、区間が終わったら滑走路からやり直す
    autopilot(flight, 0.7);
    stepFlight(flight, realDt * GAME_MINUTES_PER_SECOND * 3);
    if (flight.status !== "flying") flight = previewFlight();
  }
  updateHud();
  sound.update(flight, active);
  backScene?.draw(flight, realDt, active || attract);
  routeBar.draw(flight);
  // 最初の景色を描き終えてから画面を見せる（index.html で隠してある）。
  // 景色や計器の大きさは最初のフレームのあとに届く（dom.ts）ので、2フレーム目で描き終わる
  if (framesDrawn < 2 && ++framesDrawn === 2) $("#app").classList.add("ready");
  requestAnimationFrame(frame);
}
let framesDrawn = 0;

goTitle();
requestAnimationFrame(frame);
// 景色の描画でつまずいても、画面が隠れたままにならないように
setTimeout(() => $("#app").classList.add("ready"), 3000);
