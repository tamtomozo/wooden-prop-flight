// 音（6章「振動：計器パネルを実際に揺らし、エンジン音を変える」）。
// 音のファイルは使わず、WebAudio でその場で作る。
// エンジン：回転数で高さが変わる。振動が出るとうなりが混じり、薄すぎるとバラつく。
// ほかに風切り音・雨音・積乱雲の遠雷。
import type { FlightState } from "../game/flight";

export class Sound {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private engA!: OscillatorNode;
  private engB!: OscillatorNode;
  private engFilter!: BiquadFilterNode;
  private engGain!: GainNode;
  private am!: GainNode;
  private lfo!: OscillatorNode;
  private lfoDepth!: GainNode;
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private rainGain!: GainNode;
  private noiseBuffer!: AudioBuffer;
  private enabled = true;
  private nextThunder = 0;

  setEnabled(on: boolean) {
    this.enabled = on;
    if (on) this.ensure();
    if (this.ctx) this.master.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.1);
  }

  isEnabled() {
    return this.enabled;
  }

  /** ブラウザは、ボタンを押すなどの操作のあとでないと音を出せない。最初の操作で作る */
  ensure() {
    if (!this.enabled) return;
    if (this.ctx) {
      if (this.ctx.state === "suspended") void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.master.connect(ctx.destination);

    // エンジン：のこぎり波と矩形波を少しずらして重ね、低域だけ通す
    this.engA = ctx.createOscillator();
    this.engA.type = "sawtooth";
    this.engB = ctx.createOscillator();
    this.engB.type = "square";
    this.engFilter = ctx.createBiquadFilter();
    this.engFilter.type = "lowpass";
    this.engFilter.frequency.value = 520;
    this.engFilter.Q.value = 0.7;
    const mixB = ctx.createGain();
    mixB.gain.value = 0.35;
    this.am = ctx.createGain();
    this.am.gain.value = 1;
    this.engGain = ctx.createGain();
    this.engGain.gain.value = 0;
    this.engA.connect(this.engFilter);
    this.engB.connect(mixB).connect(this.engFilter);
    this.engFilter.connect(this.am).connect(this.engGain).connect(this.master);

    // うなり（振動・薄すぎ）：音量をゆらす
    this.lfo = ctx.createOscillator();
    this.lfo.frequency.value = 8;
    this.lfoDepth = ctx.createGain();
    this.lfoDepth.gain.value = 0;
    this.lfo.connect(this.lfoDepth).connect(this.am.gain);

    // 風と雨：白いノイズを、それぞれ違うフィルターに通す
    this.noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = this.noiseBuffer;
    noise.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = "bandpass";
    this.windFilter.frequency.value = 700;
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = "highpass";
    rainFilter.frequency.value = 2500;
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    noise.connect(this.windFilter).connect(this.windGain).connect(this.master);
    noise.connect(rainFilter).connect(this.rainGain).connect(this.master);

    for (const o of [this.engA, this.engB, this.lfo]) o.start();
    noise.start();
    this.master.gain.setTargetAtTime(0.9, ctx.currentTime, 0.2);
  }

  /** 毎フレーム呼ぶ。飛んでいないときは静かにする */
  update(s: FlightState, running: boolean) {
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const now = ctx.currentTime;
    const flying = running && s.status === "flying";
    const p = s.perf;
    const a = s.condition;

    // エンジンの高さ：4気筒4サイクルは1回転に2回爆発する
    const fire = Math.max(10, (p.rpm / 60) * 2);
    this.engA.frequency.setTargetAtTime(fire, now, 0.08);
    // 振動が出ると、2つの音がずれてうなる
    this.engB.frequency.setTargetAtTime(fire * 1.002 + a.vibration * 0.06, now, 0.08);
    this.engFilter.frequency.setTargetAtTime(350 + s.controls.throttle * 450, now, 0.1);
    this.engGain.gain.setTargetAtTime(flying ? 0.05 + s.controls.throttle * 0.07 : 0, now, 0.15);

    // うなりとバラつき：振動・薄すぎ・キャブレター凍結
    const rough = p.mixture.zone === "tooLean" ? 0.6 : 0;
    const depth = Math.min(0.85, a.vibration / 120 + rough + a.carbIce / 300);
    this.lfoDepth.gain.setTargetAtTime(flying ? depth * 0.5 : 0, now, 0.1);
    this.am.gain.setTargetAtTime(1 - depth * 0.5, now, 0.1);
    this.lfo.frequency.setTargetAtTime(rough > 0 ? 5 + Math.random() * 9 : 4 + a.vibration / 12, now, 0.05);

    // 風切り音は速度で、雨音は雨の強さで
    this.windGain.gain.setTargetAtTime(flying ? Math.min(0.06, (p.airspeed / 150) * 0.035) : 0, now, 0.2);
    this.windFilter.frequency.setTargetAtTime(400 + p.airspeed * 4, now, 0.2);
    this.rainGain.gain.setTargetAtTime(flying ? s.env.rain * 0.03 : 0, now, 0.3);

    // 積乱雲が近いと、ときどき遠雷
    if (flying && s.env.cbDistance < 70 && now > this.nextThunder) {
      this.thunder(1 - s.env.cbDistance / 70);
      this.nextThunder = now + 4 + Math.random() * 8;
    }
  }

  /**
   * ボタンやタブを押したときの短い音。
   * ボタンは木を軽く叩いたような「コッ」、タブは少し高く軽い「チッ」。
   */
  click(kind: "button" | "tab") {
    this.ensure();
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t = ctx.currentTime + 0.005;
    const tab = kind === "tab";
    const len = tab ? 0.035 : 0.06;

    // 音の芯：高いところから一瞬で下がる正弦波
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(tab ? 2300 : 1250, t);
    o.frequency.exponentialRampToValueAtTime(tab ? 1500 : 520, t + len);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(tab ? 0.06 : 0.11, t + 0.003);
    g.gain.exponentialRampToValueAtTime(0.001, t + len);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + len + 0.02);

    // 当たった瞬間の「カ」：ノイズをごく短く
    const n = ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = tab ? 5000 : 2800;
    bp.Q.value = 1.2;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(tab ? 0.05 : 0.08, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.018);
    n.connect(bp).connect(ng).connect(this.master);
    n.start(t, Math.random());
    n.stop(t + 0.03);
  }

  /** 実績を手に入れたときの、短いチャイム（ド・ミ・ソ・ド） */
  chime() {
    this.ensure();
    const ctx = this.ctx;
    if (!ctx || !this.enabled) return;
    const t0 = ctx.currentTime + 0.05;
    [523.25, 659.25, 783.99, 1046.5].forEach((hz, i) => {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = hz;
      const g = ctx.createGain();
      const t = t0 + i * 0.11;
      const len = i === 3 ? 1.2 : 0.4;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, t + len);
      o.connect(g).connect(this.master);
      o.start(t);
      o.stop(t + len + 0.05);
    });
  }

  private thunder(strength: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 160;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.35 * strength, t + 0.3);
    g.gain.exponentialRampToValueAtTime(0.001, t + 3.5);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + 3.6);
  }
}
