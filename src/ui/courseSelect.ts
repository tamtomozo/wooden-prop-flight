// 最初の画面：コースを選ぶ。陸路では行けない海峡・諸島・大洋と、高い山脈を飛びこえる旅。
import { COURSES } from "../data/courses";
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

export function showCourseSelect(onChoose: (w: World) => void, current?: string) {
  const cards = COURSES.map((w) => {
    const path = shortestPath(w, w.startId, w.goalId);
    const lo = minSeaKm(w);
    const hi = maxSeaKm(w);
    const ridge = highestRidge(w);
    const sea = [hi > 0 ? `海の上 ${lo === hi ? hi : `${lo}〜${hi}`} km` : "", ridge > 0 ? `いちばん高い山 ${ridge} m` : ""]
      .filter(Boolean)
      .join("・") || "海も山もない";
    return `<button class="course-card ${w.id === current ? "on" : ""} ${w.id === WORLD.id ? "practice" : ""}" data-act="course" data-id="${w.id}">
      ${mapSvg(w, { current: w.startId, destination: null, selectable: [], suggested: path, mini: true })}
      <span class="course-body">
        <b class="course-title">${w.title}</b>
        <span class="course-level" aria-label="難しさ ${w.level}">${"★".repeat(w.level)}${"☆".repeat(3 - w.level)}</span>
        <small class="course-route">${field(w, w.startId).name} → ${field(w, w.goalId).name}・最短 ${pathDistance(w, path)} km・${sea}</small>
        <small>${w.description}</small>
        <small class="course-history">${w.history}</small>
      </span>
    </button>`;
  }).join("");

  openDialog(
    `<h2>コースを選ぶ</h2>
    <p class="lead">陸の道では行けない、海の向こう・山の向こうへ。木のプロペラ機で、海峡・諸島・大洋・山脈を飛びこえる。</p>
    ${mechanicLine("海の上では、エンジンが止まったら降りる畑はない。山の上では、空気が薄くて上がらない。燃料と天気と、引き返す勇気がすべてだ。")}
    <div class="course-list">${cards}</div>`,
    { wide: true },
  );
  setActions({
    course: (el) => onChoose(COURSES.find((w) => w.id === el.dataset.id)!),
  });
}
