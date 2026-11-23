// コース：最初に選ぶ旅の舞台。陸路では行けない、架空の海峡・諸島・大洋と、高い山脈を飛びこえる。
// どれも史実の挑戦をもとにしているが、地名と地形は架空。
//
//   かもめ海峡   … 1909年 ブレリオの英仏海峡横断（短い海越え。霧と横風）
//   つらなり諸島 … 1919年 NC-4 の大西洋横断（島から島へ、何日もかけて）
//   おおわだつみ … 1919年 アルコックとブラウン・1927年 リンドバーグの無着陸横断（長い海の上を一気に）
//   しろがね山脈 … 1910年 チャベスのアルプス越え・1918年 ゴドイのアンデス越え（海はなく、高い山なみ）
//
// 天気のひな形と山の位置は world.ts と同じく、道の a → b の向きで書く。
// 海の上かどうかは、陸地の形（land）から自動で決まる。
import type { Edge, Waypoint, World } from "../model/types";
import { WORLD } from "./world";

const winds = (dir: number, speeds: [number, number, number, number], turn = 0) =>
  [0, 1000, 2000, 3000].map((altitude, i) => ({ altitude, direction: dir + turn * i, speed: speeds[i] }));

/** だいたい丸い島の形（中心と半径 km） */
const island = (x: number, y: number, r: number, squash = 1): [number, number][] =>
  Array.from({ length: 10 }, (_, i) => {
    const a = (i / 10) * Math.PI * 2;
    const k = 1 + 0.18 * Math.sin(i * 2.3);
    return [Math.round(x + Math.cos(a) * r * k), Math.round(y + Math.sin(a) * r * k * squash)];
  });

// =====================================================================
// 1. かもめ海峡を渡る（ひと続きの海の上 50〜100 km）
// =====================================================================
const KAMOME_FIELDS: Waypoint[] = [
  {
    id: "misaki",
    name: "みさき飛行場",
    elevation: 30,
    runwayLength: 700,
    surface: "paved",
    hasRepairShop: true,
    humidity: 78,
    temperature: 24,
    dewPoint: 17,
    description: "海峡の南の町。格納庫と整備場がある。向こう岸は、晴れた朝だけ見える。",
    x: 0,
    y: 0,
    labelSide: "left",
  },
  {
    id: "hanasaki",
    name: "はなさき飛行場",
    elevation: 40,
    runwayLength: 550,
    surface: "unpaved",
    hasRepairShop: false,
    humidity: 84,
    temperature: 22,
    dewPoint: 17.5,
    description: "海峡にいちばん突き出た岬の草地。ここから渡れば海の上は短い。朝は霧が出やすい。",
    x: 90,
    y: 55,
    labelSide: "right",
  },
  {
    id: "kojima",
    name: "こじま飛行場",
    elevation: 15,
    runwayLength: 450,
    surface: "unpaved",
    hasRepairShop: false,
    humidity: 88,
    temperature: 23,
    dewPoint: 18,
    description: "海峡のまん中の小さな島。滑走路はとても短く、満タンでは飛び立てないことがある。",
    x: 20,
    y: 110,
    labelSide: "left",
  },
  {
    id: "tomari",
    name: "とまり飛行場",
    elevation: 60,
    runwayLength: 650,
    surface: "paved",
    hasRepairShop: true,
    humidity: 72,
    temperature: 21,
    dewPoint: 14,
    description: "海峡の向こう岸。崖の上の町。ここに着けば海峡横断の成功だ。",
    x: 50,
    y: 200,
    labelSide: "right",
  },
];

