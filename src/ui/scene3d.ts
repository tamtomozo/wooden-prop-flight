// 機体を後ろから追いかける3Dの視点（Three.js）。
// 見た目用の世界なので、高度や距離の縮尺は実際の値とは合わせていない。
import * as THREE from "three";
import { DETOUR_ANGLE, DISORIENT_LIMIT_MIN } from "../config";
import { seaAt } from "../data/world";
import { groundElevation, terrainAt, type FlightState } from "../game/flight";
import type { Leg, LegWeather, RunwaySurface } from "../model/types";
import { skyAt, type RGB } from "./sky";

/** 雲を置く高さの基準（見た目用。巡航中の機体はだいたいこの高さ） */
const ALT = 120;
/** 地面からの高さ（m）→ 画面上の高さ。縮尺は見た目優先 */
const visualY = (aglMeters: number) => 6 + Math.max(0, aglMeters) * 0.075;
/** km/h → 画面上の単位/秒。時間の倍速とは関係なく、見た目の流れる速さだけを決める */
const SPEED_SCALE = 0.6;
/** 霧で見えなくなる距離。物はこの範囲で手前へ流れ、後ろへ抜けたら奥へ戻す */
const FAR = 1800;
const NEAR_EDGE = 150;
const SPAN = FAR + NEAR_EDGE + 300;
/** 天気・飛行場を置くときの縮尺：1 km = 25 単位（霧の奥まで約70 km） */
const KM = 25;
const GROUND_SIZE = 5000;
const GROUND_REPEAT = 14;
/** 山を置く、道筋からの最小の横距離（近すぎると画面をふさぐ） */
const HILL_MIN_X = 420;
/** 海の波の模様1枚の大きさ（画面上の単位） */
const SEA_TILE = 260;
/** 1区間の中の、海の上の範囲の数の上限（これより多いぶんは描かない） */
const SEA_MAX = 4;

const color = (c: RGB) => new THREE.Color().setRGB(c[0] / 255, c[1] / 255, c[2] / 255, THREE.SRGBColorSpace);
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const lambert = (hex: number, extra: THREE.MeshLambertMaterialParameters = {}) =>
  new THREE.MeshLambertMaterial({ color: hex, flatShading: true, ...extra });

export class BackScene {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(58, 1, 0.5, 5000);
  private fog = new THREE.Fog(0xbfe1fa, 350, FAR);
  private skyMat: THREE.ShaderMaterial;
  private skyMesh: THREE.Mesh;
  private sun: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  private hemi = new THREE.HemisphereLight(0xcfe8ff, 0x5a7a4a, 1.6);
  private dir = new THREE.DirectionalLight(0xffffff, 2.2);
  private groundTex: THREE.CanvasTexture;
  /** 山の上で地面に重ねる岩の色（高いほど濃く） */
  private rock: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>;
  private plane = new THREE.Group();
  private prop = new THREE.Group();
  private propDisc: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  private hills: THREE.Mesh[] = [];
  /** 海の上の範囲ごとの海面（地面の少し上に重ねる） */
  private seas: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>[] = [];
  private clouds: THREE.Group[] = [];
  /** 雲は後ろ側（影の側）から見ることが多いので、空の色で少し自分で光らせる */
  private cloudMat = lambert(0xffffff, { transparent: true, opacity: 0.94 });
  private streakPos: Float32Array;
  private streakGeo = new THREE.BufferGeometry();
  private streaks = new THREE.Group();
  private depRunway: Runway;
  private arrRunway: Runway;
  private wx: WeatherLayer;
  private bankShown = 0;
  private t = 0;
  private pitchShown = 0;
  private w = 0;
  private h = 0;

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    this.scene.fog = this.fog;

    // 空：上と地平線の2色のグラデーション。カメラについてくる大きな球
    this.skyMat = new THREE.ShaderMaterial({
      uniforms: { topColor: { value: new THREE.Color() }, bottomColor: { value: new THREE.Color() } },
      vertexShader: `
        varying vec3 vWorld;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vWorld = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 bottomColor;
        varying vec3 vWorld;
        void main() {
          float h = normalize(vWorld - cameraPosition).y;
          gl_FragColor = vec4(mix(bottomColor, topColor, smoothstep(-0.02, 0.45, h)), 1.0);
          #include <colorspace_fragment>
        }`,
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
    });
    this.skyMesh = new THREE.Mesh(new THREE.SphereGeometry(4000, 32, 16), this.skyMat);
    this.scene.add(this.skyMesh);

    this.sun = new THREE.Mesh(new THREE.SphereGeometry(70, 24, 12), new THREE.MeshBasicMaterial({ fog: false }));
    this.scene.add(this.sun);

    this.dir.position.set(-1, 0.9, -1);
    this.scene.add(this.hemi, this.dir);

