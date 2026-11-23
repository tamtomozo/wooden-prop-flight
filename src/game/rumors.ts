// 経由地のうわさ話（第三者の証言）。次の区間のデータ（山・海・天気のひな形・着く先の飛行場）から作るので、
// 予報や地図とくい違うことはない。人物は架空の土地の人で、実在の人物のセリフにはしない。
import { MAX_ALTITUDE } from "../config";
import { longestSeaKm, seaAt, seaKm } from "../data/world";
import type { Leg } from "../model/types";
import { headwindAt, spreadAt } from "../model/weather";

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
  const local = leg.sea.length ? "漁師" : "村の人";

  // 高い山：重いと上がりきれない
  if (ridge && ridge.height >= 1500) {
    out.push({
      who: "村の人",
      weight: 9,
      text: `先週ここを出た機は、${ridge.name}（${ridge.height} m）を越えられずに引き返してきた。${
        ridge.fromKm < 40 ? "飛び立ったらすぐ上りだ。" : ""
      }重いと山に間に合わないってさ。`,
    });
  }
  // 長い海：止まったら終わり
  if (longest >= 250) {
    out.push({
      who: "漁師",
      weight: 9,
      text: `沖で止まった機は、まだ見つかっていない。海の上は ${Math.round(seaTotal)} km。戻るなら、早いうちに決めな。`,
    });
  } else if (seaTotal > 0) {
    out.push({ who: "漁師", weight: 5, text: `海の上は ${Math.round(seaTotal)} km。向こう岸が見えるのは、晴れた朝だけだ。` });
  }
  // 午後の積乱雲
  const cb = feats.find((f) => f.cb && f.prob.afternoon >= LIKELY && f.prob.afternoon > f.prob.morning);
  if (cb?.cb) {
    const where = seaAt(leg, cb.cb.alongKm) ? "沖" : `${Math.round(cb.cb.alongKm)} km あたり`;
    out.push({ who: local, weight: 8, text: `午後になると、${where}に入道雲が立つ。昼までに抜けるのが、このあたりの決まりだ。` });
  }
  // 峰にかかる雲
  const capCloud = ridge && feats.find((f) => f.cloud && f.cloud.base <= ridge.height && Math.max(f.prob.morning, f.prob.afternoon) >= LIKELY);
  if (capCloud) {
    out.push({
      who: "村の人",
      weight: 7,
      text: "峰はたいてい雲をかぶってる。雲の中で向きがわからなくなって、きりもみで落ちた機があったそうだ。",
    });
  }
  // 着氷：すすめの高度のすぐ上が凍結高度で、雲や雨が出る
  const fl = leg.weather.freezingLevel;
  if (fl <= leg.cruiseAltitude + 300 && feats.some((f) => (f.cloud || f.rain) && Math.max(f.prob.morning, f.prob.afternoon) > 0)) {
    out.push({
      who: "郵便機の操縦士",
      weight: 7,
      text: `凍結高度は ${fl} m くらいだ。その上で雲に入ったら、プロペラが真っ白になった、と話してたやつがいる。`,
    });
  }
  // 着く先の朝霧
  if (spreadAt(leg.to, 9 * 60) <= 3) {
    out.push({ who: "給油係", weight: 7, text: `${to}は、朝のうちは霧の中のことが多い。日が高くなってから着くようにしな。` });
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
      who: "郵便機の操縦士",
      weight: 6,
      text: `${better.alt} m あたりは${better.hw < 0 ? "追い風に乗れる" : "向かい風が弱い"}。郵便機の連中は、その高さで飛んでるよ。`,
    });
  }
  // 着く先の短い滑走路
  if (leg.to.runwayLength <= 500) {
    out.push({
      who: "給油係",
      weight: 6,
      text: `${to}の滑走路は ${leg.to.runwayLength} m しかない。先月、満タンで出ようとした機が、端まで走っても浮かなかった。`,
    });
  }
  // 乱気流
  const turb = feats.find((f) => f.turbulence && Math.max(f.prob.morning, f.prob.afternoon) >= LIKELY);
  if (turb?.turbulence) {
    out.push({
      who: local,
      weight: 5,
      text: `${kmRange(turb.turbulence.fromKm, turb.turbulence.toKm, leg.distanceKm)}は、よく揺れる。速さを落として抜けろ、と言われてる。`,
    });
  }
  // 湿度の違う土地：ボルトがゆるむ
  const dh = leg.to.humidity - leg.from.humidity;
  if (Math.abs(dh) >= 25) {
    out.push({
      who: "宿のおかみ",
      weight: 5,
      text: `向こうは、ここより空気が${dh > 0 ? "湿って" : "乾いて"}るよ。木のプロペラは、着いたら一度見てやりな。`,
    });
  }
  // 整備場のない飛行場
  if (!leg.to.hasRepairShop) {
    out.push({ who: "給油係", weight: 4, text: `${to}には整備場がない。ボルトは自分で締めるしかないぞ。` });
  }
  // 何も目立つことがない区間でも、ひとことは出す
  if (!out.length) {
    out.push({ who: "宿のおかみ", weight: 1, text: `${to}までは ${leg.distanceKm} km。暗くなる前に着けるように出な。` });
  }
  return out;
}

/** 区間の中の範囲を、出発地から見た言い方にする */
function kmRange(from: number, to: number, total: number): string {
  const a = Math.round(from);
  const b = Math.round(to);
  if (a <= 5) return `飛び立ってから ${b} km あたりまで`;
  if (b >= total - 5) return `${a} km あたりから先、着くまで`;
  return `${a}〜${b} km あたり`;
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
