// Live audio visualiser: log-spaced frequency bars with falling peak caps, drawn on a canvas.
const BARS = 56;

export function createVisualizer(canvas, { getAnalyser, isPlaying }) {
  const ctx = canvas.getContext("2d");
  const levels = new Float32Array(BARS);
  const peaks = new Float32Array(BARS);
  let frame = 0;
  let data = null;
  let width = 0;
  let height = 0;
  let enabled = false;

  function resize() {
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(height * ratio);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }

  function sample() {
    const analyser = getAnalyser();
    if (!analyser || !isPlaying()) return levels.fill(0, 0), false;
    if (!data || data.length !== analyser.frequencyBinCount) data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    const first = 2; // skip the DC bin
    const last = Math.floor(data.length * 0.72); // roughly up to 16 kHz
    for (let i = 0; i < BARS; i++) {
      const from = Math.floor(first * (last / first) ** (i / BARS));
      const to = Math.max(from + 1, Math.floor(first * (last / first) ** ((i + 1) / BARS)));
      let sum = 0;
      for (let b = from; b < to; b++) sum += data[b];
      // A slight tilt makes up for highs carrying less energy than bass.
      levels[i] = Math.min(1, (sum / (to - from) / 255) * (0.85 + (i / BARS) * 0.5));
    }
    return true;
  }

  function draw() {
    frame = 0;
    if (!enabled || document.hidden) return;
    const live = sample();
    ctx.clearRect(0, 0, width, height);
    const style = getComputedStyle(canvas);
    const rgb = style.getPropertyValue("--accent-rgb").trim() || "90, 140, 255";
    const gap = Math.max(2, width / BARS / 4);
    const bar = (width - gap * (BARS - 1)) / BARS;
    let motion = false;
    for (let i = 0; i < BARS; i++) {
      const level = levels[i];
      peaks[i] = Math.max(level, peaks[i] - 0.008);
      if (peaks[i] > 0.01) motion = true;
      const h = Math.max(3, level ** 1.15 * height);
      const x = i * (bar + gap);
      const gradient = ctx.createLinearGradient(0, height, 0, height - h);
      gradient.addColorStop(0, `rgba(${rgb}, 0.05)`);
      gradient.addColorStop(1, `rgba(${rgb}, 0.5)`);
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.roundRect(x, height - h, bar, h, Math.min(bar / 2, 6));
      ctx.fill();
      if (peaks[i] > 0.04) {
        ctx.fillStyle = `rgba(${rgb}, 0.4)`;
        ctx.fillRect(x, height - Math.max(3, peaks[i] ** 1.15 * height) - 5, bar, 2);
      }
    }
    // Keep animating while playing or while the bars are still falling.
    if (live || motion) frame = requestAnimationFrame(draw);
  }

  const wake = () => enabled && !frame && (frame = requestAnimationFrame(draw));
  const onVisibility = () => !document.hidden && wake();
  window.addEventListener("resize", resize);
  document.addEventListener("visibilitychange", onVisibility);

  return {
    setEnabled(on) {
      enabled = on;
      if (on) (resize(), wake());
      else (cancelAnimationFrame(frame), (frame = 0), ctx.clearRect(0, 0, width, height));
    },
    wake, // call when playback starts
    destroy() {
      enabled = false;
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
    },
  };
}
