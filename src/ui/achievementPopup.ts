// 実績を手に入れたときの知らせ。画面のまん中に、1つずつ順に出す。
// クリック（またはキー）で次へ。さわらなくても数秒で次へ進み、最後は消える。
import type { Achievement } from "../game/records";

/** 1つを出しておく長さ（ミリ秒） */
const SHOW_MS = 4200;

let host: HTMLElement | null = null;

export function showAchievementPopups(list: Achievement[], onEach?: (a: Achievement) => void) {
  if (!list.length) return;
  host?.remove();
  const el = document.createElement("div");
  el.className = "achv-pop-host";
  el.setAttribute("role", "status");
  el.setAttribute("aria-live", "polite");
  document.body.append(el);
  host = el;

  let i = 0;
  let timer = 0;
  const close = () => {
    clearTimeout(timer);
    window.removeEventListener("keydown", onKey, true);
    el.classList.add("leaving");
    window.setTimeout(() => el.remove(), 300);
    if (host === el) host = null;
  };
  const next = () => {
    clearTimeout(timer);
    if (i >= list.length) return close();
    const a = list[i++];
    el.innerHTML = `<div class="achv-pop">
      <svg class="achv-medal" viewBox="0 0 60 72" aria-hidden="true">
        <path d="M18 2 L30 26 L42 2 L52 2 L36 34 L24 34 L8 2 Z" fill="#c0392b" />
        <circle cx="30" cy="46" r="22" fill="#f2c94c" stroke="#b8860b" stroke-width="3" />
        <path d="M30 32 L34 41 L44 42 L36.5 48.5 L39 58 L30 53 L21 58 L23.5 48.5 L16 42 L26 41 Z" fill="#fff6cf" />
      </svg>
      <div class="achv-head">実績を獲得！${list.length > 1 ? `<small>${i} / ${list.length}</small>` : ""}</div>
      <b class="achv-title">${a.title}</b>
      <p>${a.text}</p>
      ${a.reward ? `<p class="achv-reward">${a.reward}</p>` : ""}
      <small class="achv-tap">${i < list.length ? "クリックで次へ" : "クリックで閉じる"}</small>
    </div>`;
    onEach?.(a);
    timer = window.setTimeout(next, a.reward ? SHOW_MS + 2500 : SHOW_MS);
  };
  // 知らせが出ているあいだのキーは、知らせを進めるだけにする（下のボタンを押してしまわないように）
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " " || e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") close();
      else next();
    }
  };
  el.addEventListener("click", next);
  window.addEventListener("keydown", onKey, true);
  next();
}
