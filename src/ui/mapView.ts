// 地図（2章「ルート計画：地図上で経由地を選ぶ」）。SVG の文字列を作る。
// 行ける飛行場は data-act="dest" でクリックできる（setActions で受け取る）。
import { edgeDistance, field, seaKm, seaStretches } from "../data/world";
import type { World } from "../model/types";
import { tr } from "../i18n";

export interface MapOptions {
  /** 今いる飛行場 */
  current: string;
  /** 選んでいる次の行き先 */
  destination: string | null;
  /** クリックして選べる飛行場 */
  selectable: string[];
  /** 目的地へのいちばん近い道順（点線で示す） */
  suggested: string[];
  /** これまでに飛んだ道（[from, to] の並び） */
  flown?: [string, string][];
  /** 小さな地図（コース選び用）。滑走路の文字を書かない */
  mini?: boolean;
}

const PAD = 46;
const short = (name: string) => name.replace(tr("飛行場", " Field"), "");

export function mapSvg(w: World, o: MapOptions): string {
  const xs = w.fields.map((f) => f.x);
  const ys = w.fields.map((f) => f.y);
  // 小さな地図では、地図の大きさに合わせて文字と印を大きくする（どのコースでも同じくらいに見えるように）
  const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) + PAD * 2;
  const k = o.mini ? Math.max(1, span / 380) : 1;
  const padX = (PAD + 30) * k + (o.mini ? 60 * k : 0);
  const minX = Math.min(...xs) - padX;
  const maxX = Math.max(...xs) + padX;
  const minY = Math.min(...ys) - PAD * k;
  const maxY = Math.max(...ys) + PAD * k;
  // 北が上
  const px = (x: number) => x - minX;
  const py = (y: number) => maxY - y;
  const W = maxX - minX;
  const H = maxY - minY;

  const onPath = (a: string, b: string, path: string[]) => {
    const i = path.indexOf(a);
    return i >= 0 && (path[i + 1] === b || path[i - 1] === b);
  };
  const flown = (a: string, b: string) => (o.flown ?? []).some(([p, q]) => (p === a && q === b) || (p === b && q === a));

  // 道
  const edges = w.edges
    .map((e) => {
      const a = field(w, e.a);
      const b = field(w, e.b);
      const chosen =
        o.destination !== null &&
        ((e.a === o.current && e.b === o.destination) || (e.b === o.current && e.a === o.destination));
      const cls = chosen ? "chosen" : flown(e.a, e.b) ? "flown" : onPath(e.a, e.b, o.suggested) ? "suggested" : "";
      // 距離の文字は、道の真ん中から少し横にずらして書く（飛行場の名前と重ならないように）
      const dx = px(b.x) - px(a.x);
      const dy = py(b.y) - py(a.y);
      const len = Math.hypot(dx, dy) || 1;
      const side = dx * dy > 0 ? -1 : 1;
      const mx = (px(a.x) + px(b.x)) / 2 + (side * -dy * 16) / len;
      const my = (py(a.y) + py(b.y)) / 2 + (side * dx * 16) / len + 5;
      // 山のある道には、山の印
      // 海の上の部分は、青い線を重ねる
      const D = edgeDistance(w, e);
      const sea = seaStretches(w, e.a, e.b, D);
      const at = (km: number) => [px(a.x + ((b.x - a.x) * km) / D), py(a.y + ((b.y - a.y) * km) / D)];
      const seaLines = sea
        .map((r) => {
          const [x1, y1] = at(r.fromKm);
          const [x2, y2] = at(r.toKm);
          return `<line class="sea-line" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" />`;
        })
        .join("");
      const mountains = e.terrain
        .map((r) => {
          const D = edgeDistance(w, e);
          const t = (r.fromKm + r.toKm) / 2 / D;
          const x = px(a.x + (b.x - a.x) * t);
          const y = py(a.y + (b.y - a.y) * t);
          return `<path class="mtn" d="M${x - 14},${y + 9} L${x},${y - 12} L${x + 14},${y + 9} Z"><title>${r.name}（${r.height} m）</title></path>`;
        })
        .join("");
      return `<g class="edge ${cls}">
        <line x1="${px(a.x)}" y1="${py(a.y)}" x2="${px(b.x)}" y2="${py(b.y)}" />
        ${seaLines}
        ${mountains}
        ${o.mini ? "" : `<text class="km ${sea.length ? "sea" : ""}" x="${mx}" y="${my}" text-anchor="middle">${D}km${sea.length ? tr(`（海${seaKm({ sea })}）`, ` (sea ${seaKm({ sea })})`) : ""}</text>`}
      </g>`;
    })
    .join("");

  // 飛行場
  const fields = w.fields
    .map((f) => {
      const x = px(f.x);
      const y = py(f.y);
      const selectable = o.selectable.includes(f.id);
      const cls = [
        "field",
        f.surface,
        f.id === o.current ? "current" : "",
        f.id === o.destination ? "chosen" : "",
        selectable ? "selectable" : "",
        f.id === w.goalId ? "goal" : "",
      ].join(" ");
      // 名前は道と重なりにくい側に書く（西の海沿いと東の山側は右、真ん中の列は左）
      const right = f.labelSide ? f.labelSide === "right" : f.x < 0 || f.x >= 40;
      const lx = right ? x + 16 * k : x - 16 * k;
      const anchor = right ? "start" : "end";
      const tip = tr(
      `${f.name}　滑走路 ${f.runwayLength} m・${f.surface === "paved" ? "舗装" : "未舗装"}・整備場${f.hasRepairShop ? "あり" : "なし"}・湿度 ${f.humidity}%`,
      `${f.name}  runway ${f.runwayLength} m · ${f.surface === "paved" ? "paved" : "unpaved"} · ${f.hasRepairShop ? "repair shop" : "no repair shop"} · humidity ${f.humidity}%`,
    );
      return `<g class="${cls}" ${selectable ? `data-act="dest" data-id="${f.id}" role="button" tabindex="0"` : ""}>
        <title>${tip}</title>
        ${selectable ? `<circle class="hit" cx="${x}" cy="${y}" r="26" />` : ""}
        ${f.id === o.current ? `<circle class="here" cx="${x}" cy="${y}" r="${17 * k}" />` : ""}
        <circle class="dot" cx="${x}" cy="${y}" r="${9 * k}" />
        ${f.hasRepairShop && !o.mini ? `<text class="shop" x="${x}" y="${y + 4}" text-anchor="middle">${tr("整", "R")}</text>` : ""}
        ${f.id === w.goalId ? `<text class="flag" x="${x}" y="${y - 16 * k}" text-anchor="middle" ${o.mini ? `style="font-size:${20 * k}px"` : ""}>★</text>` : ""}
        <text class="name" x="${lx}" y="${y + (o.mini ? 7 * k : -2)}" text-anchor="${anchor}" ${
          o.mini ? `style="font-size:${19 * k}px;stroke-width:${5 * k}px"` : ""
        }>${short(f.name)}</text>
        ${o.mini ? "" : `<text class="sub" x="${lx}" y="${y + 18}" text-anchor="${anchor}">${f.runwayLength}m${f.surface === "unpaved" ? tr("・草地", " grass") : ""}</text>`}
      </g>`;
    })
    .join("");

  // 陸地の形があれば、背景は海にして陸を描く
  const land = (w.land ?? [])
    .map((poly) => `<path class="land-shape" d="M${poly.map(([x, y]) => `${px(x).toFixed(1)},${py(y).toFixed(1)}`).join(" L")} Z" />`)
    .join("");

  return `<svg class="worldmap${o.mini ? " mini" : ""}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-label="${tr("地図", "Map")}">
    <clipPath id="map-clip-${w.id}"><rect x="0" y="0" width="${W}" height="${H}" rx="14" /></clipPath>
    <rect class="${w.land ? "sea" : "land"}" x="0" y="0" width="${W}" height="${H}" rx="14" />
    <g clip-path="url(#map-clip-${w.id})">${land}</g>
    <text class="north" x="${W - 22}" y="30" text-anchor="middle">${tr("北↑", "N↑")}</text>
    ${edges}
    ${fields}
  </svg>`;
}

/** 地図の凡例 */
export const mapLegend = (w: World) => `<p class="map-legend small">
  ${w.land ? `<span><i class="lg line-sea"></i>${tr("海の上（降りられる場所がない）", "Over water (nowhere to land)")}</span>` : ""}
  <span><i class="lg dot-paved"></i>${tr("舗装", "Paved")}</span>
  <span><i class="lg dot-unpaved"></i>${tr("未舗装（小石で前縁が傷む）", "Unpaved (pebbles nick the leading edge)")}</span>
  <span>${tr("整＝整備場あり", "R = repair shop")}</span>
  ${w.edges.some((e) => e.terrain.length) ? tr("<span>▲＝山越え</span>", "<span>▲ = mountains</span>") : ""}
  <span><i class="lg line-suggested"></i>${tr("目的地へのいちばん近い道順", "Shortest way to the goal")}</span>
</p>`;

