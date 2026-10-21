/**
 * Authentic Web Audio API Synthesizer replicating the user's aggrBTCv5 audio scripts:
 * - PingPongDelay & HighPassFilter audio chain
 * - Exact frequencies from Aggr.trade BTC template (aggr_template.json):
 *   - Buy trades: 659.26 Hz (E5), 830.6 Hz (G#5), 987.76 Hz (B5), 1318.52 Hz (E6)
 *   - Sell trades: 493.88 Hz (B4), 369.99 Hz (F#4), 293.66 Hz (D4), 246.94 Hz (B3)
 *   - Liquidations: 329.63 Hz (E4) / 440 Hz (A4) sine double-pulse
 */

class AggrSoundEngine {
  private ctx: AudioContext | null = null;
  private enabled: boolean = false;
  private volume: number = 0.51; // Default from aggrBTCv5 settings.audioVolume

  public setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (enabled && !this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (enabled && this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setVolume(vol: number) {
    this.volume = Math.max(0, Math.min(1, vol));
  }

  public getVolume(): number {
    return this.volume;
  }

  private playTone(
    freq: number,
    gainVal: number,
    duration: number,
    delaySec: number = 0,
    type: OscillatorType = 'triangle'
  ) {
    if (!this.enabled || !this.ctx) return;
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    const now = this.ctx.currentTime + delaySec;
    const osc = this.ctx.createOscillator();
    const gainNode = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();

    // HighPassFilter as configured in aggrBTCv5 audioFilters
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(180, now);

    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);

    const clampedGain = Math.min(0.35, Math.max(0.01, gainVal * this.volume));
    gainNode.gain.setValueAtTime(0.0001, now);
    gainNode.gain.exponentialRampToValueAtTime(clampedGain, now + 0.015);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, now + Math.max(0.05, duration));

    osc.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(this.ctx.destination);

    osc.start(now);
    osc.stop(now + Math.max(0.06, duration + 0.02));
  }

  public playTradeTick(
    side: 'buy' | 'sell',
    tier: 'normal' | 'threshold' | 'significant' | 'huge' | 'rare',
    isLiquidation: boolean
  ) {
    if (!this.enabled || tier === 'normal') return;

    if (isLiquidation) {
      // Exact aggrBTCv5 liquidation audio script: 329.63Hz (buy) / 440Hz (sell) sine double pulse
      const freq = side === 'buy' ? 329.63 : 440.0;
      const mult = tier === 'rare' ? 0.35 : tier === 'huge' ? 0.25 : 0.16;
      this.playTone(freq, mult, 0.18, 0, 'sine');
      this.playTone(freq, mult * 1.15, 0.28, 0.08, 'sine');
      return;
    }

    if (side === 'buy') {
      if (tier === 'threshold') {
        this.playTone(659.26, 0.12, 0.14, 0);
      } else if (tier === 'significant') {
        this.playTone(659.26, 0.16, 0.22, 0);
        this.playTone(830.6, 0.16, 0.22, 0.08);
      } else {
        // huge & rare arpeggio: 659.26 -> 830.6 -> 987.76 -> 1318.52
        this.playTone(659.26, 0.18, 0.2, 0);
        this.playTone(830.6, 0.18, 0.2, 0.08);
        this.playTone(987.76, 0.18, 0.2, 0.16);
        this.playTone(1318.52, 0.24, 0.28, 0.24);
      }
    } else {
      if (tier === 'threshold') {
        this.playTone(493.88, 0.14, 0.14, 0);
      } else if (tier === 'significant') {
        this.playTone(493.88, 0.16, 0.22, 0);
        this.playTone(392.0, 0.16, 0.22, 0.08);
      } else {
        // huge & rare descending chord: 493.88 -> 369.99 -> 293.66 -> 246.94
        this.playTone(493.88, 0.18, 0.2, 0);
        this.playTone(369.99, 0.2, 0.2, 0.08);
        this.playTone(293.66, 0.2, 0.2, 0.16);
        this.playTone(246.94, 0.24, 0.28, 0.24);
      }
    }
  }

  public playSignalAlert(direction: 'LONG' | 'SHORT') {
    if (!this.enabled) return;
    if (direction === 'LONG') {
      this.playTone(523.25, 0.25, 0.18, 0, 'sine'); // C5
      this.playTone(659.25, 0.25, 0.18, 0.1, 'sine'); // E5
      this.playTone(783.99, 0.28, 0.22, 0.2, 'sine'); // G5
      this.playTone(1046.5, 0.32, 0.35, 0.3, 'sine'); // C6
    } else {
      this.playTone(880.0, 0.25, 0.18, 0, 'sine'); // A5
      this.playTone(698.46, 0.25, 0.18, 0.1, 'sine'); // F5
      this.playTone(587.33, 0.28, 0.22, 0.2, 'sine'); // D5
      this.playTone(440.0, 0.32, 0.35, 0.3, 'sine'); // A4
    }
  }
}

export const soundEngine = new AggrSoundEngine();
