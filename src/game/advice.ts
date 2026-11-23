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
import { tr } from "../i18n";

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
  cloud: tr("雲なんて、まっすぐ行けばすぐ抜けるさ。まあ大丈夫だろう。", "Cloud? Go straight and you'll be through in no time. It'll probably be fine."),
  cb: tr("あの雲はまだ遠い。急げば横をすり抜けられる。", "That storm is still far off. Hurry and you can slip past it."),
  terrain: tr("山くらい、なんとか越えられるさ。", "We'll get over the mountains somehow."),
  fog: tr("霧なんて、降りてみれば何とかなる。待ってる時間はないぞ。", "Fog? Just go down and it'll work out. No time to wait."),
  turbulence: tr("揺れには慣れてる。速度は落とさず急ごう。", "We're used to bumps. Don't slow down, let's hurry."),
  vibration: tr("少し揺れるくらい、いつものことだ。", "A bit of shaking is normal."),
  ice: tr("氷くらい、そのうち溶けるさ。", "The ice will melt sooner or later."),
  bolt: tr("ボルト？ 次の飛行場で見ればいい。", "The bolts? We can look at them at the next field."),
  carb: tr("回転が下がった？ 気のせいだろう。", "RPM dropping? Probably your imagination."),
  tired: tr("まだいける。休むのは着いてからだ。", "You can keep going. Rest when we get there."),
  range: tr("燃料はたぶん足りる。まあ大丈夫だろう。", "There's probably enough fuel. It'll probably be fine."),
  sunset: tr("日没までには、なんとか着くだろう。", "We'll make it before sunset somehow."),
  rain: tr("雨くらいで絞ってたら間に合わないぞ。", "Throttle back for a bit of rain and we'll never make it."),
  reserve: tr("予備の燃料なんて、ちょっと残ってれば十分だ。", "Reserve fuel? A little left over is plenty."),
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
        ? tr("雲から出ろ！上下の感覚はあてにならない。高度を変えるか、引き返せ！", "Get out of the cloud! You can't trust your sense of up and down. Change altitude or turn back!")
        : tr("雲の中だ！計器飛行の訓練がないなら、すぐ雲から出ろ（高度を変えるか、横によけるか、引き返す）。", "You're in cloud! Without instrument training, get out right away (change altitude, dodge sideways, or turn back)."),
    ];
  if (e.cbDistance < CB_DANGER_KM)
    return ["cb", tr(
        `積乱雲に近すぎる（${Math.round(e.cbDistance)} km）！ 37 km 以上離れろ。横によけるか、引き返せ。`,
        `Too close to the thunderstorm (${Math.round(e.cbDistance)} km)! Stay at least 37 km away. Dodge sideways or turn back.`,
      )];
  const ahead = aheadTerrain(s);
  // 離陸したばかりのときは、滑走路の先の地面そのものを「山」と言わない
  const justDeparted = !s.returning && s.elapsedMin < 3 && s.altitude - s.leg.from.elevation < 150;
  if (ahead > s.altitude - 150 && !justDeparted) return ["terrain", tr(`前方の山（${Math.round(ahead)} m）に高度が足りない！ 上昇するか、引き返せ。`, `Not enough height for the mountain ahead (${Math.round(ahead)} m)! Climb or turn back.`)];
  if (s.holding) return ["fog", tr(
        `${destination(s).name}は霧だ。燃料と相談して、待つか、引き返すか決めろ。`,
        `${destination(s).name} is fogged in. Check your fuel and decide: hold, or turn back.`,
      )];
  if (p.rpm > REDLINE_RPM)
    return [
      "overspeed",
      s.phase === "descent"
        ? tr("回転が上がりすぎだ！降下で速度が出ると回転も上がる。スロットルを絞れ。", "RPM too high! Speed in the descent pushes the RPM up. Throttle back.")
        : tr("回転がレッドラインを超えてる！スロットルを絞れ。上昇型のプロペラは回りやすいんだ。", "RPM is past the red line! Throttle back. A climb propeller spins up easily."),
    ];
  if (e.turbulence > 0 && p.airspeed > VA_KMH)
    return ["turbulence", tr(`揺れてる！速度を ${VA_KMH} km/h 以下に落とせ。速いままだと機体が壊れる。`, `It's rough! Slow down below ${VA_KMH} km/h. Stay fast and the airframe will break.`)];
  if (p.mixture.zone === "tooLean") return ["lean", tr("薄すぎる！エンジンが荒れてるぞ。少し濃い方へ戻せ。", "Too lean! The engine is running rough. Go back a little richer.")];
  if (a.vibration >= VIBRATION_RED)
    return ["vibration", tr("振動がひどい！このままだとプロペラが割れる。出力を絞って、早く降りて点検しろ。", "Heavy vibration! The propeller will crack like this. Reduce power, land soon and inspect it.")];
  if (a.propIce > 10)
    return ["ice", e.aboveFreezing ? tr("プロペラに氷が付いてる！凍結高度より下へ降りろ。", "Ice on the propeller! Descend below the freezing level.") : tr("氷が溶けるまで、凍結高度より下にいろ。", "Stay below the freezing level until the ice melts.")];
  if (a.boltTightness < BOLT_DANGER) return ["bolt", tr("ボルトがかなりゆるんでる。次の飛行場で必ず締め直せ。", "The bolts are quite loose. Re-tighten them at the next field, no matter what.")];
  if (a.carbIce > 15 && !s.controls.carbHeat)
    return ["carb", tr("回転がじわじわ下がってないか？晴れていても、湿った日はキャブレターが凍る。キャブヒートを入れろ。", "Is the RPM creeping down? Even in clear weather, the carburetor can ice up on a humid day. Turn on carb heat.")];
  if (a.engineHealth < 60) return ["engine", tr("エンジンの調子が落ちてる。無理をさせるな。", "The engine is getting worse. Don't push it.")];
  if (p.rangeKm < left)
    return [
      "range",
      p.mixture.zone === "rich"
        ? tr("このままじゃ届かない。まずは混合比を少しずつ薄くしてみろ。", "You won't make it like this. First, try leaning the mixture little by little.")
        : tr("このままじゃ届かない。出力を絞って燃費を稼ぐか、風の弱い高度を探せ。引き返すのも手だ。", "You won't make it like this. Throttle back to save fuel, or find an altitude with weaker wind. Turning back is an option too."),
    ];
  if (etaMin > s.sunsetMin) return ["sunset", tr("このペースだと日没に間に合わないぞ。出力を上げるか、引き返せ。", "At this pace you won't make it before sunset. Add power or turn back.")];
  if (s.pilot.fatigue >= PILOT_RED)
    return ["tired", tr("目がしょぼしょぼしてないか？ 疲れると操作も計器の読みも遅れる。次の飛行場で休め。", "Eyes getting heavy? Tired pilots are slow on the controls and the gauges. Rest at the next field.")];

  // ---- 天気と操縦 ----
  if (e.rain > 0) return ["rain", tr("雨の中ではスロットルを絞れ。水滴の当たる強さが変わる。", "Throttle back in the rain. It changes how hard the drops hit the propeller.")];
  if (s.controls.carbHeat && a.carbIce < 1) return ["other", tr("キャブヒートは入れっぱなしだと出力が落ちる。氷が溶けたら切っていい。", "Leaving carb heat on costs power. Once the ice has melted you can turn it off.")];
  if (s.phase === "climb")
    return [
      "other",
      s.controls.throttle < 0.95
        ? tr("上昇は全開でいけ。高く上がるほど空気が薄い、混合比も少しずつ薄くしろ。", "Climb at full throttle. The higher you go, the thinner the air, so lean the mixture little by little.")
        : tr("高く上がるほど空気が薄くなる。排気温度計を見ながら、混合比を合わせ直せ。", "The higher you go, the thinner the air. Watch the EGT gauge and re-set the mixture."),
    ];
  if (s.phase === "descent" && p.rpm > REDLINE_RPM - 100) return ["overspeed", tr("降下中は回転が上がる。スロットルを絞っておけ。", "RPM rises in the descent. Keep the throttle back.")];
  if (a.vibration >= VIBRATION_YELLOW) return ["vibration", tr("少し振動が出てる。ボルトか前縁を疑え。次の飛行場で点検だ。", "A little vibration. Suspect the bolts or the leading edge. Inspect at the next field.")];
  if (s.condition.fuelRemaining - (left / Math.max(1, p.groundSpeed)) * p.fuelBurn < RESERVE_FUEL_L)
    return ["reserve", tr("届きはするが、予備の燃料が残らない。もう少し燃費を詰めろ。", "You'll make it, but without the reserve left. Squeeze out a bit more economy.")];
  if (s.phase === "descent") return ["other", tr("降下中だ。速度が出るぶん、回転計から目を離すな。", "You're descending. With the extra speed, keep your eyes on the tachometer.")];
  if (e.headwind > 25) return ["other", tr("向かい風が強い。高度を変えると風が変わる。予報の高度別の風を見てみろ。", "Strong headwind. Change altitude and the wind changes. Check the forecast's winds by altitude.")];
  switch (p.mixture.zone) {
    case "rich":
      return ["other", tr("濃すぎて燃料を食っている。少しずつ薄くして、排気温度計の針がいちばん上がるところを探せ。", "Too rich, burning fuel. Lean it little by little and find where the EGT needle peaks.")];
    case "power":
      return ["other", tr("回転がいちばん上がるところが最大出力。そこから少し薄くすると燃費が良くなる。", "Where the RPM peaks is best power. Lean a little from there for better economy.")];
    case "economy":
      return ["other", tr("いい混ぜ方だ。排気温度がいちばん高いあたりが、いちばん遠くまで飛べる。少し遅くなるのは我慢だ。", "Good mixture. Around peak EGT is where you fly the farthest. Put up with being a little slower.")];
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