const KAMOME_EDGES: Edge[] = [
  {
    a: "misaki",
    b: "hanasaki",
    cruiseAltitude: 1200,
    note: "海峡の手前の岬まで、海沿いを北東へ。陸の上なので、いつでも畑に降りられる。",
    terrain: [],
    weather: {
      winds: winds(80, [10, 15, 20, 25]),
      freezingLevel: 4200,
      features: [
        {
          id: "kh-thermal",
          kind: "turbulence",
          prob: { morning: 0.2, afternoon: 0.5 },
          turbulence: { fromKm: 30, toKm: 90, lateralKm: 0, halfWidthKm: 30, intensity: 1 },
        },
      ],
    },
  },
  {
    a: "misaki",
    b: "tomari",
    cruiseAltitude: 1500,
    note: "まっすぐ海峡を渡る。いちばん近いが、海の上が長い。朝は海霧、午後はにわか雨。",
    terrain: [],
    weather: {
      winds: winds(70, [15, 25, 30, 35]),
      freezingLevel: 4000,
      features: [
        {
          id: "mt-fog",
          kind: "cloud",
          prob: { morning: 0.6, afternoon: 0.2 },
          cloud: { fromKm: 40, toKm: 150, lateralKm: 0, halfWidthKm: 30, base: 100, top: 700 },
        },
        {
          id: "mt-squall",
          kind: "rain",
          prob: { morning: 0.2, afternoon: 0.5 },
          cloud: { fromKm: 90, toKm: 145, lateralKm: 6, halfWidthKm: 18, base: 900, top: 2400 },
          rain: { fromKm: 95, toKm: 140, lateralKm: 6, halfWidthKm: 15, intensity: 1 },
        },
        {
          id: "mt-cliff",
          kind: "turbulence",
          prob: { morning: 0.2, afternoon: 0.5 },
          turbulence: { fromKm: 165, toKm: 200, lateralKm: 0, halfWidthKm: 25, intensity: 1 },
        },
      ],
    },
  },
  {
    a: "hanasaki",
    b: "tomari",
    cruiseAltitude: 1500,
    note: "岬から渡る。海の上はいちばん短いが、横風が強い。朝は海霧。",
    terrain: [],
    weather: {
      winds: winds(100, [20, 30, 35, 40]),
      freezingLevel: 4000,
      features: [
        {
          id: "ht-fog",
          kind: "cloud",
          prob: { morning: 0.5, afternoon: 0.2 },
          cloud: { fromKm: 15, toKm: 110, lateralKm: 0, halfWidthKm: 30, base: 100, top: 700 },
        },
        {
          id: "ht-gust",
          kind: "turbulence",
          prob: { morning: 0.3, afternoon: 0.6 },
          turbulence: { fromKm: 0, toKm: 60, lateralKm: 0, halfWidthKm: 30, intensity: 1 },
        },
      ],
    },
  },
  {
    a: "misaki",
    b: "kojima",
    cruiseAltitude: 1000,
    note: "海峡のまん中の島へ。海の上はそれほど長くない。朝は海霧。",
    terrain: [],
    weather: {
      winds: winds(80, [15, 20, 25, 30]),
      freezingLevel: 4200,
      features: [
        {
          id: "mk-fog",
          kind: "cloud",
          prob: { morning: 0.5, afternoon: 0.2 },
          cloud: { fromKm: 35, toKm: 95, lateralKm: 0, halfWidthKm: 25, base: 100, top: 600 },
        },
      ],
    },
  },
  {
    a: "kojima",
    b: "tomari",
    cruiseAltitude: 1200,
    note: "島から向こう岸へ。ときどきにわか雨。崖の近くは揺れる。",
    terrain: [],
    weather: {
      winds: winds(60, [15, 25, 30, 35]),
      freezingLevel: 4000,
      features: [
        {
          id: "kt-shower",
          kind: "rain",
          prob: { morning: 0.3, afternoon: 0.4 },
          cloud: { fromKm: 30, toKm: 70, lateralKm: 0, halfWidthKm: 15, base: 800, top: 2200 },
          rain: { fromKm: 35, toKm: 65, lateralKm: 0, halfWidthKm: 12, intensity: 1 },
        },
        {
          id: "kt-cliff",
          kind: "turbulence",
          prob: { morning: 0.2, afternoon: 0.5 },
          turbulence: { fromKm: 70, toKm: 95, lateralKm: 0, halfWidthKm: 20, intensity: 1 },
        },
      ],
    },
  },
];

export const KAMOME: World = {
  id: "kamome",
  title: "かもめ海峡を渡る",
  name: "みさき → とまり",
  description:
    "初めての海越え。海の上は 50〜100 km と短いが、エンジンが止まれば降りる場所はない。まっすぐ渡るか、岬や島を使って海の上を短くするか。",
  history:
    "1909年、ブレリオは小さな単葉機で英仏海峡を渡った。海の上はおよそ37分。霧で向こう岸が見えず、かもめを頼りに飛んだという話も残る。",
  level: 1,
  fields: KAMOME_FIELDS,
  edges: KAMOME_EDGES,
  startId: "misaki",
  goalId: "tomari",
  fuelCapacityL: 80,
  startMin: 9 * 60,
  sunsetMin: 17 * 60 + 30,
  planSpeedKmh: 110,
  land: [
    // 南の陸（はなさきの岬が北東へ突き出す）
    [
      [-200, -120],
      [240, -120],
      [240, 10],
      [150, 25],
      [112, 42],
      [102, 70],
      [80, 64],
      [58, 40],
      [30, 28],
      [0, 25],
      [-40, 32],
      [-200, 40],
    ],
    island(20, 110, 9, 1.2),
    // 北の陸（とまりの崖）
    [
      [-200, 178],
      [-40, 170],
      [20, 172],
      [60, 165],
      [120, 176],
      [240, 168],
      [240, 340],
      [-200, 340],
    ],
  ],
};

