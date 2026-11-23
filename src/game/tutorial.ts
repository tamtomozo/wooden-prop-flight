// チュートリアル：飛行中に一時停止して、操作ごとに「見る計器」と「正しい操作」を説明する。
// ここは説明の中身と、いつ出すかの判定だけ（画面は ui/tutorial.ts、流れは main.ts）。
//
//   順番の説明（scripted）… はじめの区間で、上から順に1つずつ。前の説明の「やってみよう」が済むまで次は出ない
//   場面の説明（event）  … 雨・雲・山・海・凍結など、はじめてその場面になったとき（どの区間でも、1回だけ）
import { CB_DANGER_KM, PILOT_YELLOW, REDLINE_RPM, VA_KMH, VIBRATION_YELLOW } from "../config";
import type { DifficultyRule } from "../data/difficulty";
import { mixturePoints } from "../model/physics";
import type { World } from "../model/types";
import { distanceLeft, intendedControls, overSea, terrainAt, type FlightState } from "./flight";
import { tr } from "../i18n";

/** 光らせる計器やボタンと、その説明 */
export interface TutorialMeter {
  /** 画面の要素（CSS セレクタ） */
  sel: string;
  name: string;
  text: string;
}

export interface TutorialTask {
  /** 再開したあと、画面に出しておく「やってみよう」 */
  text: string;
  done: (f: FlightState) => boolean;
}

export interface TutorialContext {
  rule: DifficultyRule;
  world: World;
  fuelCapacityL: number;
}

export interface TutorialStep {
  id: string;
  kind: "scripted" | "event";
  /** 命に関わる場面（間を空けずにすぐ出す。順番の説明より先） */
  urgent?: boolean;
  /** 前の説明から間を空けずに出す（上昇はすぐ終わるので、その間の説明） */
  noWait?: boolean;
  /** この説明が済んでから出す（場面の説明が、順番の説明を追い越さないように） */
  after?: string;
  title: string;
  /** 今なぜ止めたか */
  intro: (f: FlightState, t: TutorialContext) => string;
  meters: TutorialMeter[];
  /** 正しい操作（HTML。キーは <kbd>） */
  action: (f: FlightState, t: TutorialContext) => string;
  task?: TutorialTask;
  /** 出す場面になったか */
  when: (f: FlightState, t: TutorialContext) => boolean;
  /** 出す場面を過ぎてしまった（順番の説明だけ。出さずに次へ進む） */
  expired?: (f: FlightState, t: TutorialContext) => boolean;
  /** この難易度では説明しない（かんたんの自動操作など） */
  skip?: (t: TutorialContext) => boolean;
}

/** チュートリアルの進み具合（旅ごと） */
export interface TutorialState {
  /** 出した（または飛ばした）説明の id */
  seen: string[];
  /** 再開したあとの「やってみよう」 */
  task: { stepId: string; text: string } | null;
  /** 「説明をとばす」を押した */
  off: boolean;
}

export const newTutorial = (): TutorialState => ({ seen: [], task: null, off: false });

const kbd = (k: string) => `<kbd>${k}</kbd>`;

