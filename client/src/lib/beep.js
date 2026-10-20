let ctx = null;
/** Short confirmation tone for scans (success) or a low buzz (error). */
export function beep(kind = 'ok') {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = kind === 'ok' ? 'sine' : 'square';
    o.frequency.value = kind === 'ok' ? 1250 : 220;
    g.gain.value = 0.06;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + (kind === 'ok' ? 0.07 : 0.25));
  } catch { /* audio not available */ }
}