    // 地面：田畑の模様のテクスチャを手前へ流す
    this.groundTex = makeFieldTexture();
    this.groundTex.repeat.set(GROUND_REPEAT, GROUND_REPEAT);
    this.groundTex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
      new THREE.MeshLambertMaterial({ map: this.groundTex }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.z = -GROUND_SIZE / 2 + 600;
    this.scene.add(ground);
    this.rock = new THREE.Mesh(
      new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE),
      new THREE.MeshLambertMaterial({ color: 0x9b958c, transparent: true, depthWrite: false }),
    );
    this.rock.rotation.x = -Math.PI / 2;
    this.rock.position.set(0, 0.3, ground.position.z);
    this.scene.add(this.rock);

    // 海：海の上の範囲だけ、地面の上に海面を重ねる
    const seaTex = makeSeaTexture();
    for (let i = 0; i < SEA_MAX; i++) {
      const tex = seaTex.clone();
      tex.anisotropy = this.renderer.capabilities.getMaxAnisotropy();
      const sea = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshLambertMaterial({ map: tex }));
      sea.rotation.x = -Math.PI / 2;
      sea.position.y = 0.6;
      sea.visible = false;
      this.seas.push(sea);
      this.scene.add(sea);
    }

    // 山：飛ぶ道筋の左右に並べる
    const hillColors = [0x4f7a46, 0x5d8a4e, 0x6b8f5a, 0x7a8f6a, 0x8a9a7a];
    for (let i = 0; i < 80; i++) {
      const height = rand(40, 170);
      const hill = new THREE.Mesh(
        new THREE.ConeGeometry(rand(110, 240), height, 6 + (i % 3)),
        lambert(hillColors[i % hillColors.length]),
      );
      hill.position.set(this.sideX(HILL_MIN_X, 1800), height / 2 - 2, rand(-FAR - 300, NEAR_EDGE));
      hill.rotation.y = rand(0, Math.PI);
      this.hills.push(hill);
      this.scene.add(hill);
    }

    // 雲
    const cloudMat = this.cloudMat;
    const puff = new THREE.IcosahedronGeometry(1, 1);
    for (let i = 0; i < 26; i++) {
      const c = new THREE.Group();
      const n = 3 + (i % 3);
      for (let k = 0; k < n; k++) {
        const m = new THREE.Mesh(puff, cloudMat);
        const r = rand(9, 18);
        m.scale.set(r * 1.4, r, r);
        m.position.set((k - n / 2) * 14 + rand(-4, 4), rand(-3, 5), rand(-6, 6));
        c.add(m);
      }
      this.placeCloud(c, rand(-FAR, NEAR_EDGE));
      this.clouds.push(c);
      this.scene.add(c);
    }

    // 風の筋：機体のまわりを後ろへ流れる線
    const N = 70;
    this.streakPos = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) this.placeStreak(i, rand(-260, -10));
    this.streakGeo.setAttribute("position", new THREE.BufferAttribute(this.streakPos, 3));
    this.streaks.add(
      new THREE.LineSegments(
        this.streakGeo,
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.35 }),
      ),
    );
    this.scene.add(this.streaks);

    this.depRunway = new Runway(this.scene);
    this.arrRunway = new Runway(this.scene);
    this.wx = new WeatherLayer(this.scene);
    this.propDisc = this.buildPlane();
    this.scene.add(this.plane);
  }

  /** 道筋（x=0）から min〜max 離れた左右どちらかの x */
  private sideX(min: number, max: number) {
    return (Math.random() < 0.5 ? -1 : 1) * rand(min, max);
  }

  private placeCloud(c: THREE.Group, z: number) {
    // 道筋のすぐ近くには置かない（雲に入るのはステップ3で作る）
    c.position.set(this.sideX(70, 900), rand(ALT - 40, ALT + 140), z);
  }

  private placeStreak(i: number, z: number) {
    const x = rand(-34, 34);
    const y = ALT + rand(-14, 22);
    const len = rand(4, 9);
    this.streakPos.set([x, y, z, x, y, z + len], i * 6);
  }

  /** 複葉機（上下2枚の主翼・オープンコクピット）。-Z が前。戻り値はプロペラの残像の円盤 */
  private buildPlane() {
    const cream = lambert(0xf1e3c3);
    const red = lambert(0xc9433a);
    const wingMat = lambert(0xe9d8b0);
    const dark = lambert(0x2b2b2b);
    const wood = lambert(0x8b5a2b);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z);
      this.plane.add(m);
      return m;
    };
    /** 2点を結ぶ細い棒（支柱） */
    const rod = (a: THREE.Vector3, b: THREE.Vector3, r = 0.045, mat: THREE.Material = dark) => {
      const len = a.distanceTo(b);
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6), mat);
      m.position.copy(a).add(b).multiplyScalar(0.5);
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      this.plane.add(m);
    };
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

    // 胴体：前が太く後ろが細い
    const body = add(new THREE.CylinderGeometry(0.62, 0.22, 7.2, 10), cream, 0, 0, 0.2);
    body.rotation.x = -Math.PI / 2;
    const cowl = add(new THREE.CylinderGeometry(0.6, 0.64, 1.1, 10), red, 0, 0, -3.75);
    cowl.rotation.x = -Math.PI / 2;
    // 胴体の赤いライン
    const stripe = add(new THREE.CylinderGeometry(0.635, 0.4, 3.6, 10, 1, true), red, 0, 0, 1.2);
    stripe.rotation.x = -Math.PI / 2;
    stripe.scale.set(1, 1, 0.25);

    // オープンコクピット：座席の穴、小さな風防、革の飛行帽の操縦士とマフラー
    add(new THREE.BoxGeometry(0.72, 0.16, 1.15), lambert(0x1a1714), 0, 0.5, 0.25);
    add(new THREE.BoxGeometry(0.86, 0.08, 1.3), wood, 0, 0.56, 0.25); // 座席のふち
    const screen = add(
      new THREE.BoxGeometry(0.62, 0.3, 0.03),
      new THREE.MeshLambertMaterial({ color: 0xbfe4f7, transparent: true, opacity: 0.45 }),
      0,
      0.72,
      -0.38,
    );
    screen.rotation.x = -0.45;
    add(new THREE.SphereGeometry(0.24, 12, 8), lambert(0x5a3b22), 0, 0.8, 0.3); // 飛行帽
    add(new THREE.BoxGeometry(0.34, 0.2, 0.3), lambert(0x6b4a2e), 0, 0.6, 0.35); // 肩（革のジャケット）
    const scarf = add(new THREE.BoxGeometry(0.1, 0.05, 0.7), red, 0.1, 0.66, 0.85); // なびくマフラー
    scarf.rotation.y = 0.25;

    // 主翼：上の翼は少し前に（スタッガー）、下の翼は胴体の下に
    const UY = 1.55; // 上の翼の高さ
    const LY = -0.5; // 下の翼の高さ
    add(new THREE.BoxGeometry(10.6, 0.14, 1.5), wingMat, 0, UY, -1.6);
    add(new THREE.BoxGeometry(9.8, 0.14, 1.4), wingMat, 0, LY, -1.25);
    for (const s of [-1, 1]) {
      // 翼端の赤い帯
      add(new THREE.BoxGeometry(0.6, 0.15, 1.51), red, s * 5.0, UY, -1.6);
      add(new THREE.BoxGeometry(0.6, 0.15, 1.41), red, s * 4.6, LY, -1.25);
      // 胴体から上の翼への支柱（キャバン支柱）
      rod(v(s * 0.42, 0.45, -1.95), v(s * 0.6, UY - 0.07, -2.05));
      rod(v(s * 0.42, 0.45, -1.15), v(s * 0.6, UY - 0.07, -1.2));
      // 翼の間の支柱（左右に2本ずつ）
      rod(v(s * 3.7, LY + 0.07, -1.7), v(s * 3.7, UY - 0.07, -2.0), 0.055, wood);
      rod(v(s * 3.7, LY + 0.07, -0.85), v(s * 3.7, UY - 0.07, -1.15), 0.055, wood);
      // 張り線（X字）
      rod(v(s * 3.7, UY - 0.07, -1.55), v(s * 0.55, LY + 0.07, -1.25), 0.015);
      rod(v(s * 3.7, LY + 0.07, -1.25), v(s * 0.6, UY - 0.07, -1.6), 0.015);
    }

    // 尾翼と尾そり
    add(new THREE.BoxGeometry(3.6, 0.1, 0.9), red, 0, 0.12, 3.5);
    const fin = add(new THREE.BoxGeometry(0.1, 1.4, 1.1), red, 0, 0.75, 3.55);
    fin.rotation.x = -0.25;
    rod(v(0, -0.15, 3.2), v(0, -0.55, 3.55), 0.04);

    // 脚と車輪（下の翼の下に、左右をつなぐ車軸）
    for (const s of [-1, 1]) {
      rod(v(s * 0.4, LY, -2.0), v(s * 1.05, -1.45, -1.75));
      rod(v(s * 0.4, LY, -1.0), v(s * 1.05, -1.45, -1.75));
      const wheel = add(new THREE.CylinderGeometry(0.34, 0.34, 0.16, 14), dark, s * 1.15, -1.45, -1.75);
      wheel.rotation.z = Math.PI / 2;
    }
    rod(v(-1.05, -1.45, -1.75), v(1.05, -1.45, -1.75), 0.04);

    // 木製プロペラ
    this.prop.position.set(0, 0, -4.35);
    for (const s of [-1, 1]) {
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.3, 0.06), wood);
      blade.position.y = s * 0.68;
      blade.rotation.y = s * 0.25;
      this.prop.add(blade);
    }
    const spinner = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.6, 10), red);
    spinner.rotation.x = -Math.PI / 2;
    spinner.position.z = -0.2;
    this.prop.add(spinner);
    this.plane.add(this.prop);

    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(1.36, 32),
      new THREE.MeshBasicMaterial({ color: 0x9a6a3a, transparent: true, opacity: 0.18, depthWrite: false }),
    );
    disc.position.set(0, 0, -4.3);
    this.plane.add(disc);
    return disc;
  }

  private fit() {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (!w || !h || (w === this.w && h === this.h)) return;
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  draw(s: FlightState, realDt: number, running: boolean) {
    this.fit();
    this.t += realDt;
    const p = s.perf;
    const rough = p.mixture.zone === "tooLean" && s.status === "flying";

    // 山の上では、地面を岩の色に寄せる（谷の高さから 1500 m 上がるとほぼ岩）
    const valley = Math.min(s.leg.from.elevation, s.leg.to.elevation);
    const rocky = s.leg.terrain.length ? Math.min(0.85, Math.max(0, (groundElevation(s) - valley - 300) / 1500)) : 0;
    this.rock.visible = rocky > 0.02;
    this.rock.material.opacity = rocky;

    // 空と光：時刻に合わせて夕焼けから夜へ
    const sky = skyAt(s);
    this.skyMat.uniforms.topColor.value.copy(color(sky.top));
    this.skyMat.uniforms.bottomColor.value.copy(color(sky.bottom));
    this.fog.color.copy(color(sky.bottom));
    const sunColor = color(sky.sunColor);
    this.sun.material.color.copy(sunColor);
    this.dir.color.copy(new THREE.Color(0xffffff).lerp(sunColor, sky.dusk));
    const light = 1 - 0.75 * sky.night;
    this.dir.intensity = 2.2 * light * (1 - 0.35 * sky.dusk);
    this.hemi.intensity = 1.6 * light;
    this.hemi.color.copy(color(sky.top)).lerp(new THREE.Color(0xffffff), 0.5);
    this.cloudMat.emissive.copy(color(sky.bottom)).multiplyScalar(0.55 * light);

    // 雨や厚い雲の下では空が灰色になり、遠くが見えにくい。雲の中は真っ白
    const e = s.env;
    const gloom = Math.min(1, (e.overcast ? 0.45 : 0) + e.rain * 0.15);
    const gray = new THREE.Color(0x7d848c);
    this.skyMat.uniforms.topColor.value.lerp(gray, gloom);
    this.skyMat.uniforms.bottomColor.value.lerp(gray, gloom * 0.8);
    this.fog.color.lerp(gray, gloom * 0.8);
    this.dir.intensity *= 1 - gloom * 0.6;
    this.sun.visible = gloom < 0.3;
    if (e.inCloud) {
      this.fog.color.set(0xd5d9de).multiplyScalar(light);
      this.fog.near = 1;
      this.fog.far = 28;
    } else {
      this.fog.near = 350 - e.rain * 80;
      this.fog.far = FAR - e.rain * 350;
    }

    // 飛んでいる間だけ、景色を手前へ流す。
    // 地面と山は対地速度、空気と一緒に動く雲と風の筋は対気速度で流れるので、
    // 向かい風が強いと雲だけが速く流れて見える。
    if (running) {
      const g = Math.max(0, p.groundSpeed) * SPEED_SCALE * realDt;
      const a = Math.max(0, p.airspeed) * SPEED_SCALE * realDt;
      this.groundTex.offset.y = (this.groundTex.offset.y + (g * GROUND_REPEAT) / GROUND_SIZE) % 1;
      for (const hill of this.hills) {
        hill.position.z += g;
        if (hill.position.z > NEAR_EDGE) {
          hill.position.z -= SPAN;
          hill.position.x = this.sideX(HILL_MIN_X, 1800);
        }
      }
      for (const c of this.clouds) {
        c.position.z += a;
        if (c.position.z > NEAR_EDGE) this.placeCloud(c, c.position.z - SPAN);
      }
      for (let i = 0; i < this.streakPos.length / 6; i++) {
        this.streakPos[i * 6 + 2] += a * 1.6;
        this.streakPos[i * 6 + 5] += a * 1.6;
        // カメラ（z=10）の手前で消す。近くを通ると長い線に見えてしまうため
        if (this.streakPos[i * 6 + 5] > 0) this.placeStreak(i, rand(-280, -200));
      }
      this.streakGeo.attributes.position.needsUpdate = true;
      this.prop.rotation.z += realDt * p.rpm * 0.012;
    }
    this.propDisc.material.opacity = 0.08 + 0.14 * Math.min(1, p.rpm / 2500);

    // 飛行場：出発地はコースの 0 km、目的地は終点。引き返しているときは向きが逆になる
    const h = s.returning ? -1 : 1;
    const fieldX = -h * s.lateral * KM;
    const zOf = (alongKm: number) => -h * (alongKm - s.distanceFlown) * KM;
    const near = (z: number) => z > -FAR - 300 && z < 400;
    const zFrom = zOf(0);
    const zTo = zOf(s.leg.distanceKm);
    this.depRunway.place(near(zFrom), zFrom, fieldX, s.leg.from.surface, s.holding && s.returning);
    this.arrRunway.place(near(zTo), zTo, fieldX, s.leg.to.surface, s.holding && !s.returning);

    // 海：海の上の範囲に海面を置き、波の模様はコースの距離に合わせて流す。海の上には山を置かない
    this.seas.forEach((sea, i) => {
      const r = s.leg.sea[i];
      if (!r) return void (sea.visible = false);
      const za = Math.min(400, Math.max(-FAR - 600, zOf(r.fromKm)));
      const zb = Math.min(400, Math.max(-FAR - 600, zOf(r.toKm)));
      const len = Math.abs(zb - za);
      sea.visible = len > 1;
      if (!sea.visible) return;
      const zNear = Math.max(za, zb);
      sea.position.set(fieldX, 0.6, zNear - len / 2);
      sea.scale.set(GROUND_SIZE, len, 1);
      const tex = sea.material.map!;
      tex.repeat.set(GROUND_SIZE / SEA_TILE, (h * len) / SEA_TILE);
      tex.offset.set((this.t * 0.01) % 1, ((((s.distanceFlown * KM - h * zNear) / SEA_TILE) % 1) + 1) % 1);
    });
    for (const hill of this.hills) hill.visible = !seaAt(s.leg, s.distanceFlown - (h * hill.position.z) / KM);

    // 実際の天気（雲・雨のカーテン・積乱雲・雨粒）
    this.wx.update(s, realDt, running, this.camera.position);

    // 機体の高さは「地面からの高さ」で決める。上昇中は機首上げ、降下中は機首下げ
    const y = visualY(s.altitude - groundElevation(s));
    const flying = s.status === "flying";
    const vib = flying ? s.condition.vibration / 100 : 0;
    const jitterAmp = (rough ? 0.12 : 0) + vib * 0.25 + (flying ? s.env.turbulence * 0.12 : 0);
    const j = () => (running ? (Math.random() - 0.5) * jitterAmp : 0);
    const bob = y > 8 ? Math.sin(this.t * 1.3) * 0.3 : 0;
    const targetPitch = s.phase === "climb" && flying ? 0.12 : s.phase === "descent" && flying ? -0.06 : 0;
    this.pitchShown += (targetPitch - this.pitchShown) * Math.min(1, realDt * 2);
    this.plane.position.set(j(), y + bob + j(), 0);
    // 左右によけているときは、そちらへ機首を向けて傾ける。霧で待っているときは旋回
    const latErr = s.lateralTarget - s.lateral;
    const steer = flying && !s.holding && Math.abs(latErr) > 0.05 ? Math.sign(latErr) * h : 0;
    const bankTarget = s.holding ? -0.35 : -steer * 0.3;
    this.bankShown += (bankTarget - this.bankShown) * Math.min(1, realDt * 1.5);
    this.plane.rotation.z = this.bankShown + Math.sin(this.t * 0.7) * 0.035;
    this.plane.rotation.y = (-steer * DETOUR_ANGLE * Math.PI) / 180 / 3;
    this.plane.rotation.x = this.pitchShown + Math.sin(this.t * 1.1) * 0.012;
    this.streaks.position.y = y - ALT;

    // カメラは機体の少し後ろ上から、前方を見る
    const shake = running ? jitterAmp * 1.2 : 0;
    this.camera.position.set(
      Math.sin(this.t * 0.31) * 0.5 + (Math.random() - 0.5) * shake,
      y + 2.9 + (Math.random() - 0.5) * shake,
      10,
    );
    this.camera.lookAt(0, y + 0.6 + this.pitchShown * 8, -30);
    // 空間識失調：雲の中では、気づかないうちに画面がじわじわ傾いていく（4.10・6章）
    const tilt = Math.min(1, s.disorientation / DISORIENT_LIMIT_MIN);
    this.camera.rotateZ(-tilt * tilt * 0.7);
    this.skyMesh.position.copy(this.camera.position);
    this.sun.position.set(-1500, -60 + sky.sunHeight * 900, -2600);

    this.renderer.render(this.scene, this.camera);
  }
}

