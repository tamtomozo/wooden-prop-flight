// もとの地図：7つの飛行場と、それをつなぐ道（夏の日本をイメージ）。
// コース選びには直接は出さない。ここから道を切り出して、チュートリアルの海ルート・山ルートを作る（courses.ts）。
// テストでも、この地図をそのまま使う。
//
//   山越え   みなみ → かわら → たかね → きた（いちばん近い。山の上の雲と、午後の積乱雲）
//   峠経由   かわら → とうげ → たかね（区間は短いが、とうげの滑走路はとても短い）
//   海沿い   みなみ → はまかぜ → ぬまた → きた（山も積乱雲もないが遠い。海霧と向かい風）
//
// 天気のひな形と山の位置は、道の a → b の向きで書く。逆向きに飛ぶときは反転する（legBetween）。
import type { Edge, Leg, Ridge, SeaStretch, Waypoint, WeatherFeature, WeatherTemplate, World } from "../model/types";
import { headwindAt } from "../model/weather";

const minami: Waypoint = {
  id: "minami",
  name: "みなみ飛行場",
  elevation: 20,
  runwayLength: 800,
  surface: "paved",
  hasRepairShop: true,
  humidity: 75,
  temperature: 28,
  dewPoint: 20,
  description: "海沿いの町の飛行場。格納庫と整備場がある。",
  x: 0,
  y: 0,
};

const kawara: Waypoint = {
  id: "kawara",
  name: "かわら飛行場",
  elevation: 40,
  runwayLength: 500,
  surface: "unpaved",
  hasRepairShop: false,
  humidity: 85,
  temperature: 27,
  dewPoint: 23,
  description: "河川敷の草地の滑走路。短くて小石が多い。朝は川霧が出やすい。整備場はない。",
  x: 10,
  y: 200,
};

const hamakaze: Waypoint = {
  id: "hamakaze",
  name: "はまかぜ飛行場",
  elevation: 10,
  runwayLength: 900,
  surface: "paved",
  hasRepairShop: true,
  humidity: 80,
  temperature: 27,
  dewPoint: 22.5,
  description: "海辺の飛行場。滑走路は長く、整備場もある。朝は海霧が出やすい。",
  x: -160,
  y: 150,
};

const touge: Waypoint = {
  id: "touge",
  name: "とうげ飛行場",
  elevation: 500,
  runwayLength: 480,
  surface: "unpaved",
  hasRepairShop: false,
  humidity: 55,
  temperature: 20,
  dewPoint: 10,
  description: "峠の小さな草地の滑走路。とても短いので、重いままでは飛び立てない。",
  x: 70,
  y: 320,
};

const takane: Waypoint = {
  id: "takane",
  name: "たかね飛行場",
  elevation: 900,
  runwayLength: 700,
  surface: "paved",
  hasRepairShop: true,
  humidity: 35,
  temperature: 20,
  dewPoint: 6,
  description: "山を越えた先の乾いた高原。整備場がある。",
  x: 40,
  y: 420,
};

const numata: Waypoint = {
  id: "numata",
  name: "ぬまた飛行場",
  elevation: 60,
  runwayLength: 650,
  surface: "paved",
  hasRepairShop: true,
  humidity: 70,
  temperature: 24,
  dewPoint: 18,
  description: "北の海沿いの町。整備場がある。",
  x: -190,
  y: 380,
};

const kita: Waypoint = {
  id: "kita",
  name: "きた飛行場",
  elevation: 120,
  runwayLength: 600,
  surface: "unpaved",
  hasRepairShop: false,
  humidity: 60,
  temperature: 18,
  dewPoint: 14.5,
  description: "旅の目的地。北の町の草地の滑走路。夕方は霧が出やすい。",
  x: 0,
  y: 640,
};

const winds = (dir: number, speeds: [number, number, number, number], turn = 0) =>
  [0, 1000, 2000, 3000].map((altitude, i) => ({ altitude, direction: dir + turn * i, speed: speeds[i] }));

