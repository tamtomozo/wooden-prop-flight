// 経由地のうわさ話（第三者の証言）。次の区間のデータ（山・海・天気のひな形・着く先の飛行場）から作るので、
// 予報や地図とくい違うことはない。人物は架空の土地の人で、実在の人物のセリフにはしない。
import { MAX_ALTITUDE } from "../config";
import { longestSeaKm, seaAt, seaKm } from "../data/world";
import type { Leg } from "../model/types";
import { headwindAt, spreadAt } from "../model/weather";
import { tr } from "../i18n";

const FISHER = tr("漁師", "Fisherman");
const VILLAGER = tr("村の人", "Villager");
const MAIL_PILOT = tr("郵便機の操縦士", "Mail pilot");
const FUELER = tr("給油係", "Fuel hand");
const INNKEEPER = tr("宿のおかみ", "Innkeeper");

export interface Rumor {
  /** 話している人 */
  who: string;
  text: string;
}

interface Candidate extends Rumor {
  /** 大事さ（大きいほど先に出す） */
  weight: number;
}

/** 午後に育ちやすい、とみなす確率 */
const LIKELY = 0.3;

function candidates(leg: Leg): Candidate[] {
  const out: Candidate[] = [];
  const to = leg.to.name;
  const feats = leg.weather.features;
  const ridge = [...leg.terrain].sort((a, b) => b.height - a.height)[0];
  const longest = longestSeaKm(leg);
  const seaTotal = seaKm(leg);
  const local = leg.sea.length ? FISHER : VILLAGER;

  // 高い山：重いと上がりきれない
  if (ridge && ridge.height >= 1500) {
    out.push({
      who: VILLAGER,
      weight: 9,
      text: tr(
        `先週ここを出た機は、${ridge.name}（${ridge.height} m）を越えられずに引き返してきた。${
          ridge.fromKm < 40 ? "飛び立ったらすぐ上りだ。" : ""
        }重いと山に間に合わないってさ。`,
        `A plane that left here last week couldn't get over ${ridge.name} (${ridge.height} m) and came back. ${
          ridge.fromKm < 40 ? "The climb starts right after takeoff. " : ""
        }They say if you're heavy, you won't clear the mountains in time.`,
      ),
    });
  }
  // 長い海：止まったら終わり
  if (longest >= 250) {
    out.push({
      who: FISHER,
      weight: 9,
      text: tr(
        `沖で止まった機は、まだ見つかっていない。海の上は ${Math.round(seaTotal)} km。戻るなら、早いうちに決めな。`,
        `The plane that stopped out at sea still hasn't been found. It's ${Math.round(seaTotal)} km over water. If you're going to turn back, decide early.`,
      ),
    });
  } else if (seaTotal > 0) {
    out.push({ who: FISHER, weight: 5, text: tr(
        `海の上は ${Math.round(seaTotal)} km。向こう岸が見えるのは、晴れた朝だけだ。`,
        `It's ${Math.round(seaTotal)} km over water. You only see the far shore on a clear morning.`,
      ),
    });
  }
  // 午後の積乱雲
  const cb = feats.find((f) => f.cb && f.prob.afternoon >= LIKELY && f.prob.afternoon > f.prob.morning);
  if (cb?.cb) {
    const where = seaAt(leg, cb.cb.alongKm) ? tr("沖", "out at sea") : tr(`${Math.round(cb.cb.alongKm)} km あたり`, `around ${Math.round(cb.cb.alongKm)} km`);
    out.push({ who: local, weight: 8, text: tr(
        `午後になると、${where}に入道雲が立つ。昼までに抜けるのが、このあたりの決まりだ。`,
        `In the afternoon, thunderheads tower up ${where}. Around here the rule is to be through by noon.`,
      ),
    });
  }
  // 峰にかかる雲
  const capCloud = ridge && feats.find((f) => f.cloud && f.cloud.base <= ridge.height && Math.max(f.prob.morning, f.prob.afternoon) >= LIKELY);
  if (capCloud) {
    out.push({
      who: VILLAGER,
      weight: 7,
      text: tr(
        "峰はたいてい雲をかぶってる。雲の中で向きがわからなくなって、きりもみで落ちた機があったそうだ。",
        "The peak is usually capped with cloud. They say one plane lost its bearings in there and went down in a spin.",
      ),
    });
  }
  // 着氷：すすめの高度のすぐ上が凍結高度で、雲や雨が出る
  const fl = leg.weather.freezingLevel;
  if (fl <= leg.cruiseAltitude + 300 && feats.some((f) => (f.cloud || f.rain) && Math.max(f.prob.morning, f.prob.afternoon) > 0)) {
    out.push({
      who: MAIL_PILOT,
      weight: 7,
      text: tr(
        `凍結高度は ${fl} m くらいだ。その上で雲に入ったら、プロペラが真っ白になった、と話してたやつがいる。`,
        `The freezing level is around ${fl} m. Someone told me he went into cloud above it and his propeller turned white.`,
      ),
    });
  }
  // 着く先の朝霧
  if (spreadAt(leg.to, 9 * 60) <= 3) {
    out.push({ who: FUELER, weight: 7, text: tr(`${to}は、朝のうちは霧の中のことが多い。日が高くなってから着くようにしな。`, `${to} is often in fog in the morning. Try to arrive once the sun is high.`),
    });
  }
  // 高さで風が変わる：すすめの高度より楽な高さがある
  const floor = Math.max(leg.from.elevation, leg.to.elevation, ...leg.terrain.map((r) => r.height)) + 300;
  const here = headwindAt(leg.weather.winds, leg.cruiseAltitude);
  const better = leg.weather.winds
    .map((w) => w.altitude)
    .filter((alt) => alt >= floor && alt <= MAX_ALTITUDE && alt !== leg.cruiseAltitude)
    .map((alt) => ({ alt, hw: headwindAt(leg.weather.winds, alt) }))
    .sort((a, b) => a.hw - b.hw)[0];
  if (better && here - better.hw >= 12) {
    out.push({
      who: MAIL_PILOT,
      weight: 6,
      text: tr(
        `${better.alt} m あたりは${better.hw < 0 ? "追い風に乗れる" : "向かい風が弱い"}。郵便機の連中は、その高さで飛んでるよ。`,
        `Around ${better.alt} m ${better.hw < 0 ? "you can ride a tailwind" : "the headwind is weaker"}. The mail pilots fly at that height.`,
      ),
    });
  }
  // 着く先の短い滑走路
  if (leg.to.runwayLength <= 500) {
    out.push({
      who: FUELER,
      weight: 6,
      text: tr(
        `${to}の滑走路は ${leg.to.runwayLength} m しかない。先月、満タンで出ようとした機が、端まで走っても浮かなかった。`,
        `The runway at ${to} is only ${leg.to.runwayLength} m. Last month a plane tried to leave with full tanks and ran to the very end without lifting off.`,
      ),
    });
  }
  // 乱気流
  const turb = feats.find((f) => f.turbulence && Math.max(f.prob.morning, f.prob.afternoon) >= LIKELY);
  if (turb?.turbulence) {
    out.push({
      who: local,
      weight: 5,
      text: tr(
        `${kmRange(turb.turbulence.fromKm, turb.turbulence.toKm, leg.distanceKm)}は、よく揺れる。速さを落として抜けろ、と言われてる。`,
        `It's often bumpy ${kmRange(turb.turbulence.fromKm, turb.turbulence.toKm, leg.distanceKm)}. The saying is: slow down to get through.`,
      ),
    });
  }
  // 湿度の違う土地：ボルトがゆるむ
  const dh = leg.to.humidity - leg.from.humidity;
  if (Math.abs(dh) >= 25) {
    out.push({
      who: INNKEEPER,
      weight: 5,
      text: tr(
        `向こうは、ここより空気が${dh > 0 ? "湿って" : "乾いて"}るよ。木のプロペラは、着いたら一度見てやりな。`,
        `The air over there is ${dh > 0 ? "more humid" : "drier"} than here. Check your wooden propeller once you land.`,
      ),
    });
  }
  // 整備場のない飛行場
  if (!leg.to.hasRepairShop) {
    out.push({ who: FUELER, weight: 4, text: tr(`${to}には整備場がない。ボルトは自分で締めるしかないぞ。`, `There's no repair shop at ${to}. You'll have to tighten the bolts yourself.`),
    });
  }
  // 何も目立つことがない区間でも、ひとことは出す
  if (!out.length) {
    out.push({ who: INNKEEPER, weight: 1, text: tr(`${to}までは ${leg.distanceKm} km。暗くなる前に着けるように出な。`, `It's ${leg.distanceKm} km to ${to}. Leave in time to get there before dark.`),
    });
  }
  return out;
}

/** 区間の中の範囲を、出発地から見た言い方にする */
function kmRange(from: number, to: number, total: number): string {
  const a = Math.round(from);
  const b = Math.round(to);
  if (a <= 5) return tr(`飛び立ってから ${b} km あたりまで`, `from takeoff to about ${b} km`);
  if (b >= total - 5) return tr(`${a} km あたりから先、着くまで`, `from about ${a} km all the way in`);
  return tr(`${a}〜${b} km あたり`, `around ${a}–${b} km`);
}

/**
 * 次の区間についてのうわさを count 個まで。いちばん大事なものは必ず入れ、残りは seed で選ぶ
 * （同じ seed なら同じうわさ。画面を描き直しても変わらない）。
 */
export function rumorsFor(leg: Leg, seed: number, count = 2): Rumor[] {
  const all = candidates(leg).sort((a, b) => b.weight - a.weight);
  if (all.length <= count) return all.map(({ who, text }) => ({ who, text }));
  const [top, ...rest] = all;
  const pool = rest.slice(0, 4);
  const picked = [top];
  for (let i = 0; picked.length < count && i < pool.length; i++) picked.push(pool[((seed >>> 0) + i) % pool.length]);
  return picked.map(({ who, text }) => ({ who, text }));
}
