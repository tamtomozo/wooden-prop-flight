// 格納庫：出発前のセッティング（A1〜A4）。
import { EQUIPMENT_MAX_KG, EQUIPMENT_SLOTS } from "../config";
import { DIFFICULTY } from "../data/difficulty";
import { EDGE_GEAR, equipmentKg, ITEMS, NO_EQUIPMENT, slotsUsed } from "../data/equipment";
import { field } from "../data/world";
import { setupProblems, suggestedDestination } from "../game/campaign";
import { pitchFactors, staticRpmVerdict, takeoffDistance, totalWeight } from "../model/physics";
import type { Difficulty, Equipment, PitchLevel, Setup, TorqueResult, World } from "../model/types";
import { mechanicLine, openDialog, setActions } from "./dialog";
import { routePlanHtml } from "./routePlan";
import { runTorque } from "./torque";

const PITCH_NAMES: Record<PitchLevel, string> = { 1: "上昇型", 2: "やや上昇", 3: "中間", 4: "やや巡航", 5: "巡航型" };
const VERDICT = { low: "低い（上昇が弱い）", ok: "適正", high: "高い（オーバースピード注意）" } as const;
const TORQUE_TEXT: Record<TorqueResult, string> = { under: "不足", ok: "適正", over: "締めすぎ" };

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
  render(false);

  function render(keepScroll = true) {
    const pf = pitchFactors(st.pitch);
    const fuelL = (world.fuelCapacityL * st.fuelPercent) / 100;
    const eqKg = equipmentKg(st.equipment);
    const problems = setupProblems(world, { ...setupOf(), torqueResult: st.torque ?? "ok" });
    if (!st.torque) problems.push("ボルトを締めていない");
    const verdict = staticRpmVerdict(pf.staticRPM);

    const factor = (label: string, v: number, betterHigh: boolean) => {
      const good = betterHigh ? v > 1.001 : v < 0.999;
      const bad = betterHigh ? v < 0.999 : v > 1.001;
      return `<span class="factor ${good ? "good" : bad ? "bad" : ""}">${label} ×${v.toFixed(2)}</span>`;
    };

    // 各飛行場から、この燃料と装備で離陸したときの距離
    const toRows = world.fields
      .filter((w) => w.id !== world.goalId)
      .map((w) => {
        const d = takeoffDistance(st.pitch, w.elevation, w.temperature, totalWeight(fuelL, eqKg));
        const ok = d <= w.runwayLength;
        return `<tr class="${ok ? "" : "ng"}"><td>${w.name}<small>${w.surface === "paved" ? "舗装" : "未舗装"}・${w.temperature}℃・標高${w.elevation}m</small></td>
          <td>${Math.round(d)} m / ${w.runwayLength} m</td><td>${ok ? "○" : "× 長すぎる"}</td></tr>`;
      })
      .join("");

    const gearRow = (key: "toolKit" | "spareProp" | "weatherRadio") => {
      const g = ITEMS[key];
      const on = st.equipment[key];
      const trial = { ...st.equipment, [key]: true };
      const fits = on || (slotsUsed(trial) <= EQUIPMENT_SLOTS && equipmentKg(trial) <= EQUIPMENT_MAX_KG);
      return `<label class="gear ${fits ? "" : "disabled"}">
        <input type="checkbox" data-gear="${key}" ${on ? "checked" : ""} ${fits ? "" : "disabled"} />
        <span><b>${g.name}</b> <small>${g.kg} kg</small><br /><small>${g.effect}</small></span>
      </label>`;
    };
    const edgeRow = (key: "none" | "tape" | "metal") => {
      const g = key === "none" ? null : EDGE_GEAR[key];
      const trial = { ...st.equipment, edgeGear: key };
      const fits = st.equipment.edgeGear === key || (slotsUsed(trial) <= EQUIPMENT_SLOTS && equipmentKg(trial) <= EQUIPMENT_MAX_KG);
      return `<label class="gear ${fits ? "" : "disabled"}">
        <input type="radio" name="edge" data-edge="${key}" ${st.equipment.edgeGear === key ? "checked" : ""} ${fits ? "" : "disabled"} />
        <span>${g ? `<b>${g.name}</b> <small>${g.kg} kg</small><br /><small>${g.effect}</small>` : "<b>前縁の保護なし</b>"}</span>
      </label>`;
    };

    const root = openDialog(
      `<h2>格納庫：出発前のセッティング</h2>
      <p class="lead">${start.name}から${goal.name}への旅。どの飛行場を通って行くかは、地図で選ぶ。</p>
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
          <li>操縦者：飛ぶほど<b>疲労</b>がたまり、操作の効きが遅れ、計器の読みがずれる（一晩休むと回復）。日没までに着けそうにないと<b>焦り</b>が出る（引き返す・天気を待つと落ち着く。焦ると判断が甘くなる）。</li>
          <li>着いたら、かかった日数・燃費・機体の状態・安全な判断で評価される。引き返す・待つには「勇気ある撤退ボーナス」。</li>
          <li>スペースキーで一時停止、V キーで視点の切り替え。</li>
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

      <section class="setup">
        <h3>A1 プロペラの性格（ピッチ）</h3>
        <div class="seg">${([1, 2, 3, 4, 5] as PitchLevel[])
          .map((p) => `<button data-act="pitch" data-v="${p}" class="${p === st.pitch ? "on" : ""}">${p}<small>${PITCH_NAMES[p]}</small></button>`)
          .join("")}</div>
        <p class="factors">${factor("巡航速度", pf.pitchSpeedFactor, true)} ${factor("上昇力", pf.climbFactor, true)} ${factor("離陸距離", pf.takeoffDistFactor, false)}</p>
        <p class="small">地上回転数テスト：<b class="verdict ${verdict}">${VERDICT[verdict]}</b>（${pf.staticRPM} rpm）</p>
        ${mechanicLine("長い滑走路から出るなら巡航型でいける。山を越えるなら上昇型が安心だ。上昇型は回りやすいから、全開や降下では回転計に気をつけろ。")}
      </section>

      <section class="setup">
        <h3>A2 燃料の量</h3>
        <div class="fuel-row">
          <input type="range" min="0" max="100" step="5" value="${st.fuelPercent}" data-fuel />
          <span><b>${fuelL.toFixed(0)} L</b>（${st.fuelPercent}%・${(fuelL * 0.72).toFixed(0)} kg）</span>
        </div>
        <table class="route-table takeoff">
          <tr><th>この燃料と装備で離陸すると</th><th>離陸距離 / 滑走路</th><th></th></tr>
          ${toRows}
        </table>
        ${mechanicLine("暑い日の満タン離陸は、滑走路の長さを必ず確認しろ。経由地では、次に必要なぶんだけ積むのも手だ。")}
      </section>

      <section class="setup">
        <h3>A4 装備 <small>${slotsUsed(st.equipment)} / ${EQUIPMENT_SLOTS} 枠・${eqKg} / ${EQUIPMENT_MAX_KG} kg</small></h3>
        <div class="gears">
          ${edgeRow("none")}${edgeRow("tape")}${edgeRow("metal")}
          ${gearRow("toolKit")}${gearRow("spareProp")}${gearRow("weatherRadio")}
        </div>
      </section>

      <section class="setup">
        <h3>A3 ボルトの締め付け</h3>
        <p>${st.torque ? `結果：<b class="torque-${st.torque}">${TORQUE_TEXT[st.torque]}</b>` : "まだ締めていない。"}</p>
        ${
          st.torque === null || st.torque === "under"
            ? `<button data-act="torque">${st.torque ? "もう一度締める" : "ボルトを締める（ミニゲーム）"}</button>`
            : ""
        }
        ${mechanicLine("確かめるときは締める方向で。ゆるめて測っても正しい値は出ない。")}
      </section>

      ${problems.length ? `<p class="problems">${problems.join("・")}</p>` : ""}
      <button class="primary" data-act="depart" ${problems.length ? "disabled" : ""}>${start.name}から${field(world, st.destination).name}へ出発する</button>`,
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
        heading: "A3 ボルトの締め付け",
        note: "木のプロペラを留めるボルト3本を、トルクレンチで締める。",
        onDone: (r) => {
          st.torque = r;
          render(false);
        },
      }),
    dest: (el) => {
      st.destination = el.dataset.id!;
      render();
    },
    depart: () => onDepart(setupOf(), st.difficulty, st.destination),
  });
}

