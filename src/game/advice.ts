// 整備士のひとこと（飛行中）。状況に応じて一番大事な一言を選ぶ。
// 焦りが高いと（E2）、危ないサインも「まあ大丈夫だろう」に聞こえてしまう（判断が甘くなる演出）。
import {
  BOLT_DANGER,
  CB_DANGER_KM,
  DISORIENT_LIMIT_MIN,
  PILOT_RED,
  REDLINE_RPM,
  RESERVE_FUEL_L,
  VA_KMH,
  VIBRATION_RED,
  VIBRATION_YELLOW,
} from "../config";
import { isHasty } from "../model/pilot";
import { clockMin, destination, distanceLeft, terrainAt, type FlightState } from "./flight";

type Key =
  | "cloud"
  | "cb"
  | "terrain"
  | "fog"
  | "overspeed"
  | "turbulence"
  | "lean"
  | "vibration"
  | "ice"
  | "bolt"
  | "carb"
  | "engine"
  | "tired"
  | "range"
  | "sunset"
  | "rain"
  | "reserve"
  | "other";

/** 焦っているときに聞こえる「まあ大丈夫だろう」 */
const OPTIMISTIC: Partial<Record<Key, string>> = {
  cloud: "雲なんて、まっすぐ行けばすぐ抜けるさ。まあ大丈夫だろう。",
  cb: "あの雲はまだ遠い。急げば横をすり抜けられる。",
  terrain: "山くらい、なんとか越えられるさ。",
  fog: "霧なんて、降りてみれば何とかなる。待ってる時間はないぞ。",
  turbulence: "揺れには慣れてる。速度は落とさず急ごう。",
  vibration: "少し揺れるくらい、いつものことだ。",
  ice: "氷くらい、そのうち溶けるさ。",
  bolt: "ボルト？ 次の飛行場で見ればいい。",
  carb: "回転が下がった？ 気のせいだろう。",
  tired: "まだいける。休むのは着いてからだ。",
  range: "燃料はたぶん足りる。まあ大丈夫だろう。",
  sunset: "日没までには、なんとか着くだろう。",
  rain: "雨くらいで絞ってたら間に合わないぞ。",
  reserve: "予備の燃料なんて、ちょっと残ってれば十分だ。",
};

export function mechanicAdvice(s: FlightState): string {
  const [key, text] = realAdvice(s);
  if (isHasty(s.pilot.haste) && OPTIMISTIC[key]) return OPTIMISTIC[key]!;
  return text;
}