// =====================================================================
// 2. つらなり諸島を島づたいに（海の上 130〜330 km を何度も）
// =====================================================================
const TSURANARI_FIELDS: Waypoint[] = [
  {
    id: "oominato",
    name: "おおみなと飛行場",
    elevation: 20,
    runwayLength: 800,
    surface: "paved",
    hasRepairShop: true,
    humidity: 74,
    temperature: 26,
    dewPoint: 19,
    description: "南の大陸の港町。ここから先は、島から島へ渡っていく。",
    x: 0,
    y: 0,
    labelSide: "right",
  },
  {
    id: "isobe",
    name: "いそべ島飛行場",
    elevation: 30,
    runwayLength: 600,
    surface: "paved",
    hasRepairShop: true,
    humidity: 84,
    temperature: 27,
    dewPoint: 21,
    description: "諸島でいちばん大きな島。整備場がある。午後はにわか雨と積乱雲が育ちやすい。",
    x: 130,
    y: 230,
    labelSide: "right",
  },
  {
    id: "akaiwa",
    name: "あかいわ島飛行場",
    elevation: 120,
    runwayLength: 500,
    surface: "unpaved",
    hasRepairShop: false,
    humidity: 62,
    temperature: 28,
    dewPoint: 17,
    description: "赤い岩の火山島。乾いていて霧は出にくいが、整備場はなく、滑走路は石だらけ。",
    x: -90,
    y: 290,
    labelSide: "left",
  },
  {
    id: "nagare",
    name: "ながれ島飛行場",
    elevation: 25,
    runwayLength: 560,
    surface: "unpaved",
    hasRepairShop: true,
    humidity: 86,
    temperature: 25,
    dewPoint: 20,
    description: "諸島の北のはしの島。小さな整備小屋がある。ここから北の大陸までは、海の上がいちばん長い。",
    x: 50,
    y: 520,
    labelSide: "right",
  },
  {
    id: "saihate",
    name: "さいはて島飛行場",
    elevation: 10,
    runwayLength: 450,
    surface: "unpaved",
    hasRepairShop: false,
    humidity: 90,
    temperature: 22,
    dewPoint: 18.5,
    description: "霧の多い小さな島。寄れば海の上は短くなるが、朝はほとんど霧。滑走路も短い。",
    x: -50,
    y: 640,
    labelSide: "left",
  },
  {
    id: "toono",
    name: "とおの飛行場",
    elevation: 50,
    runwayLength: 700,
    surface: "paved",
    hasRepairShop: true,
    humidity: 68,
    temperature: 22,
    dewPoint: 13,
    description: "北の大陸の飛行場。諸島を渡りきったゴール。",
    x: 20,
    y: 880,
    labelSide: "right",
  },
];

