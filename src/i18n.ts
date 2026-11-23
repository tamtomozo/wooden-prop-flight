/**
 * 日本語版と英語版の切り替え。
 *
 * 文言はそれぞれの場所で tr("日本語", "English") と両方書いておき、起動したときに決めた言語のほうを使う。
 * コースのデータなどは読み込んだときに文言が決まるので、言語を変えるとページを読み直す。
 *
 * 言語の決め方：URL の ?lang=en / ?lang=ja → 前に選んだ言語 → ブラウザの言語（日本語以外なら英語）。
 * テスト（Node）では window が無いので、いつも日本語。
 */
export type Lang = "ja" | "en";

const LANG_KEY = "plane.lang";

function detectLang(): Lang {
  try {
    const q = new URLSearchParams(window.location.search).get("lang");
    if (q === "ja" || q === "en") return q;
  } catch {
    /* URL が読めなければ次へ */
  }
  try {
    const saved = window.localStorage.getItem(LANG_KEY);
    if (saved === "ja" || saved === "en") return saved;
  } catch {
    /* 保存した言語が読めなければ次へ */
  }
  try {
    const langs = window.navigator.languages?.length ? window.navigator.languages : [window.navigator.language];
    return langs.some((l) => l?.toLowerCase().startsWith("ja")) ? "ja" : "en";
  } catch {
    return "ja";
  }
}

export const LANG: Lang = typeof window === "undefined" ? "ja" : detectLang();
export const isEn = LANG === "en";

/** いまの言語のほうを返す */
export function tr<T>(ja: T, en: T): T {
  return LANG === "en" ? en : ja;
}

/** 英語で数をかぞえるときの単数・複数（"1 leg" / "2 legs"） */
export function plural(n: number, one: string, many = one + "s"): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** 言語を変えて、ページを読み直す（URL の ?lang= は外す） */
export function switchLang(lang: Lang): void {
  try {
    window.localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* 保存できなくても、URL で言語を渡す */
  }
  const url = new URL(window.location.href);
  url.searchParams.set("lang", lang);
  window.location.href = url.toString();
}

/**
 * index.html に書いてある日本語を英語に置きかえる。
 * data-en：要素の最初の文字（子要素の前）を置きかえる。data-en-title / data-en-label：title / aria-label。
 */
export function localizeStatic(root: ParentNode = document): void {
  document.documentElement.lang = LANG;
  if (!isEn) return;
  root.querySelectorAll<HTMLElement>("[data-en]").forEach((el) => {
    const text = el.dataset.en!;
    const first = Array.from(el.childNodes).find((n) => n.nodeType === Node.TEXT_NODE && n.textContent!.trim());
    if (first) first.textContent = text;
    else el.insertBefore(document.createTextNode(text), el.firstChild);
  });
  root.querySelectorAll<HTMLElement>("[data-en-title]").forEach((el) => (el.title = el.dataset.enTitle!));
  root.querySelectorAll<HTMLElement>("[data-en-label]").forEach((el) => el.setAttribute("aria-label", el.dataset.enLabel!));
  const title = document.querySelector<HTMLElement>("title[data-en]");
  if (title) document.title = title.dataset.en!;
}