/** 田畑と道の模様（上から見た地面） */
function makeFieldTexture(): THREE.CanvasTexture {
  const size = 512;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  const fields = ["#6f9a4f", "#82a85a", "#5e8a45", "#9bb36a", "#a99a62", "#7c9550", "#8fae63", "#6b8a3f"];
  g.fillStyle = "#6a8f4a";
  g.fillRect(0, 0, size, size);
  const cells = 8;
  const cs = size / cells;
  for (let y = 0; y < cells; y++) {
    for (let x = 0; x < cells; x++) {
      // 1マスを2〜3枚の田畑に分ける
      const split = 2 + ((x * 7 + y * 3) % 2);
      for (let k = 0; k < split; k++) {
        g.fillStyle = fields[(x * 5 + y * 11 + k * 3) % fields.length];
        g.fillRect(x * cs + 2, y * cs + 2 + (k * (cs - 4)) / split, cs - 4, (cs - 4) / split - 1);
      }
    }
  }
  // 林
  g.fillStyle = "#3f6a37";
  for (let i = 0; i < 6; i++) {
    g.beginPath();
    g.ellipse(((i * 173) % size) + 20, ((i * 97) % size) + 30, 30, 18, i, 0, Math.PI * 2);
    g.fill();
  }
  // 道
  g.strokeStyle = "#c9bfa2";
  g.lineWidth = 3;
  g.beginPath();
  g.moveTo(cs * 3, 0);
  g.lineTo(cs * 3, size);
  g.moveTo(0, cs * 5);
  g.lineTo(size, cs * 5);
  g.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** 海の模様（上から見た波）。白い波頭を散らす */
function makeSeaTexture(): THREE.CanvasTexture {
  const size = 256;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d")!;
  g.fillStyle = "#2f6f9e";
  g.fillRect(0, 0, size, size);
  // 濃淡のうねり
  for (let i = 0; i < 14; i++) {
    g.fillStyle = i % 2 ? "rgba(70,140,190,0.35)" : "rgba(20,70,110,0.3)";
    g.beginPath();
    g.ellipse((i * 71) % size, (i * 137) % size, 70, 16, 0.1, 0, Math.PI * 2);
    g.fill();
  }
  // 波頭
  g.strokeStyle = "rgba(235,245,250,0.7)";
  g.lineWidth = 2;
  for (let i = 0; i < 40; i++) {
    const x = (i * 97) % size;
    const y = (i * 53 + (i % 5) * 11) % size;
    g.beginPath();
    g.moveTo(x, y);
    g.quadraticCurveTo(x + 5, y - 2, x + 11, y);
    g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** 飛行場（滑走路と格納庫）。舗装ならアスファルト、未舗装なら草地 */
class Runway {
  private group = new THREE.Group();
  private stripMat = lambert(0x4a4d52);
  private dashes: THREE.Mesh[] = [];

  constructor(scene: THREE.Scene) {
    const strip = new THREE.Mesh(new THREE.BoxGeometry(14, 0.6, 220), this.stripMat);
    strip.position.y = 0.3;
    this.group.add(strip);
    const white = lambert(0xf2f2f2);
    for (let z = -95; z <= 95; z += 19) {
      const dash = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.2, 9), white);
      dash.position.set(0, 0.7, z);
      this.dashes.push(dash);
      this.group.add(dash);
    }
    const hangar = new THREE.Mesh(new THREE.BoxGeometry(26, 12, 20), lambert(0xd9d2c3));
    hangar.position.set(32, 6, 30);
    const roof = new THREE.Mesh(new THREE.CylinderGeometry(13, 13, 20, 12, 1, false, 0, Math.PI), lambert(0xb5463c));
    roof.rotation.set(Math.PI / 2, 0, Math.PI / 2);
    roof.position.set(32, 12, 30);
    this.group.add(hangar, roof);
    // 霧のとき、飛行場をおおう白いもや
    this.fogBlanket = new THREE.Mesh(
      new THREE.BoxGeometry(900, 40, 900),
      new THREE.MeshLambertMaterial({ color: 0xe6e9ec, transparent: true, opacity: 0.85, depthWrite: false }),
    );
    this.fogBlanket.position.y = 20;
    this.group.add(this.fogBlanket);
    this.group.visible = false;
    scene.add(this.group);
  }

  private fogBlanket: THREE.Mesh;

  place(visible: boolean, z: number, x: number, surface: RunwaySurface, fogged: boolean) {
    this.group.visible = visible;
    this.group.position.set(x, 0, z);
    this.fogBlanket.visible = fogged;
    this.stripMat.color.setHex(surface === "paved" ? 0x4a4d52 : 0x9a8a5c);
    for (const d of this.dashes) d.visible = surface === "paved";
  }
}

/**
 * 実際の天気を3Dに置く。天気は「出発地からの距離 along・コースからのずれ lateral・高度」で決まっているので、
 * 機体の位置から見た向きに並べ直す（引き返しているときは前後と左右が入れ替わる）。
 */
class WeatherLayer {
  private root = new THREE.Group();
  private built: LegWeather | null = null;
  private cloudMat = lambert(0xe9ecef, { transparent: true, opacity: 0.93 });
  private cbMat = lambert(0x5b6170);
  private rockMat = lambert(0x8a847c);
  private snowMat = lambert(0xf4f6f8);
  private curtainMat = new THREE.MeshLambertMaterial({ color: 0x8e9aa8, transparent: true, opacity: 0.22, depthWrite: false });
  private rainGeo = new THREE.BufferGeometry();
  private rainPos: Float32Array;
  private rainLines: THREE.LineSegments<THREE.BufferGeometry, THREE.LineBasicMaterial>;
  private flash = 0;

  constructor(scene: THREE.Scene) {
    scene.add(this.root);
    const N = 500;
    this.rainPos = new Float32Array(N * 6);
    for (let i = 0; i < N; i++) this.placeDrop(i, rand(-140, 10));
    this.rainGeo.setAttribute("position", new THREE.BufferAttribute(this.rainPos, 3));
    this.rainLines = new THREE.LineSegments(
      this.rainGeo,
      new THREE.LineBasicMaterial({ color: 0xc8d4e0, transparent: true, opacity: 0.5 }),
    );
    this.rainLines.frustumCulled = false;
    scene.add(this.rainLines);
  }

  private placeDrop(i: number, z: number) {
    const x = rand(-70, 70);
    const y = rand(-40, 40);
    this.rainPos.set([x, y, z, x - 0.3, y - 3, z + 1.5], i * 6);
  }

  /** 天気が変わったら（区間が変わったら）作り直す */
  private build(w: LegWeather, leg: Leg) {
    this.built = w;
    for (const c of [...this.root.children]) this.root.remove(c);
    const yAt = (alt: number) => 6 + alt * 0.075;
    const puff = new THREE.IcosahedronGeometry(1, 1);

    this.buildRidges(w, leg);

    // 雲の層：ふくらんだ塊をたくさん並べる
    for (const c of w.clouds) {
      const step = 4;
      const nx = Math.max(1, Math.round((c.halfWidthKm * 2) / step));
      const nz = Math.max(1, Math.round((c.toKm - c.fromKm) / step));
      const mesh = new THREE.InstancedMesh(puff, this.cloudMat, nx * nz * 2);
      const m = new THREE.Matrix4();
      let k = 0;
      for (let ix = 0; ix < nx; ix++)
        for (let iz = 0; iz < nz; iz++)
          for (let layer = 0; layer < 2; layer++) {
            const lat = c.lateralKm - c.halfWidthKm + (ix + 0.5) * step + rand(-1, 1);
            const along = c.fromKm + (iz + 0.5) * step + rand(-1, 1);
            const alt = c.base + (c.top - c.base) * (layer === 0 ? rand(0.15, 0.4) : rand(0.55, 0.85));
            const sx = step * KM * rand(0.55, 0.8);
            const sy = (c.top - c.base) * 0.075 * rand(0.3, 0.45);
            m.compose(
              new THREE.Vector3(lat * KM, yAt(alt), -along * KM),
              new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rand(0, Math.PI), 0)),
              new THREE.Vector3(sx, sy, sx * rand(0.8, 1.2)),
            );
            mesh.setMatrixAt(k++, m);
          }
      this.root.add(mesh);
    }

    // 雨のカーテン（地面から雲の底まで）
    for (const r of w.rain) {
      const cloud = w.clouds.find((c) => c.id === r.id);
      const top = yAt(cloud ? cloud.base : 1500);
      const box = new THREE.Mesh(new THREE.BoxGeometry(r.halfWidthKm * 2 * KM, top, (r.toKm - r.fromKm) * KM), this.curtainMat);
      box.position.set(r.lateralKm * KM, top / 2, -((r.fromKm + r.toKm) / 2) * KM);
      this.root.add(box);
    }

    // 積乱雲：高くそびえる暗い雲の塔と、上の金床
    for (const cb of w.cb) {
      const g = new THREE.Group();
      const r = cb.radiusKm * KM;
      for (let i = 0; i < 9; i++) {
        const m = new THREE.Mesh(puff, this.cbMat);
        const u = i / 8;
        const rr = r * (1.1 - 0.35 * u) * rand(0.9, 1.1);
        m.scale.set(rr, rr * 0.9, rr);
        m.position.set(rand(-r, r) * 0.3, yAt(1200 + u * 7000), rand(-r, r) * 0.3);
        g.add(m);
      }
      const anvil = new THREE.Mesh(puff, this.cbMat);
      anvil.scale.set(r * 2.6, r * 0.35, r * 2.2);
      anvil.position.y = yAt(9000);
      g.add(anvil);
      g.position.set(cb.lateralKm * KM, 0, -cb.alongKm * KM);
      this.root.add(g);
    }
  }

  /**
   * 山の尾根：コースを横切る山なみとして、峰をたくさん並べる。
   * コースの真上の峰は、その地点の地面の高さ（terrainAt）と同じ。15 km より外の峰は少し高いこともある（見た目だけ）。
   * 凍る高さより上は雪をかぶせる。
   */
  private buildRidges(w: LegWeather, leg: Leg) {
    if (!leg.terrain.length) return;
    const STEP_ALONG = 3;
    const STEP_LAT = 6;
    const LAT = 72;
    const base = Math.min(leg.from.elevation, leg.to.elevation) - 300;
    const snowLine = w.freezingLevel - 300;
    const cone = new THREE.ConeGeometry(1, 1, 5);
    cone.translate(0, 0.5, 0);
    const peaks: { x: number; z: number; h: number; r: number; rot: number }[] = [];
    for (const r of leg.terrain)
      for (let along = r.fromKm + STEP_ALONG / 2; along < r.toKm; along += STEP_ALONG)
        for (let lat = -LAT; lat <= LAT; lat += STEP_LAT) {
          // コースは尾根のいちばん低いところ（鞍部）を越える。少し離れた左右には、もっと高い峰がある
          const k = Math.abs(lat) < STEP_LAT / 2 ? 1 : Math.abs(lat) < 15 ? rand(0.85, 1) : rand(0.85, 1.12);
          const a = along + rand(-1, 1);
          const h = terrainAt(leg, a) * k;
          if (h - base < 200) continue;
          peaks.push({ x: (lat + rand(-2, 2)) * KM, z: -a * KM, h, r: rand(3, 4.5) * KM, rot: rand(0, Math.PI) });
        }
    const rock = new THREE.InstancedMesh(cone, this.rockMat, peaks.length);
    const caps = peaks.filter((p) => p.h > snowLine);
    const snow = new THREE.InstancedMesh(cone, this.snowMat, Math.max(1, caps.length));
    snow.count = caps.length;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    peaks.forEach((p, i) => {
      const hy = (p.h - base) * 0.075;
      q.setFromEuler(new THREE.Euler(0, p.rot, 0));
      m.compose(new THREE.Vector3(p.x, base * 0.075, p.z), q, new THREE.Vector3(p.r, hy, p.r));
      rock.setMatrixAt(i, m);
    });
    caps.forEach((p, i) => {
      // 雪は峰の上の部分だけ。円すいの相似形なので、高さの割合で半径も縮める
      const total = (p.h - base) * 0.075;
      const cap = (p.h - snowLine) * 0.075;
      const ratio = cap / total;
      q.setFromEuler(new THREE.Euler(0, p.rot, 0));
      m.compose(new THREE.Vector3(p.x, p.h * 0.075 - cap + 0.3, p.z), q, new THREE.Vector3(p.r * ratio * 1.04, cap, p.r * ratio * 1.04));
      snow.setMatrixAt(i, m);
    });
    this.root.add(rock, snow);
  }

  update(s: FlightState, realDt: number, running: boolean, cam: THREE.Vector3) {
    if (this.built !== s.weather) this.build(s.weather, s.leg);
    const h = s.returning ? -1 : 1;
    const ground = groundElevation(s);
    this.root.scale.set(h, 1, h);
    this.root.position.set(-h * s.lateral * KM, -ground * 0.075, h * s.distanceFlown * KM);

    // 雨粒：雨の中だけ。カメラのまわりを手前へ流れる
    const rain = s.env.rain;
    this.rainLines.visible = rain > 0;
    if (rain > 0) {
      this.rainLines.material.opacity = 0.25 + rain * 0.15;
      this.rainLines.position.copy(cam);
      if (running) {
        const v = (40 + s.perf.airspeed * 0.6) * realDt;
        for (let i = 0; i < this.rainPos.length / 6; i++) {
          this.rainPos[i * 6 + 2] += v;
          this.rainPos[i * 6 + 5] += v;
          this.rainPos[i * 6 + 1] -= 30 * realDt;
          this.rainPos[i * 6 + 4] -= 30 * realDt;
          if (this.rainPos[i * 6 + 2] > 10 || this.rainPos[i * 6 + 1] < -40) this.placeDrop(i, rand(-140, -60));
        }
        this.rainGeo.attributes.position.needsUpdate = true;
      }
    }

    // 積乱雲の稲光
    if (running && s.env.cbDistance < 80 && Math.random() < realDt * 0.6) this.flash = 0.25;
    this.flash = Math.max(0, this.flash - realDt);
    const f = this.flash > 0.1 ? 0.7 : 0;
    this.cbMat.emissive.setRGB(f, f, f * 1.1);
  }
}