const EDGES: Edge[] = [
  // ---- 山越え（いちばん近い） ----
  {
    a: "minami",
    b: "kawara",
    cruiseAltitude: 1200,
    note: "海沿いを北へ。途中に雨雲がかかりやすい。低いほど向かい風が弱い。",
    terrain: [],
    weather: {
      winds: winds(0, [15, 25, 40, 45], 7),
      freezingLevel: 4200,
      features: [
        {
          id: "mk-front",
          kind: "rain",
          prob: { morning: 0.9, afternoon: 0.7 },
          cloud: { fromKm: 75, toKm: 145, lateralKm: 5, halfWidthKm: 22, base: 900, top: 2400 },
          rain: { fromKm: 85, toKm: 135, lateralKm: 5, halfWidthKm: 18, intensity: 2 },
        },
      ],
    },
  },
  {
    a: "kawara",
    b: "takane",
    cruiseAltitude: 2500,
    note: "山越え。山の上に雲がかかりやすく、午後は積乱雲が育つ。",
    terrain: [{ fromKm: 80, toKm: 170, height: 1900, name: "北の山なみ" }],
    weather: {
      winds: winds(0, [15, 20, 30, 45]),
      freezingLevel: 3300,
      features: [
        {
          id: "kn-cap",
          kind: "cloud",
          prob: { morning: 0.6, afternoon: 0.8 },
          cloud: { fromKm: 100, toKm: 160, lateralKm: 0, halfWidthKm: 15, base: 2300, top: 3300 },
        },
        {
          id: "kn-wave",
          kind: "turbulence",
          prob: { morning: 0.5, afternoon: 0.8 },
          turbulence: { fromKm: 90, toKm: 180, lateralKm: 0, halfWidthKm: 40, intensity: 2 },
        },
        {
          id: "kn-cb",
          kind: "cb",
          prob: { morning: 0.2, afternoon: 0.8 },
          cb: { alongKm: 135, lateralKm: 6, radiusKm: 6 },
        },
      ],
    },
  },
  {
    a: "takane",
    b: "kita",
    cruiseAltitude: 2000,
    note: "高原から北の平野へ。高いほど追い風が強い。途中に寒冷前線。",
    terrain: [],
    weather: {
      winds: winds(180, [5, 10, 20, 35]),
      freezingLevel: 2800,
      features: [
        {
          id: "ng-front",
          kind: "rain",
          prob: { morning: 0.6, afternoon: 0.6 },
          cloud: { fromKm: 130, toKm: 200, lateralKm: 0, halfWidthKm: 30, base: 1600, top: 3000 },
          rain: { fromKm: 140, toKm: 195, lateralKm: 0, halfWidthKm: 25, intensity: 1 },
        },
        {
          id: "ng-thermal",
          kind: "turbulence",
          prob: { morning: 0.4, afternoon: 0.6 },
          turbulence: { fromKm: 0, toKm: 40, lateralKm: 0, halfWidthKm: 30, intensity: 1 },
        },
      ],
    },
  },

  // ---- 峠経由 ----
  {
    a: "kawara",
    b: "touge",
    cruiseAltitude: 2000,
    note: "低い峠を越える近道。揺れやすく、午後は積乱雲が出ることも。",
    terrain: [{ fromKm: 40, toKm: 115, height: 1500, name: "峠の手前の尾根" }],
    weather: {
      winds: winds(330, [10, 20, 30, 35]),
      freezingLevel: 3500,
      features: [
        {
          id: "kt-rotor",
          kind: "turbulence",
          prob: { morning: 0.5, afternoon: 0.8 },
          turbulence: { fromKm: 30, toKm: 125, lateralKm: 0, halfWidthKm: 25, intensity: 2 },
        },
        {
          id: "kt-cb",
          kind: "cb",
          prob: { morning: 0.1, afternoon: 0.5 },
          cb: { alongKm: 85, lateralKm: -8, radiusKm: 5 },
        },
      ],
    },
  },
  {
    a: "touge",
    b: "takane",
    cruiseAltitude: 2300,
    note: "峠から高原へ。尾根に雲がかかりやすい。",
    terrain: [{ fromKm: 10, toKm: 80, height: 1800, name: "高原のへり" }],
    weather: {
      winds: winds(0, [10, 20, 30, 40]),
      freezingLevel: 3300,
      features: [
        {
          id: "tn-cap",
          kind: "cloud",
          prob: { morning: 0.4, afternoon: 0.6 },
          cloud: { fromKm: 20, toKm: 80, lateralKm: 0, halfWidthKm: 15, base: 2000, top: 3000 },
        },
        {
          id: "tn-wave",
          kind: "turbulence",
          prob: { morning: 0.4, afternoon: 0.7 },
          turbulence: { fromKm: 10, toKm: 90, lateralKm: 0, halfWidthKm: 30, intensity: 1 },
        },
      ],
    },
  },

  // ---- 海沿い ----
  {
    a: "minami",
    b: "hamakaze",
    cruiseAltitude: 1500,
    note: "海岸線を北西へ。朝は低い雲（海霧）が出やすい。",
    terrain: [],
    weather: {
      winds: winds(20, [10, 20, 25, 30]),
      freezingLevel: 4300,
      features: [
        {
          id: "mh-stratus",
          kind: "cloud",
          prob: { morning: 0.5, afternoon: 0.2 },
          cloud: { fromKm: 100, toKm: 200, lateralKm: 0, halfWidthKm: 30, base: 300, top: 1200 },
        },
      ],
    },
  },
  {
    a: "kawara",
    b: "hamakaze",
    cruiseAltitude: 1200,
    note: "川を下って海へ。横風で、ときどき雨。",
    terrain: [],
    weather: {
      winds: winds(90, [15, 20, 25, 30]),
      freezingLevel: 4200,
      features: [
        {
          id: "kh-shower",
          kind: "rain",
          prob: { morning: 0.4, afternoon: 0.4 },
          cloud: { fromKm: 50, toKm: 130, lateralKm: 0, halfWidthKm: 20, base: 1000, top: 2600 },
          rain: { fromKm: 60, toKm: 120, lateralKm: 0, halfWidthKm: 15, intensity: 1 },
        },
      ],
    },
  },
  {
    a: "hamakaze",
    b: "numata",
    cruiseAltitude: 1500,
    note: "海岸線をまっすぐ北へ。どの高さでも向かい風。低い雲と雨に注意。",
    terrain: [],
    weather: {
      winds: winds(0, [25, 30, 35, 40]),
      freezingLevel: 4000,
      features: [
        {
          id: "hu-stratus",
          kind: "cloud",
          prob: { morning: 0.4, afternoon: 0.3 },
          cloud: { fromKm: 40, toKm: 140, lateralKm: 0, halfWidthKm: 25, base: 300, top: 1300 },
        },
        {
          id: "hu-rain",
          kind: "rain",
          prob: { morning: 0.3, afternoon: 0.4 },
          cloud: { fromKm: 150, toKm: 220, lateralKm: 0, halfWidthKm: 25, base: 1100, top: 2500 },
          rain: { fromKm: 160, toKm: 215, lateralKm: 0, halfWidthKm: 20, intensity: 1 },
        },
      ],
    },
  },
  {
    a: "numata",
    b: "kita",
    cruiseAltitude: 1800,
    note: "海から内陸の平野へ。追い風。途中に前線の雲と雨。",
    terrain: [],
    weather: {
      winds: winds(200, [10, 20, 30, 35]),
      freezingLevel: 3200,
      features: [
        {
          id: "ug-front",
          kind: "rain",
          prob: { morning: 0.5, afternoon: 0.5 },
          cloud: { fromKm: 180, toKm: 260, lateralKm: 0, halfWidthKm: 30, base: 1500, top: 2800 },
          rain: { fromKm: 190, toKm: 250, lateralKm: 0, halfWidthKm: 25, intensity: 1 },
        },
      ],
    },
  },
];