/** 焦っていないときの、本当のひとこと */
function realAdvice(s: FlightState): [Key, string] {
  const p = s.perf;
  const a = s.condition;
  const e = s.env;
  const left = distanceLeft(s);
  const etaMin = p.groundSpeed > 0 ? clockMin(s) + (left / p.groundSpeed) * 60 : Infinity;

  // ---- 命に関わること ----
  if (e.inCloud)
    return [
      "cloud",
      s.disorientation > DISORIENT_LIMIT_MIN / 2
        ? "雲から出ろ！上下の感覚はあてにならない。高度を変えるか、引き返せ！"
        : "雲の中だ！計器飛行の訓練がないなら、すぐ雲から出ろ（高度を変えるか、横によけるか、引き返す）。",
    ];
  if (e.cbDistance < CB_DANGER_KM)
    return ["cb", `積乱雲に近すぎる（${Math.round(e.cbDistance)} km）！ 37 km 以上離れろ。横によけるか、引き返せ。`];
  const ahead = aheadTerrain(s);
  // 離陸したばかりのときは、滑走路の先の地面そのものを「山」と言わない
  const justDeparted = !s.returning && s.elapsedMin < 3 && s.altitude - s.leg.from.elevation < 150;
  if (ahead > s.altitude - 150 && !justDeparted) return ["terrain", `前方の山（${Math.round(ahead)} m）に高度が足りない！ 上昇するか、引き返せ。`];
  if (s.holding) return ["fog", `${destination(s).name}は霧だ。燃料と相談して、待つか、引き返すか決めろ。`];
  if (p.rpm > REDLINE_RPM)
    return [
      "overspeed",
      s.phase === "descent"
        ? "回転が上がりすぎだ！降下で速度が出ると回転も上がる。スロットルを絞れ。"
        : "回転がレッドラインを超えてる！スロットルを絞れ。上昇型のプロペラは回りやすいんだ。",
    ];
  if (e.turbulence > 0 && p.airspeed > VA_KMH)
    return ["turbulence", `揺れてる！速度を ${VA_KMH} km/h 以下に落とせ。速いままだと機体が壊れる。`];
  if (p.mixture.zone === "tooLean") return ["lean", "薄すぎる！エンジンが荒れてるぞ。少し濃い方へ戻せ。"];
  if (a.vibration >= VIBRATION_RED)
    return ["vibration", "振動がひどい！このままだとプロペラが割れる。出力を絞って、早く降りて点検しろ。"];
  if (a.propIce > 10)
    return ["ice", e.aboveFreezing ? "プロペラに氷が付いてる！凍結高度より下へ降りろ。" : "氷が溶けるまで、凍結高度より下にいろ。"];
  if (a.boltTightness < BOLT_DANGER) return ["bolt", "ボルトがかなりゆるんでる。次の飛行場で必ず締め直せ。"];
  if (a.carbIce > 15 && !s.controls.carbHeat)
    return ["carb", "回転がじわじわ下がってないか？晴れていても、湿った日はキャブレターが凍る。キャブヒートを入れろ。"];
  if (a.engineHealth < 60) return ["engine", "エンジンの調子が落ちてる。無理をさせるな。"];
  if (p.rangeKm < left)
    return [
      "range",
      p.mixture.zone === "rich"
        ? "このままじゃ届かない。まずは混合比を少しずつ薄くしてみろ。"
        : "このままじゃ届かない。出力を絞って燃費を稼ぐか、風の弱い高度を探せ。引き返すのも手だ。",
    ];
  if (etaMin > s.sunsetMin) return ["sunset", "このペースだと日没に間に合わないぞ。出力を上げるか、引き返せ。"];
  if (s.pilot.fatigue >= PILOT_RED)
    return ["tired", "目がしょぼしょぼしてないか？ 疲れると操作も計器の読みも遅れる。次の飛行場で休め。"];

  // ---- 天気と操縦 ----
  if (e.rain > 0) return ["rain", "雨の中ではスロットルを絞れ。水滴の当たる強さが変わる。"];
  if (s.controls.carbHeat && a.carbIce < 1) return ["other", "キャブヒートは入れっぱなしだと出力が落ちる。氷が溶けたら切っていい。"];
  if (s.phase === "climb")
    return [
      "other",
      s.controls.throttle < 0.95
        ? "上昇は全開でいけ。高く上がるほど空気が薄い、混合比も少しずつ薄くしろ。"
        : "高く上がるほど空気が薄くなる。排気温度計を見ながら、混合比を合わせ直せ。",
    ];
  if (s.phase === "descent" && p.rpm > REDLINE_RPM - 100) return ["overspeed", "降下中は回転が上がる。スロットルを絞っておけ。"];
  if (a.vibration >= VIBRATION_YELLOW) return ["vibration", "少し振動が出てる。ボルトか前縁を疑え。次の飛行場で点検だ。"];
  if (s.condition.fuelRemaining - (left / Math.max(1, p.groundSpeed)) * p.fuelBurn < RESERVE_FUEL_L)
    return ["reserve", "届きはするが、予備の燃料が残らない。もう少し燃費を詰めろ。"];
  if (s.phase === "descent") return ["other", "降下中だ。速度が出るぶん、回転計から目を離すな。"];
  if (e.headwind > 25) return ["other", "向かい風が強い。高度を変えると風が変わる。予報の高度別の風を見てみろ。"];
  switch (p.mixture.zone) {
    case "rich":
      return ["other", "濃すぎて燃料を食っている。少しずつ薄くして、排気温度計の針がいちばん上がるところを探せ。"];
    case "power":
      return ["other", "回転がいちばん上がるところが最大出力。そこから少し薄くすると燃費が良くなる。"];
    case "economy":
      return ["other", "いい混ぜ方だ。排気温度がいちばん高いあたりが、いちばん遠くまで飛べる。少し遅くなるのは我慢だ。"];
  }
  return ["other", ""];
}

/** 前方 25 km までのいちばん高い地面 */
function aheadTerrain(s: FlightState) {
  const dir = s.returning ? -1 : 1;
  let h = 0;
  for (let d = 0; d <= 25; d += 2.5) h = Math.max(h, terrainAt(s.leg, s.distanceFlown + dir * d));
  return h;
}
