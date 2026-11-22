// 格納庫：出発前のセッティング（A1〜A4）。
import { DIFFICULTY } from "../data/difficulty";
import { equipmentKg, NO_EQUIPMENT } from "../data/equipment";
import { field } from "../data/world";
import { setupProblems, suggestedDestination } from "../game/campaign";
import { recommendSetup, type Recommendation } from "../game/recommend";
import type { Difficulty, Equipment, PitchLevel, Setup, TorqueResult, World } from "../model/types";
import { mechanicLine, openDialog, setActions } from "./dialog";
import { equipmentDiagramHtml } from "./equipmentDiagram";
import { fuelDiagramHtml } from "./fuelDiagram";
import { pitchDiagramHtml } from "./pitchDiagram";
import { routePlanHtml } from "./routePlan";
import { runTorque } from "./torque";
import { torqueDiagramHtml } from "./torqueDiagram";

const PITCH_NAMES: Record<PitchLevel, string> = { 1: "上昇型", 2: "やや上昇", 3: "中間", 4: "やや巡航", 5: "巡航型" };

interface HangarState {
  difficulty: Difficulty;
  /** 最初の行き先（地図で選ぶ） */
  destination: string;
  pitch: PitchLevel;
  fuelPercent: number;
  equipment: Equipment;
  torque: TorqueResult | null;
}

