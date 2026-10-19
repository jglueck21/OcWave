// Audio metadata helpers: ID3 tags, cover art, generated covers, dominant color.

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|ogg|oga|opus|flac|weba|webm)$/i;
export const isAudioFile = (file) => file.type.startsWith("audio/") || AUDIO_EXT.test(file.name);

/* ------------------------------ ID3 parsing ------------------------------ */

const syncsafe = (b, o) => ((b[o] & 127) << 21) | ((b[o + 1] & 127) << 14) | ((b[o + 2] & 127) << 7) | (b[o + 3] & 127);
const be32 = (b, o) => ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
const be24 = (b, o) => (b[o] << 16) | (b[o + 1] << 8) | b[o + 2];

function decodeText(bytes, encoding) {
  let label = "iso-8859-1";
  if (encoding === 3) label = "utf-8";
  else if (encoding === 1 || encoding === 2) {
    label = "utf-16le";
    if (bytes[0] === 0xfe && bytes[1] === 0xff) (label = "utf-16be"), (bytes = bytes.subarray(2));
    else if (bytes[0] === 0xff && bytes[1] === 0xfe) bytes = bytes.subarray(2);
    else if (encoding === 2) label = "utf-16be";
  }
  return new TextDecoder(label).decode(bytes).split("\0")[0].replace(/\r\n?/g, "\n").trim();
}

// Index of the first string terminator at or after `from` (1 byte for 8-bit encodings, 2 for UTF-16).
function terminator(bytes, from, encoding) {
  if (encoding === 1 || encoding === 2) {
    for (let i = from; i + 1 < bytes.length; i += 2) if (bytes[i] === 0 && bytes[i + 1] === 0) return [i, 2];
    return [bytes.length, 0];
  }
  const i = bytes.indexOf(0, from);
  return i === -1 ? [bytes.length, 0] : [i, 1];
}

function parsePicture(data, isV22) {
  const encoding = data[0];
  let offset = 1;
  let mime = "image/jpeg";
  if (isV22) {
    mime = "image/" + String.fromCharCode(...data.subarray(1, 4)).toLowerCase().replace("jpg", "jpeg");
    offset = 4;
  } else {
    const end = data.indexOf(0, 1);
    const declared = new TextDecoder("latin1").decode(data.subarray(1, end));
    if (declared.startsWith("image/")) mime = declared;
    offset = end + 1;
  }
  offset += 1; // picture type
  const [end, width] = terminator(data, offset, encoding);
  offset = end + width; // skip description
  return new Blob([data.subarray(offset)], { type: mime });
}

function parseId3v2(buffer, version, flags) {
  const tags = {};
  const isV22 = version === 2;
  const idLen = isV22 ? 3 : 4;
  const headerLen = isV22 ? 6 : 10;
  let offset = 0;
  if (flags & 0x40 && !isV22) offset = version === 4 ? syncsafe(buffer, 0) : be32(buffer, 0) + 4;

  while (offset + headerLen <= buffer.length) {
    const id = String.fromCharCode(...buffer.subarray(offset, offset + idLen));
    if (!/^[A-Z0-9]+$/.test(id)) break;
    const size = isV22 ? be24(buffer, offset + 3) : version === 4 ? syncsafe(buffer, offset + 4) : be32(buffer, offset + 4);
    const data = buffer.subarray(offset + headerLen, offset + headerLen + size);
    offset += headerLen + size;
    if (!data.length) continue;

    if (id === "TIT2" || id === "TT2") tags.title = decodeText(data.subarray(1), data[0]);
    else if (id === "TPE1" || id === "TP1") tags.artist = decodeText(data.subarray(1), data[0]);
    else if (id === "TALB" || id === "TAL") tags.album = decodeText(data.subarray(1), data[0]);
    else if (id === "TRCK" || id === "TRK") tags.track = parseInt(decodeText(data.subarray(1), data[0]), 10) || 0; // "3" or "3/12"
    else if ((id === "USLT" || id === "ULT") && !tags.lyrics && data.length > 5) {
      // encoding (1) + language (3) + content descriptor (terminated) + lyrics text
      const [end, width] = terminator(data, 4, data[0]);
      tags.lyrics = decodeText(data.subarray(end + width), data[0]);
    } else if ((id === "APIC" || id === "PIC") && !tags.picture) {
      try {
        tags.picture = parsePicture(data, isV22);
      } catch {
        /* ignore broken artwork */
      }
    }
  }
  return tags;
}

