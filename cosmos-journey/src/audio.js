import { createAmbienceBuffer, createEffectBuffer, AMBIENCE_DURATION } from './ambience.js';
export { createAmbienceBuffer, createEffectBuffer } from './ambience.js';
const MODES = new Set(['off', 'zh', 'en', 'both']);
const clamp = value => Math.max(0, Math.min(1, value));

export function narrationSentences(text, language) {
  const limit = language === 'zh' ? 65 : 150;
  const pieces = String(text).match(/[^。！？.!?]+[。！？.!?]*/g) || [String(text)];
  return pieces.flatMap(piece => {
    const chunks = [];
    let remaining = piece.trim();
    while (remaining.length > limit) {
      let split = language === 'en' ? remaining.lastIndexOf(' ', limit) : limit;
      if (split < limit / 2) split = limit;
      chunks.push(remaining.slice(0, split).trim());
      remaining = remaining.slice(split).trim();
    }
    if (remaining) chunks.push(remaining);
    return chunks;
  });
}

export class CosmicAudio {
  ctx = null;
  ambienceGain = null;
  effectsGain = null;
  ambience = false;
  effects = false;
  mode = 'off';
  speaking = false;
  paused = false;
  generation = 0;
  player = new Audio();
  fallbackSpeaking = false;
  utterance = null;
  queue = [];
  current = null;
  voiceWait = null;
  watchdog = null;
  resumeAction = null;
  ambienceBuffer = null;
  ambienceBuffers = new Map();
  epoch = 9;
  ambienceSource = null;
  ambienceOffset = 0;
  effectSources = new Set();
  effectGeneration = 0;
  status = { state: 'off', language: null };
  onStatusChange = () => {};
  failedLanguages = new Set();

  constructor(notify, epochs) {
    this.notify = notify;
    this.epochs = epochs;
    this.player.id = 'narration-audio';
    this.player.preload = 'none';
    this.player.hidden = true;
    document.body.appendChild(this.player);
  }

  get zh() { return this.mode === 'zh' || this.mode === 'both'; }
  get en() { return this.mode === 'en' || this.mode === 'both'; }
  get available() {
    return !!window.__COSMIC_AUDIO__ || ('speechSynthesis' in window && 'SpeechSynthesisUtterance' in window);
  }
  setStatus(state, language = null) {
    this.status = { state, language };
    this.player.dataset.state = state;
    this.player.dataset.language = language || '';
    this.onStatusChange(this.status);
  }

