import { ACHIEVEMENTS, challengeCourses, courseLabel, type Progress } from "../game/records";
import { isEn, switchLang, tr } from "../i18n";
import { MECHANIC_NAME } from "./dialog";
// タイトル画面：後ろで機体がひとりでに飛ぶ景色の上に題名を出し、画面の下に「Enter かスペースではじめる」を出す。
// 計器盤や上の帯は隠して、景色を画面いっぱいに見せる。画面のどこを押しても（Enter／スペースでも）はじまる。
// 右上の「スタッフクレジット」で、同じ景色の上にクレジット（クリアしたコース・操縦者・開発）を出す。

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

/**
 * クレジットの締めくくりの複葉機のロゴ。紺地に橙の縁取りのバッジに、横から見た複葉機を収める
 * （後ろの3Dの景色に埋もれないように）。プロペラが回り、機体はゆっくり上下する。
 */
const BIPLANE_LOGO = `<svg class="cr-logo" viewBox="0 0 260 150" role="img" aria-label="Thank you for playing!">
  <defs>
    <linearGradient id="cr-wood" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#7a4a22" /><stop offset="0.5" stop-color="#c58b52" /><stop offset="1" stop-color="#7a4a22" />
    </linearGradient>
    <linearGradient id="cr-sky" x1="0" x2="0" y1="0" y2="1">
      <stop offset="0" stop-color="#2b4a6e" /><stop offset="1" stop-color="#16202c" />
    </linearGradient>
  </defs>
  <!-- バッジ -->
  <rect x="3" y="3" width="254" height="144" rx="72" fill="url(#cr-sky)" stroke="currentColor" stroke-width="3" />
  <rect x="11" y="11" width="238" height="128" rx="64" fill="none" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.2" />
  <!-- 風を切る線 -->
  <path d="M20 66 H44 M16 79 H40 M24 92 H46" stroke="#cfe3ee" stroke-opacity="0.55" stroke-width="2.5" stroke-linecap="round" />
  <!-- 位置合わせ（外の g）と、上下のゆれ（内の g。CSS の transform が属性の transform を上書きするので分ける） -->
  <g transform="translate(8 14)"><g class="cr-plane">
    <!-- 尾翼 -->
    <path d="M60 53 L46 28 L35 28 L37 54 Z" fill="#c9433a" />
    <ellipse cx="50" cy="57" rx="17" ry="3.2" fill="#e9e2cf" />
    <path d="M40 60 L33 71" stroke="#2a2420" stroke-width="2.5" stroke-linecap="round" />
    <!-- 下の翼と脚 -->
    <path d="M148 73 L143 97 M162 73 L147 97" stroke="#2a2420" stroke-width="2.5" stroke-linecap="round" />
    <circle cx="145" cy="100" r="8.5" fill="#2a2420" /><circle cx="145" cy="100" r="3" fill="#9aa0a6" />
    <path d="M112 76 Q 140 72 174 75 Q 176 78 172 80 Q 140 80 112 80 Z" fill="#e9e2cf" />
    <path d="M112 76 L124 75 L124 80 L112 80 Z" fill="#c9433a" />
    <!-- 胴体 -->
    <path d="M190 47 L122 45 L60 53 L37 50 L36 58 L60 64 L122 75 L190 73 Z" fill="#e9e2cf" />
    <path d="M190 59 L122 60 L62 58" fill="none" stroke="#c9433a" stroke-width="4" />
    <!-- 操縦士 -->
    <path d="M146 45 Q 150 36 158 38" fill="none" stroke="#cfe3ee" stroke-width="2.5" stroke-linecap="round" />
    <circle cx="138" cy="40" r="6" fill="#5a3b25" />
    <!-- 支柱と上の翼 -->
    <path d="M124 27 L126 76 M164 26 L162 75 M142 27 L140 46 M154 27 L156 46" stroke="#2a2420" stroke-width="2.5" stroke-linecap="round" />
    <path d="M124 27 L162 75 M164 26 L126 76" stroke="#2a2420" stroke-width="1" />
    <path d="M108 22 Q 140 14 178 20 Q 181 24 176 27 Q 140 28 108 28 Z" fill="#e9e2cf" />
    <path d="M108 22 L121 20 L121 28 L108 28 Z" fill="#c9433a" />
    <!-- エンジンとプロペラ -->
    <rect x="186" y="46" width="16" height="28" rx="5" fill="#6b7178" />
    <path d="M202 54 Q 214 60 202 66 Z" fill="#c9433a" />
    <ellipse class="cr-prop" cx="207" cy="60" rx="3.2" ry="34" fill="url(#cr-wood)" />
  </g></g>
</svg>`;

let onKey: ((e: KeyboardEvent) => void) | null = null;
let onClick: (() => void) | null = null;

