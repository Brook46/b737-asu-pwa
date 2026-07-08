/* GPWS aural engine — plays real Honeywell/Boeing 737 callout recordings.
   Sources (see README): Boeing-voice callouts from tylerbmusic/GeoFS-GPWS-Callouts,
   terrain family from net-lisias-kspu/GPWS, windshear from andrewhawkes/x-plane-11.
   Uses Web Audio decoded buffers so we can hard-cut a lower-priority callout when a
   higher-priority one fires. window.GpwsAudio is the public API. */
(function () {
  'use strict';

  const MANIFEST = {
    'pull-up': 'sounds/pull-up.mp3',            // whoop whoop pull up
    'sink-rate': 'sounds/sink-rate.mp3',
    'dont-sink': 'sounds/dont-sink.wav',
    'too-low-gear': 'sounds/too-low-gear.wav',
    'too-low-flaps': 'sounds/too-low-flaps.wav',
    'too-low-terrain': 'sounds/too-low-terrain.wav',
    'glideslope': 'sounds/glideslope.wav',
    'bank-angle': 'sounds/bank-angle.wav',
    'minimums': 'sounds/minimums.wav',
    'terrain': 'sounds/terrain.wav',            // "terrain, terrain"
    'terrain-pull-up': 'sounds/terrain-pull-up.wav',
    'windshear': 'sounds/windshear.wav',
    'alt-2500': 'sounds/alt-2500.wav', 'alt-1000': 'sounds/alt-1000.wav',
    'alt-500': 'sounds/alt-500.wav', 'alt-400': 'sounds/alt-400.wav',
    'alt-300': 'sounds/alt-300.wav', 'alt-200': 'sounds/alt-200.wav',
    'alt-100': 'sounds/alt-100.wav', 'alt-50': 'sounds/alt-50.wav',
    'alt-40': 'sounds/alt-40.wav', 'alt-30': 'sounds/alt-30.wav',
    'alt-20': 'sounds/alt-20.wav', 'alt-10': 'sounds/alt-10.wav'
  };

  let ctx = null;
  let masterGain = null;
  let enabled = false;
  let ready = false;
  const buffers = {};       // name -> AudioBuffer
  let current = null;       // { source, name, done }

  function ensureCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = 1;
      masterGain.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  async function loadAll() {
    ensureCtx();
    const names = Object.keys(MANIFEST);
    await Promise.all(names.map(async name => {
      if (buffers[name]) return;
      try {
        const res = await fetch(MANIFEST[name]);
        const arr = await res.arrayBuffer();
        buffers[name] = await ctx.decodeAudioData(arr);
      } catch (e) {
        console.warn('GPWS: failed to load', name, e);
      }
    }));
    ready = true;
  }

  function stop() {
    if (current && current.source) {
      try { current.source.onended = null; current.source.stop(); } catch (e) {}
    }
    current = null;
  }

  // Play one clip. If force is false and something is already playing, the request
  // is ignored (used so a running callout finishes cleanly).
  function play(name, force) {
    return new Promise(resolve => {
      if (!enabled || !buffers[name]) return resolve();
      ensureCtx();
      if (current && !force) return resolve();
      if (current && force) stop();
      const src = ctx.createBufferSource();
      src.buffer = buffers[name];
      src.connect(masterGain);
      const token = { source: src, name };
      current = token;
      src.onended = () => {
        if (current === token) current = null;
        resolve();
      };
      try { src.start(); } catch (e) { current = null; resolve(); }
    });
  }

  async function playSeq(names, force) {
    for (let i = 0; i < names.length; i++) {
      await play(names[i], i === 0 ? force : true);
    }
  }

  function setEnabled(on) {
    enabled = on;
    if (on) { ensureCtx(); if (!ready) loadAll(); }
    else stop();
  }

  window.GpwsAudio = {
    setEnabled,
    isEnabled: () => enabled,
    isReady: () => ready,
    isBusy: () => !!current,
    currentName: () => (current ? current.name : null),
    play,
    playSeq,
    stop
  };
})();