async function parseId3v1(file) {
  if (file.size < 128) return {};
  const bytes = new Uint8Array(await file.slice(file.size - 128).arrayBuffer());
  if (String.fromCharCode(...bytes.subarray(0, 3)) !== "TAG") return {};
  const text = (a, b) => new TextDecoder("latin1").decode(bytes.subarray(a, b)).split("\0")[0].trim();
  return { title: text(3, 33), artist: text(33, 63), album: text(63, 93) };
}

export async function readTags(file) {
  try {
    const head = new Uint8Array(await file.slice(0, 10).arrayBuffer());
    if (String.fromCharCode(...head.subarray(0, 3)) === "ID3") {
      const size = syncsafe(head, 6);
      const body = new Uint8Array(await file.slice(10, 10 + size).arrayBuffer());
      const tags = parseId3v2(body, head[3], head[5]);
      if (tags.title || tags.artist || tags.picture) return tags;
    }
    return await parseId3v1(file);
  } catch {
    return {};
  }
}

/* ------------------------------ Filenames ------------------------------ */

export function parseFilename(fileName) {
  let name = fileName
    .replace(AUDIO_EXT, "")
    .replace(/^(y2mate\.com|spotifydown\.com|spotifydownloader\.com)\s*-\s*/i, "")
    .replace(/[([][^)\]]*(official|lyrics?|video|audio|visuali[sz]er|\bhd\b|\bhq\b|from the)[^)\]]*[)\]]/gi, "")
    .replace(/\s+(official\s+(music\s+)?(video|audio)|lyrics?|lyric video)\s*$/i, "")
    .replace(/_/g, " ")
    .replace(/^\d{1,3}[.\s)-]+(?=\D)/, "") // leading track number
    .trim();

  const dash = name.split(/\s+-\s+/);
  if (dash.length >= 2) return { artist: dash[0].trim(), title: dash.slice(1).join(" - ").trim() };
  const gap = name.split(/\s{2,}/);
  if (gap.length === 2) return { artist: gap[0].trim(), title: gap[1].trim() };
  return { artist: "", title: name.replace(/\s+/g, " ") };
}

/* --------------------------------- Images --------------------------------- */