  async init() {
    try {
      if (!this.ctx || this.ctx.state === 'closed') {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) throw new Error('AudioContext unavailable');
        this.ctx = new AudioContext();
        this.ambienceGain = this.ctx.createGain();
        this.effectsGain = this.ctx.createGain();
        this.ambienceGain.gain.value = 0;
        this.effectsGain.gain.value = .7;
        this.ambienceGain.connect(this.ctx.destination);
        this.effectsGain.connect(this.ctx.destination);
      }
      if (this.ctx.state !== 'running') await this.ctx.resume();
      return this.ctx.state === 'running';
    } catch {
      this.notify('声音未能启动，请再次点击声音开关。 / Click the audio switch again to enable sound.');
      return false;
    }
  }

  setEpoch(epoch, progress = 0, { seek = false } = {}) {
    if (!Number.isInteger(epoch) || epoch < 0 || epoch > 10) return;
    if (epoch === this.epoch && !seek) return;
    this.stopAmbience(.35);
    this.epoch = epoch;
    this.ambienceOffset = Math.min(AMBIENCE_DURATION - .001, clamp(progress) * AMBIENCE_DURATION);
    if (this.ambience && !this.paused) this.init().then(ready => { if (ready) this.startAmbience(); });
  }
  async setAmbience(enabled) {
    this.ambience = enabled;
    if (!enabled) { this.stopAmbience(); return; }
    if (await this.init()) this.startAmbience();
  }
  startAmbience() {
    if (!this.ctx || !this.ambience || this.paused || this.ambienceSource) return;
    if (!this.ambienceBuffers.has(this.epoch)) {
      this.ambienceBuffers.set(this.epoch, createAmbienceBuffer(this.ctx, this.epoch));
      if (this.ambienceBuffers.size > 2) this.ambienceBuffers.delete(this.ambienceBuffers.keys().next().value);
    }
    this.ambienceBuffer = this.ambienceBuffers.get(this.epoch);
    const source = this.ctx.createBufferSource(), gain = this.ctx.createGain();
    source.buffer = this.ambienceBuffer;
    source.loop = true;
    source.connect(gain);
    gain.connect(this.ambienceGain);
    gain.gain.setValueAtTime(0, this.ctx.currentTime);
    gain.gain.linearRampToValueAtTime(1, this.ctx.currentTime + .35);
    source.onended = () => { source.disconnect(); gain.disconnect(); };
    this.ambienceSource = { source, gain, started: this.ctx.currentTime };
    this.updateVolume();
    source.start(0, this.ambienceOffset);
  }
  stopSource(record, fade = .04) {
    if (!record || !this.ctx) return;
    const now = this.ctx.currentTime;
    record.gain.gain.cancelScheduledValues(now);
    record.gain.gain.setValueAtTime(record.gain.gain.value, now);
    record.gain.gain.linearRampToValueAtTime(0, now + fade);
    try { record.source.stop(now + fade + .005); } catch {}
  }
  stopAmbience(fade = .04) {
    if (!this.ambienceSource) return;
    this.ambienceOffset = (this.ambienceOffset + this.ctx.currentTime - this.ambienceSource.started) % this.ambienceBuffer.duration;
    this.stopSource(this.ambienceSource, fade);
    this.ambienceSource = null;
  }
  updateVolume() {
    if (!this.ctx || !this.ambienceGain) return;
    const gain = this.ambienceGain.gain, now = this.ctx.currentTime;
    gain.cancelScheduledValues(now);
    gain.setTargetAtTime(this.ambience && !this.paused ? (this.speaking ? .22 : .72) : 0, now, .12);
  }
  setEffects(enabled) {
    this.effects = enabled;
    if (!enabled) this.stopEffects();
  }
  stopEffects() {
    this.effectGeneration++;
    for (const record of this.effectSources) this.stopSource(record);
    this.effectSources.clear();
  }
  async chime(epoch, { preview = false } = {}) {
    if (!this.effects || (this.paused && !preview)) return;
    this.stopEffects();
    const generation = this.effectGeneration;
    if (!await this.init() || !this.effects || generation !== this.effectGeneration || (this.paused && !preview)) return;
    const source = this.ctx.createBufferSource(), gain = this.ctx.createGain();
    source.buffer = createEffectBuffer(this.ctx, epoch);
    source.connect(gain); gain.connect(this.effectsGain);
    const record = { source, gain };
    this.effectSources.add(record);
    source.onended = () => { this.effectSources.delete(record); source.disconnect(); gain.disconnect(); };
    source.start();
  }

  setNarrationMode(mode) {
    if (!MODES.has(mode)) throw new Error('Unknown narration mode');
    this.mode = mode;
    this.cancel();
    this.setStatus(mode === 'off' ? 'off' : this.paused ? 'paused' : 'ready');
  }
  clearWatchdog() { clearTimeout(this.watchdog); this.watchdog = null; }
  cancel() {
    this.generation++;
    this.clearWatchdog();
    this.voiceWait?.(); this.voiceWait = null;
    this.player.onended = this.player.onerror = this.player.onplaying = null;
    this.player.pause();
    if (this.utterance) this.utterance.onend = this.utterance.onerror = this.utterance.onstart = null;
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      // cancel() clears the queue, but is not a transport resume operation.
      window.speechSynthesis.resume();
    }
    this.queue = []; this.current = null; this.resumeAction = null;
    this.utterance = null; this.fallbackSpeaking = false; this.speaking = false;
    this.updateVolume();
    this.setStatus(this.mode === 'off' ? 'off' : 'ready');
  }
  narrate(epoch) {
    this.cancel();
    if (this.mode === 'off' || this.paused) return;
    const number = String(this.epochs.indexOf(epoch) + 1).padStart(2, '0');
    for (const language of ['zh', 'en'].filter(language => this[language])) {
      const text = language === 'zh' ? epoch.zhVoice : epoch.enVoice;
      const recording = window.__COSMIC_AUDIO__?.[`${number}-${language}`];
      if (recording) this.queue.push({ language, text, recording });
      else this.queue.push(...narrationSentences(text, language).map(text => ({ language, text })));
    }
    this.speaking = this.queue.length > 0;
    this.updateVolume();
    this.advance(this.generation);
  }
  advance(generation) {
    if (generation !== this.generation) return;
    if (this.paused) { this.resumeAction = () => this.advance(generation); return; }
    this.current = this.queue.shift() || null;
    if (!this.current) {
      this.speaking = false; this.fallbackSpeaking = false;
      this.updateVolume();
      if (this.status.state !== 'unavailable') this.setStatus('complete');
      return;
    }
    const item = this.current;
    this.setStatus('loading', item.language);
    item.valid = () => generation === this.generation && this.current === item;
    item.finish = () => {
      if (!item.valid()) return;
      this.clearWatchdog();
      this.player.onended = this.player.onerror = this.player.onplaying = null;
      if (this.utterance) this.utterance.onend = this.utterance.onerror = this.utterance.onstart = null;
      this.utterance = null;
      this.current = null;
      this.advance(generation);
    };
    item.fail = () => {
      if (!item.valid()) return;
      this.clearWatchdog();
      if (this.utterance) this.utterance.onend = this.utterance.onerror = this.utterance.onstart = null;
      window.speechSynthesis?.cancel(); window.speechSynthesis?.resume();
      this.player.pause();
      this.queue = this.queue.filter(queued => queued.language !== item.language);
      this.setStatus('unavailable', item.language);
      if (!this.failedLanguages.has(item.language)) {
        this.failedLanguages.add(item.language);
        this.notify(item.language === 'zh' ? '此设备暂不能播放中文语音；可切换 English，字幕与动画继续播放。' : 'English voice is unavailable on this device. Subtitles and animation continue.');
      }
      item.finish();
    };
    item.armWatchdog = () => {
      this.clearWatchdog();
      this.watchdog = setTimeout(item.fail, item.started ? Math.max(15000, item.text.length * 350) : 6000);
    };
    if (item.recording) this.playRecording(item);
    else this.prepareSpeech(item);
  }
  playRecording(item) {
    let fallback = false;
    const speakInstead = () => {
      if (!item.valid() || fallback) return;
      fallback = true;
      item.started = false;
      this.clearWatchdog();
      this.player.onended = this.player.onerror = this.player.onplaying = null;
      this.player.pause();
      const chunks = narrationSentences(item.text, item.language);
      item.text = chunks.shift();
      this.queue.unshift(...chunks.map(text => ({ language: item.language, text })));
      this.prepareSpeech(item);
    };
    item.playRecording = () => {
      this.player.play().catch(speakInstead);
      item.armWatchdog();
    };
    this.player.src = item.recording;
    this.player.onended = item.finish;
    this.player.onerror = speakInstead;
    this.player.onplaying = () => {
      if (!item.valid()) return;
      item.started = true; this.setStatus('speaking', item.language); item.armWatchdog();
    };
    item.playRecording();
  }
  prepareSpeech(item) {
    this.fallbackSpeaking = true;
    const synth = window.speechSynthesis;
    if (!synth || !window.SpeechSynthesisUtterance) { item.fail(); return; }
    const ready = () => {
      this.voiceWait?.(); this.voiceWait = null;
      if (!item.valid()) return;
      const speak = () => this.startSpeech(item, synth.getVoices());
      if (this.paused) this.resumeAction = speak;
      else speak();
    };
    if (synth.getVoices().length) { ready(); return; }
    const changed = () => { if (synth.getVoices().length) ready(); };
    const timer = setTimeout(ready, 1200);
    synth.addEventListener('voiceschanged', changed);
    this.voiceWait = () => { clearTimeout(timer); synth.removeEventListener('voiceschanged', changed); };
  }
  startSpeech(item, voices) {
    if (!item.valid() || this.paused) return;
    const normalize = language => language.toLowerCase().replaceAll('_', '-');
    const preferred = item.language === 'zh' ? 'zh-cn' : 'en-us';
    const matching = voices.filter(voice => normalize(voice.lang).split('-')[0] === item.language);
    const score = voice => (normalize(voice.lang) === preferred ? 30 : 0) + (voice.localService ? 5 : 0) + (voice.default ? 2 : 0);
    matching.sort((a, b) => score(b) - score(a));
    if (voices.length && !matching.length) { item.fail(); return; }
    const utterance = new SpeechSynthesisUtterance(item.text);
    this.utterance = utterance;
    utterance.lang = item.language === 'zh' ? 'zh-CN' : 'en-US';
    if (matching[0]) utterance.voice = matching[0];
    utterance.rate = 1; utterance.pitch = 1; utterance.volume = 1;
    utterance.onstart = () => {
      if (!item.valid()) return;
      item.started = true; this.failedLanguages.delete(item.language);
      this.setStatus('speaking', item.language); item.armWatchdog();
    };
    utterance.onend = item.finish;
    utterance.onerror = item.fail;
    window.speechSynthesis.resume();
    window.speechSynthesis.speak(utterance);
    item.armWatchdog();
  }

  pause() {
    this.paused = true;
    this.clearWatchdog();
    this.stopAmbience(); this.stopEffects();
    this.player.pause();
    if (this.fallbackSpeaking) window.speechSynthesis?.pause();
    if (this.mode !== 'off') this.setStatus('paused', this.current?.language);
    this.updateVolume();
  }
  resume() {
    this.paused = false;
    if (this.ambience) this.init().then(ready => { if (ready) this.startAmbience(); });
    window.speechSynthesis?.resume();
    if (this.resumeAction) {
      const action = this.resumeAction; this.resumeAction = null; action();
    } else if (this.current) {
      if (!this.fallbackSpeaking) this.current.playRecording?.();
      this.current.armWatchdog();
      this.setStatus(this.current.started ? 'speaking' : 'loading', this.current.language);
    } else if (this.mode !== 'off') this.setStatus('ready');
    this.updateVolume();
  }
  enterIntro() {
    this.cancel(); this.stopEffects(); this.stopAmbience();
    this.paused = false;
    this.setStatus(this.mode === 'off' ? 'off' : 'ready');
    if (this.ambience) this.setAmbience(true);
  }
}