// ---- よく使う計器 ----
const M = {
  tach: {
    sel: "#g-tach",
    name: tr("回転計", "Tachometer"),
    text: tr(
      "エンジン（プロペラ）が1分に何回まわっているか。×100 rpm。赤い線（2700 rpm）を超えると、エンジンとプロペラが傷む。",
      "How many times a minute the engine (propeller) turns. ×100 rpm. Past the red line (2700 rpm), the engine and propeller get damaged.",
    ),
  },
  asi: {
    sel: "#g-asi",
    name: tr("対気速度計", "Airspeed indicator"),
    text: tr(
      `空気に対する速さ km/h。緑の帯がふつうの速さ。白い印（${VA_KMH} km/h）は、揺れているときに超えてはいけない速さ。`,
      `Speed through the air, km/h. The green band is normal speed. The white mark (${VA_KMH} km/h) is the speed not to exceed when it's rough.`,
    ),
  },
  alt: {
    sel: "#g-alt",
    name: tr("高度計", "Altimeter"),
    text: tr(
      "海の高さからの高度。×100 m（針が「12」なら 1200 m）。上の札は、上昇中・巡航中・降下中。",
      "Height above sea level. ×100 m (the needle on \"12\" means 1200 m). The tag on top says climbing, cruising or descending.",
    ),
  },
  egt: {
    sel: "#g-egt",
    name: tr("排気温度計", "EGT gauge"),
    text: tr(
      "エンジンから出るガスの温度。針の上の札が、燃料と空気の混ぜ方（濃い・最大出力・最良燃費・薄すぎ）を教えてくれる。",
      "The temperature of the exhaust gas. The tag above the needle tells you the fuel–air mixture (rich, best power, best economy, too lean).",
    ),
  },
  fuel: {
    sel: "#g-fuel",
    name: tr("燃料計", "Fuel gauge"),
    text: tr(
      "タンクに残っている燃料。E が空、F が満タン。黄色は半分より少ない、赤は残りわずか。",
      "Fuel left in the tank. E is empty, F is full. Yellow is less than half, red is almost gone.",
    ),
  },
  engine: {
    sel: "#g-engine",
    name: tr("エンジン計", "Engine gauge"),
    text: tr(
      "エンジンの調子。薄すぎる混ぜ方や回しすぎで下がる。黄色に入ったら無理をさせない。",
      "The engine's health. Running too lean or overspeeding lowers it. Once it's in the yellow, don't push it.",
    ),
  },
  throttle: {
    sel: ".lever.throttle",
    name: tr("スロットル", "Throttle"),
    text: tr(
      `エンジンの力。上が全開、下が絞る。${kbd("W")}${kbd("S")}（または ${kbd("↑")}${kbd("↓")}）で 5% ずつ。レバーをドラッグしてもいい。`,
      `Engine power. Up is full, down is idle. ${kbd("W")}${kbd("S")} (or ${kbd("↑")}${kbd("↓")}) move it 5% at a time. You can also drag the lever.`,
    ),
  },
  mixture: {
    sel: ".lever.mixture",
    name: tr("ミクスチャー", "Mixture"),
    text: tr(
      `燃料と空気の混ぜ方。上が濃い、下が薄い。${kbd("D")} で薄く、${kbd("A")} で濃く（押しっぱなしで続けて動く）。`,
      `The fuel–air mixture. Up is rich, down is lean. ${kbd("D")} leans, ${kbd("A")} enriches (hold the key to keep moving).`,
    ),
  },
  navAlt: {
    sel: "#nav-alt",
    name: tr("目標高度", "Target altitude"),
    text: tr(
      `${kbd("R")} で 100 m 上げる、${kbd("F")} で 100 m 下げる（▲▼ を押してもいい）。機体はその高さまで自動で上がり下がりする。`,
      `${kbd("R")} raises it 100 m, ${kbd("F")} lowers it 100 m (or press ▲▼). The plane climbs or descends to that height by itself.`,
    ),
  },
  navCourse: {
    sel: "#nav-course",
    name: tr("よける", "Dodge"),
    text: tr(
      `${kbd("Q")} で左へ、${kbd("E")} で右へ 10 km ずつコースからずれる。雲や積乱雲を横によける。`,
      `${kbd("Q")} moves you 10 km left of course, ${kbd("E")} 10 km right. Use it to go around cloud and thunderstorms.`,
    ),
  },
  range: {
    sel: "#kb-range",
    name: tr("届く距離", "Range"),
    text: tr(
      "今の燃料と燃費で、どこまで飛べるか。緑＝予備の燃料を残して着ける、黄＝ぎりぎり、赤＝届かない。",
      "How far you can fly on the current fuel and economy. Green = you arrive with the reserve left, yellow = just barely, red = you won't make it.",
    ),
  },
  eta: {
    sel: "#kb-eta",
    name: tr("到着予定", "ETA"),
    text: tr(
      "今の速さで着く時刻。日没までに着かないと危ない（夜は飛べない）。",
      "When you'll arrive at the current speed. Arriving after sunset is dangerous (you can't fly at night).",
    ),
  },
  ground: {
    sel: "#kb-ground",
    name: tr("対地速度", "Ground speed"),
    text: tr(
      "地面に対する速さ。向かい風だと遅く、追い風だと速い。",
      "Speed over the ground. Slower with a headwind, faster with a tailwind.",
    ),
  },
  ahead: {
    sel: "#kb-ahead",
    name: tr("前方の天気", "Weather ahead"),
    text: tr(
      "進む先 120 km の雲・雨・乱気流。予報の確率と、目で見えたもの。",
      "Cloud, rain and turbulence in the next 120 km. Forecast chances, and what you can see.",
    ),
  },
  routebar: {
    sel: "#routebar",
    name: tr("ルートバー", "Route bar"),
    text: tr(
      "この区間を横から見た図。機体の位置・高さと、前方の山・雲・海が見える。",
      "A side view of this leg. It shows where and how high the plane is, and the mountains, cloud and sea ahead.",
    ),
  },
  turnback: {
    sel: "#turnback",
    name: tr("引き返す", "Turn back"),
    text: tr(
      `${kbd("U")} で、出発した飛行場へ 180 度旋回して戻る。`,
      `${kbd("U")} turns you 180° and flies you back to the field you left.`,
    ),
  },
  carb: {
    sel: "#carbheat",
    name: tr("キャブヒート", "Carb heat"),
    text: tr(
      `${kbd("H")} で入れる・切る。キャブレター（燃料と空気を混ぜるところ）を温めて、氷を溶かす。`,
      `${kbd("H")} turns it on and off. It warms the carburetor (where fuel and air mix) to melt ice.`,
    ),
  },
  lamps: {
    sel: ".annunciators",
    name: tr("警告灯", "Warning lights"),
    text: tr(
      "異常が起きると光る。エンジン荒れ（薄すぎ）・燃料少・回転超過・振動・ボルト点検・キャブ凍結。",
      "They light up when something is wrong: rough engine (too lean), low fuel, overspeed, vibration, check bolts, carb ice.",
    ),
  },
  pilot: {
    sel: ".pilot",
    name: tr("疲労・焦り", "Fatigue / haste"),
    text: tr(
      "操縦者の調子。疲れると操作が遅れ、計器の読みがずれる。焦ると、整備士のひとことが甘く聞こえる。",
      "How the pilot is doing. When tired, your controls lag and you misread the gauges. When rushed, the mechanic's advice sounds too easygoing.",
    ),
  },
  pause: {
    sel: "#pause",
    name: tr("一時停止", "Pause"),
    text: tr(
      `${kbd("スペース")} でも止まる・動く。止まっているあいだも、レバーやボタンは動かせる。`,
      `${kbd("Space")} also pauses and resumes. While paused you can still move the levers and buttons.`,
    ),
  },
  speed: {
    sel: ".speed",
    name: tr("時間の速さ", "Time speed"),
    text: tr(
      "×1・×2・×4。長い巡航は速めてもいい。大事なことが起きると ×1 に戻る。",
      "×1, ×2, ×4. Speed up long cruises if you like. It drops back to ×1 when something important happens.",
    ),
  },
  radio: {
    sel: "#radio",
    name: tr("気象ラジオ", "Weather radio"),
    text: tr(
      `${kbd("P")} で、前方の予報を新しくする（積んでいるときだけ。一度使うと少し待つ）。`,
      `${kbd("P")} refreshes the forecast ahead (only if you carry one; after use you wait a while).`,
    ),
  },
} satisfies Record<string, TutorialMeter>;