// Scales an image blob to a centered square thumbnail and returns a JPEG data URL.
export async function downscaleImage(blob, size = 480, quality = 0.86) {
  try {
    const bitmap = await createImageBitmap(blob);
    const side = Math.min(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = Math.min(size, side);
    canvas.getContext("2d").drawImage(
      bitmap,
      (bitmap.width - side) / 2,
      (bitmap.height - side) / 2,
      side,
      side,
      0,
      0,
      canvas.width,
      canvas.height
    );
    bitmap.close?.();
    return canvas.toDataURL("image/jpeg", quality);
  } catch {
    return null;
  }
}

const coverCache = new Map();

// Small seeded random generator so the same seed always gives the same artwork.
function seededRandom(seed) {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Deterministic abstract artwork (soft mesh gradient, fine rings, grain) used when a song or playlist has no cover.
export function generateCover(seed = "") {
  if (coverCache.has(seed)) return coverCache.get(seed);
  let hash = 7;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
  const rand = seededRandom(hash);
  const size = 480;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");

  const base = Math.abs(hash) % 360;
  const palette = [base, (base + 30 + rand() * 30) % 360, (base + 170 + rand() * 50) % 360, (base + 300 + rand() * 30) % 360];

  ctx.fillStyle = `hsl(${base} 55% 8%)`;
  ctx.fillRect(0, 0, size, size);

  // Overlapping glows make the mesh-gradient look.
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 5; i++) {
    const x = rand() * size;
    const y = rand() * size;
    const radius = size * (0.36 + rand() * 0.34);
    const hue = palette[i % palette.length];
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, `hsla(${hue} ${82 + rand() * 14}% ${42 + rand() * 12}% / 0.92)`);
    gradient.addColorStop(1, `hsla(${hue} 85% 45% / 0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.globalCompositeOperation = "source-over";

  // Fine concentric rings, a nod to vinyl grooves.
  const cx = size * (0.15 + rand() * 0.7);
  const cy = size * (0.15 + rand() * 0.7);
  ctx.strokeStyle = "rgba(255,255,255,0.11)";
  ctx.lineWidth = 1.4;
  for (let ring = 0; ring < 7; ring++) {
    ctx.beginPath();
    ctx.arc(cx, cy, 46 + ring * 34, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Soft light sweep and vignette for depth.
  const sweep = ctx.createLinearGradient(0, 0, size, size);
  sweep.addColorStop(0, "rgba(255,255,255,0.20)");
  sweep.addColorStop(0.45, "rgba(255,255,255,0)");
  ctx.fillStyle = sweep;
  ctx.fillRect(0, 0, size, size);
  const vignette = ctx.createRadialGradient(size / 2, size / 2, size * 0.35, size / 2, size / 2, size * 0.78);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.38)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, size, size);

  // A touch of film grain.
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = rand() > 0.5 ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.07)";
    ctx.fillRect(rand() * size, rand() * size, 1.6, 1.6);
  }

  const url = canvas.toDataURL("image/jpeg", 0.88);
  coverCache.set(seed, url);
  return url;
}

const colorCache = new Map();

// Average color of an image, weighted towards saturated pixels. Resolves to [r, g, b].
export function dominantColor(src) {
  if (colorCache.has(src)) return Promise.resolve(colorCache.get(src));
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 24;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 24, 24);
      const { data } = ctx.getImageData(0, 0, 24, 24);
      let r = 0, g = 0, b = 0, total = 0;
      for (let i = 0; i < data.length; i += 4) {
        const max = Math.max(data[i], data[i + 1], data[i + 2]);
        const min = Math.min(data[i], data[i + 1], data[i + 2]);
        const weight = 0.15 + (max - min) / 255;
        r += data[i] * weight;
        g += data[i + 1] * weight;
        b += data[i + 2] * weight;
        total += weight;
      }
      const color = [r, g, b].map((v) => Math.round(v / total));
      colorCache.set(src, color);
      resolve(color);
    };
    img.onerror = () => resolve([90, 90, 110]);
    img.src = src;
  });
}

/* --------------------------------- Audio --------------------------------- */

// Finds the real audio container by looking at the first bytes (after any ID3v2 tag).
// Returns { offset, type }: where the audio data starts and its MIME type (null if unrecognised).
export async function sniffAudio(blob) {
  const head = new Uint8Array(await blob.slice(0, 10).arrayBuffer());
  let offset = 0;
  if (String.fromCharCode(...head.subarray(0, 3)) === "ID3") {
    const footer = head[5] & 0x10 ? 10 : 0;
    offset = 10 + syncsafe(head, 6) + footer;
  }
  const p = new Uint8Array(await blob.slice(offset, offset + 16).arrayBuffer());
  const text = (a, b) => String.fromCharCode(...p.subarray(a, b));
  let type = null;
  if (text(4, 8) === "ftyp") type = "audio/mp4"; // m4a / aac / alac in an MP4 container
  else if (text(0, 4) === "OggS") type = "audio/ogg";
  else if (text(0, 4) === "fLaC") type = "audio/flac";
  else if (text(0, 4) === "RIFF" && text(8, 12) === "WAVE") type = "audio/wav";
  else if (p[0] === 0x1a && p[1] === 0x45 && p[2] === 0xdf && p[3] === 0xa3) type = "audio/webm";
  else if (p[0] === 0xff && (p[1] & 0xe0) === 0xe0) type = "audio/mpeg"; // MPEG audio frame sync
  return { offset, type };
}

// Some files are mislabelled, e.g. an ".mp3" that is really an MP4/M4A with an ID3 tag stuck in front,
// which browsers refuse to play. Returns a blob with the tag stripped and the right type, or the
// original blob when nothing needs fixing.
export async function normalizeAudio(blob, fallbackType = "audio/mpeg") {
  const { offset, type } = await sniffAudio(blob);
  if (!type) return blob.type ? blob : blob.slice(0, blob.size, fallbackType);
  if (type === "audio/mpeg") return blob.type === "audio/mpeg" ? blob : blob.slice(0, blob.size, "audio/mpeg");
  if (offset === 0 && blob.type === type) return blob;
  return blob.slice(offset, blob.size, type);
}

export function getDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    const done = (value) => {
      URL.revokeObjectURL(url);
      audio.removeAttribute("src");
      resolve(Number.isFinite(value) ? value : 0);
    };
    audio.preload = "metadata";
    audio.onloadedmetadata = () => done(audio.duration);
    audio.onerror = () => done(0);
    setTimeout(() => done(0), 8000);
    audio.src = url;
  });
}