const TSURANARI_EDGES: Edge[] = [
  {
    a: "oominato",
    b: "isobe",
    cruiseAltitude: 1500,
    note: "大陸から大きな島へ。貿易風が斜め前から吹く。午後は島の手前に積乱雲。",
    terrain: [],
    weather: {
      winds: winds(30, [15, 20, 25, 30]),
      freezingLevel: 4500,
      features: [
        {
          id: "oi-squall",
          kind: "rain",
          prob: { morning: 0.3, afternoon: 0.5 },
          cloud: { fromKm: 120, toKm: 180, lateralKm: 0, halfWidthKm: 20, base: 900, top: 2800 },
          rain: { fromKm: 125, toKm: 175, lateralKm: 0, halfWidthKm: 16, intensity: 1 },
        },
        {
          id: "oi-cb",
          kind: "cb",
          prob: { morning: 0.1, afternoon: 0.5 },
          cb: { alongKm: 210, lateralKm: 8, radiusKm: 5 },
        },
      ],
    },
  },
  {
    a: "oominato",
    b: "akaiwa",
    cruiseAltitude: 1500,
    note: "大陸から火山島へ。風はほぼ横から。朝は低い雲。",
    terrain: [],
    weather: {
      winds: winds(80, [15, 20, 25, 30]),
      freezingLevel: 4500,
      features: [
        {
          id: "oa-stratus",
          kind: "cloud",
          prob: { morning: 0.4, afternoon: 0.2 },
          cloud: { fromKm: 60, toKm: 160, lateralKm: 0, halfWidthKm: 30, base: 300, top: 1100 },
        },
        {
          id: "oa-squall",
          kind: "rain",
          prob: { morning: 0.2, afternoon: 0.4 },
          cloud: { fromKm: 190, toKm: 250, lateralKm: -5, halfWidthKm: 18, base: 900, top: 2600 },
          rain: { fromKm: 195, toKm: 245, lateralKm: -5, halfWidthKm: 15, intensity: 1 },
        },
      ],
    },
  },
  {
    a: "isobe",
    b: "akaiwa",
    cruiseAltitude: 1200,
    note: "島から島へ西向き。貿易風に背中を押される。",
    terrain: [],
    weather: {
      winds: winds(160, [10, 15, 20, 25]),
      freezingLevel: 4500,
      features: [
        {
          id: "ia-shower",
          kind: "rain",
          prob: { morning: 0.3, afternoon: 0.3 },
          cloud: { fromKm: 80, toKm: 140, lateralKm: 0, halfWidthKm: 18, base: 900, top: 2400 },
          rain: { fromKm: 85, toKm: 135, lateralKm: 0, halfWidthKm: 14, intensity: 1 },
        },
      ],
    },
  },
  {
    a: "isobe",
    b: "nagare",
    cruiseAltitude: 1500,
    note: "諸島の北へ。途中に前線の帯があり、強い雨。午後は積乱雲も。",
    terrain: [],
    weather: {
      winds: winds(50, [15, 20, 30, 35]),
      freezingLevel: 4200,
      features: [
        {
          id: "in-front",
          kind: "rain",
          prob: { morning: 0.5, afternoon: 0.5 },
          cloud: { fromKm: 150, toKm: 230, lateralKm: 0, halfWidthKm: 30, base: 800, top: 2800 },
          rain: { fromKm: 160, toKm: 220, lateralKm: 0, halfWidthKm: 25, intensity: 2 },
        },
        {
          id: "in-cb",
          kind: "cb",
          prob: { morning: 0.2, afternoon: 0.5 },
          cb: { alongKm: 200, lateralKm: -6, radiusKm: 5 },
        },
      ],
    },
  },
  {
    a: "akaiwa",
    b: "nagare",
    cruiseAltitude: 1200,
    note: "火山島から北東へ。ずっと向かい風。低いほど弱い。",
    terrain: [],
    weather: {
      winds: winds(0, [15, 20, 25, 30]),
      freezingLevel: 4200,
      features: [
        {
          id: "an-stratus",
          kind: "cloud",
          prob: { morning: 0.4, afternoon: 0.2 },
          cloud: { fromKm: 180, toKm: 269, lateralKm: 0, halfWidthKm: 30, base: 200, top: 900 },
        },
        {
          id: "an-turb",
          kind: "turbulence",
          prob: { morning: 0.3, afternoon: 0.4 },
          turbulence: { fromKm: 0, toKm: 50, lateralKm: 0, halfWidthKm: 30, intensity: 1 },
        },
      ],
    },
  },
  {
    a: "nagare",
    b: "saihate",
    cruiseAltitude: 1000,
    note: "霧の島へ。距離は短いが、着く先が霧に隠れていることが多い。",
    terrain: [],
    weather: {
      winds: winds(40, [10, 15, 20, 25]),
      freezingLevel: 4000,
      features: [
        {
          id: "ns-fog",
          kind: "cloud",
          prob: { morning: 0.7, afternoon: 0.4 },
          cloud: { fromKm: 90, toKm: 156, lateralKm: 0, halfWidthKm: 30, base: 100, top: 700 },
        },
      ],
    },
  },
  {
    a: "nagare",
    b: "toono",
    cruiseAltitude: 1200,
    note: "諸島から北の大陸へ、いちばん長い海の上。どの高さでも向かい風。途中に前線。",
    terrain: [],
    weather: {
      winds: winds(15, [20, 25, 32, 40]),
      freezingLevel: 3800,
      features: [
        {
          id: "nt-front",
          kind: "rain",
          prob: { morning: 0.5, afternoon: 0.5 },
          cloud: { fromKm: 200, toKm: 290, lateralKm: 0, halfWidthKm: 30, base: 1000, top: 2800 },
          rain: { fromKm: 210, toKm: 280, lateralKm: 0, halfWidthKm: 25, intensity: 1 },
        },
        {
          id: "nt-stratus",
          kind: "cloud",
          prob: { morning: 0.3, afternoon: 0.2 },
          cloud: { fromKm: 300, toKm: 361, lateralKm: 0, halfWidthKm: 30, base: 300, top: 1000 },
        },
      ],
    },
  },
  {
    a: "saihate",
    b: "toono",
    cruiseAltitude: 1200,
    note: "霧の島から北の大陸へ。島を出るまで低い雲。そのあとは穏やか。",
    terrain: [],
    weather: {
      winds: winds(10, [15, 20, 25, 30]),
      freezingLevel: 3800,
      features: [
        {
          id: "st-stratus",
          kind: "cloud",
          prob: { morning: 0.5, afternoon: 0.3 },
          cloud: { fromKm: 0, toKm: 60, lateralKm: 0, halfWidthKm: 30, base: 100, top: 800 },
        },
        {
          id: "st-shower",
          kind: "rain",
          prob: { morning: 0.3, afternoon: 0.3 },
          cloud: { fromKm: 140, toKm: 200, lateralKm: 0, halfWidthKm: 18, base: 900, top: 2400 },
          rain: { fromKm: 145, toKm: 195, lateralKm: 0, halfWidthKm: 14, intensity: 1 },
        },
      ],
    },
  },
];