/** 前方 km までのいちばん高い地面 */
export function terrainAhead(f: FlightState, km: number) {
  const dir = f.returning ? -1 : 1;
  let h = 0;
  for (let d = 0; d <= km; d += 2.5) h = Math.max(h, terrainAt(f.leg, f.distanceFlown + dir * d));
  return h;
}

/** 前方 km 以内にかかる山（尾根）のいちばん高いところ。なければ 0 */
export function ridgeAhead(f: FlightState, km: number) {
  let h = 0;
  for (const r of f.leg.terrain) {
    const near = f.returning ? f.distanceFlown - r.toKm : r.fromKm - f.distanceFlown;
    const inside = f.distanceFlown > r.fromKm && f.distanceFlown < r.toKm;
    if (inside || (near >= 0 && near <= km)) h = Math.max(h, r.height);
  }
  return h;
}

/** 前方 km 以内から海の上になる（または今、海の上） */
export function seaAhead(f: FlightState, km: number) {
  if (overSea(f)) return true;
  return f.leg.sea.some((r) => {
    const near = f.returning ? f.distanceFlown - r.toKm : r.fromKm - f.distanceFlown;
    return near >= 0 && near <= km;
  });
}

const flying = (f: FlightState) => f.status === "flying";
const cruising = (f: FlightState) => flying(f) && f.phase === "cruise" && !f.approach && !f.holding;
const mix = (f: FlightState) => mixturePoints(f.altitude);

