// A3 ボルトの締め付けミニゲーム。
// ボタンを押している間トルクが上がる。トルクレンチが「カチッ」と鳴る範囲で離せば適正。
// 早すぎれば不足、遅すぎれば締めすぎ（木がつぶれる）。
import { TORQUE_OK_FROM, TORQUE_OK_TO } from "../config";
import type { TorqueResult } from "../model/types";
import { mechanicLine, openDialog } from "./dialog";

const BOLTS = 3;
const OK_FROM = TORQUE_OK_FROM;
const OK_TO = TORQUE_OK_TO;

const RESULT_TEXT: Record<TorqueResult, string> = { under: "不足", ok: "適正", over: "締めすぎ" };

export function overallTorque(results: TorqueResult[]): TorqueResult {
  if (results.includes("over")) return "over";
  if (results.includes("under")) return "under";
  return "ok";
}

export function runTorque(opts: { heading: string; note: string; onDone: (r: TorqueResult) => void }) {
  const results: TorqueResult[] = [];
  let value = 0;
  let holding = false;
  let clicked = false;
  let last = 0;
  let raf = 0;

  const root = openDialog(
    `<h2>${opts.heading}</h2>
    <p>${opts.note}</p>
    <div class="torque">
      <div class="tq-meter">
        <div class="tq-band" style="left:${OK_FROM}%;width:${OK_TO - OK_FROM}%"></div>
        <div class="tq-fill"></div>
        <div class="tq-click">カチッ</div>
      </div>
      <div class="tq-scale"><span>ゆるい</span><span>適正</span><span>締めすぎ</span></div>
      <div class="tq-bolts">${Array.from({ length: BOLTS }, (_, i) => `<span class="tq-bolt" data-i="${i}">${i + 1}</span>`).join("")}</div>
    </div>
    ${mechanicLine(`<span class="tq-msg">押し続けるとトルクが上がる。レンチが「カチッ」と鳴ったら離せ。確かめるときは締める方向で。</span>`)}
    <button class="primary tq-hold">押して締める（スペースキーでも）</button>`,
  );
  const fill = root.querySelector<HTMLElement>(".tq-fill")!;
  const click = root.querySelector<HTMLElement>(".tq-click")!;
  const msg = root.querySelector<HTMLElement>(".tq-msg")!;
  const hold = root.querySelector<HTMLButtonElement>(".tq-hold")!;

  const draw = () => {
    fill.style.width = `${Math.min(100, value)}%`;
    click.classList.toggle("on", clicked);
  };

  const loop = (now: number) => {
    if (!holding) return;
    // 締めるほど速く上がる（dv/dt = 30 + 0.5v）。実際の経過時間で計算するので、遅いPCでも同じ速さ
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    value = (value + 60) * Math.exp(0.5 * dt) - 60;
    if (value >= OK_FROM) clicked = true;
    draw();
    if (value >= 100) release();
    else raf = requestAnimationFrame(loop);
  };

  const press = () => {
    if (holding || results.length >= BOLTS) return;
    holding = true;
    value = 0;
    clicked = false;
    last = performance.now();
    hold.classList.add("down");
    raf = requestAnimationFrame(loop);
  };

  const release = () => {
    if (!holding) return;
    holding = false;
    cancelAnimationFrame(raf);
    hold.classList.remove("down");
    const r: TorqueResult = value < OK_FROM ? "under" : value > OK_TO ? "over" : "ok";
    results.push(r);
    const bolt = root.querySelector<HTMLElement>(`.tq-bolt[data-i="${results.length - 1}"]`)!;
    bolt.classList.add(r);
    bolt.title = RESULT_TEXT[r];
    msg.textContent =
      r === "ok" ? "よし、ちょうどいい。" : r === "under" ? "ゆるいぞ。もう少し待ってから離せ。" : "締めすぎだ！木のハブがつぶれる。";
    if (results.length >= BOLTS) finish();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key !== " ") return;
    e.preventDefault();
    if (e.type === "keydown" && !e.repeat) press();
    if (e.type === "keyup") release();
  };
  window.addEventListener("keydown", onKey);
  window.addEventListener("keyup", onKey);
  hold.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    hold.setPointerCapture(e.pointerId);
    press();
  });
  hold.addEventListener("pointerup", release);
  hold.addEventListener("pointercancel", release);

  function finish() {
    window.removeEventListener("keydown", onKey);
    window.removeEventListener("keyup", onKey);
    const overall = overallTorque(results);
    const comment = {
      ok: "3本とも適正だ。これで長持ちする。",
      under: "ゆるいボルトがある。このままだと早くゆるむぞ（締め直しはできる）。",
      over: "締めすぎた。木がつぶれて、区間ごとにプロペラが弱っていく。締めすぎは取り消せない。",
    }[overall];
    msg.textContent = comment;
    hold.textContent = `結果：${RESULT_TEXT[overall]}　（次へ）`;
    hold.classList.add("done");
    // 最後に離したときの click を拾わないよう、少し待ってから「次へ」を受け付ける
    setTimeout(() => hold.addEventListener("click", () => opts.onDone(overall), { once: true }), 300);
  }

  draw();
}
