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
  tach: { sel: "#g-tach", name: "回転計", text: "エンジン（プロペラ）が1分に何回まわっているか。×100 rpm。赤い線（2700 rpm）を超えると、エンジンとプロペラが傷む。" },
  asi: { sel: "#g-asi", name: "対気速度計", text: `空気に対する速さ km/h。緑の帯がふつうの速さ。白い印（${VA_KMH} km/h）は、揺れているときに超えてはいけない速さ。` },
  alt: { sel: "#g-alt", name: "高度計", text: "海の高さからの高度。×100 m（針が「12」なら 1200 m）。上の札は、上昇中・巡航中・降下中。" },
  egt: { sel: "#g-egt", name: "排気温度計", text: "エンジンから出るガスの温度。針の上の札が、燃料と空気の混ぜ方（濃い・最大出力・最良燃費・薄すぎ）を教えてくれる。" },
  fuel: { sel: "#g-fuel", name: "燃料計", text: "タンクに残っている燃料。E が空、F が満タン。黄色は半分より少ない、赤は残りわずか。" },
  engine: { sel: "#g-engine", name: "エンジン計", text: "エンジンの調子。薄すぎる混ぜ方や回しすぎで下がる。黄色に入ったら無理をさせない。" },
  throttle: { sel: ".lever.throttle", name: "スロットル", text: `エンジンの力。上が全開、下が絞る。${kbd("W")}${kbd("S")}（または ${kbd("↑")}${kbd("↓")}）で 5% ずつ。レバーをドラッグしてもいい。` },
  mixture: { sel: ".lever.mixture", name: "ミクスチャー", text: `燃料と空気の混ぜ方。上が濃い、下が薄い。${kbd("D")} で薄く、${kbd("A")} で濃く（押しっぱなしで続けて動く）。` },
  navAlt: { sel: "#nav-alt", name: "目標高度", text: `${kbd("R")} で 100 m 上げる、${kbd("F")} で 100 m 下げる（▲▼ を押してもいい）。機体はその高さまで自動で上がり下がりする。` },
  navCourse: { sel: "#nav-course", name: "よける", text: `${kbd("Q")} で左へ、${kbd("E")} で右へ 10 km ずつコースからずれる。雲や積乱雲を横によける。` },
  range: { sel: "#kb-range", name: "届く距離", text: "今の燃料と燃費で、どこまで飛べるか。緑＝予備の燃料を残して着ける、黄＝ぎりぎり、赤＝届かない。" },
  eta: { sel: "#kb-eta", name: "到着予定", text: "今の速さで着く時刻。日没までに着かないと危ない（夜は飛べない）。" },
  ground: { sel: "#kb-ground", name: "対地速度", text: "地面に対する速さ。向かい風だと遅く、追い風だと速い。" },
  ahead: { sel: "#kb-ahead", name: "前方の天気", text: "進む先 120 km の雲・雨・乱気流。予報の確率と、目で見えたもの。" },
  routebar: { sel: "#routebar", name: "ルートバー", text: "この区間を横から見た図。機体の位置・高さと、前方の山・雲・海が見える。" },
  turnback: { sel: "#turnback", name: "引き返す", text: `${kbd("U")} で、出発した飛行場へ 180 度旋回して戻る。` },
  carb: { sel: "#carbheat", name: "キャブヒート", text: `${kbd("H")} で入れる・切る。キャブレター（燃料と空気を混ぜるところ）を温めて、氷を溶かす。` },
  lamps: { sel: ".annunciators", name: "警告灯", text: "異常が起きると光る。エンジン荒れ（薄すぎ）・燃料少・回転超過・振動・ボルト点検・キャブ凍結。" },
  pilot: { sel: ".pilot", name: "疲労・焦り", text: "操縦者の調子。疲れると操作が遅れ、計器の読みがずれる。焦ると、整備士のひとことが甘く聞こえる。" },
  pause: { sel: "#pause", name: "一時停止", text: `${kbd("スペース")} でも止まる・動く。止まっているあいだも、レバーやボタンは動かせる。` },
  speed: { sel: ".speed", name: "時間の速さ", text: "×1・×2・×4。長い巡航は速めてもいい。大事なことが起きると ×1 に戻る。" },
  radio: { sel: "#radio", name: "気象ラジオ", text: `${kbd("P")} で、前方の予報を新しくする（積んでいるときだけ。一度使うと少し待つ）。` },
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
    title: "チュートリアルの進み方",
    intro: (f) => `${f.leg.from.name}を離陸した。大事な操作のたびに、このように飛行を止めて説明する。光っているところが、今見る計器やボタンだ。`,
    meters: [M.pause, M.speed],
    action: () =>
      `説明を読んだら「わかった」（${kbd("Enter")} か ${kbd("スペース")}）で飛行を再開する。止まっているあいだも操作はできるので、計器を見ながら試してから再開してもいい。`,
    when: (f) => flying(f),
  },
  {
    id: "climb-throttle",
    kind: "scripted",
    noWait: true,
    title: "上昇はスロットル全開",
    intro: (f) => `今は目標高度 ${intendedControls(f).targetAltitude} m へ上昇中。上昇はエンジンの力をいちばん使う。`,
    meters: [M.throttle, M.tach, M.asi],
    action: (f) =>
      `${kbd("W")} を何回か押して、スロットルを <b>100%（全開）</b> にする。回転計の針が上がり、上昇が速くなる。${
        f.setup.pitch <= 2
          ? `ただし今のプロペラは回りやすい上昇型（ピッチ ${f.setup.pitch}）。回転計の針が<b>赤い線</b>を超えたら、${kbd("S")} で1〜2回戻す。`
          : "回転計の針が赤い線を超えそうなら、少し戻す。"
      }`,
    task: {
      text: "スロットルを全開にする（回転計が赤い線に届くなら、その手前まで）",
      done: (f) => intendedControls(f).throttle >= 0.95 || f.perf.rpm >= REDLINE_RPM - 150,
    },
    when: (f) => flying(f) && f.phase === "climb",
    expired: (f) => f.phase !== "climb" || f.approach,
  },
  {
    id: "climb-mixture",
    kind: "scripted",
    noWait: true,
    title: "高く上がったら、混ぜ方を薄く",
    intro: (f) =>
      `高度 ${Math.round(f.altitude)} m。高く上がるほど空気が薄くなり、同じ燃料の量では「濃すぎ」になる。濃すぎると力が出ず、燃料も食う。`,
    meters: [M.mixture, M.egt],
    action: () =>
      `${kbd("D")} を押しっぱなしにして、ミクスチャーを薄くしていく。排気温度計の針の上の札が <b>「濃い」→「最大出力」</b> に変わったら止める。上昇中は「最大出力」がいい。`,
    task: { text: "排気温度計の札を「最大出力」にする（D で薄く）", done: (f) => ["power", "economy"].includes(f.perf.mixture.zone) },
    when: (f) => flying(f) && f.phase === "climb" && f.altitude > f.leg.from.elevation + 300,
    expired: (f) => f.phase !== "climb" || f.approach,
    skip: (t) => t.rule.autoMixture,
  },
  {
    id: "altitude",
    kind: "scripted",
    title: "高度は目標を決めるだけ",
    intro: (f) =>
      `高度計の針が目標高度 ${intendedControls(f).targetAltitude} m で止まり、上の札が「巡航中」になった。目標高度は、この区間のすすめの巡航高度に合わせてある。`,
    meters: [M.alt, M.navAlt],
    action: () =>
      `ふだんはこのままでいい。<b>前方に山があるとき</b>は上げ、<b>雲にぶつかりそうなとき</b>や<b>プロペラが凍りそうなとき</b>は ${kbd("R")} / ${kbd("F")} で変える。高さによって風の強さも変わる（高いほど強いことが多い）。`,
    when: (f) => cruising(f),
  },
  {
    id: "cruise-throttle",
    kind: "scripted",
    title: "巡航ではスロットルを絞る",
    intro: (f) => `目標高度 ${Math.round(f.altitude)} m に着いて、巡航に入った。全開のままだと燃料をたくさん食い、エンジンも傷む。`,
    meters: [M.throttle, M.tach, M.ground],
    action: () =>
      `${kbd("S")} を何回か押して、スロットルを <b>70〜75%</b> くらいにする。速さは少し落ちるが、遠くまで飛べる。日没に間に合わないときだけ上げる。`,
    task: { text: "スロットルを 75% 以下に絞る（S）", done: (f) => intendedControls(f).throttle <= 0.8 },
    when: (f) => cruising(f),
  },
  {
    id: "cruise-mixture",
    kind: "scripted",
    title: "巡航は「最良燃費」の混ぜ方",
    intro: () => "巡航では、速さより燃費。混ぜ方をもう少し薄くすると、同じ燃料でずっと遠くまで飛べる。",
    meters: [M.mixture, M.egt, M.range],
    action: (f) =>
      `${kbd("D")} で少しずつ薄くして、排気温度計の札を <b>「最良燃費」</b> にする（針がいちばん高く上がるあたり。今の高さならミクスチャー ${Math.round(mix(f).bestEconomy)} くらい）。薄くしすぎて札が「薄すぎ」になり、警告灯「エンジン荒れ」が光ったら、${kbd("A")} で少し戻す。`,
    task: { text: "排気温度計の札を「最良燃費」にする（D で薄く）", done: (f) => f.perf.mixture.zone === "economy" },
    when: (f) => cruising(f),
    skip: (t) => t.rule.autoMixture,
  },
  {
    id: "fuel",
    kind: "scripted",
    title: "燃料は「届く距離」で見る",
    intro: (f) => `燃料は ${f.condition.fuelRemaining.toFixed(0)} L、${f.leg.to.name}まで残り ${distanceLeft(f).toFixed(0)} km。燃料計だけでは、着けるかどうかはわからない。`,
    meters: [M.fuel, M.range, M.eta],
    action: () =>
      `右上の飛行メモの <b>「届く距離」が緑</b>ならそのままでいい。<b>黄色・赤</b>になったら、スロットルを絞る・混ぜ方を「最良燃費」にする・向かい風の弱い高さを探す。それでも赤なら ${kbd("U")} で引き返す。<b>「到着予定」</b>が日没に近いときも同じ。`,
    when: (f) => cruising(f),
  },
  {
    id: "lamps",
    kind: "scripted",
    title: "警告灯と、操縦者の調子",
    intro: () => "計器盤の右側には、異常を知らせる警告灯と、操縦者の疲れ・焦りがある。",
    meters: [M.lamps, M.engine, M.pilot],
    action: () =>
      `警告灯が光ったら、まず整備士のひとこと（景色の下）を読む。<b>エンジン荒れ</b>→ ${kbd("A")} で濃く。<b>回転超過</b>→ ${kbd("S")} で絞る。<b>振動</b>→ 出力を絞って次の飛行場で点検。疲労が黄色になったら、次の飛行場で休む。`,
    when: (f) => cruising(f),
  },
  {
    id: "routebar",
    kind: "scripted",
    title: "前方を見る：ルートバーと前方の天気",
    intro: (f) => `${f.leg.to.name}まで残り ${distanceLeft(f).toFixed(0)} km。景色の下の帯で、この先に何があるかを見ておこう。`,
    meters: [M.routebar, M.ahead, M.speed],
    action: (_f, t) =>
      `ルートバーで、前方の${t.world.tutorial === "sea" ? "海" : "山"}・雲と、自分の高さを見比べる。何もなければ ×2・×4 で時間を速めてもいい。大事なことが起きると、×1 に戻ってまた説明する。`,
    when: (f) => cruising(f),
  },

  // =================== 場面の説明（はじめてその場面になったとき） ===================
  {
    id: "cloud",
    kind: "event",
    urgent: true,
    title: "雲の中に入った！",
    intro: () => "何も見えない。計器飛行の訓練がないので、雲の中に長くいると上下がわからなくなり、気づかないうちに旋回しながら落ちていく。",
    meters: [M.ahead, M.navAlt, M.navCourse, M.turnback],
    action: () =>
      `すぐ雲から出る。雲の下へ ${kbd("F")}、上へ ${kbd("R")}、横へ ${kbd("Q")} / ${kbd("E")}、だめなら ${kbd("U")} で引き返す。ルートバーで雲の上下の高さを見て、近いほうへ。`,
    task: { text: "雲から出る（高度を変える・よける・引き返す）", done: (f) => !f.env.inCloud },
    when: (f) => flying(f) && f.env.inCloud,
  },
  {
    id: "cb",
    kind: "event",
    urgent: true,
    title: "積乱雲が近い",
    intro: (f) => `積乱雲まで ${Math.round(f.env.cbDistance)} km。中は激しい上下の風とひょうで、木の機体はもたない。`,
    meters: [M.ahead, M.navCourse, M.turnback],
    action: () => `${CB_DANGER_KM} km 以上離れる。${kbd("Q")} / ${kbd("E")} で大きく横へよけるか、${kbd("U")} で引き返す。`,
    task: { text: `積乱雲から ${CB_DANGER_KM} km 以上離れる`, done: (f) => f.env.cbDistance >= CB_DANGER_KM },
    when: (f) => flying(f) && f.env.cbDistance < CB_DANGER_KM + 15,
  },
  {
    id: "terrain",
    kind: "event",
    urgent: false,
    title: "前方に山がある",
    intro: (f) => `この先に ${ridgeAhead(f, 45)} m の山なみがある。今の高度は ${Math.round(f.altitude)} m。`,
    meters: [M.routebar, M.alt, M.navAlt],
    action: (f) =>
      `目標高度を <b>山より 300 m 以上高く</b>（${Math.ceil((ridgeAhead(f, 45) + 300) / 100) * 100} m 以上）にして、山の手前で上がりきっておく。${kbd("R")} で上げ、スロットルは全開。高いほど空気が薄く、上昇がにぶくなるので早めに。上がりきれないときは引き返す。`,
    task: {
      text: "目標高度を山より 300 m 以上高くする（R）",
      done: (f) => intendedControls(f).targetAltitude >= ridgeAhead(f, 45) + 300 || ridgeAhead(f, 45) === 0,
    },
    when: (f) => flying(f) && !f.approach && ridgeAhead(f, 45) > 0,
  },
  {
    id: "terrain-low",
    kind: "event",
    urgent: true,
    title: "山に高度が足りない！",
    intro: (f) => `前方の地面は ${Math.round(terrainAhead(f, 25))} m、今の高度は ${Math.round(f.altitude)} m。このままだとぶつかる。`,
    meters: [M.alt, M.navAlt, M.throttle, M.turnback],
    action: () => `${kbd("R")} で目標高度を上げ、スロットルを全開にする。間に合いそうにないなら、${kbd("U")} ですぐ引き返す。`,
    task: { text: "上昇するか、引き返す", done: (f) => f.returning || terrainAhead(f, 25) < f.altitude - 150 },
    // 山（尾根）が近いときだけ。離陸直後の、地面そのものの近さでは出さない
    when: (f) => flying(f) && !f.approach && ridgeAhead(f, 25) > 0 && terrainAhead(f, 25) > f.altitude - 150,
  },
  {
    id: "sea",
    kind: "event",
    title: "この先は海の上",
    intro: () => "海の上でエンジンが止まったら、降りられる畑はない（着水になる）。予備のプロペラでの復帰もできない。",
    meters: [M.routebar, M.fuel, M.range, M.turnback],
    action: () =>
      `ルートバーの <b>引き返し限界点</b>（ここを過ぎると、戻るだけの燃料がない地点）を見る。越える前に、届く距離が緑か、エンジン・振動の調子がいいかを確かめる。不安なら限界点の手前で ${kbd("U")} で引き返す。`,
    when: (f, t) => flying(f) && !!t.world.land && seaAhead(f, 25),
  },
  {
    id: "no-return",
    kind: "event",
    title: "引き返し限界点を越えた",
    intro: () => "ここからは、引き返しても出発地まで燃料がもたない。進むしかない。",
    meters: [M.routebar, M.range, M.mixture],
    action: () => `燃料を大事に使う。スロットルは 70% くらい、混ぜ方は「最良燃費」。届く距離が黄色になったら、向かい風の弱い高さを探す。`,
    when: (f) => flying(f) && f.pastNoReturn,
  },
  {
    id: "rain",
    kind: "event",
    title: "雨の中に入った",
    intro: () => "雨粒がプロペラの前縁（前のへり）を削る。回転が速いほど、強く当たってよく削れる。",
    meters: [M.throttle, M.tach, M.ahead],
    action: () => `${kbd("S")} でスロットルを <b>70% 以下</b>に絞って、回転を下げる。雨を抜けたら元に戻していい。`,
    task: { text: "雨の中ではスロットルを 70% 以下に（S）", done: (f) => intendedControls(f).throttle <= 0.7 || f.env.rain === 0 },
    when: (f) => flying(f) && f.env.rain > 0,
  },
  {
    id: "turbulence",
    kind: "event",
    urgent: true,
    title: "乱気流で揺れている",
    intro: () => "速いまま揺られると、機体に大きな力がかかって壊れる。",
    meters: [M.asi, M.throttle],
    action: () => `${kbd("S")} でスロットルを絞り、対気速度計の針を <b>白い印（${VA_KMH} km/h）より下</b>にする。`,
    task: { text: `対気速度を ${VA_KMH} km/h 以下に（S）`, done: (f) => f.perf.airspeed <= VA_KMH || f.env.turbulence === 0 },
    when: (f) => flying(f) && f.env.turbulence > 0,
  },
  {
    id: "overspeed",
    kind: "event",
    urgent: true,
    title: "回転が上がりすぎている",
    intro: () => "回転計の針が赤い線を超えた。降下で速度が出たときや、全開のままのときに起きる。",
    meters: [M.tach, M.lamps, M.throttle],
    action: () => `${kbd("S")} でスロットルを絞って、針を緑の帯に戻す。`,
    task: { text: "回転を赤い線より下に（S）", done: (f) => f.perf.rpm <= REDLINE_RPM - 100 },
    when: (f) => flying(f) && f.perf.rpm > REDLINE_RPM,
  },
  {
    id: "descent",
    kind: "event",
    title: "着陸のための降下",
    intro: (f) => `${f.leg.to.name}が近づいた。着陸のための降下は自動でする。降りるときは速度が出て、回転も上がる。`,
    meters: [M.tach, M.throttle, M.alt],
    action: () => `回転計の針が黄色に近づいたら、${kbd("S")} でスロットルを絞る。あとは着くのを待つだけ。`,
    task: { text: "降下中は回転を黄色の手前に（S）", done: (f) => f.perf.rpm <= REDLINE_RPM - 100 },
    when: (f) => flying(f) && f.approach,
  },
  {
    id: "lean",
    kind: "event",
    urgent: true,
    title: "混ぜ方が薄すぎる",
    intro: () => "エンジンが荒れて、力が急に落ちている。このままだとエンジンが傷む。",
    meters: [M.mixture, M.egt, M.lamps],
    action: () => `${kbd("A")} でミクスチャーを少し濃くして、排気温度計の札を「最良燃費」に戻す。`,
    task: { text: "ミクスチャーを濃くする（A）", done: (f) => f.perf.mixture.zone !== "tooLean" },
    when: (f) => flying(f) && f.perf.mixture.zone === "tooLean",
    skip: (t) => t.rule.autoMixture,
  },
  {
    id: "carb-ice",
    kind: "event",
    title: "キャブレターが凍りはじめた",
    intro: () => "晴れていても湿った日は、キャブレターの中が冷えて氷がつく。回転がじわじわ下がっていく。",
    meters: [M.carb, M.tach],
    action: () => `${kbd("H")} でキャブヒートを入れる。氷が溶けたら（回転が戻ったら）切る。入れっぱなしだと少し力が落ちる。`,
    task: { text: "キャブヒートを入れる（H）", done: (f) => intendedControls(f).carbHeat },
    when: (f) => flying(f) && f.condition.carbIce > 3 && !f.controls.carbHeat,
    skip: (t) => t.rule.autoCarbHeat,
  },
  {
    id: "carb-off",
    kind: "event",
    title: "キャブヒートを切る",
    intro: () => "キャブレターに氷はない（溶けた）。キャブヒートは入れっぱなしだと、温かい空気で力が少し落ちる。",
    meters: [M.carb, M.tach],
    action: () => `${kbd("H")} でキャブヒートを切る。また回転が下がってきたら入れ直す。`,
    task: { text: "キャブヒートを切る（H）", done: (f) => !intendedControls(f).carbHeat },
    when: (f) => flying(f) && f.controls.carbHeat && f.condition.carbIce < 1,
    skip: (t) => t.rule.autoCarbHeat,
  },
  {
    id: "prop-ice",
    kind: "event",
    title: "プロペラに氷がついた",
    intro: (f) => `凍結高度（${f.weather.freezingLevel} m）より上は、氷点下。雲や雨の水がプロペラに凍りつき、重くなって振動が出る。`,
    meters: [M.alt, M.navAlt, M.lamps],
    action: (f) => `${kbd("F")} で目標高度を <b>${f.weather.freezingLevel} m より下</b>にする。下で氷が溶けるまで待つ。`,
    task: { text: "凍結高度より下へ降りる（F）", done: (f) => intendedControls(f).targetAltitude < f.weather.freezingLevel },
    when: (f) => flying(f) && f.condition.propIce > 3,
  },
  {
    id: "vibration",
    kind: "event",
    title: "振動が出ている",
    intro: () => "警告灯「振動」が光った。ボルトのゆるみ、前縁の傷、プロペラの氷が原因になる。ひどくなるとプロペラが割れる。",
    meters: [M.lamps, M.throttle],
    action: () => `出力を少し絞って、次の飛行場で「機体の点検」を見る。ボルトがゆるんでいたら締め直す。`,
    when: (f) => flying(f) && f.condition.vibration >= VIBRATION_YELLOW,
  },
  {
    id: "low-fuel",
    kind: "event",
    urgent: true,
    title: "このままでは届かない",
    intro: (f) => `届く距離が残りの ${distanceLeft(f).toFixed(0)} km より短くなった。`,
    meters: [M.range, M.fuel, M.throttle, M.turnback],
    action: () =>
      `スロットルを絞り、混ぜ方を「最良燃費」に。向かい風が強いなら高さを変えてみる。それでも赤のままなら、${kbd("U")} で引き返すのが正しい判断だ。`,
    after: "fuel",
    when: (f) => flying(f) && !f.approach && f.phase !== "climb" && f.perf.rangeKm < distanceLeft(f),
  },
  {
    id: "fatigue",
    kind: "event",
    title: "操縦者が疲れてきた",
    intro: () => "長く飛ぶと疲れがたまる。疲れると、操作が効くまで時間がかかり、計器の読みもずれる。",
    meters: [M.pilot],
    action: () => "次の飛行場で「休む」。泊まって翌朝出るのも、立派な判断だ。",
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
