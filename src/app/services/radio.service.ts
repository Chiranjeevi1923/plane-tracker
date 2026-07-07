import { inject, Injectable, OnDestroy } from '@angular/core';
import { cityForAirport } from '../data/seed-data';
import { FlightSimulatorService } from './flight-simulator.service';

/**
 * Simulated ATC radio chatter for the 3D flight view.
 *
 * Realism comes from four layers (browser TTS itself can't be piped through
 * Web Audio filters — speechSynthesis outputs straight to the device — so the
 * radio "feel" is built around the voice instead):
 *  1. A continuous filtered-noise bed that opens (gets louder) while someone
 *     is transmitting and closes between calls, plus random crackle bursts
 *     DURING speech — a clean voice over live static reads as radio.
 *  2. Call-and-response: an ATC voice and a pilot voice with different
 *     pitches; the pilot reads clearances back like real frequency traffic.
 *  3. Authentic phraseology built from LIVE simulator data — real callsigns
 *     ("IndiGo two zero one"), flight levels from current altitude, "niner"
 *     for 9, spoken frequencies.
 *  4. Slight per-transmission pitch/rate jitter so calls never sound cloned.
 */

/** Aviation digit words ("niner" for 9, to cut through static). */
const DIGITS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];

/** Speak a string's digits individually: "201" → "two zero one". */
function spokenDigits(value: string | number): string {
  return String(value)
    .split('')
    .filter((c) => /\d/.test(c))
    .map((c) => DIGITS[Number(c)])
    .join(' ');
}

/** One line of an exchange and who says it. */
interface Turn {
  speaker: 'atc' | 'pilot';
  text: string;
}

/** Live context an exchange template is built from. */
interface ChatterContext {
  /** Spoken callsign, e.g. "IndiGo two zero one". */
  callsign: string;
  /** Spoken flight level, e.g. "three five zero". */
  flightLevel: string;
  /** Spoken 3-digit heading, e.g. "zero niner five". */
  heading: string;
  /** Controlling center name, e.g. "Bengaluru". */
  center: string;
  /** Spoken radio frequency, e.g. "one two four point three five". */
  frequency: string;
}

/** Exchange templates (ATC ↔ pilot). One is picked at random per transmission. */
const EXCHANGES: ((c: ChatterContext) => Turn[])[] = [
  (c) => [
    { speaker: 'atc', text: `${c.callsign}, ${c.center} control, climb and maintain flight level ${c.flightLevel}.` },
    { speaker: 'pilot', text: `Climb and maintain flight level ${c.flightLevel}, ${c.callsign}.` },
  ],
  (c) => [
    { speaker: 'atc', text: `${c.callsign}, turn left heading ${c.heading}, vectors for spacing.` },
    { speaker: 'pilot', text: `Left heading ${c.heading}, ${c.callsign}.` },
  ],
  (c) => [
    { speaker: 'atc', text: `${c.callsign}, contact ${c.center} control on ${c.frequency}.` },
    { speaker: 'pilot', text: `Over to ${c.frequency}, ${c.callsign}, good day.` },
  ],
  (c) => [
    { speaker: 'pilot', text: `${c.center} control, ${c.callsign}, level flight level ${c.flightLevel}.` },
    { speaker: 'atc', text: `${c.callsign}, roger, maintain flight level ${c.flightLevel}, expect higher in two zero miles.` },
  ],
  (c) => [
    { speaker: 'atc', text: `${c.callsign}, traffic, two o'clock, one zero miles, southbound, same level.` },
    { speaker: 'pilot', text: `Looking for traffic, ${c.callsign}.` },
  ],
  (c) => [
    { speaker: 'pilot', text: `${c.center} control, ${c.callsign}, request ride reports at flight level ${c.flightLevel}.` },
    { speaker: 'atc', text: `${c.callsign}, smooth rides reported, altimeter one zero one three.` },
    { speaker: 'pilot', text: `One zero one three, ${c.callsign}.` },
  ],
];