export const TSURANARI: World = {
  id: "tsuranari",
  title: "つらなり諸島を島づたいに",
  name: "おおみなと → とおの",
  description:
    "島から島へ、何日もかけて北の大陸を目指す。島の滑走路は短く、整備場のない島もある。最後の海は 330 km。霧の島に寄って短く渡るか、一気に渡るか。",
  history:
    "1919年、アメリカ海軍の飛行艇 NC-4 は、島に寄りながら何日もかけて、初めて大西洋を飛んで渡った。一緒に出発した2機は、霧で迷って海に降り、たどり着けなかった。",
  level: 2,
  fields: TSURANARI_FIELDS,
  edges: TSURANARI_EDGES,
  startId: "oominato",
  goalId: "toono",
  fuelCapacityL: 80,
  startMin: 9 * 60,
  sunsetMin: 17 * 60 + 30,
  planSpeedKmh: 110,
  land: [
    [
      [-260, -150],
      [260, -150],
      [260, 30],
      [80, 25],
      [0, 32],
      [-80, 22],
      [-260, 38],
    ],
    island(130, 230, 22, 0.8),
    island(-90, 290, 12),
    island(50, 520, 13),
    island(-50, 640, 9),
    [
      [-260, 850],
      [-100, 860],
      [0, 855],
      [60, 862],
      [260, 848],
      [260, 1050],
      [-260, 1050],
    ],
  ],
};

// =====================================================================
// 3. おおわだつみを無着陸で（海の上 390〜510 km を一気に）
// =====================================================================
const OWADATSUMI_FIELDS: Waypoint[] = [
  {
    id: "nishihama",
    name: "にしはま飛行場",
    elevation: 20,
    runwayLength: 1100,
    surface: "paved",
    hasRepairShop: true,
    humidity: 70,
    temperature: 24,
    dewPoint: 16,
    description: "西の大陸の大きな飛行場。滑走路がとても長いので、満タンでも飛び立てる。",
    x: 0,
    y: 0,
    labelSide: "left",
  },
  {
    id: "kitanomisaki",
    name: "きたのみさき飛行場",
    elevation: 60,
    runwayLength: 380,
    surface: "unpaved",
    hasRepairShop: false,
    humidity: 88,
    temperature: 14,
    dewPoint: 10.5,
    description: "北の岬の牧草地。寒くて霧が多い。滑走路が短く、重いと飛び立てない。",
    x: 70,
    y: 190,
    labelSide: "left",
  },
  {
    id: "higashimisaki",
    name: "ひがしみさき飛行場",
    elevation: 30,
    runwayLength: 500,
    surface: "unpaved",
    hasRepairShop: false,
    humidity: 86,
    temperature: 15,
    dewPoint: 11.5,
    description: "東の大陸の、海に突き出た岬の湿った草地。北回りで渡った先。",
    x: 520,
    y: 250,
    labelSide: "right",
  },
  {
    id: "miyako",
    name: "みやこ飛行場",
    elevation: 40,
    runwayLength: 900,
    surface: "paved",
    hasRepairShop: true,
    humidity: 65,
    temperature: 22,
    dewPoint: 13,
    description: "東の大陸の都の飛行場。大洋を渡りきったゴール。",
    x: 600,
    y: 90,
    labelSide: "right",
  },
];

