// Vendored from https://github.com/Jeffrey0117/audio-dsp-kit @ 7c1179c (MIT).
// Zero-dependency Web Audio DSP: 5-band EQ, stereo width, reverb, gain.
// Inlined because a plugin is a single entry file with no module loader.
const createAudioDSP = (function () {
    const module = { exports: {} };
    // ============================================================================
    // audio-dsp-kit — Web Audio 等化器 + 音效 + 音量增益（零依賴，注入 AudioContext）
    // ----------------------------------------------------------------------------
    // 框架無關（沒有 Vue/Vuex/logger/任何 store 依賴）。把三件事併成一個檔：
    //   1) 5-band biquad EQ（含 22 組預設）
    //   2) 音效：立體聲寬度 / 單聲道 / 混響
    //   3) 音量增益（讓你的聲音比別人大聲）
    //
    // 由呼叫端「注入」AudioContext 與來源節點——本 kit 不自建 AudioContext、
    // 不碰任何 store。傳 HTMLMediaElement 會自動 createMediaElementSource；
    // 也可直接傳一個 AudioNode 當來源。狀態全放在回傳的 controller 物件裡。
    //
    // 音頻鏈：source → EQ(5) → eqOutput → effects(stereo/mono/reverb) → gain → (你接 destination)
    //
    // 用法：
    //   const ctx = new AudioContext();
    //   const dsp = createAudioDSP({ audioContext: ctx, source: videoEl });
    //   dsp.setPreset('bass_boost');
    //   dsp.setGain(1.8);
    //   dsp.connect(ctx.destination);
    // ============================================================================
    'use strict';
    
    // EQ 頻段設定（頻率固定，對應 gains 陣列的 5 個索引）
    const EQ_BANDS = [
      { frequency: 60, type: 'lowshelf', label: 'Bass' },
      { frequency: 250, type: 'peaking', label: 'Low-Mid' },
      { frequency: 1000, type: 'peaking', label: 'Mid' },
      { frequency: 4000, type: 'peaking', label: 'High-Mid' },
      { frequency: 16000, type: 'highshelf', label: 'Treble' }
    ];
    
    // 預設列表（gains: [60Hz, 250Hz, 1kHz, 4kHz, 16kHz]，單位 dB）
    const EQ_PRESETS = {
      flat: { id: 'flat', name: 'Flat', gains: [0, 0, 0, 0, 0] },
      acoustic: { id: 'acoustic', name: 'Acoustic', gains: [10, 8, 6, 3, 5] },
      bass_boost: { id: 'bass_boost', name: 'Bass Boost', gains: [15, 12, 0, 0, 0] },
      bass_reducer: { id: 'bass_reducer', name: 'Bass Reducer', gains: [-15, -12, 0, 0, 0] },
      classical: { id: 'classical', name: 'Classical', gains: [10, 6, -4, 5, 8] },
      dance: { id: 'dance', name: 'Dance', gains: [12, 8, 4, 0, -4] },
      deep: { id: 'deep', name: 'Deep', gains: [12, 8, 3, -3, -6] },
      electronic: { id: 'electronic', name: 'Electronic', gains: [12, 6, 0, 6, 12] },
      hip_hop: { id: 'hip_hop', name: 'Hip-Hop', gains: [14, 10, 0, 4, -2] },
      jazz: { id: 'jazz', name: 'Jazz', gains: [8, 4, -4, 5, 10] },
      latin: { id: 'latin', name: 'Latin', gains: [8, 5, 0, 0, 8] },
      loudness: { id: 'loudness', name: 'Loudness', gains: [12, 8, 0, 0, 12] },
      lounge: { id: 'lounge', name: 'Lounge', gains: [-6, 4, 6, 2, -4] },
      piano: { id: 'piano', name: 'Piano', gains: [6, -2, 5, 8, 6] },
      pop: { id: 'pop', name: 'Pop', gains: [-2, 6, 10, 6, -2] },
      rnb: { id: 'rnb', name: 'R&B', gains: [12, 10, -2, 5, 6] },
      rock: { id: 'rock', name: 'Rock', gains: [10, 6, -2, 6, 10] },
      small_speakers: { id: 'small_speakers', name: 'Small Speakers', gains: [12, 8, 4, 0, -4] },
      spoken_word: { id: 'spoken_word', name: 'Spoken Word', gains: [-6, 0, 10, 8, 0] },
      treble_boost: { id: 'treble_boost', name: 'Treble Boost', gains: [0, 0, 0, 12, 15] },
      treble_reducer: { id: 'treble_reducer', name: 'Treble Reducer', gains: [0, 0, 0, -12, -15] },
      vocal: { id: 'vocal', name: 'Vocal', gains: [-4, 0, 12, 10, 2] }
    };
    
    function clamp(v, min, max) {
      return Math.max(min, Math.min(max, v));
    }
    
    // 建立 5 個 biquad EQ 濾波器
    function createEQFilters(ctx) {
      return EQ_BANDS.map(band => {
        const filter = ctx.createBiquadFilter();
        filter.type = band.type;
        filter.frequency.value = band.frequency;
        filter.gain.value = 0;
        if (band.type === 'peaking') filter.Q.value = 1;
        return filter;
      });
    }
    
    // 串接 EQ 鏈：input → filter[0] → … → output
    function connectEQChain(filters, inputNode, outputNode) {
      if (filters.length === 0) {
        inputNode.connect(outputNode);
        return;
      }
      inputNode.connect(filters[0]);
      for (let i = 0; i < filters.length - 1; i++) {
        filters[i].connect(filters[i + 1]);
      }
      filters[filters.length - 1].connect(outputNode);
    }
    
    // 建立音效節點（立體聲寬度 / 單聲道 / 混響），並連好內部鏈
    function createAudioEffects(ctx, inputNode, outputNode) {
      const splitter = ctx.createChannelSplitter(2);
      const merger = ctx.createChannelMerger(2);
      const leftGain = ctx.createGain();
      const rightGain = ctx.createGain();
    
      const monoMerger = ctx.createChannelMerger(1);
      const monoGain = ctx.createGain();
      monoGain.gain.value = 0; // 預設關閉單聲道
    
      const reverbGain = ctx.createGain();
      reverbGain.gain.value = 0; // 預設關閉混響
    
      const reverbDelay1 = ctx.createDelay(1);
      const reverbDelay2 = ctx.createDelay(1);
      const reverbDelay3 = ctx.createDelay(1);
      reverbDelay1.delayTime.value = 0.03;
      reverbDelay2.delayTime.value = 0.06;
      reverbDelay3.delayTime.value = 0.09;
    
      const reverbFeedback = ctx.createGain();
      reverbFeedback.gain.value = 0.3;
    
      const reverbFilter = ctx.createBiquadFilter();
      reverbFilter.type = 'lowpass';
      reverbFilter.frequency.value = 4000;
    
      const dryGain = ctx.createGain();
      dryGain.gain.value = 1;
    
      // 連接：inputNode → splitter → L/R → merger → dryGain → outputNode
      //                                          → reverbChain → outputNode
      inputNode.connect(splitter);
    
      splitter.connect(leftGain, 0);
      leftGain.connect(merger, 0, 0);
      splitter.connect(rightGain, 1);
      rightGain.connect(merger, 0, 1);
    
      // 單聲道路徑（L+R 混合）
      splitter.connect(monoMerger, 0, 0);
      splitter.connect(monoMerger, 1, 0);
      monoMerger.connect(monoGain);
    
      merger.connect(dryGain);
      monoGain.connect(dryGain);
      dryGain.connect(outputNode);
    
      // 混響鏈
      merger.connect(reverbDelay1);
      reverbDelay1.connect(reverbDelay2);
      reverbDelay2.connect(reverbDelay3);
      reverbDelay3.connect(reverbFeedback);
      reverbFeedback.connect(reverbDelay1); // 回授
      reverbDelay1.connect(reverbFilter);
      reverbDelay2.connect(reverbFilter);
      reverbDelay3.connect(reverbFilter);
      reverbFilter.connect(reverbGain);
      reverbGain.connect(outputNode);
    
      return {
        splitter, merger, leftGain, rightGain,
        monoMerger, monoGain,
        reverbGain, reverbDelay1, reverbDelay2, reverbDelay3, reverbFeedback, reverbFilter,
        dryGain,
        isMono: false,
        reverbAmount: 0,
        stereoWidthValue: 1
      };
    }
    
    /**
     * 建立一個 Audio DSP controller。
     * @param {object} opts
     * @param {AudioContext} opts.audioContext - 由呼叫端注入（本 kit 不自建）
     * @param {HTMLMediaElement|AudioNode} opts.source - 媒體元素（自動建 source）或現成的 AudioNode
     * @param {number} [opts.gain=1] - 初始增益倍數（1.0 = 100%）
     * @param {number[]} [opts.eqGains] - 初始 EQ 增益（5 個值）
     * @param {boolean} [opts.eqEnabled=true]
     * @returns {object} controller
     */
    function createAudioDSP(opts = {}) {
      const ctx = opts.audioContext;
      if (!ctx || typeof ctx.createBiquadFilter !== 'function') {
        throw new Error('audio-dsp-kit: opts.audioContext is required（請注入你的 AudioContext）');
      }
      if (!opts.source) {
        throw new Error('audio-dsp-kit: opts.source is required（HTMLMediaElement 或 AudioNode）');
      }
    
      // 解析來源：HTMLMediaElement → createMediaElementSource；否則當成 AudioNode
      let source;
      let ownsSource = false;
      const isMediaEl =
        typeof HTMLMediaElement !== 'undefined' && opts.source instanceof HTMLMediaElement;
      if (isMediaEl) {
        source = ctx.createMediaElementSource(opts.source);
        ownsSource = true;
      } else if (typeof opts.source.connect === 'function') {
        source = opts.source;
      } else {
        throw new Error('audio-dsp-kit: opts.source 必須是 HTMLMediaElement 或 AudioNode');
      }
    
      // 建鏈：source → EQ → eqOutput → effects → gainNode
      const eqFilters = createEQFilters(ctx);
      const eqOutput = ctx.createGain();
      eqOutput.gain.value = 1;
      const gainNode = ctx.createGain();
      gainNode.gain.value = typeof opts.gain === 'number' ? opts.gain : 1;
    
      connectEQChain(eqFilters, source, eqOutput);
      const effects = createAudioEffects(ctx, eqOutput, gainNode);
    
      // controller 內部狀態
      const state = {
        ctx, source, ownsSource, eqFilters, eqOutput, gainNode, effects,
        eqEnabled: opts.eqEnabled !== false,
        savedGains: null,
        destination: null
      };
    
      // 套用初始 EQ
      if (Array.isArray(opts.eqGains)) {
        eqFilters.forEach((f, i) => {
          if (opts.eqGains[i] !== undefined) f.gain.value = clamp(opts.eqGains[i], -12, 12);
        });
      }
    
      // ---- EQ ----
      function setBand(index, gain) {
        const f = eqFilters[index];
        if (!f) return false;
        f.gain.value = clamp(gain, -24, 24);
        return true;
      }
      function setEqualizer(gains) {
        if (!Array.isArray(gains)) return false;
        gains.forEach((g, i) => {
          if (eqFilters[i]) eqFilters[i].gain.value = clamp(g, -12, 12);
        });
        return true;
      }
      function setPreset(presetId) {
        const preset = EQ_PRESETS[presetId];
        if (!preset) return null;
        setEqualizer(preset.gains);
        return preset.gains.slice();
      }
      function setEqualizerEnabled(enabled) {
        if (enabled) {
          if (state.savedGains) {
            eqFilters.forEach((f, i) => { f.gain.value = state.savedGains[i]; });
          }
        } else {
          state.savedGains = eqFilters.map(f => f.gain.value);
          eqFilters.forEach(f => { f.gain.value = 0; });
        }
        state.eqEnabled = enabled;
        return true;
      }
      function resetEqualizer() {
        return setEqualizer([0, 0, 0, 0, 0]);
      }
      function getEqualizerState() {
        return {
          enabled: state.eqEnabled !== false,
          bands: eqFilters.map(f => f.gain.value)
        };
      }
    
      // ---- 立體聲寬度 / 單聲道 ----
      function applyStereoWidth(width) {
        const g = Math.min(2, 1 + (width - 1) * 0.5);
        effects.leftGain.gain.value = g;
        effects.rightGain.gain.value = g;
      }
      function setStereoWidth(width) {
        if (effects.isMono) return false;
        effects.stereoWidthValue = width;
        applyStereoWidth(width);
        return true;
      }
      function setMono(enabled) {
        effects.isMono = enabled;
        if (enabled) {
          effects.leftGain.gain.value = 0;
          effects.rightGain.gain.value = 0;
          effects.monoGain.gain.value = 0.5; // 避免音量加倍
        } else {
          effects.monoGain.gain.value = 0;
          applyStereoWidth(effects.stereoWidthValue);
        }
        return true;
      }
    
      // ---- 混響 ----
      function setReverb(amount) {
        effects.reverbAmount = amount;
        effects.reverbGain.gain.value = amount * 0.5;       // 最大 50% 混響
        effects.dryGain.gain.value = 1 - amount * 0.3;      // 混響增加時稍減乾聲
        return true;
      }
      function setReverbParams(params = {}) {
        const roomSize = params.roomSize !== undefined ? params.roomSize : 0.5;
        const decay = params.decay !== undefined ? params.decay : 0.3;
        effects.reverbDelay1.delayTime.value = 0.02 + roomSize * 0.04;
        effects.reverbDelay2.delayTime.value = 0.04 + roomSize * 0.08;
        effects.reverbDelay3.delayTime.value = 0.06 + roomSize * 0.12;
        effects.reverbFeedback.gain.value = decay * 0.5;
        return true;
      }
      function getEffectsState() {
        return {
          isMono: effects.isMono,
          stereoWidth: effects.stereoWidthValue,
          reverbAmount: effects.reverbAmount
        };
      }
    
      // ---- 音量增益 ----
      function setGain(value) {
        gainNode.gain.value = value;
        return true;
      }
      function getGain() {
        return gainNode.gain.value;
      }
    
      // ---- 輸出接線 ----
      function connect(destination) {
        const target = destination || ctx.destination;
        gainNode.connect(target);
        state.destination = target;
        return controller;
      }
      function disconnect() {
        try { gainNode.disconnect(); } catch (e) { /* ignore */ }
        state.destination = null;
        return controller;
      }
    
      // ---- 清理 ----
      function destroy() {
        try {
          if (state.ownsSource) source.disconnect();
          eqFilters.forEach(f => { try { f.disconnect(); } catch (e) { /* ignore */ } });
          eqOutput.disconnect();
          [
            effects.splitter, effects.merger, effects.leftGain, effects.rightGain,
            effects.monoMerger, effects.monoGain, effects.reverbGain,
            effects.reverbDelay1, effects.reverbDelay2, effects.reverbDelay3,
            effects.reverbFeedback, effects.reverbFilter, effects.dryGain
          ].forEach(n => { try { n.disconnect(); } catch (e) { /* ignore */ } });
          gainNode.disconnect();
        } catch (e) { /* ignore */ }
      }
    
      const controller = {
        // 節點存取（進階用途）
        audioContext: ctx,
        source,
        gainNode,
        eqFilters,
        effects,
        // 常數
        bands: EQ_BANDS,
        presets: EQ_PRESETS,
        // EQ
        setBand,
        setEqualizer,
        setPreset,
        setEqualizerEnabled,
        resetEqualizer,
        getEqualizerState,
        // 音效
        setStereoWidth,
        setMono,
        setReverb,
        setReverbParams,
        getEffectsState,
        // 增益
        setGain,
        getGain,
        // 接線 / 清理
        connect,
        disconnect,
        destroy
      };
    
      return controller;
    }
    
    module.exports = createAudioDSP;
    module.exports.createAudioDSP = createAudioDSP;
    module.exports.EQ_BANDS = EQ_BANDS;
    module.exports.EQ_PRESETS = EQ_PRESETS;
    return module.exports;
})();

