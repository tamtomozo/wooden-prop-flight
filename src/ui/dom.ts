// 毎フレーム画面を書き換えるときの、むだな作業を減らす小道具。
//
// ・要素の大きさ（clientWidth など）を毎フレーム読むと、直前に書き換えた文字のせいで
//   ブラウザがその場でレイアウトを計算し直す（強制レイアウト）。大きさは ResizeObserver で
//   変わったときだけ受け取って覚えておく。
// ・同じ文字やクラスを入れ直しても、ブラウザはレイアウトやスタイルを計算し直すことがある。
//   変わったときだけ書き換える。

/** 要素の大きさ（CSS ピクセル。clientWidth / clientHeight と同じ） */
export interface ElementSize {
  w: number;
  h: number;
}

const sizes = new WeakMap<Element, ElementSize>();
let observer: ResizeObserver | null | undefined;

function sizeObserver(): ResizeObserver | null {
  if (observer === undefined) {
    observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver((entries) => {
            // 知らせが来るのはレイアウトの計算が済んだあとなので、ここで読んでも計算し直しにならない
            for (const e of entries) {
              const el = e.target as HTMLElement;
              const s = sizes.get(el);
              if (s) {
                s.w = el.clientWidth;
                s.h = el.clientHeight;
              }
            }
          });
  }
  return observer;
}

/** 要素の今の大きさ。返したオブジェクトは、大きさが変わると中身が書き換わる */
export function elementSize(el: HTMLElement): ElementSize {
  const ro = sizeObserver();
  let s = sizes.get(el);
  if (!s) {
    // 最初の大きさも ResizeObserver から受け取る（最初の描画のときに知らせが来る）。
    // ここで直接読むと、知らせが来る前に要素が隠れて 0×0 になったとき、
    // 「0×0 のまま」とみなされて知らせが来ず、古い大きさが残ってしまう
    s = { w: 0, h: 0 };
    sizes.set(el, s);
    ro?.observe(el);
  }
  if (!ro) {
    // ResizeObserver がない古いブラウザでは、これまでどおり毎回読む
    s.w = el.clientWidth;
    s.h = el.clientHeight;
  }
  return s;
}

/** 文字が変わったときだけ書き換える */
export function setText(el: Element, text: string) {
  if (el.textContent !== text) el.textContent = text;
}

const htmlShown = new WeakMap<Element, string>();
/** HTML が変わったときだけ書き換える（その要素の中身は、いつもこの関数で書くこと） */
export function setHtml(el: Element, html: string) {
  if (htmlShown.get(el) === html) return;
  htmlShown.set(el, html);
  el.innerHTML = html;
}

/** classes のうち on だけを付け、ほかは外す（on が null なら全部外す）。変わらないものには触らない */
export function setOneClass(el: Element, classes: readonly string[], on: string | null) {
  for (const c of classes) el.classList.toggle(c, c === on);
}

/** ボタンや入力欄の disabled を、変わったときだけ書き換える */
export function setDisabled(el: HTMLButtonElement | HTMLInputElement, disabled: boolean) {
  if (el.disabled !== disabled) el.disabled = disabled;
}

/** hidden を、変わったときだけ書き換える */
export function setHidden(el: HTMLElement, hidden: boolean) {
  if (el.hidden !== hidden) el.hidden = hidden;
}

/** インラインスタイル（CSS 変数も可）を、変わったときだけ書き換える */
export function setStyle(el: HTMLElement, prop: string, value: string) {
  if (el.style.getPropertyValue(prop) !== value) el.style.setProperty(prop, value);
}