const OWADATSUMI_EDGES: Edge[] = [
  {
    a: "nishihama",
    b: "kitanomisaki",
    cruiseAltitude: 1500,
    note: "大陸の海沿いを北の岬へ。陸の上なので、いつでも畑に降りられる。",
    terrain: [],
    weather: {
      winds: winds(200, [10, 15, 20, 25]),
      freezingLevel: 3000,
      features: [
        {
          id: "nk-rain",
          kind: "rain",
          prob: { morning: 0.3, afternoon: 0.3 },
          cloud: { fromKm: 110, toKm: 170, lateralKm: 0, halfWidthKm: 25, base: 900, top: 2400 },
          rain: { fromKm: 115, toKm: 165, lateralKm: 0, halfWidthKm: 20, intensity: 1 },
        },
      ],
    },
  },
  {
    a: "nishihama",
    b: "miyako",
    cruiseAltitude: 2000,
    note: "南回りの直行。海の上は 500 km 以上。偏西風の追い風は高いほど強い。まん中に積乱雲の列。",
    terrain: [],
    weather: {
      winds: winds(165, [10, 18, 26, 32]),
      freezingLevel: 3600,
      features: [
        {
          id: "nm-line",
          kind: "rain",
          prob: { morning: 0.4, afternoon: 0.6 },
          cloud: { fromKm: 290, toKm: 360, lateralKm: 0, halfWidthKm: 30, base: 1000, top: 3400 },
          rain: { fromKm: 300, toKm: 350, lateralKm: 0, halfWidthKm: 25, intensity: 2 },
        },
        {
          id: "nm-cb",
          kind: "cb",
          prob: { morning: 0.2, afternoon: 0.6 },
          cb: { alongKm: 330, lateralKm: 4, radiusKm: 7 },
        },
        {
          id: "nm-coast",
          kind: "cloud",
          prob: { morning: 0.4, afternoon: 0.2 },
          cloud: { fromKm: 520, toKm: 607, lateralKm: 0, halfWidthKm: 30, base: 300, top: 1000 },
        },
      ],
    },
  },
  {
    a: "kitanomisaki",
    b: "higashimisaki",
    cruiseAltitude: 1300,
    note: "北回り。海の上は短いが寒い。下は海霧、上は凍る雲。そのあいだの狭いすき間を飛ぶ。",
    terrain: [],
    weather: {
      winds: winds(185, [10, 25, 35, 45]),
      freezingLevel: 1700,
      features: [
        {
          id: "kh-seafog",
          kind: "cloud",
          prob: { morning: 0.7, afternoon: 0.5 },
          cloud: { fromKm: 50, toKm: 330, lateralKm: 0, halfWidthKm: 40, base: 100, top: 900 },
        },
        {
          id: "kh-deck",
          kind: "cloud",
          prob: { morning: 0.5, afternoon: 0.6 },
          cloud: { fromKm: 150, toKm: 380, lateralKm: 0, halfWidthKm: 40, base: 1800, top: 3200 },
        },
        {
          id: "kh-rain",
          kind: "rain",
          prob: { morning: 0.3, afternoon: 0.3 },
          cloud: { fromKm: 380, toKm: 440, lateralKm: 0, halfWidthKm: 25, base: 1000, top: 2600 },
          rain: { fromKm: 385, toKm: 435, lateralKm: 0, halfWidthKm: 20, intensity: 1 },
        },
      ],
    },
  },
  {
    a: "higashimisaki",
    b: "miyako",
    cruiseAltitude: 1500,
    note: "東の大陸を、岬から都へ南東へ。陸の上なので、いつでも畑に降りられる。",
    terrain: [],
    weather: {
      winds: winds(140, [10, 15, 20, 25]),
      freezingLevel: 3000,
      features: [
        {
          id: "hm-rain",
          kind: "rain",
          prob: { morning: 0.3, afternoon: 0.3 },
          cloud: { fromKm: 60, toKm: 120, lateralKm: 0, halfWidthKm: 20, base: 900, top: 2400 },
          rain: { fromKm: 65, toKm: 115, lateralKm: 0, halfWidthKm: 16, intensity: 1 },
        },
      ],
    },
  },
];

export const OWADATSUMI: World = {
  id: "owadatsumi",
  title: "おおわだつみを無着陸で",
  name: "にしはま → みやこ",
  description:
    "大洋を一気に渡る。南回りは海の上 500 km 以上、満タンでも燃料はぎりぎり。北回りは海の上は短いが、寒く、霧と着氷、短い滑走路が待つ。引き返せなくなる地点を越えたら、前へ進むしかない。",
  history:
    "1919年、アルコックとブラウンは大西洋を初めて無着陸で渡った。霧と着氷に苦しみ、最後は湿地に降りた。1927年、リンドバーグは燃料を積めるだけ積んだ重い機体で飛び立ち、ひとりでパリまで飛んだ。",
  level: 3,
  fields: OWADATSUMI_FIELDS,
  edges: OWADATSUMI_EDGES,
  startId: "nishihama",
  goalId: "miyako",
  fuelCapacityL: 80,
  startMin: 8 * 60,
  sunsetMin: 18 * 60,
  planSpeedKmh: 115,
  land: [
    // 西の大陸
    [
      [-260, -200],
      [80, -200],
      [60, -40],
      [35, 30],
      [40, 100],
      [90, 170],
      [110, 215],
      [60, 245],
      [-260, 300],
    ],
    // 東の大陸
    [
      [455, 380],
      [470, 265],
      [505, 225],
      [545, 180],
      [530, 120],
      [550, 70],
      [590, 40],
      [620, -200],
      [860, -200],
      [860, 380],
    ],
  ],
};