/** Gap between transmissions (ms). */
const NEXT_CALL_MIN_MS = 9000;
const NEXT_CALL_MAX_MS = 22000;
/** Pause between turns inside one exchange (ms). */
const TURN_GAP_MIN_MS = 500;
const TURN_GAP_MAX_MS = 1100;
/** Noise-bed gain: barely-there hiss idle, open carrier while transmitting. */
const BED_IDLE_GAIN = 0.004;
const BED_OPEN_GAIN = 0.022;

@Injectable({ providedIn: 'root' })
export class RadioService implements OnDestroy {
  private readonly simulator = inject(FlightSimulatorService);

  private audioCtx: AudioContext | null = null;
  private bedGain: GainNode | null = null;
  private timeoutId?: ReturnType<typeof setTimeout>;
  private crackleId?: ReturnType<typeof setTimeout>;
  private isEnabled = false;
  private voices: SpeechSynthesisVoice[] = [];
  /** Which flight the chatter is about (falls back to a random fleet flight). */
  private activeFlightId: string | null = null;

  /**
   * Start the chatter. Must be called from a user gesture (AudioContext policy).
   * Pass the flight the user is watching so the calls reference it.
   */
  enableRadio(flightId?: string): void {
    this.activeFlightId = flightId ?? null;
    if (this.isEnabled) {
      return;
    }
    this.isEnabled = true;

    this.audioCtx = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    this.startNoiseBed();
    this.loadVoices();

    this.scheduleNextTransmission(3000); // first call comes fairly quickly
  }

  /** Stop everything (leaving the 3D view). Safe to call repeatedly. */
  disableRadio(): void {
    this.isEnabled = false;
    clearTimeout(this.timeoutId);
    clearTimeout(this.crackleId);
    window.speechSynthesis?.cancel();
    this.audioCtx?.close().catch(() => undefined);
    this.audioCtx = null;
    this.bedGain = null;
  }

  ngOnDestroy(): void {
    this.disableRadio();
  }

  // ------------------------------------------------------------------ chatter

  private scheduleNextTransmission(delayMs?: number): void {
    if (!this.isEnabled) {
      return;
    }
    const delay =
      delayMs ??
      NEXT_CALL_MIN_MS + Math.random() * (NEXT_CALL_MAX_MS - NEXT_CALL_MIN_MS);
    this.timeoutId = setTimeout(() => void this.playExchange(), delay);
  }

  /** Play one full ATC↔pilot exchange, then schedule the next. */
  private async playExchange(): Promise<void> {
    if (!this.isEnabled || !this.audioCtx) {
      return;
    }
    if (this.audioCtx.state === 'suspended') {
      await this.audioCtx.resume().catch(() => undefined);
    }

    const context = this.buildContext();
    if (!context) {
      this.scheduleNextTransmission();
      return;
    }
    const turns = EXCHANGES[Math.floor(Math.random() * EXCHANGES.length)](context);

    for (const turn of turns) {
      if (!this.isEnabled) {
        return;
      }
      await this.playTurn(turn);
      await this.wait(
        TURN_GAP_MIN_MS + Math.random() * (TURN_GAP_MAX_MS - TURN_GAP_MIN_MS),
      );
    }
    this.scheduleNextTransmission();
  }

  /** One keyed transmission: squelch → voice over open static → squelch. */
  private async playTurn(turn: Turn): Promise<void> {
    this.playSquelch(0.09);
    this.setBedGain(BED_OPEN_GAIN); // open the carrier
    this.startCrackle();

    await this.speak(turn);

    this.stopCrackle();
    this.playRogerBeep(); // courtesy tone as the mic keys off
    this.setBedGain(BED_IDLE_GAIN);
    this.playSquelch(0.12);
  }