// --- ReVid plugin -----------------------------------------------------------
// Splices audio-dsp-kit into the player's audio slot and renders a small
// control panel: 22 EQ presets, 5 draggable bands, stereo width and reverb.

const BAND_LABELS = ['60', '250', '1k', '4k', '16k'];

let dsp = null;
let detachSlot = null;
let currentSlot = null;
let state = { preset: 'flat', bands: [0, 0, 0, 0, 0], width: 1, reverb: 0, enabled: true };
let rerender = null;

function teardown() {
    if (dsp) {
        try { dsp.destroy(); } catch (e) { /* already gone */ }
        dsp = null;
    }
    if (currentSlot) {
        // Restore the player's straight-through connection.
        try { currentSlot.input.disconnect(); } catch (e) { /* not connected */ }
        try { currentSlot.input.connect(currentSlot.output); } catch (e) { /* gone */ }
        currentSlot = null;
    }
}

// Route slot.input → DSP chain → slot.output, replacing the passthrough.
// Order matters: the kit wires source → EQ inside its constructor, so the
// passthrough must be dropped BEFORE the chain is built, or disconnecting
// afterwards would also cut the kit's own connection.
function attach(slot, api) {
    if (!slot || slot === currentSlot) return Boolean(dsp);
    teardown();
    try {
        slot.input.disconnect();
        dsp = createAudioDSP({ audioContext: slot.context, source: slot.input });
        dsp.connect(slot.output);
        currentSlot = slot;
        applyState();
        return true;
    } catch (e) {
        api.log('could not attach to the audio slot', e);
        // Leave audio working even if the chain failed to build.
        try { slot.input.connect(slot.output); } catch (e2) { /* gone */ }
        dsp = null;
        currentSlot = null;
        return false;
    }
}