// =====================================================================
// 4. しろがね山脈を越える（海はない。3000 m を超える山なみ）
// =====================================================================
const SHIROGANE_FIELDS: Waypoint[] = [
  {
    id: "susono",
    name: "すその飛行場",
    elevation: 350,
    runwayLength: 800,
    surface: "paved",
    hasRepairShop: true,
    humidity: 62,
    temperature: 26,
    dewPoint: 14,
    description: "山脈のふもとの町。格納庫と整備場がある。西の空に、雪をかぶった山なみが見える。",
    x: 0,
    y: 0,
    labelSide: "left",
  },
  {
    id: "tanima",
    name: "たにま飛行場",
    elevation: 950,
    runwayLength: 600,
    surface: "unpaved",
    hasRepairShop: false,
    humidity: 78,
    temperature: 23,
    dewPoint: 15,
    description: "谷の奥の村の草地。整備場はない。ここを出るとすぐ峠の上りで、重いと上昇が間に合わない。",
    x: 50,
    y: 125,
    labelSide: "right",
  },
  {
    id: "kougen",
    name: "こうげん飛行場",
    elevation: 1700,
    runwayLength: 720,
    surface: "unpaved",
    hasRepairShop: true,
    humidity: 45,
    temperature: 18,
    dewPoint: 5,
    description: "峠を越えた先の高原の村。小さな整備小屋がある。空気が薄く、飛び立つのに長い距離がいる。",
    x: 95,
    y: 240,
    labelSide: "right",
  },
  {
    id: "hikune",
    name: "ひくね飛行場",
    elevation: 450,
    runwayLength: 700,
    surface: "paved",
    hasRepairShop: true,
    humidity: 70,
    temperature: 25,
    dewPoint: 16,
    description: "山脈の南のはしの町。整備場がある。ここから回りこめば、山はいちばん低い。",
    x: -170,
    y: 130,
    labelSide: "left",
  },
  {
    id: "asahi",
    name: "あさひ飛行場",
    elevation: 650,
    runwayLength: 750,
    surface: "paved",
    hasRepairShop: true,
    humidity: 60,
    temperature: 22,
    dewPoint: 12,
    description: "山脈の向こう側の町。山を越えきったゴール。",
    x: 40,
    y: 330,
    labelSide: "left",
  },
];