export const TUTORIAL_STEPS: TutorialStep[] = [
  // =================== 順番の説明（はじめの区間） ===================
  {
    id: "welcome",
    kind: "scripted",
    noWait: true,
    title: tr("チュートリアルの進み方", "How the tutorial works"),
    intro: (f) => tr(
        `${f.leg.from.name}を離陸した。大事な操作のたびに、このように飛行を止めて説明する。光っているところが、今見る計器やボタンだ。`,
        `You took off from ${f.leg.from.name}. At each important step the flight pauses like this to explain. What's lit up is the gauge or button to look at now.`,
      ),
    meters: [M.pause, M.speed],
    action: () =>
      tr(
        `説明を読んだら「わかった」（${kbd("Enter")} か ${kbd("スペース")}）で飛行を再開する。止まっているあいだも操作はできるので、計器を見ながら試してから再開してもいい。`,
        `After reading, press "Got it" (${kbd("Enter")} or ${kbd("Space")}) to resume. You can still use the controls while paused, so feel free to try things while watching the gauges first.`,
      ),
    when: (f) => flying(f),
  },
  {
    id: "climb-throttle",
    kind: "scripted",
    noWait: true,
    title: tr("上昇はスロットル全開", "Climb at full throttle"),
    intro: (f) => tr(
        `今は目標高度 ${intendedControls(f).targetAltitude} m へ上昇中。上昇はエンジンの力をいちばん使う。`,
        `You're climbing to the target altitude of ${intendedControls(f).targetAltitude} m. Climbing takes the most engine power.`,
      ),
    meters: [M.throttle, M.tach, M.asi],
    action: (f) =>
      tr(
        `${kbd("W")} を何回か押して、スロットルを <b>100%（全開）</b> にする。回転計の針が上がり、上昇が速くなる。${
          f.setup.pitch <= 2
            ? `ただし今のプロペラは回りやすい上昇型（ピッチ ${f.setup.pitch}）。回転計の針が<b>赤い線</b>を超えたら、${kbd("S")} で1〜2回戻す。`
            : "回転計の針が赤い線を超えそうなら、少し戻す。"
        }`,
        `Press ${kbd("W")} a few times to set the throttle to <b>100% (full)</b>. The tachometer needle rises and you climb faster. ${
          f.setup.pitch <= 2
            ? `But this propeller is a climb type that spins up easily (pitch ${f.setup.pitch}). If the needle goes past the <b>red line</b>, press ${kbd("S")} once or twice to bring it back.`
            : "If the needle is about to pass the red line, back off a little."
        }`,
      ),
    task: {
      text: tr("スロットルを全開にする（回転計が赤い線に届くなら、その手前まで）", "Open the throttle fully (or just short of the red line on the tachometer)"),
      done: (f) => intendedControls(f).throttle >= 0.95 || f.perf.rpm >= REDLINE_RPM - 150,
    },
    when: (f) => flying(f) && f.phase === "climb",
    expired: (f) => f.phase !== "climb" || f.approach,
  },
  {
    id: "climb-mixture",
    kind: "scripted",
    noWait: true,
    title: tr("高く上がったら、混ぜ方を薄く", "Lean the mixture as you climb"),
    intro: (f) =>
      tr(
        `高度 ${Math.round(f.altitude)} m。高く上がるほど空気が薄くなり、同じ燃料の量では「濃すぎ」になる。濃すぎると力が出ず、燃料も食う。`,
        `Altitude ${Math.round(f.altitude)} m. The higher you go, the thinner the air, so the same amount of fuel becomes "too rich". Too rich means less power and more fuel burned.`,
      ),
    meters: [M.mixture, M.egt],
    action: () =>
      tr(
        `${kbd("D")} を押しっぱなしにして、ミクスチャーを薄くしていく。排気温度計の針の上の札が <b>「濃い」→「最大出力」</b> に変わったら止める。上昇中は「最大出力」がいい。`,
        `Hold ${kbd("D")} to lean the mixture. Stop when the tag above the EGT needle changes <b>from "Rich" to "Best power"</b>. "Best power" is right for climbing.`,
      ),
    task: { text: tr("排気温度計の札を「最大出力」にする（D で薄く）", "Set the EGT tag to \"Best power\" (D to lean)"), done: (f) => ["power", "economy"].includes(f.perf.mixture.zone) },
    when: (f) => flying(f) && f.phase === "climb" && f.altitude > f.leg.from.elevation + 300,
    expired: (f) => f.phase !== "climb" || f.approach,
    skip: (t) => t.rule.autoMixture,
  },
  {
    id: "altitude",
    kind: "scripted",
    title: tr("高度は目標を決めるだけ", "For altitude, just set a target"),
    intro: (f) =>
      tr(
        `高度計の針が目標高度 ${intendedControls(f).targetAltitude} m で止まり、上の札が「巡航中」になった。目標高度は、この区間のすすめの巡航高度に合わせてある。`,
        `The altimeter has settled at the target of ${intendedControls(f).targetAltitude} m and the tag says "Cruising". The target is set to the suggested cruise altitude for this leg.`,
      ),
    meters: [M.alt, M.navAlt],
    action: () =>
      tr(
        `ふだんはこのままでいい。<b>前方に山があるとき</b>は上げ、<b>雲にぶつかりそうなとき</b>や<b>プロペラが凍りそうなとき</b>は ${kbd("R")} / ${kbd("F")} で変える。高さによって風の強さも変わる（高いほど強いことが多い）。`,
        `Usually you can leave it. Raise it <b>when there are mountains ahead</b>, and change it with ${kbd("R")} / ${kbd("F")} <b>when you're about to hit cloud</b> or <b>the propeller might ice up</b>. The wind changes with height too (often stronger higher up).`,
      ),
    when: (f) => cruising(f),
  },
  {
    id: "cruise-throttle",
    kind: "scripted",
    title: tr("巡航ではスロットルを絞る", "Throttle back for cruise"),
    intro: (f) => tr(
        `目標高度 ${Math.round(f.altitude)} m に着いて、巡航に入った。全開のままだと燃料をたくさん食い、エンジンも傷む。`,
        `You've reached ${Math.round(f.altitude)} m and are cruising. Staying at full throttle burns a lot of fuel and wears the engine.`,
      ),
    meters: [M.throttle, M.tach, M.ground],
    action: () =>
      tr(
        `${kbd("S")} を何回か押して、スロットルを <b>70〜75%</b> くらいにする。速さは少し落ちるが、遠くまで飛べる。日没に間に合わないときだけ上げる。`,
        `Press ${kbd("S")} a few times to set the throttle to about <b>70–75%</b>. You'll be a little slower but fly much farther. Only push it up if you won't make it before sunset.`,
      ),
    task: { text: tr("スロットルを 75% 以下に絞る（S）", "Throttle back to 75% or less (S)"), done: (f) => intendedControls(f).throttle <= 0.8 },
    when: (f) => cruising(f),
  },
  {
    id: "cruise-mixture",
    kind: "scripted",
    title: tr("巡航は「最良燃費」の混ぜ方", "Cruise at \"Best economy\""),
    intro: () => tr("巡航では、速さより燃費。混ぜ方をもう少し薄くすると、同じ燃料でずっと遠くまで飛べる。", "In cruise, economy matters more than speed. Lean the mixture a bit more and the same fuel takes you much farther."),
    meters: [M.mixture, M.egt, M.range],
    action: (f) =>
      tr(
        `${kbd("D")} で少しずつ薄くして、排気温度計の札を <b>「最良燃費」</b> にする（針がいちばん高く上がるあたり。今の高さならミクスチャー ${Math.round(mix(f).bestEconomy)} くらい）。薄くしすぎて札が「薄すぎ」になり、警告灯「エンジン荒れ」が光ったら、${kbd("A")} で少し戻す。`,
        `Lean little by little with ${kbd("D")} until the EGT tag reads <b>"Best economy"</b> (around where the needle peaks; at this height, a mixture of about ${Math.round(mix(f).bestEconomy)}). If you go too far, the tag reads "Too lean" and the "Rough engine" light comes on; then back off a little with ${kbd("A")}.`,
      ),
    task: { text: tr("排気温度計の札を「最良燃費」にする（D で薄く）", "Set the EGT tag to \"Best economy\" (D to lean)"), done: (f) => f.perf.mixture.zone === "economy" },
    when: (f) => cruising(f),
    skip: (t) => t.rule.autoMixture,
  },
  {
    id: "fuel",
    kind: "scripted",
    title: tr("燃料は「届く距離」で見る", "Judge fuel by \"Range\""),
    intro: (f) => tr(
        `燃料は ${f.condition.fuelRemaining.toFixed(0)} L、${f.leg.to.name}まで残り ${distanceLeft(f).toFixed(0)} km。燃料計だけでは、着けるかどうかはわからない。`,
        `You have ${f.condition.fuelRemaining.toFixed(0)} L of fuel and ${distanceLeft(f).toFixed(0)} km to go to ${f.leg.to.name}. The fuel gauge alone can't tell you whether you'll make it.`,
      ),
    meters: [M.fuel, M.range, M.eta],
    action: () =>
      tr(
        `右上の飛行メモの <b>「届く距離」が緑</b>ならそのままでいい。<b>黄色・赤</b>になったら、スロットルを絞る・混ぜ方を「最良燃費」にする・向かい風の弱い高さを探す。それでも赤なら ${kbd("U")} で引き返す。<b>「到着予定」</b>が日没に近いときも同じ。`,
        `If <b>"Range" is green</b> on the flight notes (top right), carry on. If it turns <b>yellow or red</b>, throttle back, set the mixture to "Best economy", and look for a height with less headwind. If it's still red, turn back with ${kbd("U")}. Same when the <b>"ETA"</b> is close to sunset.`,
      ),
    when: (f) => cruising(f),
  },
  {
    id: "lamps",
    kind: "scripted",
    title: tr("警告灯と、操縦者の調子", "Warning lights and the pilot"),
    intro: () => tr("計器盤の右側には、異常を知らせる警告灯と、操縦者の疲れ・焦りがある。", "On the right of the panel are the warning lights, and the pilot's fatigue and haste."),
    meters: [M.lamps, M.engine, M.pilot],
    action: () =>
      tr(
        `警告灯が光ったら、まず整備士のひとこと（景色の下）を読む。<b>エンジン荒れ</b>→ ${kbd("A")} で濃く。<b>回転超過</b>→ ${kbd("S")} で絞る。<b>振動</b>→ 出力を絞って次の飛行場で点検。疲労が黄色になったら、次の飛行場で休む。`,
        `When a light comes on, first read the mechanic's words (below the view). <b>Rough engine</b> → enrich with ${kbd("A")}. <b>Overspeed</b> → throttle back with ${kbd("S")}. <b>Vibration</b> → reduce power and inspect at the next field. When fatigue turns yellow, rest at the next field.`,
      ),
    when: (f) => cruising(f),
  },
  {
    id: "routebar",
    kind: "scripted",
    title: tr("前方を見る：ルートバーと前方の天気", "Look ahead: the route bar and weather ahead"),
    intro: (f) => tr(
        `${f.leg.to.name}まで残り ${distanceLeft(f).toFixed(0)} km。景色の下の帯で、この先に何があるかを見ておこう。`,
        `${distanceLeft(f).toFixed(0)} km to go to ${f.leg.to.name}. Use the strip below the view to see what's coming.`,
      ),
    meters: [M.routebar, M.ahead, M.speed],
    action: (_f, t) =>
      tr(
        `ルートバーで、前方の${t.world.tutorial === "sea" ? "海" : "山"}・雲と、自分の高さを見比べる。何もなければ ×2・×4 で時間を速めてもいい。大事なことが起きると、×1 に戻ってまた説明する。`,
        `On the route bar, compare the ${t.world.tutorial === "sea" ? "sea" : "mountains"} and cloud ahead with your own height. If nothing's coming, speed time up to ×2 or ×4. When something important happens it drops back to ×1 and explains again.`,
      ),
    when: (f) => cruising(f),
  },

  // =================== 場面の説明（はじめてその場面になったとき） ===================
  {
    id: "cloud",
    kind: "event",
    urgent: true,
    title: tr("雲の中に入った！", "You're in cloud!"),
    intro: () => tr("何も見えない。計器飛行の訓練がないので、雲の中に長くいると上下がわからなくなり、気づかないうちに旋回しながら落ちていく。", "You can't see a thing. Without instrument training, if you stay in cloud long you lose track of up and down and start spiraling down without noticing."),
    meters: [M.ahead, M.navAlt, M.navCourse, M.turnback],
    action: () =>
      tr(
        `すぐ雲から出る。雲の下へ ${kbd("F")}、上へ ${kbd("R")}、横へ ${kbd("Q")} / ${kbd("E")}、だめなら ${kbd("U")} で引き返す。ルートバーで雲の上下の高さを見て、近いほうへ。`,
        `Get out right away: below it with ${kbd("F")}, above it with ${kbd("R")}, sideways with ${kbd("Q")} / ${kbd("E")}, or turn back with ${kbd("U")}. Check the cloud's base and top on the route bar and go for the nearer one.`,
      ),
    task: { text: tr("雲から出る（高度を変える・よける・引き返す）", "Get out of the cloud (change altitude, dodge, or turn back)"), done: (f) => !f.env.inCloud },
    when: (f) => flying(f) && f.env.inCloud,
  },
  {
    id: "cb",
    kind: "event",
    urgent: true,
    title: tr("積乱雲が近い", "Thunderstorm close"),
    intro: (f) => tr(
        `積乱雲まで ${Math.round(f.env.cbDistance)} km。中は激しい上下の風とひょうで、木の機体はもたない。`,
        `${Math.round(f.env.cbDistance)} km to the thunderstorm. Inside are violent up- and downdrafts and hail; a wooden plane won't survive.`,
      ),
    meters: [M.ahead, M.navCourse, M.turnback],
    action: () => tr(
        `${CB_DANGER_KM} km 以上離れる。${kbd("Q")} / ${kbd("E")} で大きく横へよけるか、${kbd("U")} で引き返す。`,
        `Stay at least ${CB_DANGER_KM} km away. Dodge wide with ${kbd("Q")} / ${kbd("E")}, or turn back with ${kbd("U")}.`,
      ),
    task: { text: tr(
        `積乱雲から ${CB_DANGER_KM} km 以上離れる`,
        `Get at least ${CB_DANGER_KM} km from the thunderstorm`,
      ), done: (f) => f.env.cbDistance >= CB_DANGER_KM },
    when: (f) => flying(f) && f.env.cbDistance < CB_DANGER_KM + 15,
  },
  {
    id: "terrain",
    kind: "event",
    urgent: false,
    title: tr("前方に山がある", "Mountains ahead"),
    intro: (f) => tr(
        `この先に ${ridgeAhead(f, 45)} m の山なみがある。今の高度は ${Math.round(f.altitude)} m。`,
        `There's a ${ridgeAhead(f, 45)} m range ahead. You're at ${Math.round(f.altitude)} m.`,
      ),
    meters: [M.routebar, M.alt, M.navAlt],
    action: (f) =>
      tr(
        `目標高度を <b>山より 300 m 以上高く</b>（${Math.ceil((ridgeAhead(f, 45) + 300) / 100) * 100} m 以上）にして、山の手前で上がりきっておく。${kbd("R")} で上げ、スロットルは全開。高いほど空気が薄く、上昇がにぶくなるので早めに。上がりきれないときは引き返す。`,
        `Set the target altitude <b>at least 300 m above the mountains</b> (${Math.ceil((ridgeAhead(f, 45) + 300) / 100) * 100} m or more) and finish climbing before you reach them. Raise it with ${kbd("R")}, full throttle. The higher you go, the thinner the air and the slower the climb, so start early. If you can't get high enough, turn back.`,
      ),
    task: {
      text: tr("目標高度を山より 300 m 以上高くする（R）", "Set the target altitude 300 m or more above the mountains (R)"),
      done: (f) => intendedControls(f).targetAltitude >= ridgeAhead(f, 45) + 300 || ridgeAhead(f, 45) === 0,
    },
    when: (f) => flying(f) && !f.approach && ridgeAhead(f, 45) > 0,
  },
  {
    id: "terrain-low",
    kind: "event",
    urgent: true,
    title: tr("山に高度が足りない！", "Too low for the mountains!"),
    intro: (f) => tr(
        `前方の地面は ${Math.round(terrainAhead(f, 25))} m、今の高度は ${Math.round(f.altitude)} m。このままだとぶつかる。`,
        `The ground ahead rises to ${Math.round(terrainAhead(f, 25))} m and you're at ${Math.round(f.altitude)} m. You'll hit it like this.`,
      ),
    meters: [M.alt, M.navAlt, M.throttle, M.turnback],
    action: () => tr(
        `${kbd("R")} で目標高度を上げ、スロットルを全開にする。間に合いそうにないなら、${kbd("U")} ですぐ引き返す。`,
        `Raise the target altitude with ${kbd("R")} and open the throttle fully. If you won't make it, turn back with ${kbd("U")} right away.`,
      ),
    task: { text: tr("上昇するか、引き返す", "Climb or turn back"), done: (f) => f.returning || terrainAhead(f, 25) < f.altitude - 150 },
    // 山（尾根）が近いときだけ。離陸直後の、地面そのものの近さでは出さない
    when: (f) => flying(f) && !f.approach && ridgeAhead(f, 25) > 0 && terrainAhead(f, 25) > f.altitude - 150,
  },
  {
    id: "sea",
    kind: "event",
    title: tr("この先は海の上", "Over the sea ahead"),
    intro: () => tr("海の上でエンジンが止まったら、降りられる畑はない（着水になる）。予備のプロペラでの復帰もできない。", "If the engine stops over the sea, there's no field to land in (you ditch). You can't recover with a spare propeller either."),
    meters: [M.routebar, M.fuel, M.range, M.turnback],
    action: () =>
      tr(
        `ルートバーの <b>引き返し限界点</b>（ここを過ぎると、戻るだけの燃料がない地点）を見る。越える前に、届く距離が緑か、エンジン・振動の調子がいいかを確かめる。不安なら限界点の手前で ${kbd("U")} で引き返す。`,
        `Find the <b>point of no return</b> on the route bar (past it, you no longer have the fuel to get back). Before you cross it, check that Range is green and the engine and vibration are fine. If in doubt, turn back with ${kbd("U")} before you reach it.`,
      ),
    when: (f, t) => flying(f) && !!t.world.land && seaAhead(f, 25),
  },
  {
    id: "no-return",
    kind: "event",
    title: tr("引き返し限界点を越えた", "Past the point of no return"),
    intro: () => tr("ここからは、引き返しても出発地まで燃料がもたない。進むしかない。", "From here, the fuel won't last back to where you started. The only way is forward."),
    meters: [M.routebar, M.range, M.mixture],
    action: () => tr(`燃料を大事に使う。スロットルは 70% くらい、混ぜ方は「最良燃費」。届く距離が黄色になったら、向かい風の弱い高さを探す。`, `Make every drop count. Throttle around 70%, mixture at "Best economy". If Range turns yellow, look for a height with less headwind.`),
    when: (f) => flying(f) && f.pastNoReturn,
  },
  {
    id: "rain",
    kind: "event",
    title: tr("雨の中に入った", "Into the rain"),
    intro: () => tr("雨粒がプロペラの前縁（前のへり）を削る。回転が速いほど、強く当たってよく削れる。", "Raindrops wear away the propeller's leading edge. The faster it spins, the harder they hit and the more they wear."),
    meters: [M.throttle, M.tach, M.ahead],
    action: () => tr(
        `${kbd("S")} でスロットルを <b>70% 以下</b>に絞って、回転を下げる。雨を抜けたら元に戻していい。`,
        `Throttle back to <b>70% or less</b> with ${kbd("S")} to lower the RPM. Once you're out of the rain you can open it up again.`,
      ),
    task: { text: tr("雨の中ではスロットルを 70% 以下に（S）", "In rain, throttle at 70% or less (S)"), done: (f) => intendedControls(f).throttle <= 0.7 || f.env.rain === 0 },
    when: (f) => flying(f) && f.env.rain > 0,
  },
  {
    id: "turbulence",
    kind: "event",
    urgent: true,
    title: tr("乱気流で揺れている", "Turbulence"),
    intro: () => tr("速いまま揺られると、機体に大きな力がかかって壊れる。", "Getting shaken at high speed puts big loads on the airframe and breaks it."),
    meters: [M.asi, M.throttle],
    action: () => tr(
        `${kbd("S")} でスロットルを絞り、対気速度計の針を <b>白い印（${VA_KMH} km/h）より下</b>にする。`,
        `Throttle back with ${kbd("S")} until the airspeed needle is <b>below the white mark (${VA_KMH} km/h)</b>.`,
      ),
    task: { text: tr(
        `対気速度を ${VA_KMH} km/h 以下に（S）`,
        `Airspeed at ${VA_KMH} km/h or less (S)`,
      ), done: (f) => f.perf.airspeed <= VA_KMH || f.env.turbulence === 0 },
    when: (f) => flying(f) && f.env.turbulence > 0,
  },
  {
    id: "overspeed",
    kind: "event",
    urgent: true,
    title: tr("回転が上がりすぎている", "RPM too high"),
    intro: () => tr("回転計の針が赤い線を超えた。降下で速度が出たときや、全開のままのときに起きる。", "The tachometer needle is past the red line. It happens when you pick up speed in a descent, or stay at full throttle."),
    meters: [M.tach, M.lamps, M.throttle],
    action: () => tr(
        `${kbd("S")} でスロットルを絞って、針を緑の帯に戻す。`,
        `Throttle back with ${kbd("S")} to bring the needle back into the green.`,
      ),
    task: { text: tr("回転を赤い線より下に（S）", "RPM below the red line (S)"), done: (f) => f.perf.rpm <= REDLINE_RPM - 100 },
    when: (f) => flying(f) && f.perf.rpm > REDLINE_RPM,
  },
  {
    id: "descent",
    kind: "event",
    title: tr("着陸のための降下", "Descent for landing"),
    intro: (f) => tr(
        `${f.leg.to.name}が近づいた。着陸のための降下は自動でする。降りるときは速度が出て、回転も上がる。`,
        `${f.leg.to.name} is close. The descent for landing is automatic. Going down, speed builds and the RPM rises.`,
      ),
    meters: [M.tach, M.throttle, M.alt],
    action: () => tr(
        `回転計の針が黄色に近づいたら、${kbd("S")} でスロットルを絞る。あとは着くのを待つだけ。`,
        `When the tachometer needle nears the yellow, throttle back with ${kbd("S")}. Then just wait to arrive.`,
      ),
    task: { text: tr("降下中は回転を黄色の手前に（S）", "In the descent, keep RPM short of the yellow (S)"), done: (f) => f.perf.rpm <= REDLINE_RPM - 100 },
    when: (f) => flying(f) && f.approach,
  },
  {
    id: "lean",
    kind: "event",
    urgent: true,
    title: tr("混ぜ方が薄すぎる", "Mixture too lean"),
    intro: () => tr("エンジンが荒れて、力が急に落ちている。このままだとエンジンが傷む。", "The engine is running rough and power has suddenly dropped. Keep this up and the engine gets damaged."),
    meters: [M.mixture, M.egt, M.lamps],
    action: () => tr(
        `${kbd("A")} でミクスチャーを少し濃くして、排気温度計の札を「最良燃費」に戻す。`,
        `Enrich the mixture a little with ${kbd("A")} to get the EGT tag back to "Best economy".`,
      ),
    task: { text: tr("ミクスチャーを濃くする（A）", "Enrich the mixture (A)"), done: (f) => f.perf.mixture.zone !== "tooLean" },
    when: (f) => flying(f) && f.perf.mixture.zone === "tooLean",
    skip: (t) => t.rule.autoMixture,
  },
  {
    id: "carb-ice",
    kind: "event",
    title: tr("キャブレターが凍りはじめた", "Carburetor icing"),
    intro: () => tr("晴れていても湿った日は、キャブレターの中が冷えて氷がつく。回転がじわじわ下がっていく。", "Even in clear weather, on humid days the inside of the carburetor gets cold and ice forms. The RPM creeps down."),
    meters: [M.carb, M.tach],
    action: () => tr(
        `${kbd("H")} でキャブヒートを入れる。氷が溶けたら（回転が戻ったら）切る。入れっぱなしだと少し力が落ちる。`,
        `Turn on carb heat with ${kbd("H")}. When the ice has melted (the RPM comes back), turn it off. Leaving it on costs a little power.`,
      ),
    task: { text: tr("キャブヒートを入れる（H）", "Turn on carb heat (H)"), done: (f) => intendedControls(f).carbHeat },
    when: (f) => flying(f) && f.condition.carbIce > 3 && !f.controls.carbHeat,
    skip: (t) => t.rule.autoCarbHeat,
  },
  {
    id: "carb-off",
    kind: "event",
    title: tr("キャブヒートを切る", "Turn off carb heat"),
    intro: () => tr("キャブレターに氷はない（溶けた）。キャブヒートは入れっぱなしだと、温かい空気で力が少し落ちる。", "There's no ice in the carburetor (it melted). Leaving carb heat on feeds warm air and costs a little power."),
    meters: [M.carb, M.tach],
    action: () => tr(
        `${kbd("H")} でキャブヒートを切る。また回転が下がってきたら入れ直す。`,
        `Turn off carb heat with ${kbd("H")}. If the RPM starts dropping again, turn it back on.`,
      ),
    task: { text: tr("キャブヒートを切る（H）", "Turn off carb heat (H)"), done: (f) => !intendedControls(f).carbHeat },
    when: (f) => flying(f) && f.controls.carbHeat && f.condition.carbIce < 1,
    skip: (t) => t.rule.autoCarbHeat,
  },
  {
    id: "prop-ice",
    kind: "event",
    title: tr("プロペラに氷がついた", "Ice on the propeller"),
    intro: (f) => tr(
        `凍結高度（${f.weather.freezingLevel} m）より上は、氷点下。雲や雨の水がプロペラに凍りつき、重くなって振動が出る。`,
        `Above the freezing level (${f.weather.freezingLevel} m) it's below zero. Water from cloud and rain freezes onto the propeller, making it heavy and causing vibration.`,
      ),
    meters: [M.alt, M.navAlt, M.lamps],
    action: (f) => tr(
        `${kbd("F")} で目標高度を <b>${f.weather.freezingLevel} m より下</b>にする。下で氷が溶けるまで待つ。`,
        `Set the target altitude <b>below ${f.weather.freezingLevel} m</b> with ${kbd("F")}. Wait down there until the ice melts.`,
      ),
    task: { text: tr("凍結高度より下へ降りる（F）", "Descend below the freezing level (F)"), done: (f) => intendedControls(f).targetAltitude < f.weather.freezingLevel },
    when: (f) => flying(f) && f.condition.propIce > 3,
  },
  {
    id: "vibration",
    kind: "event",
    title: tr("振動が出ている", "Vibration"),
    intro: () => tr("警告灯「振動」が光った。ボルトのゆるみ、前縁の傷、プロペラの氷が原因になる。ひどくなるとプロペラが割れる。", "The \"Vibration\" light is on. Loose bolts, a nicked leading edge or ice on the propeller cause it. If it gets bad, the propeller cracks."),
    meters: [M.lamps, M.throttle],
    action: () => tr(`出力を少し絞って、次の飛行場で「機体の点検」を見る。ボルトがゆるんでいたら締め直す。`, `Reduce power a little, and check "Inspection" at the next field. If the bolts are loose, re-tighten them.`),
    when: (f) => flying(f) && f.condition.vibration >= VIBRATION_YELLOW,
  },
  {
    id: "low-fuel",
    kind: "event",
    urgent: true,
    title: tr("このままでは届かない", "You won't make it like this"),
    intro: (f) => tr(
        `届く距離が残りの ${distanceLeft(f).toFixed(0)} km より短くなった。`,
        `Your range is now shorter than the ${distanceLeft(f).toFixed(0)} km left.`,
      ),
    meters: [M.range, M.fuel, M.throttle, M.turnback],
    action: () =>
      tr(
        `スロットルを絞り、混ぜ方を「最良燃費」に。向かい風が強いなら高さを変えてみる。それでも赤のままなら、${kbd("U")} で引き返すのが正しい判断だ。`,
        `Throttle back and set the mixture to "Best economy". If the headwind is strong, try another height. If it's still red, turning back with ${kbd("U")} is the right call.`,
      ),
    after: "fuel",
    when: (f) => flying(f) && !f.approach && f.phase !== "climb" && f.perf.rangeKm < distanceLeft(f),
  },
  {
    id: "fatigue",
    kind: "event",
    title: tr("操縦者が疲れてきた", "The pilot is getting tired"),
    intro: () => tr("長く飛ぶと疲れがたまる。疲れると、操作が効くまで時間がかかり、計器の読みもずれる。", "Long flights build up fatigue. When you're tired, the controls take longer to respond and you misread the gauges."),
    meters: [M.pilot],
    action: () => tr("次の飛行場で「休む」。泊まって翌朝出るのも、立派な判断だ。", "\"Rest\" at the next field. Staying the night and leaving the next morning is a fine decision."),
    when: (f) => flying(f) && f.pilot.fatigue >= PILOT_YELLOW,
  },
];

