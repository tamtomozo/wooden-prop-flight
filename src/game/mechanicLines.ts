// 整備士のひとこと：パラメータごとに、現実の理屈を一行で（1章 方針3・6章）。
// 「」の文は設計書3章の例のまま。焦りが高いと（E2）、楽観的な文に変わる。
import { isHasty } from "../model/pilot";
import { tr } from "../i18n";

export type ParamId =
  | "A1"
  | "A2"
  | "A3"
  | "A4"
  | "B1"
  | "B2"
  | "B3"
  | "B4"
  | "B5"
  | "B6"
  | "C1"
  | "C2"
  | "C3"
  | "C4"
  | "ASI"
  | "ALT"
  | "EGT"
  | "FUEL"
  | "COURSE"
  | "E1"
  | "E2";

interface ParamLine {
  name: string;
  line: string;
  /** 焦っているときに聞こえる文 */
  hasty: string;
}

export const PARAM_LINES: Record<ParamId, ParamLine> = {
  A1: {
    name: tr("プロペラの性格", "Propeller type"),
    line: tr("長い滑走路から出るなら巡航型でいける。山を越えるなら上昇型が安心だ。", "From a long runway a cruise prop will do. If you're crossing mountains, a climb prop is safer."),
    hasty: tr("巡航型にしておけば速い。滑走路の長さなんて何とかなる。", "Go with a cruise prop, it's fast. The runway length will work out."),
  },
  A2: {
    name: tr("燃料の量", "Fuel load"),
    line: tr("暑い日の満タン離陸は、滑走路の長さを必ず確認しろ。", "Taking off full on a hot day? Always check the runway length."),
    hasty: tr("満タンにしておけば安心だ。重さなんて気にするな。", "Fill it up and you're safe. Don't worry about the weight."),
  },
  A3: {
    name: tr("ボルトの締め付け", "Bolt torque"),
    line: tr("確かめるときは締める方向で。ゆるめて測っても正しい値は出ない。", "Always check in the tightening direction. Loosening it to measure won't give the right value."),
    hasty: tr("ボルトなんて、ぎゅっと締めておけばいい。", "Bolts? Just crank them down tight."),
  },
  A4: {
    name: tr("装備", "Equipment"),
    line: tr("装備は重さとの相談だ。雨の多い旅なら前縁の保護、整備場のない道なら工具だ。", "Equipment is a trade-off with weight. Edge protection for a rainy trip, tools for a route without repair shops."),
    hasty: tr("装備なんて重いだけだ。身軽に行こう。", "Equipment is just dead weight. Travel light."),
  },
  B1: {
    name: tr("ボルトの締まり", "Bolt tightness"),
    line: tr("気候の違う土地に着いたら、まず締め直せ。", "When you land somewhere with a different climate, re-tighten first."),
    hasty: tr("ボルト？ 次の飛行場で見ればいいさ。", "The bolts? We can look at them at the next field."),
  },
  B2: {
    name: tr("プロペラの前縁", "Prop leading edge"),
    line: tr("雨の中ではスロットルを絞れ。水滴の当たる強さが変わる。", "Throttle back in the rain. It changes how hard the drops hit the propeller."),
    hasty: tr("傷のひとつやふたつ、平気だ。", "A nick or two is nothing."),
  },
  B3: {
    name: tr("振動", "Vibration"),
    line: tr("振動は総合的な警告だ。出たら原因を探せ。ボルトのゆるみか、前縁の傷か、着氷か。", "Vibration is a catch-all warning. When it shows up, find the cause: loose bolts, a nicked leading edge, or ice."),
    hasty: tr("少し揺れるくらい、いつものことだ。", "A bit of shaking is normal."),
  },
  B4: {
    name: tr("エンジンの調子", "Engine health"),
    line: tr("薄くしすぎと回しすぎが、エンジンをいちばん傷める。", "Running too lean and overspeeding hurt the engine most."),
    hasty: tr("エンジンはまだ回ってる。まあ大丈夫だろう。", "The engine is still turning. It'll probably be fine."),
  },
  B5: {
    name: tr("プロペラ耐久度", "Prop durability"),
    line: tr("締めすぎと強い振動が、木のプロペラを弱らせる。", "Over-tightening and heavy vibration weaken a wooden propeller."),
    hasty: tr("木は丈夫だ。まだまだもつさ。", "Wood is tough. It'll last a good while yet."),
  },
  B6: {
    name: tr("機体の強度", "Airframe strength"),
    line: tr("積乱雲には近づくな。揺れたら速度を落とせ。", "Stay away from thunderstorms. When it gets rough, slow down."),
    hasty: tr("多少の揺れで壊れるほどやわじゃない。", "It's not so flimsy that a few bumps will break it."),
  },
  C1: {
    name: tr("スロットル", "Throttle"),
    line: tr("固定ピッチだから、降下で速度が上がると回転も上がる。降下中は絞れ。", "It's a fixed-pitch prop, so when speed rises in the descent the RPM rises too. Throttle back while descending."),
    hasty: tr("全開で急げば、遅れを取り戻せる。", "Hurry at full throttle and you'll make up the time."),
  },
  C2: {
    name: tr("ミクスチャー", "Mixture"),
    line: tr("回転が一番上がるところが最大出力。そこから少し薄くすると燃費が良くなる。", "Where the RPM peaks is best power. Lean a little from there for better economy."),
    hasty: tr("濃いままでいい。いじっている暇はない。", "Leave it rich. No time to fiddle with it."),
  },
  C3: {
    name: tr("キャブレターヒート", "Carburetor heat"),
    line: tr("晴れていても、湿った日は凍る。回転がじわじわ下がったら疑え。", "Even in clear weather, it ices up on humid days. Suspect it when the RPM creeps down."),
    hasty: tr("回転が下がった？ 気のせいだろう。", "RPM dropping? Probably your imagination."),
  },
  C4: {
    name: tr("飛行高度", "Altitude"),
    line: tr("高度を変えれば風が変わる。山越えには十分な高度が要る。", "Change altitude and the wind changes. Crossing mountains takes plenty of height."),
    hasty: tr("高度なんて今のままでいい。まっすぐ行こう。", "The altitude's fine as it is. Just go straight."),
  },
  ASI: {
    name: tr("対気速度計", "Airspeed indicator"),
    line: tr("白い印が設計運動速度（140 km/h）。揺れたら、それより遅く飛べ。", "The white mark is the maneuvering speed (140 km/h). When it gets rough, fly slower than that."),
    hasty: tr("揺れても速度は落とすな。急ごう。", "Don't slow down for the bumps. Let's hurry."),
  },
  ALT: {
    name: tr("高度計", "Altimeter"),
    line: tr("雲の中で高度計がじわじわ下がり、速度が上がっていたら、旋回降下に入っている合図だ。", "If, in cloud, the altimeter creeps down while the speed builds, you're in a spiral dive."),
    hasty: tr("高度計なんて、たまに見れば十分だ。", "A glance at the altimeter now and then is enough."),
  },
  EGT: {
    name: tr("排気温度計", "EGT gauge"),
    line: tr("排気温度がいちばん高いところが最良燃費。そこを越えて薄くすると荒れる。", "Peak EGT is best economy. Lean past it and the engine runs rough."),
    hasty: tr("排気温度なんて気にするな。", "Don't worry about the EGT."),
  },
  FUEL: {
    name: tr("燃料計", "Fuel gauge"),
    line: tr("予備燃料は30分ぶん（8 L くらい）は残せ。よけた距離や待った時間のぶんも減る。", "Keep 30 minutes of reserve (about 8 L). Detours and waiting burn fuel too."),
    hasty: tr("燃料はたぶん足りる。まあ大丈夫だろう。", "There's probably enough fuel. It'll probably be fine."),
  },
  COURSE: {
    name: tr("よける", "Dodge"),
    line: tr("積乱雲からは 37 km 以上離れろ。よけたぶん遠回りになるのは覚悟しろ。", "Keep at least 37 km from thunderstorms. Accept that dodging makes the trip longer."),
    hasty: tr("よけていたら遅れる。まっすぐ突っ切ろう。", "Dodging will make us late. Let's punch straight through."),
  },
  E1: {
    name: tr("疲労", "Fatigue"),
    line: tr("疲れると操作も計器の読みも遅れる。一晩休め。", "When you're tired, you're slow on the controls and the gauges. Rest for the night."),
    hasty: tr("まだいける。休むのは着いてからだ。", "You can keep going. Rest when we get there."),
  },
  E2: {
    name: tr("焦り", "Haste"),
    line: tr("焦りは判断を鈍らせる。降りて待つのも、引き返すのも正しい判断だ。", "Haste dulls your judgment. Landing to wait and turning back are both right calls."),
    hasty: tr("急げばまだ間に合う。", "If we hurry, we can still make it."),
  },
};

/** そのパラメータの整備士のひとこと（焦っていれば楽観的な文） */
export function paramLine(id: ParamId, haste: number): string {
  const p = PARAM_LINES[id];
  return isHasty(haste) ? p.hasty : p.line;
}
