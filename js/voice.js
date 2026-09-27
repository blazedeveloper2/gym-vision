// Spoken feedback via the Web Speech API.
export class Voice {
  constructor() {
    this.supported = typeof window !== 'undefined' && 'speechSynthesis' in window;
    this.enabled = true;
    this.lastSaid = new Map();
  }

  /** iOS only allows speech after a user gesture, so call this from a tap handler. */
  unlock() {
    if (!this.supported) return;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      speechSynthesis.speak(u);
    } catch {
      // ignore
    }
  }

  // Utterances queue rather than interrupt: Safari can drop speech queued right after cancel().
  say(text, { key = text, gapMs = 0 } = {}) {
    if (!this.enabled || !this.supported || !text) return;
    const now = performance.now();
    if (gapMs && now - (this.lastSaid.get(key) ?? -Infinity) < gapMs) return;
    this.lastSaid.set(key, now);
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.1;
      u.lang = 'en-US';
      speechSynthesis.speak(u);
    } catch {
      // ignore
    }
  }

  stop() {
    if (this.supported) speechSynthesis.cancel();
  }
}