const stepById = (id: string) => TUTORIAL_STEPS.find((s) => s.id === id);

/**
 * 今出す説明。なければ null。
 * 出せない（難易度で飛ばす・場面を過ぎた）順番の説明は、ここで「出した」ことにして次へ進む。
 * cooled：前の説明から間が空いた（急ぎでない説明は、間が空くまで待つ）
 */
export function nextTutorialStep(t: TutorialState, f: FlightState, ctx: TutorialContext, cooled = true): TutorialStep | null {
  if (t.off || f.status !== "flying") return null;
  const started = t.seen.includes("welcome");
  // 場面の説明（急ぎのものを先に）
  if (started) {
    const events = TUTORIAL_STEPS.filter(
      (s) =>
        s.kind === "event" &&
        !t.seen.includes(s.id) &&
        (!s.after || t.seen.includes(s.after)) &&
        !s.skip?.(ctx) &&
        s.when(f, ctx),
    );
    const pick = events.find((s) => s.urgent) ?? (cooled ? events[0] : undefined);
    if (pick) return pick;
  }
  // 順番の説明：「やってみよう」が済むまで次は出さない
  if (t.task) return null;
  for (const s of TUTORIAL_STEPS) {
    if (s.kind !== "scripted" || t.seen.includes(s.id)) continue;
    if (s.skip?.(ctx) || s.expired?.(f, ctx)) {
      t.seen.push(s.id);
      continue;
    }
    return s.when(f, ctx) && (cooled || s.noWait) ? s : null;
  }
  return null;
}

/** 説明を出した。やってみようが残るなら覚えておく（もう済んでいれば残さない） */
export function markShown(t: TutorialState, step: TutorialStep, f: FlightState) {
  if (!t.seen.includes(step.id)) t.seen.push(step.id);
  t.task = step.task && !step.task.done(f) ? { stepId: step.id, text: step.task.text } : null;
}

/** 「やってみよう」が済んだら true（そのとき task を消す） */
export function checkTask(t: TutorialState, f: FlightState): boolean {
  if (!t.task) return false;
  const step = stepById(t.task.stepId);
  if (!step?.task || step.task.done(f)) {
    t.task = null;
    return true;
  }
  return false;
}

/** 順番の説明のうち、いくつ目か（見出しの「3 / 9」用。場面の説明は null） */
export function scriptedIndex(step: TutorialStep): { n: number; of: number } | null {
  const list = TUTORIAL_STEPS.filter((s) => s.kind === "scripted");
  const i = list.indexOf(step);
  return i < 0 ? null : { n: i + 1, of: list.length };
}