export const WORLD: World = {
  id: "hondo",
  title: "本土の地図",
  name: "みなみ → きた",
  description: "陸の上だけの地図。山越え・峠・海沿いの3つの道。チュートリアルのコースは、ここから道を切り出して作る。",
  history: "",
  level: 1,
  fields: [minami, kawara, hamakaze, touge, takane, numata, kita],
  edges: EDGES,
  startId: "minami",
  goalId: "kita",
  fuelCapacityL: 80,
  startMin: 9 * 60,
  sunsetMin: 17 * 60 + 30,
  planSpeedKmh: 110,
};

// ---- 地図の計算 ----
export const field = (w: World, id: string): Waypoint => {
  const f = w.fields.find((x) => x.id === id);
  if (!f) throw new Error(`飛行場がない: ${id}`);
  return f;
};

export const edgeDistance = (w: World, e: Edge) => {
  const a = field(w, e.a);
  const b = field(w, e.b);
  return Math.round(Math.hypot(b.x - a.x, b.y - a.y));
};

export const findEdge = (w: World, from: string, to: string) =>
  w.edges.find((e) => (e.a === from && e.b === to) || (e.a === to && e.b === from)) ?? null;

/** つながっている飛行場 */
export const neighbors = (w: World, id: string) =>
  w.edges.filter((e) => e.a === id || e.b === id).map((e) => (e.a === id ? e.b : e.a));

/** 道を from → to の向きの「区間」にする。逆向きなら天気・山・風を反転する */
export function legBetween(w: World, from: string, to: string): Leg {
  const e = findEdge(w, from, to);
  if (!e) throw new Error(`道がない: ${from} → ${to}`);
  const D = edgeDistance(w, e);
  const reversed = e.a !== from;
  const terrain: Ridge[] = reversed
    ? e.terrain.map((r) => ({ ...r, fromKm: D - r.toKm, toKm: D - r.fromKm }))
    : e.terrain;
  const weather: WeatherTemplate = reversed ? reverseWeather(e.weather, D) : e.weather;
  return {
    from: field(w, from),
    to: field(w, to),
    distanceKm: D,
    headwindKmh: Math.round(headwindAt(weather.winds, 0)),
    cruiseAltitude: e.cruiseAltitude,
    note: e.note,
    terrain,
    weather,
    sea: seaStretches(w, from, to, D),
  };
}

