// 最初の画面：コースを選ぶ。陸路では行けない海峡・諸島・大洋と、高い山脈を飛びこえる旅。
import { COURSES } from "../data/courses";
import { ACHIEVEMENTS, type Progress } from "../game/records";
import { field, legBetween, longestSeaKm, pathDistance, shortestPath, WORLD } from "../data/world";
import type { World } from "../model/types";
import { mechanicLine, openDialog, setActions } from "./dialog";
import { mapSvg } from "./mapView";

/** 地図の中の、ひと続きの海の上の長さ（いちばん長い道と、いちばん短い道） */
const maxSeaKm = (w: World) => Math.max(0, ...w.edges.map((e) => longestSeaKm(legBetween(w, e.a, e.b))));
/** 地図の中で、いちばん高い山 m（山がなければ 0） */
const highestRidge = (w: World) => Math.max(0, ...w.edges.flatMap((e) => e.terrain.map((r) => r.height)));
const minSeaKm = (w: World) => {
  const sea = w.edges.map((e) => longestSeaKm(legBetween(w, e.a, e.b))).filter((k) => k > 0);
  return sea.length ? Math.min(...sea) : 0;
};

export interface CourseSelectOptions {
  /** 格納庫で準備する */
  onChoose: (w: World) => void;
  /** 整備士のおすすめセッティングで、格納庫を飛ばしてすぐ飛ぶ */
  onQuick: (w: World) => void;
  current?: string;
  /** 自己ベストと実績 */
  progress: Progress;
}

export function showCourseSelect({ onChoose, onQuick, current, progress }: CourseSelectOptions) {
  const cards = COURSES.map((w) => {
    const path = shortestPath(w, w.startId, w.goalId);
    const lo = minSeaKm(w);
    const hi = maxSeaKm(w);
    const ridge = highestRidge(w);
    const sea = [hi > 0 ? `海の上 ${lo === hi ? hi : `${lo}〜${hi}`} km` : "", ridge > 0 ? `いちばん高い山 ${ridge} m` : ""]
      .filter(Boolean)
      .join("・") || "海も山もない";
    return `<div class="course-card ${w.id === current ? "on" : ""} ${w.id === WORLD.id ? "practice" : ""}">
      ${mapSvg(w, { current: w.startId, destination: null, selectable: [], suggested: path, mini: true })}
      <span class="course-body">
        <b class="course-title">${w.title}</b>
        <span class="course-level" aria-label="難しさ ${w.level}">${"★".repeat(w.level)}${"☆".repeat(3 - w.level)}</span>
        ${bestHtml(progress, w.id)}
        <small class="course-route">${field(w, w.startId).name} → ${field(w, w.goalId).name}・最短 ${pathDistance(w, path)} km・${sea}</small>
        <small>${w.description}</small>
        <small class="course-history">${w.history}</small>
      </span>
      <span class="course-go">
        <button class="quick" data-act="quick" data-id="${w.id}" title="格納庫を飛ばして、整備士のおすすめセッティングで出発する">すぐ飛ぶ<small>整備士のおすすめで</small></button>
        <button data-act="course" data-id="${w.id}">格納庫で準備<small>機体を自分で決める</small></button>
      </span>
    </div>`;
  }).join("");

  openDialog(
    `<h2>コースを選ぶ</h2>
    <p class="lead">陸の道では行けない、海の向こう・山の向こうへ。木のプロペラ機で、海峡・諸島・山脈・大洋を飛びこえる。</p>
    ${mechanicLine("海の上では、エンジンが止まったら降りる畑はない。山の上では、空気が薄くて上がらない。燃料と天気と、引き返す勇気がすべてだ。")}
    <div class="course-list">${cards}</div>
    ${achievementsHtml(progress)}`,
    { wide: true, seeThrough: true },
  );
  const pick = (el: HTMLElement) => COURSES.find((w) => w.id === el.dataset.id)!;
  setActions({
    course: (el) => onChoose(pick(el)),
    quick: (el) => onQuick(pick(el)),
  });
}

/** カードに出す自己ベスト（まだ着いていなければ「未踏」） */
function bestHtml(p: Progress, id: string): string {
  const b = p.best[id];
  return b
    ? `<span class="course-best">自己ベスト <b class="rank-${b.rank}">${b.rank}</b> ${b.total} 点・${b.day}日目に着いた</span>`
    : `<span class="course-best none">まだ渡っていない</span>`;
}

/** 実績の一覧。手に入れていないものは題名を「？？？」で伏せ、手がかりだけ見せる */
function achievementsHtml(p: Progress): string {
  const got = ACHIEVEMENTS.filter((a) => p.achievements.includes(a.id)).length;
  return `<details class="howto achievements">
    <summary>実績 ${got} / ${ACHIEVEMENTS.length}</summary>
    <ul>${ACHIEVEMENTS.map((a) =>
      p.achievements.includes(a.id)
        ? `<li class="got"><b>${a.title}</b><small>${a.text}${a.reward ? `<br />${a.reward}` : ""}</small></li>`
        : `<li><b>？？？</b><small>${a.hint}</small></li>`,
    ).join("")}</ul>
  </details>`;
}