  /** Short high "Roger beep" (VHF courtesy tone) at the end of a transmission. */
  private playRogerBeep(): void {
    if (!this.audioCtx) {
      return;
    }
    const t = this.audioCtx.currentTime;
    const osc = this.audioCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 1400; // characteristic high squelch tone

    const gain = this.audioCtx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.07, t + 0.01); // quick attack
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11); // ~100 ms tone

    osc.connect(gain).connect(this.audioCtx.destination);
    osc.start(t);
    osc.stop(t + 0.13);
  }

  /**
   * Break the TTS rhythm so pilots sound human: occasional leading filler
   * ("Uh,") and a mid-phrase pause (comma → the engine pauses). ATC stays
   * clipped and precise, like a real controller.
   */
  private humanize(turn: Turn): string {
    if (turn.speaker !== 'pilot') {
      return turn.text;
    }
    let text = turn.text;
    if (Math.random() < 0.4) {
      const fillers = ['Uh, ', 'Ah, ', 'Okay, ', 'Roger, '];
      text = fillers[Math.floor(Math.random() * fillers.length)] + text;
    }
    // A hesitation partway through breaks the metronome cadence.
    if (Math.random() < 0.3) {
      text = text.replace(/, /, ', uh, ');
    }
    return text;
  }

  /** Speak one line with the speaker's voice + slight per-call jitter. */
  private speak(turn: Turn): Promise<void> {
    return new Promise((resolve) => {
      const utterance = new SpeechSynthesisUtterance(this.humanize(turn));
      const [atcVoice, pilotVoice] = this.pickVoices();
      const voice = turn.speaker === 'atc' ? atcVoice : pilotVoice;
      if (voice) {
        utterance.voice = voice;
      }
      // Distinct registers per role, with jitter so calls never sound cloned.
      const base = turn.speaker === 'atc' ? { pitch: 0.78, rate: 1.08 } : { pitch: 0.95, rate: 1.0 };
      utterance.pitch = base.pitch + (Math.random() - 0.5) * 0.08;
      utterance.rate = base.rate + (Math.random() - 0.5) * 0.08;
      utterance.volume = 0.95;
      utterance.onend = () => resolve();
      utterance.onerror = () => resolve(); // never stall the loop on a TTS error
      window.speechSynthesis.speak(utterance);
    });
  }

  /** Live phraseology context from the simulator (watched or random flight). */
  private buildContext(): ChatterContext | null {
    const fleet = this.simulator.sample(Date.now());
    if (fleet.length === 0) {
      return null;
    }
    const plane =
      fleet.find((p) => p.flightId === this.activeFlightId) ??
      fleet[Math.floor(Math.random() * fleet.length)];

    // "6E-201" → flight number digits; callsign = airline + digits.
    const flightNumber = plane.flightId.split('-').pop() ?? plane.flightId;
    const callsign = `${plane.airline} ${spokenDigits(flightNumber)}`;
    // Altitude (ft) → flight level (hundreds of feet), 3 digits spoken.
    const fl = Math.max(1, Math.round(plane.altitude / 100));
    const flightLevel = spokenDigits(String(fl).padStart(3, '0'));
    const heading = spokenDigits(String(Math.round(plane.heading)).padStart(3, '0'));
    // Plausible VHF frequency, e.g. "one two four point three five".
    const mhz = 118 + Math.floor(Math.random() * 18);
    const decimals = ['zero five', 'one five', 'three five', 'five five', 'seven five'][
      Math.floor(Math.random() * 5)
    ];
    const frequency = `${spokenDigits(mhz)} point ${decimals}`;

    return {
      callsign,
      flightLevel,
      heading,
      center: cityForAirport(plane.destination),
      frequency,
    };
  }

  // ------------------------------------------------------------ audio texture

  /** Continuous filtered-noise bed; gain is modulated open/closed per turn. */
  private startNoiseBed(): void {
    if (!this.audioCtx) {
      return;
    }
    const seconds = 2;
    const buffer = this.audioCtx.createBuffer(1, this.audioCtx.sampleRate * seconds, this.audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const source = this.audioCtx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;

    const bandpass = this.audioCtx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 1200; // VHF-ish hiss
    bandpass.Q.value = 0.7;

    this.bedGain = this.audioCtx.createGain();
    this.bedGain.gain.value = BED_IDLE_GAIN;

    source.connect(bandpass).connect(this.bedGain).connect(this.audioCtx.destination);
    source.start();
  }

  private setBedGain(target: number): void {
    if (this.audioCtx && this.bedGain) {
      // Short time constant ≈ the squelch opening/closing.
      this.bedGain.gain.setTargetAtTime(target, this.audioCtx.currentTime, 0.05);
    }
  }

  /** Random tiny crackle bursts while a voice is transmitting. */
  private startCrackle(): void {
    const burst = () => {
      if (!this.isEnabled) {
        return;
      }
      this.playSquelch(0.02 + Math.random() * 0.05, 0.03 + Math.random() * 0.04);
      this.crackleId = setTimeout(burst, 150 + Math.random() * 450);
    };
    this.crackleId = setTimeout(burst, 200);
  }

  private stopCrackle(): void {
    clearTimeout(this.crackleId);
  }

  /** Band-limited noise burst: squelch click / crackle. */
  private playSquelch(duration: number, gain = 0.15): void {
    if (!this.audioCtx) {
      return;
    }
    const bufferSize = Math.max(1, Math.floor(this.audioCtx.sampleRate * duration));
    const buffer = this.audioCtx.createBuffer(1, bufferSize, this.audioCtx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    const source = this.audioCtx.createBufferSource();
    source.buffer = buffer;

    const bandpass = this.audioCtx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 1200;
    bandpass.Q.value = 0.5;

    const gainNode = this.audioCtx.createGain();
    gainNode.gain.setValueAtTime(gain, this.audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.001, this.audioCtx.currentTime + duration);

    source.connect(bandpass).connect(gainNode).connect(this.audioCtx.destination);
    source.start();
  }

  // ------------------------------------------------------------------- helpers

  /**
   * Two stable, distinct MALE English voices (ATC, pilot) — refreshed lazily.
   * The Web Speech API has no reliable gender field, so male voices are matched
   * by name; falls back to any English voice if none are found.
   */
  private pickVoices(): [SpeechSynthesisVoice | null, SpeechSynthesisVoice | null] {
    if (this.voices.length === 0) {
      this.loadVoices();
    }
    const english = this.voices.filter((v) => v.lang.startsWith('en'));
    if (english.length === 0) {
      return [null, null];
    }
    const males = english.filter((v) => this.isMaleVoice(v));
    const pool = males.length > 0 ? males : english;
    // Prefer higher-quality voices when present (Natural/Google/Microsoft).
    const ranked = [...pool].sort((a, b) => this.voiceRank(b) - this.voiceRank(a));
    const atc = ranked[0] ?? null;
    const pilot = ranked.find((v) => v !== atc) ?? atc;
    return [atc, pilot];
  }

  /** Best-effort male detection by voice name (no gender field exists). */
  private isMaleVoice(v: SpeechSynthesisVoice): boolean {
    const name = v.name.toLowerCase();
    if (name.includes('female')) {
      return false;
    }
    if (name.includes('male')) {
      return true; // e.g. "Google UK English Male", "…(Male)"
    }
    // Known male voice names across Windows / Edge Natural / macOS / Chrome.
    return /\b(david|mark|guy|christopher|eric|roger|steffan|ryan|thomas|william|brian|george|alex|daniel|fred|tom|oliver|arthur|james|richard|aaron|gordon)\b/.test(
      name,
    );
  }

  private voiceRank(v: SpeechSynthesisVoice): number {
    const name = v.name.toLowerCase();
    if (name.includes('natural')) return 3;
    if (name.includes('google')) return 2;
    if (name.includes('microsoft')) return 1;
    return 0;
  }

  private loadVoices(): void {
    this.voices = window.speechSynthesis.getVoices();
    if (this.voices.length === 0) {
      // Chrome loads voices asynchronously — capture them when ready.
      window.speechSynthesis.addEventListener(
        'voiceschanged',
        () => (this.voices = window.speechSynthesis.getVoices()),
        { once: true },
      );
    }
  }

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