export function showHangar(
  world: World,
  onDepart: (setup: Setup, difficulty: Difficulty, destination: string) => void,
  onChangeCourse: () => void,
  initial?: Partial<HangarState>,
) {
  const start = field(world, world.startId);
  const goal = field(world, world.goalId);
  const st: HangarState = {
    difficulty: "normal",
    destination: suggestedDestination(world, world.startId),
    pitch: 3,
    fuelPercent: 100,
    equipment: { ...NO_EQUIPMENT },
    torque: null,
    ...initial,
  };
  /** 最後に「おすすめにする」を押したときの中身（そのままなら説明を見せる） */
  let rec: Recommendation | null = null;
  /** 今のセッティングが、整備士のおすすめのままか */
  const isRecommended = () =>
    !!rec &&
    st.pitch === rec.pitch &&
    st.fuelPercent === rec.fuelPercent &&
    JSON.stringify(st.equipment) === JSON.stringify(rec.equipment);
  render(false);

  function render(keepScroll = true) {
    const fuelL = (world.fuelCapacityL * st.fuelPercent) / 100;
    const eqKg = equipmentKg(st.equipment);
    const problems = setupProblems(world, { ...setupOf(), torqueResult: st.torque ?? "ok" });
    // ボルトを締めるまでは出発できない（文言は出さず、ボルトの欄のボタンで促す）
    const canDepart = problems.length === 0 && st.torque !== null;

    const root = openDialog(
      `<div class="course-head">
        <h2>格納庫：出発前のセッティング</h2>
        <button data-act="change-course">コースを選び直す</button>
      </div>
      <p class="lead"><b>${world.title}</b>　${start.name}から${goal.name}への旅。</p>
      <section class="setup first">
        <h3>難易度</h3>
        <div class="seg seg3">${(Object.keys(DIFFICULTY) as Difficulty[])
          .map((k) => `<button data-act="difficulty" data-v="${k}" class="${k === st.difficulty ? "on" : ""}">${DIFFICULTY[k].label}</button>`)
          .join("")}</div>
        <p class="small">${DIFFICULTY[st.difficulty].description}</p>
      </section>
      <details class="howto">
        <summary>遊び方</summary>
        <ul>
          <li>格納庫でプロペラ・燃料・装備を決め、ボルトを締めて出発する。<b>行き先は地図で選ぶ</b>（経由地に着くたびに、次の行き先を選ぶ）。</li>
          <li>飛行中は<b>スロットル</b>（W / S）と<b>ミクスチャー</b>（A / D）を操作する。排気温度計の針がいちばん上がるところが最良燃費。</li>
          <li>離陸すると目標高度まで上昇し、目的地が近づくと自動で降下する。上昇は全開、降下中は回転が上がりすぎないよう絞る。</li>
          <li>天気：<b>高度</b>（R / F）で風や雲を選び、<b>よける</b>（Q / E）で積乱雲や雨を迂回する。湿った日は<b>キャブヒート</b>（H）。気象ラジオがあれば<b>予報を更新</b>（P）。危ないと思ったら<b>引き返す</b>（U）。</li>
          <li>経由地では点検・整備・給油・宿泊・天気待ちができる。湿度の違う土地ではボルトがゆるむ。</li>
          <li><b>海の上</b>（地図の青い線）では、エンジンが止まったら降りる場所がなく、予備のプロペラにも替えられない。戻るだけの燃料がなくなる<b>引き返し限界点</b>を越えたら、前へ進むしかない。</li>
          <li>操縦者：飛ぶほど<b>疲労</b>がたまり、操作の効きが遅れ、計器の読みがずれる（一晩休むと回復）。日没までに着けそうにないと<b>焦り</b>が出る（引き返す・天気を待つと落ち着く。焦ると判断が甘くなる）。</li>
          <li>着いたら、かかった日数・燃費・機体の状態・安全な判断で評価される。引き返す・待つには「勇気ある撤退ボーナス」。</li>
          <li>スペースキーで一時停止。</li>
        </ul>
      </details>

      <section class="setup">
        <h3>最初の行き先 <small>地図の飛行場をクリック</small></h3>
        ${routePlanHtml(world, { from: world.startId, destination: st.destination, nowAbs: world.startMin, pitch: st.pitch, equipmentKg: eqKg })}
        <details class="howto">
          <summary>飛行場の一覧</summary>
          <table class="route-table">
            <tr><th>飛行場</th><th>滑走路</th><th>整備場</th><th>湿度</th></tr>
            ${world.fields
              .map(
                (w) => `<tr><td>${w.name}<small>${w.description}</small></td><td>${w.runwayLength} m・${w.surface === "paved" ? "舗装" : "未舗装"}</td>
                <td>${w.hasRepairShop ? "あり" : "なし"}</td><td>${w.humidity}%</td></tr>`,
              )
              .join("")}
          </table>
        </details>
      </section>

      <div class="recommend">
        <div class="recommend-row">
          <button class="primary" data-act="recommend">整備士のおすすめセッティングにする</button>
        </div>
        ${
          isRecommended()
            ? `<div class="mechanic recommend-why"><span class="who">整備士</span><ul>${rec!.reasons.map((r) => `<li>${r}</li>`).join("")}</ul></div>`
            : ""
        }
      </div>
      <section class="setup">
        <h3>プロペラの性格（ピッチ）</h3>
        ${mechanicLine("長い滑走路から出るなら巡航型でいける。山を越えるなら上昇型が安心だ。上昇型は回りやすいから、全開や降下では回転計に気をつけろ。")}
        <div class="seg">${([1, 2, 3, 4, 5] as PitchLevel[])
          .map((p) => `<button data-act="pitch" data-v="${p}" class="${p === st.pitch ? "on" : ""}">${p}<small>${PITCH_NAMES[p]}</small></button>`)
          .join("")}</div>
        ${pitchDiagramHtml(st.pitch)}
      </section>

      <section class="setup">
        <h3>燃料の量</h3>
        ${mechanicLine("暑い日の満タン離陸は、滑走路の長さを必ず確認しろ。経由地では、次に必要なぶんだけ積むのも手だ。")}
        <div class="fuel-row">
          <input type="range" min="0" max="100" step="5" value="${st.fuelPercent}" data-fuel />
          <span><b>${fuelL.toFixed(0)} L</b>（${st.fuelPercent}%・${(fuelL * 0.72).toFixed(0)} kg）</span>
        </div>
        ${fuelDiagramHtml({
          fuelL,
          capacityL: world.fuelCapacityL,
          equipmentKg: eqKg,
          pitch: st.pitch,
          fields: world.fields.filter((w) => w.id !== world.goalId),
        })}
      </section>

      <section class="setup">
        <h3>装備</h3>
        ${mechanicLine("装備は重さとの相談だ。雨の多い旅なら前縁の保護、整備場のない道なら工具だ。")}
        ${equipmentDiagramHtml(st.equipment)}
      </section>

      <section class="setup">
        <h3>ボルトの締め付け</h3>
        ${mechanicLine("ボルトを締め終えたら、出発できるぞ。これが出発前の最後の仕事だ。")}
        ${
          st.torque === null || st.torque === "under"
            ? `<button class="torque-btn" data-act="torque">${st.torque ? "もう一度締める" : "ボルトを締める（ミニゲーム）"}</button>`
            : ""
        }
        ${torqueDiagramHtml(st.torque)}
      </section>

      ${problems.length ? `<p class="problems">${problems.join("・")}</p>` : ""}
      <button class="primary" data-act="depart" ${canDepart ? "" : "disabled"}>${start.name}から${field(world, st.destination).name}へ出発する</button>`,
      { wide: true, keepScroll },
    );

    root.querySelector<HTMLInputElement>("[data-fuel]")!.addEventListener("input", (e) => {
      st.fuelPercent = Number((e.target as HTMLInputElement).value);
      render();
    });
    root.querySelectorAll<HTMLInputElement>("[data-gear]").forEach((el) =>
      el.addEventListener("change", () => {
        st.equipment = { ...st.equipment, [el.dataset.gear!]: el.checked };
        render();
      }),
    );
    root.querySelectorAll<HTMLInputElement>("[data-edge]").forEach((el) =>
      el.addEventListener("change", () => {
        st.equipment = { ...st.equipment, edgeGear: el.dataset.edge as Equipment["edgeGear"] };
        render();
      }),
    );
  }

  function setupOf(): Setup {
    return { pitch: st.pitch, fuelPercent: st.fuelPercent, torqueResult: st.torque ?? "ok", equipment: st.equipment };
  }

  setActions({
    difficulty: (el) => {
      st.difficulty = el.dataset.v as Difficulty;
      render();
    },
    pitch: (el) => {
      st.pitch = Number(el.dataset.v) as PitchLevel;
      render();
    },
    torque: () =>
      runTorque({
        heading: "ボルトの締め付け",
        note: "木のプロペラを留めるボルト3本を、トルクレンチで締める。",
        onDone: (r) => {
          st.torque = r;
          render(false);
        },
      }),
    "change-course": onChangeCourse,
    recommend: () => {
      rec = recommendSetup(world, st.destination, st.difficulty);
      st.pitch = rec.pitch;
      st.fuelPercent = rec.fuelPercent;
      st.equipment = { ...rec.equipment };
      render();
    },
    dest: (el) => {
      // 行き先が変わると、おすすめの説明は前の行き先のものになるので隠す（もう一度押せば出し直す）
      if (el.dataset.id !== st.destination) rec = null;
      st.destination = el.dataset.id!;
      render();
    },
    depart: () => onDepart(setupOf(), st.difficulty, st.destination),
  });
}

