// 最初の画面：コースを選ぶ。陸路では行けない海峡・諸島・大洋と、高い山脈を飛びこえる旅。
import { COURSES } from "../data/courses";
import { ACHIEVEMENTS, type Progress } from "../game/records";
import { field, legBetween, longestSeaKm, pathDistance, shortestPath } from "../data/world";
import type { World } from "../model/types";
import { mechanicLine, openDialog, setActions } from "./dialog";
import { mapSvg } from "./mapView";
import { tr } from "../i18n";

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
  /** タイトル画面へ戻る */
  onTitle: () => void;
  current?: string;
  /** 自己ベストと実績 */
  progress: Progress;
}

export function showCourseSelect({ onChoose, onQuick, onTitle, current, progress }: CourseSelectOptions) {
  const cards = COURSES.map((w) => {
    const path = shortestPath(w, w.startId, w.goalId);
    const lo = minSeaKm(w);
    const hi = maxSeaKm(w);
    const ridge = highestRidge(w);
    const sea =
      [
        hi > 0 ? `${tr("海の上", "Over water")} ${lo === hi ? hi : `${lo}–${hi}`} km` : "",
        ridge > 0 ? `${tr("いちばん高い山", "Highest peak")} ${ridge} m` : "",
      ]
        .filter(Boolean)
        .join(tr("・", " · ")) || tr("海も山もない", "No sea, no mountains");
    return `<div class="course-card ${w.id === current ? "on" : ""} ${w.tutorial ? "practice" : ""}">
      ${mapSvg(w, { current: w.startId, destination: null, selectable: [], suggested: path, mini: true })}
      <span class="course-body">
        <b class="course-title">${w.title}</b>
        ${
          w.tutorial
            ? `<span class="course-level tutorial">${tr("はじめての人むけ・飛行を止めて説明つき", "For first-timers · pauses to explain")}</span>`
            : `<span class="course-level" aria-label="${tr("難しさ", "Difficulty")} ${w.level}">${"★".repeat(w.level)}${"☆".repeat(3 - w.level)}</span>`
        }
        ${bestHtml(progress, w.id)}
        <small class="course-route">${field(w, w.startId).name} → ${field(w, w.goalId).name}${tr("・最短", " · shortest")} ${pathDistance(w, path)} km${tr("・", " · ")}${sea}</small>
        <small>${w.description}</small>
        <small class="course-history">${w.history}</small>
      </span>
      <span class="course-go">
        <button class="quick" data-act="quick" data-id="${w.id}" title="${tr("格納庫を飛ばして、整備士のおすすめセッティングで出発する", "Skip the hangar and take off with the mechanic's recommended setup")}">${tr("すぐ飛ぶ", "Fly now")}<small>${tr("整備士のおすすめで", "Mechanic's setup")}</small></button>
        <button data-act="course" data-id="${w.id}">${tr("格納庫で準備", "Prepare in hangar")}<small>${tr("機体を自分で決める", "Set up the plane yourself")}</small></button>
      </span>
    </div>`;
  }).join("");

  openDialog(
    `<div class="dialog-head"><h2>${tr("コースを選ぶ", "Choose a course")}</h2><button class="back" data-act="title">${tr("タイトルへ", "Title")}</button></div>
    <p class="lead">${tr(
      "陸の道では行けない、海の向こう・山の向こうへ。木のプロペラ機で、海峡・諸島・山脈・大洋を飛びこえる。はじめての人は、チュートリアル（海ルート・山ルート）から。",
      "To places no road can reach: beyond the sea, beyond the mountains. Fly a wooden-propeller plane over straits, islands, ranges and oceans. New pilots, start with a tutorial (Sea Route or Mountain Route).",
    )}</p>
    ${mechanicLine(
      tr(
        "海の上では、エンジンが止まったら降りる畑はない。山の上では、空気が薄くて上がらない。燃料と天気と、引き返す勇気がすべてだ。",
        "Over the sea, if the engine stops there's no field to land in. Over the mountains, the air is thin and you won't climb. Fuel, weather, and the courage to turn back are everything.",
      ),
    )}
    <div class="course-list">${cards}</div>
    ${achievementsHtml(progress)}`,
    { wide: true, seeThrough: true },
  );
  const pick = (el: HTMLElement) => COURSES.find((w) => w.id === el.dataset.id)!;
  setActions({
    course: (el) => onChoose(pick(el)),
    quick: (el) => onQuick(pick(el)),
    title: onTitle,
  });
}

/** カードに出す自己ベスト（まだ着いていなければ「未踏」） */
function bestHtml(p: Progress, id: string): string {
  const b = p.best[id];
  return b
    ? `<span class="course-best">${tr("自己ベスト", "Best")} <b class="rank-${b.rank}">${b.rank}</b> ${tr(
        `${b.total} 点・${b.day}日目に着いた`,
        `${b.total} pts · arrived on day ${b.day}`,
      )}</span>`
    : `<span class="course-best none">${tr("まだ渡っていない", "Not crossed yet")}</span>`;
}

/** 実績の一覧。手に入れていないものは題名を「？？？」で伏せ、手がかりだけ見せる */
function achievementsHtml(p: Progress): string {
  const got = ACHIEVEMENTS.filter((a) => p.achievements.includes(a.id)).length;
  return `<details class="howto achievements">
    <summary>${tr("実績", "Achievements")} ${got} / ${ACHIEVEMENTS.length}</summary>
    <ul>${ACHIEVEMENTS.map((a) =>
      p.achievements.includes(a.id)
        ? `<li class="got"><b>${a.title}</b><small>${a.text}${a.reward ? `<br />${a.reward}` : ""}</small></li>`
        : `<li><b>？？？</b><small>${a.hint}</small></li>`,
    ).join("")}</ul>
  </details>`;
}