const SHIROGANE_EDGES: Edge[] = [
  {
    a: "susono",
    b: "tanima",
    cruiseAltitude: 1900,
    note: "川をさかのぼって谷の奥へ。前山を越える。午後は谷を吹き上がる風で揺れる。",
    terrain: [{ fromKm: 55, toKm: 100, height: 1500, name: "前山" }],
    weather: {
      winds: winds(20, [10, 15, 25, 35]),
      freezingLevel: 3400,
      features: [
        {
          id: "st-thermal",
          kind: "turbulence",
          prob: { morning: 0.2, afternoon: 0.6 },
          turbulence: { fromKm: 40, toKm: 130, lateralKm: 0, halfWidthKm: 30, intensity: 1 },
        },
        {
          id: "st-valleyfog",
          kind: "cloud",
          prob: { morning: 0.4, afternoon: 0.1 },
          cloud: { fromKm: 105, toKm: 135, lateralKm: 0, halfWidthKm: 20, base: 900, top: 1300 },
        },
      ],
    },
  },
  {
    a: "tanima",
    b: "kougen",
    cruiseAltitude: 3300,
    note: "かざこし峠を越える。谷を出てすぐ急な上り。峠に雲がかかると下をくぐれない。午後は雲と山の波で荒れる。",
    terrain: [{ fromKm: 3, toKm: 55, height: 3000, name: "かざこし峠" }],
    weather: {
      winds: winds(30, [10, 20, 30, 40]),
      freezingLevel: 3200,
      features: [
        {
          id: "tk-cap",
          kind: "cloud",
          prob: { morning: 0.3, afternoon: 0.7 },
          cloud: { fromKm: 15, toKm: 45, lateralKm: 0, halfWidthKm: 20, base: 2800, top: 4200 },
        },
        {
          id: "tk-wave",
          kind: "turbulence",
          prob: { morning: 0.4, afternoon: 0.7 },
          turbulence: { fromKm: 35, toKm: 100, lateralKm: 0, halfWidthKm: 35, intensity: 2 },
        },
        {
          id: "tk-cb",
          kind: "cb",
          prob: { morning: 0.1, afternoon: 0.4 },
          cb: { alongKm: 50, lateralKm: 10, radiusKm: 5 },
        },
      ],
    },
  },
  {
    a: "kougen",
    b: "asahi",
    cruiseAltitude: 2600,
    note: "高原から東の尾根を越えて、山の向こうの町へ下る。追い風。",
    terrain: [{ fromKm: 20, toKm: 60, height: 2300, name: "東の尾根" }],
    weather: {
      winds: winds(200, [5, 10, 20, 30]),
      freezingLevel: 3200,
      features: [
        {
          id: "ka-wave",
          kind: "turbulence",
          prob: { morning: 0.3, afternoon: 0.6 },
          turbulence: { fromKm: 45, toKm: 90, lateralKm: 0, halfWidthKm: 30, intensity: 1 },
        },
        {
          id: "ka-shower",
          kind: "rain",
          prob: { morning: 0.2, afternoon: 0.4 },
          cloud: { fromKm: 60, toKm: 95, lateralKm: 0, halfWidthKm: 15, base: 1800, top: 3200 },
          rain: { fromKm: 65, toKm: 90, lateralKm: 0, halfWidthKm: 12, intensity: 1 },
        },
      ],
    },
  },
  {
    a: "susono",
    b: "asahi",
    cruiseAltitude: 3500,
    note: "しろがね岳のすぐ横を、まっすぐ越える。高い空は向かい風が強く、峰には雲がかかりやすい。凍る高さより上を飛ぶ。",
    terrain: [
      { fromKm: 50, toKm: 95, height: 1600, name: "前山" },
      { fromKm: 150, toKm: 235, height: 3300, name: "しろがね岳" },
    ],
    weather: {
      winds: winds(15, [10, 20, 30, 40]),
      freezingLevel: 2800,
      features: [
        {
          id: "sa-cap",
          kind: "cloud",
          prob: { morning: 0.4, afternoon: 0.8 },
          cloud: { fromKm: 165, toKm: 225, lateralKm: 0, halfWidthKm: 25, base: 2800, top: 4500 },
        },
        {
          id: "sa-wave",
          kind: "turbulence",
          prob: { morning: 0.5, afternoon: 0.8 },
          turbulence: { fromKm: 200, toKm: 290, lateralKm: 0, halfWidthKm: 40, intensity: 2 },
        },
        {
          id: "sa-cb",
          kind: "cb",
          prob: { morning: 0.1, afternoon: 0.5 },
          cb: { alongKm: 190, lateralKm: -12, radiusKm: 6 },
        },
      ],
    },
  },
  {
    a: "susono",
    b: "hikune",
    cruiseAltitude: 1500,
    note: "山脈のすそを南西へ。山はないが、横風で、ときどき雨。",
    terrain: [],
    weather: {
      winds: winds(80, [15, 20, 25, 30]),
      freezingLevel: 3600,
      features: [
        {
          id: "sh-shower",
          kind: "rain",
          prob: { morning: 0.3, afternoon: 0.4 },
          cloud: { fromKm: 90, toKm: 150, lateralKm: 0, halfWidthKm: 20, base: 1000, top: 2600 },
          rain: { fromKm: 95, toKm: 145, lateralKm: 0, halfWidthKm: 16, intensity: 1 },
        },
      ],
    },
  },
  {
    a: "hikune",
    b: "asahi",
    cruiseAltitude: 2200,
    note: "南のはしの低い山を回りこむ。山は低いが遠く、ずっと向かい風。途中に前線。",
    terrain: [{ fromKm: 90, toKm: 170, height: 1800, name: "南の山なみ" }],
    weather: {
      winds: winds(0, [15, 20, 30, 40]),
      freezingLevel: 3200,
      features: [
        {
          id: "ha-front",
          kind: "rain",
          prob: { morning: 0.5, afternoon: 0.5 },
          cloud: { fromKm: 180, toKm: 250, lateralKm: 0, halfWidthKm: 30, base: 1400, top: 3000 },
          rain: { fromKm: 190, toKm: 240, lateralKm: 0, halfWidthKm: 25, intensity: 1 },
        },
        {
          id: "ha-wave",
          kind: "turbulence",
          prob: { morning: 0.3, afternoon: 0.5 },
          turbulence: { fromKm: 140, toKm: 200, lateralKm: 0, halfWidthKm: 30, intensity: 1 },
        },
      ],
    },
  },
];

export const SHIROGANE: World = {
  id: "shirogane",
  title: "しろがね山脈を越える",
  name: "すその → あさひ",
  description:
    "海はないが、3000 m を超える山なみが行く手をふさぐ。高いほど空気が薄く、上昇は鈍る。峰の雲は午後に育つ。まっすぐ峰を越えるか、峠を越えるか、南へ回りこむか。",
  history:
    "1910年、チャベスは小さな単葉機でアルプスの峠を越えた。寒さと強い風に耐えて越えきったが、着陸の直前に翼が折れた。1918年、ゴドイはアンデス山脈のいちばん高いあたりを越えた。山の天気は朝のうちが穏やかだ。",
  level: 2,
  fields: SHIROGANE_FIELDS,
  edges: SHIROGANE_EDGES,
  startId: "susono",
  goalId: "asahi",
  fuelCapacityL: 80,
  startMin: 7 * 60,
  sunsetMin: 18 * 60,
  planSpeedKmh: 105,
};

/** 最初に選べるコース（並び順のまま画面に出す） */
/** コース選びに並べる順。やさしいものから（練習 → ★ → ★★ → ★★★） */
export const COURSES: World[] = [WORLD, KAMOME, TSURANARI, SHIROGANE, OWADATSUMI];

export const courseById = (id: string): World => COURSES.find((c) => c.id === id) ?? KAMOME;