// ---- 陸と海 ----
/** 点が多角形の中にあるか（レイキャスティング） */
function inPolygon(x: number, y: number, poly: [number, number][]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** 地図の上のその点が陸か。陸地の形が書いていない地図は、全部が陸 */
export const isLand = (w: World, x: number, y: number) => !w.land || w.land.some((p) => inPolygon(x, y, p));

/** from → to をまっすぐ飛んだときの、海の上の範囲（出発地からの距離 km、1 km きざみ） */
export function seaStretches(w: World, from: string, to: string, D = edgeDistance(w, findEdge(w, from, to)!)): SeaStretch[] {
  if (!w.land) return [];
  const a = field(w, from);
  const b = field(w, to);
  const out: SeaStretch[] = [];
  let start: number | null = null;
  for (let km = 0; km <= D; km++) {
    const t = km / D;
    const sea = !isLand(w, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    if (sea && start === null) start = km;
    if (!sea && start !== null) {
      out.push({ fromKm: start, toKm: km });
      start = null;
    }
  }
  if (start !== null) out.push({ fromKm: start, toKm: D });
  return out;
}

/** 区間のその地点が海の上か */
export const seaAt = (leg: Pick<Leg, "sea">, km: number) => leg.sea.some((r) => km > r.fromKm && km < r.toKm);

/** 区間のうち、海の上を飛ぶ距離 km */
export const seaKm = (leg: Pick<Leg, "sea">) => leg.sea.reduce((s, r) => s + r.toKm - r.fromKm, 0);

/** いちばん長く続く海の上の距離 km */
export const longestSeaKm = (leg: Pick<Leg, "sea">) => Math.max(0, ...leg.sea.map((r) => r.toKm - r.fromKm));

/** 逆向きに飛ぶときの天気：距離は D から数え直し、左右は入れ替わり、風は反対から吹く */
function reverseWeather(t: WeatherTemplate, D: number): WeatherTemplate {
  const area = <A extends { fromKm: number; toKm: number; lateralKm: number }>(a: A): A => ({
    ...a,
    fromKm: D - a.toKm,
    toKm: D - a.fromKm,
    lateralKm: -a.lateralKm,
  });
  return {
    winds: t.winds.map((wl) => ({ ...wl, direction: wl.direction + 180 })),
    freezingLevel: t.freezingLevel,
    features: t.features.map(
      (f): WeatherFeature => ({
        ...f,
        id: `${f.id}~r`,
        cloud: f.cloud && area(f.cloud),
        rain: f.rain && area(f.rain),
        turbulence: f.turbulence && area(f.turbulence),
        cb: f.cb && { ...f.cb, alongKm: D - f.cb.alongKm, lateralKm: -f.cb.lateralKm },
      }),
    ),
  };
}

/** いちばん近い道順（距離で）。from と to を含む飛行場の並び */
export function shortestPath(w: World, from: string, to: string): string[] {
  const dist = new Map<string, number>(w.fields.map((f) => [f.id, Infinity]));
  const prev = new Map<string, string>();
  const todo = new Set(w.fields.map((f) => f.id));
  dist.set(from, 0);
  while (todo.size) {
    let u = "";
    for (const id of todo) if (!u || dist.get(id)! < dist.get(u)!) u = id;
    todo.delete(u);
    if (u === to || dist.get(u) === Infinity) break;
    for (const v of neighbors(w, u)) {
      const d = dist.get(u)! + edgeDistance(w, findEdge(w, u, v)!);
      if (d < dist.get(v)!) {
        dist.set(v, d);
        prev.set(v, u);
      }
    }
  }
  const path = [to];
  while (path[0] !== from) {
    const p = prev.get(path[0]);
    if (!p) return [];
    path.unshift(p);
  }
  return path;
}

export const pathDistance = (w: World, path: string[]) =>
  path.slice(1).reduce((s, id, i) => s + edgeDistance(w, findEdge(w, path[i], id)!), 0);

/** 天気のない同じ地図（テスト用）。風は地上の向かい風だけ */
export function clearSkies(w: World): World {
  return {
    ...w,
    edges: w.edges.map((e) => ({
      ...e,
      weather: {
        ...e.weather,
        winds: [{ altitude: 0, direction: 0, speed: Math.round(headwindAt(e.weather.winds, 0)) }],
        features: [],
      },
    })),
  };
}