/** いまクレジットを出しているか（出しているあいだは Enter／スペース・クリックではじめない） */
let creditsOpen = false;

/** タイトルを出す。onStart：コース選びへ。progress：クレジットに出す、クリアしたコースの記録 */
export function showTitle(onStart: () => void, progress: Progress) {
  creditsOpen = false;
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
    <button class="title-credits-link">${tr("スタッフクレジット", "Credits")}</button>
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

  // スタッフクレジットを開く（ゲームははじめない）
  title.querySelector<HTMLButtonElement>(".title-credits-link")!.addEventListener("click", (e) => {
    e.stopPropagation();
    openCredits(progress);
  });

  const leave = () => {
    hideTitle();
    onStart();
  };
  removeListeners();
  onKey = (e) => {
    if (creditsOpen) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeCredits();
      }
      return;
    }
    if (e.key !== "Enter" && e.key !== " ") return;
    // Tab でリンクやボタンを選んで Enter を押したときは、そちらを押す
    if (e.target instanceof HTMLAnchorElement || e.target instanceof HTMLButtonElement) return;
    e.preventDefault();
    leave();
  };
  onClick = () => {
    if (!creditsOpen) leave();
  };
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

// ---- スタッフクレジット ----

/** クリアしたコースの一覧（自己ベストのランク・点・何日目に着いたか） */
function clearedHtml(p: Progress): string {
  const courses = challengeCourses();
  const cleared = courses.filter((w) => p.best[w.id]);
  const rows = cleared
    .map((w) => {
      const b = p.best[w.id]!;
      return `<li><span class="cr-course">${courseLabel(w)}</span><span class="cr-best"><b class="rank-${b.rank}">${b.rank}</b> ${tr(
        `${b.total} 点・${b.day}日目`,
        `${b.total} pts · day ${b.day}`,
      )}</span></li>`;
    })
    .join("");
  const got = p.achievements.length;
  return `<p class="cr-count">${tr(
    `${courses.length} コースのうち ${cleared.length} コースをクリア・実績 ${got} / ${ACHIEVEMENTS.length}`,
    `${cleared.length} of ${courses.length} courses cleared · achievements ${got} / ${ACHIEVEMENTS.length}`,
  )}</p>
  ${
    rows
      ? `<ul class="cr-cleared">${rows}</ul>`
      : `<p class="cr-none">${tr("まだクリアしたコースはありません。最初の空へ。", "No courses cleared yet. Off to your first sky.")}</p>`
  }`;
}

function setTitleParts(hidden: boolean) {
  title.classList.toggle("credits-mode", hidden);
  for (const sel of [".title-inner", ".title-start", ".title-links"]) {
    title.querySelector<HTMLElement>(sel)?.toggleAttribute("hidden", hidden);
  }
}

function openCredits(progress: Progress) {
  creditsOpen = true;
  setTitleParts(true);
  const box = document.createElement("div");
  box.className = "title-credits";
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-label", tr("スタッフクレジット", "Credits"));
  box.innerHTML = `<h2>${tr("スタッフクレジット", "Credits")}</h2>
    <section>
      <h3>${tr("クリアしたコース", "Courses cleared")}</h3>
      ${clearedHtml(progress)}
    </section>
    <section>
      <h3>${tr("登場人物", "Cast")}</h3>
      <dl class="cr-cast">
        <dt>${tr("整備士", "Mechanic")}</dt><dd class="cr-name">${MECHANIC_NAME}</dd>
        <dt>${tr("操縦士", "Pilot")}</dt><dd class="cr-name">${tr("あなた", "You")}</dd>
      </dl>
    </section>
    <section>
      <h3>${tr("開発", "Development")}</h3>
      <p class="cr-name">${tr("タムゾウ", "Tamuzo")}</p>
      <p class="cr-name">Claude</p>
    </section>
    <button class="cr-back">${tr("タイトルへ戻る", "Back to title")}<small>Esc</small></button>
    ${BIPLANE_LOGO}`;
  // クレジットの上を押してもゲームははじめない
  box.addEventListener("click", (e) => e.stopPropagation());
  box.querySelector<HTMLButtonElement>(".cr-back")!.addEventListener("click", closeCredits);
  title.appendChild(box);
  title.scrollTop = 0;
  box.querySelector<HTMLButtonElement>(".cr-back")!.focus({ preventScroll: true });
}

function closeCredits() {
  creditsOpen = false;
  title.querySelector(".title-credits")?.remove();
  setTitleParts(false);
  // フォーカスはボタンに戻さない（戻すと、次の Enter でクレジットがまた開き、ゲームがはじまらない）
  if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

export function hideTitle() {
  creditsOpen = false;
  title.classList.remove("credits-mode");
  removeListeners();
  app.classList.remove("title-mode");
  title.hidden = true;
  title.innerHTML = "";
}