function applyState() {
    if (!dsp) return;
    try {
        dsp.setEqualizerEnabled(state.enabled);
        dsp.setEqualizer(state.bands);
        dsp.setStereoWidth(state.width);
        dsp.setReverb(state.reverb);
    } catch (e) { /* node torn down mid-update */ }
}

function save(api) {
    api.storage?.set('state', state);
}

// --- UI (plain DOM: plugins stay framework-free) ---------------------------
function buildUi(root, api) {
    root.innerHTML = '';
    const css = (el, styles) => { Object.assign(el.style, styles); return el; };
    const make = (tag, styles, text) => {
        const el = document.createElement(tag);
        if (styles) css(el, styles);
        if (text != null) el.textContent = text;
        return el;
    };

    const label = (text) => make('div', {
        fontSize: '11px', opacity: '0.55', margin: '10px 0 5px'
    }, text);

    if (!currentSlot) {
        const warn = make('div', { fontSize: '12px', opacity: '0.7', lineHeight: '1.5' },
            'Play the video, then reopen this panel to enable audio processing.');
        root.appendChild(warn);
        const btn = make('button', {
            marginTop: '10px', width: '100%', padding: '6px 0',
            borderRadius: '6px', fontSize: '12px', cursor: 'pointer',
            background: 'rgba(59,130,246,0.85)', color: '#fff', border: 'none'
        }, 'Enable now');
        btn.onclick = () => {
            const slot = api.audio.ensureSlot();
            if (slot && attach(slot, api)) rerender?.();
        };
        root.appendChild(btn);
        return;
    }

    // Enable toggle
    const toggleRow = make('label', {
        display: 'flex', alignItems: 'center', gap: '6px',
        fontSize: '12px', cursor: 'pointer'
    });
    const toggle = make('input');
    toggle.type = 'checkbox';
    toggle.checked = state.enabled;
    toggle.onchange = () => { state.enabled = toggle.checked; applyState(); save(api); };
    toggleRow.appendChild(toggle);
    toggleRow.appendChild(make('span', null, 'Equalizer'));
    root.appendChild(toggleRow);

    // Presets
    root.appendChild(label('Preset'));
    const select = make('select', {
        width: '100%', padding: '5px', borderRadius: '5px', fontSize: '12px',
        background: 'rgba(127,127,127,0.15)', color: 'inherit',
        border: '1px solid rgba(127,127,127,0.3)'
    });
    for (const p of Object.values(createAudioDSP.EQ_PRESETS)) {
        const opt = make('option', null, p.name);
        opt.value = p.id;
        if (p.id === state.preset) opt.selected = true;
        select.appendChild(opt);
    }
    select.onchange = () => {
        state.preset = select.value;
        const gains = createAudioDSP.EQ_PRESETS[state.preset]?.gains;
        if (gains) state.bands = [...gains];
        applyState();
        save(api);
        rerender?.();
    };
    root.appendChild(select);

    // Bands — vertical faders, the way a mixer lays them out. Horizontal
    // sliders crammed side by side are unusable at this width.
    root.appendChild(label('Bands (dB)'));
    const bandRow = make('div', {
        display: 'flex', gap: '2px', alignItems: 'stretch', justifyContent: 'space-between'
    });

    // dB scale down the left so the fader positions mean something.
    const scale = make('div', {
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        fontSize: '9px', opacity: '0.4', height: '118px', paddingRight: '2px', textAlign: 'right'
    });
    ['+12', '0', '-12'].forEach(tick => scale.appendChild(make('div', null, tick)));
    bandRow.appendChild(scale);

    state.bands.forEach((gain, i) => {
        const col = make('div', {
            flex: '1', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px'
        });
        const slider = make('input', {
            // Chromium's standard vertical range: writing-mode + rtl puts the
            // maximum at the top, like a fader.
            writingMode: 'vertical-lr',
            direction: 'rtl',
            width: '18px',
            height: '118px',
            accentColor: '#3b82f6',
            cursor: 'ns-resize'
        });
        slider.type = 'range';
        slider.min = '-12';
        slider.max = '12';
        slider.step = '1';
        slider.value = String(gain);

        const readout = make('div', {
            fontSize: '10px', opacity: '0.75', fontVariantNumeric: 'tabular-nums'
        }, String(gain));

        slider.oninput = () => {
            state.bands[i] = Number(slider.value);
            state.preset = 'custom';
            readout.textContent = slider.value;
            applyState();
            save(api);
        };
        // Double-click a fader to re-centre just that band.
        slider.ondblclick = () => {
            slider.value = '0';
            slider.dispatchEvent(new Event('input'));
        };

        col.appendChild(slider);
        col.appendChild(readout);
        col.appendChild(make('div', { fontSize: '10px', opacity: '0.45' }, BAND_LABELS[i]));
        bandRow.appendChild(col);
    });
    root.appendChild(bandRow);

    // Effects
    const effect = (text, min, max, step, value, onInput) => {
        root.appendChild(label(text));
        const slider = make('input', { width: '100%', accentColor: '#3b82f6' });
        slider.type = 'range';
        slider.min = String(min);
        slider.max = String(max);
        slider.step = String(step);
        slider.value = String(value);
        slider.oninput = () => onInput(Number(slider.value));
        root.appendChild(slider);
    };
    effect('Stereo width', 0, 2, 0.1, state.width, (v) => {
        state.width = v; applyState(); save(api);
    });
    effect('Reverb', 0, 1, 0.05, state.reverb, (v) => {
        state.reverb = v; applyState(); save(api);
    });

    const reset = make('button', {
        marginTop: '12px', width: '100%', padding: '6px 0',
        borderRadius: '6px', fontSize: '12px', cursor: 'pointer',
        background: 'rgba(127,127,127,0.18)', color: 'inherit', border: 'none'
    }, 'Reset');
    reset.onclick = () => {
        state = { preset: 'flat', bands: [0, 0, 0, 0, 0], width: 1, reverb: 0, enabled: true };
        applyState();
        save(api);
        rerender?.();
    };
    root.appendChild(reset);
}

module.exports = {
    activate(api) {
        const saved = api.storage?.get('state', null);
        if (saved && Array.isArray(saved.bands) && saved.bands.length === 5) {
            state = { ...state, ...saved };
        }

        if (!api.audio.claim()) {
            api.log('another audio plugin already owns the audio slot');
            return;
        }

        // Attach whenever the player (re)builds its graph.
        detachSlot = api.audio.onSlot((slot) => {
            if (!slot) { teardown(); return; }
            attach(slot, api);
            rerender?.();
        });
        const existing = api.audio.getSlot();
        if (existing) attach(existing, api);

        api.ui.registerPanel({
            title: 'Equalizer',
            icon: 'EQ',
            mount(el) {
                rerender = () => buildUi(el, api);
                rerender();
            },
            unmount() {
                rerender = null;
            }
        });
    },

    deactivate() {
        rerender = null;
        if (detachSlot) { detachSlot(); detachSlot = null; }
        teardown();
    }
};
