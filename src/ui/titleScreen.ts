import { isEn, switchLang, tr } from "../i18n";
// タイトル画面：後ろで機体がひとりでに飛ぶ景色の上に題名を出し、画面の下に「Enter かスペースではじめる」を出す。
// 計器盤や上の帯は隠して、景色を画面いっぱいに見せる。画面のどこを押しても（Enter／スペースでも）はじまる。

const app = document.querySelector<HTMLElement>("#app")!;
const title = document.querySelector<HTMLElement>("#title")!;

/** 木のプロペラ（まん中の赤いスピナーのまわりを回る） */
const PROP_SVG = `<svg class="title-prop" viewBox="-50 -50 100 100" aria-hidden="true">
  <defs>
    <linearGradient id="title-wood" x1="0" x2="1">
      <stop offset="0" stop-color="#7a4a22" /><stop offset="0.5" stop-color="#c58b52" /><stop offset="1" stop-color="#7a4a22" />
    </linearGradient>
  </defs>
  <g class="blades">
    <path d="M -5 -4 C -6 -20 -7 -38 -1 -47 C 6 -38 6 -20 5 -4 Z" fill="url(#title-wood)" />
    <path d="M -5 4 C -6 20 -7 38 -1 47 C 6 38 6 20 5 4 Z" fill="url(#title-wood)" />
  </g>
  <circle r="8" fill="#c9433a" /><circle r="3" cx="-2" cy="-2" fill="#e8806f" />
</svg>`;

let onKey: ((e: KeyboardEvent) => void) | null = null;
let onClick: (() => void) | null = null;

/** タイトルを出す。onStart：コース選びへ */
export function showTitle(onStart: () => void) {
  title.innerHTML = `<div class="title-inner">
    ${PROP_SVG}
    <p class="title-kicker">${tr("海の向こう・山の向こうへ", "Beyond the sea, beyond the mountains")}</p>
    <h1>${tr("木製プロペラ<br />長距離飛行", "Wooden Prop<br />Long Flight")}</h1>
    <p class="title-lead">${tr(
      "木のプロペラ機で、海峡・諸島・山脈・大洋を飛びこえる。<br />燃料と天気と、引き返す勇気がすべて。",
      "Fly a wooden-propeller plane over straits, islands, mountain ranges and oceans.<br />Fuel, weather, and the courage to turn back are everything.",
    )}</p>
  </div>
  <div class="title-links">
    <button class="title-lang" lang="${isEn ? "ja" : "en"}">${isEn ? "日本語" : "English"}</button>
    <a class="title-lp" href="${tr("./lp/index.html", "./lp/en.html")}">${tr("ゲームの紹介ページ", "About this game")}</a>
  </div>
  <p class="title-start">${tr("Enter かスペースではじめる", "Press Enter or Space to start")}</p>`;
  // 紹介ページへのリンクを押したときは、ゲームをはじめずにリンク先へ進む
  title.querySelector<HTMLAnchorElement>(".title-lp")!.addEventListener("click", (e) => e.stopPropagation());
  // 言語の切り替え（ページを読み直す）
  title.querySelector<HTMLButtonElement>(".title-lang")!.addEventListener("click", (e) => {
    e.stopPropagation();
    switchLang(isEn ? "ja" : "en");
  });

  const leave = () => {
    hideTitle();
    onStart();
  };
  removeListeners();
  onKey = (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    // Tab でリンクやボタンを選んで Enter を押したときは、そちらを押す
    if (e.target instanceof HTMLAnchorElement || e.target instanceof HTMLButtonElement) return;
    e.preventDefault();
    leave();
  };
  onClick = leave;
  window.addEventListener("keydown", onKey);
  title.addEventListener("click", onClick);

  app.classList.add("title-mode");
  title.hidden = false;
}

function removeListeners() {
  if (onKey) window.removeEventListener("keydown", onKey);
  if (onClick) title.removeEventListener("click", onClick);
  onKey = null;
  onClick = null;
}

export function hideTitle() {
  removeListeners();
  app.classList.remove("title-mode");
  title.hidden = true;
  title.innerHTML = "";
}
