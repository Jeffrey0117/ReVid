
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

    // Bands
    root.appendChild(label('Bands (dB)'));
    const bandRow = make('div', { display: 'flex', gap: '6px', alignItems: 'flex-end' });
    state.bands.forEach((gain, i) => {
        const col = make('div', { flex: '1', textAlign: 'center' });
        const slider = make('input', { width: '100%', accentColor: '#3b82f6' });
        slider.type = 'range';
        slider.min = '-12';
        slider.max = '12';
        slider.step = '1';
        slider.value = String(gain);
        slider.oninput = () => {
            state.bands[i] = Number(slider.value);
            state.preset = 'custom';
            readout.textContent = slider.value;
            applyState();
            save(api);
        };
        const readout = make('div', { fontSize: '10px', opacity: '0.6' }, String(gain));
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
