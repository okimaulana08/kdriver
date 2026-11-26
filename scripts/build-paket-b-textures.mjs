/**
 * Procedural Photorealistic Arena Texture & 360° Equirectangular Skybox Generator
 * for Paket B Sectors:
 *   - Sector 04: Neon Rain District (wet asphalt puddles + cyberpunk rainy night skyline)
 *   - Sector 05: Glacial Eclipse Citadel (cracked crystal ice flagstones + crimson-violet eclipse peak)
 *
 * Pure Node.js RGBA PNG writer + Windows System.Drawing JPEG compressor (0 external deps, 0 Meshy credits).
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';

const TEX_DIR = path.resolve(process.cwd(), 'public/assets/textures');
fs.mkdirSync(TEX_DIR, { recursive: true });

// ---- Pure Node RGBA PNG Encoder ----
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}
function writeRgbaPng(filePath, width, height, rgba) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const compressed = zlib.deflateSync(raw, { level: 9 });
  const png = Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
  fs.writeFileSync(filePath, png);
  console.log(`[PNG] ${path.basename(filePath).padEnd(34)} | ${width}x${height} | ${(png.length / 1024).toFixed(1)} KB`);
}

function writeJpgViaSystemDrawing(jpgPath, width, height, rgba, quality = 88) {
  const tmpPng = jpgPath.replace(/\.jpg$/i, '.__tmp.png');
  writeRgbaPng(tmpPng, width, height, rgba);
  const psScript = `
Add-Type -AssemblyName System.Drawing
$img = [System.Drawing.Image]::FromFile('${tmpPng.replace(/'/g, "''")}')
$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' } | Select-Object -First 1
$ep = New-Object System.Drawing.Imaging.EncoderParameters(1)
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter([System.Drawing.Imaging.Encoder]::Quality, [long]${quality})
$img.Save('${jpgPath.replace(/'/g, "''")}', $enc, $ep)
$img.Dispose()
`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', psScript], { stdio: 'inherit' });
  fs.unlinkSync(tmpPng);
  const sz = fs.statSync(jpgPath).size;
  console.log(`[JPG] ${path.basename(jpgPath).padEnd(34)} | ${width}x${height} | ${(sz / 1024).toFixed(1)} KB`);
}

// ---- Math & Periodic Noise Helpers ----
function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
function lerp(a, b, t) { return a + (b - a) * t; }
function smoothstep(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
}

function hash2(ix, iy, periodX, periodY = periodX, seed = 0) {
  const x = ((ix % periodX) + periodX) % periodX;
  const y = ((iy % periodY) + periodY) % periodY;
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 1442695041);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function periodicNoise(u, v, freqX, freqY = freqX, seed = 0) {
  const x = u * freqX;
  const y = v * freqY;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hash2(ix, iy, freqX, freqY, seed);
  const b = hash2(ix + 1, iy, freqX, freqY, seed);
  const c = hash2(ix, iy + 1, freqX, freqY, seed);
  const d = hash2(ix + 1, iy + 1, freqX, freqY, seed);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

function fbmPeriodic(u, v, freqX = 8, freqY = freqX, octaves = 5, seed = 0) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let fx = freqX;
  let fy = freqY;
  for (let o = 0; o < octaves; o++) {
    sum += periodicNoise(u, v, fx, fy, seed + o * 17) * amp;
    norm += amp;
    amp *= 0.5;
    fx *= 2;
    fy *= 2;
  }
  return sum / norm;
}

function voronoiPeriodic(u, v, cells, seed = 0) {
  const x = u * cells;
  const y = v * cells;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  let f1 = 99;
  let f2 = 99;
  let bestId = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx;
      const cy = iy + dy;
      const rx = hash2(cx, cy, cells, cells, seed + 1);
      const ry = hash2(cx, cy, cells, cells, seed + 2);
      const px = cx + 0.15 + rx * 0.7;
      const py = cy + 0.15 + ry * 0.7;
      const d = Math.hypot(x - px, y - py);
      if (d < f1) {
        f2 = f1;
        f1 = d;
        bestId = hash2(cx, cy, cells, cells, seed + 3);
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return { f1, edge: f2 - f1, cellId: bestId };
}

function heightToNormalRgba(heightField, width, height, strength = 2.6, flatMask = null) {
  const out = Buffer.alloc(width * height * 4);
  const sample = (x, y) => {
    const wx = ((x % width) + width) % width;
    const wy = ((y % height) + height) % height;
    return heightField[wy * width + wx];
  };
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idxPix = y * width + x;
      const damp = flatMask ? 1.0 - flatMask[idxPix] : 1.0;
      const eff = strength * damp;
      const tl = sample(x - 1, y - 1);
      const t = sample(x, y - 1);
      const tr = sample(x + 1, y - 1);
      const l = sample(x - 1, y);
      const r = sample(x + 1, y);
      const bl = sample(x - 1, y + 1);
      const b = sample(x, y + 1);
      const br = sample(x + 1, y + 1);
      const dx = (tr + 2 * r + br - (tl + 2 * l + bl)) * eff;
      const dy = (bl + 2 * b + br - (tl + 2 * t + tr)) * eff;
      const dz = 1.0;
      const invLen = 1 / Math.hypot(dx, dy, dz);
      const idx = idxPix * 4;
      out[idx] = Math.max(0, Math.min(255, Math.round((-dx * invLen * 0.5 + 0.5) * 255)));
      out[idx + 1] = Math.max(0, Math.min(255, Math.round((-dy * invLen * 0.5 + 0.5) * 255)));
      out[idx + 2] = Math.max(0, Math.min(255, Math.round((dz * invLen * 0.5 + 0.5) * 255)));
      out[idx + 3] = 255;
    }
  }
  return out;
}

function setRgb(buf, idx, r, g, b) {
  buf[idx] = Math.max(0, Math.min(255, Math.round(r * 255)));
  buf[idx + 1] = Math.max(0, Math.min(255, Math.round(g * 255)));
  buf[idx + 2] = Math.max(0, Math.min(255, Math.round(b * 255)));
  buf[idx + 3] = 255;
}

// ============================================================================
// 1. SECTOR 04: NEON RAIN DISTRICT — 360° SKYBOX (1536x768)
// ============================================================================
function buildNeonDistrictSkybox() {
  const W = 1536;
  const H = 768;
  const rgba = Buffer.alloc(W * H * 4);

  // Pre-generate 3 layers of cyberpunk skyline towers around 360 degrees
  const makeLayer = (count, minH, maxH, seed, minW, maxW) => {
    const towers = [];
    for (let i = 0; i < count; i++) {
      const h1 = hash2(i, 1, count, 7, seed);
      const h2 = hash2(i, 2, count, 7, seed);
      const h3 = hash2(i, 3, count, 7, seed);
      const h4 = hash2(i, 4, count, 7, seed);
      const uCenter = (i + 0.15 + h1 * 0.7) / count;
      const halfW = lerp(minW, maxW, h2) * 0.5;
      const topV = 0.515 - lerp(minH, maxH, Math.pow(h3, 0.85));
      const neonType = Math.floor(h4 * 4); // 0 cyan, 1 magenta, 2 amber, 3 violet
      const hasSpire = h1 > 0.62;
      const winCols = 4 + Math.floor(h2 * 10);
      const winRows = 10 + Math.floor(h3 * 28);
      towers.push({ uCenter, halfW, topV, neonType, hasSpire, winCols, winRows, seed: i + seed * 31 });
    }
    return towers;
  };

  const farTowers = makeLayer(72, 0.05, 0.22, 11, 0.012, 0.028);
  const midTowers = makeLayer(46, 0.06, 0.27, 23, 0.014, 0.032);
  const nearTowers = makeLayer(28, 0.04, 0.19, 37, 0.016, 0.036);

  const neonPalette = [
    [0.08, 0.88, 1.0],  // electric cyan
    [1.0, 0.16, 0.68],  // cyberpunk magenta
    [1.0, 0.68, 0.18],  // warm street amber
    [0.62, 0.32, 1.0],  // hyper violet
  ];

  for (let y = 0; y < H; y++) {
    const v = y / (H - 1); // 0 top zenith, 0.5 horizon, 1 nadir
    for (let x = 0; x < W; x++) {
      const u = x / W;

      // Base stormy neon-night sky gradient
      let r, g, b;
      if (v < 0.52) {
        const elev = clamp01((0.52 - v) / 0.52);
        const cloudWarp = fbmPeriodic(u, v * 1.4, 8, 4, 4, 5);
        const clouds = fbmPeriodic(u + cloudWarp * 0.06, v * 1.6 + cloudWarp * 0.04, 10, 6, 5, 19);
        const horizonGlow = Math.pow(1.0 - elev, 2.5);
        const neonShift = 0.5 + 0.5 * Math.sin(u * Math.PI * 6 + cloudWarp * 2.5);

        // Deep stormy slate-indigo zenith to neon magenta/cyan urban cloud underglow
        r = lerp(0.02, 0.09, 1 - elev) + horizonGlow * lerp(0.06, 0.28, neonShift) * (0.65 + clouds * 0.7);
        g = lerp(0.03, 0.11, 1 - elev) + horizonGlow * lerp(0.24, 0.11, neonShift) * (0.65 + clouds * 0.7);
        b = lerp(0.07, 0.20, 1 - elev) + horizonGlow * lerp(0.38, 0.34, neonShift) * (0.7 + clouds * 0.65);

        // Bright rain-cloud edges catching city light
        const cloudRim = smoothstep(0.42, 0.78, clouds) * (0.28 + 0.72 * horizonGlow);
        r += cloudRim * lerp(0.05, 0.22, neonShift);
        g += cloudRim * lerp(0.22, 0.09, neonShift);
        b += cloudRim * 0.32;

        // Subtle distant storm lightning sheet glow in two sky pockets
        const boltA = Math.exp(-Math.pow(((u - 0.22 + 1.5) % 1 - 0.5) * 24, 2)) * Math.exp(-Math.pow((v - 0.24) * 9, 2));
        const boltB = Math.exp(-Math.pow(((u - 0.74 + 1.5) % 1 - 0.5) * 28, 2)) * Math.exp(-Math.pow((v - 0.21) * 10, 2));
        const flash = (boltA + boltB * 0.85) * (0.55 + 0.45 * clouds);
        r += flash * 0.32;
        g += flash * 0.52;
        b += flash * 0.78;
      } else {
        // Below horizon: wet dark city canyon mist & reflected neon haze
        const dep = clamp01((v - 0.52) / 0.48);
        const ripple = fbmPeriodic(u, v * 2.0, 16, 12, 3, 41);
        const horiz = Math.exp(-dep * 6.0);
        const neonShift = 0.5 + 0.5 * Math.sin(u * Math.PI * 6);
        r = lerp(0.025, 0.12 * neonShift + 0.03, horiz) + ripple * 0.015;
        g = lerp(0.035, 0.14 * (1 - neonShift * 0.5) + 0.04, horiz) + ripple * 0.02;
        b = lerp(0.06, 0.22, horiz) + ripple * 0.025;
      }

      // Render skyline layers (far -> mid -> near)
      if (v > 0.22 && v < 0.64) {
        const layers = [
          { towers: farTowers, fog: 0.62, winBright: 0.38, baseDark: [0.045, 0.065, 0.115] },
          { towers: midTowers, fog: 0.36, winBright: 0.68, baseDark: [0.028, 0.040, 0.072] },
          { towers: nearTowers, fog: 0.14, winBright: 0.92, baseDark: [0.018, 0.024, 0.045] },
        ];

        for (let li = 0; li < layers.length; li++) {
          const L = layers[li];
          for (let ti = 0; ti < L.towers.length; ti++) {
            const tw = L.towers[ti];
            let du = u - tw.uCenter;
            if (du > 0.5) du -= 1.0;
            if (du < -0.5) du += 1.0;
            const ad = Math.abs(du);

            // Antenna spire & red aviation beacon above roof
            if (tw.hasSpire && ad < 0.0012 && v >= tw.topV - 0.048 && v < tw.topV) {
              r = lerp(r, 0.06, 0.8);
              g = lerp(g, 0.08, 0.8);
              b = lerp(b, 0.13, 0.8);
              const tipDist = Math.hypot(du * 65, (v - (tw.topV - 0.046)) * 35);
              if (tipDist < 0.25) {
                const glow = Math.exp(-tipDist * tipDist * 28);
                r += glow * 1.1;
                g += glow * 0.15;
                b += glow * 0.22;
              }
            }

            if (ad <= tw.halfW && v >= tw.topV && v <= 0.62) {
              const localU = (du + tw.halfW) / (tw.halfW * 2);
              const localV = (v - tw.topV) / Math.max(0.01, 0.56 - tw.topV);
              const neonCol = neonPalette[tw.neonType];

              // Dark glass tower facade with atmospheric mist fading seamlessly below horizon
              const groundMist = smoothstep(0.50, 0.60, v);
              let tr = L.baseDark[0] + (1 - Math.abs(localU - 0.5) * 1.6) * 0.014;
              let tg = L.baseDark[1] + (1 - Math.abs(localU - 0.5) * 1.6) * 0.018;
              let tb = L.baseDark[2] + (1 - Math.abs(localU - 0.5) * 1.6) * 0.028;

              // Roof glowing neon crown trim
              if (localV < 0.022) {
                tr += neonCol[0] * 0.68 * (1 - L.fog);
                tg += neonCol[1] * 0.68 * (1 - L.fog);
                tb += neonCol[2] * 0.68 * (1 - L.fog);
              }

              // Vertical holographic neon sign strip on side of tower
              if (localU > 0.76 && localU < 0.87 && localV > 0.1 && localV < 0.62) {
                const seg = Math.sin(localV * 44) > -0.3 ? 1.0 : 0.2;
                tr += neonCol[0] * 0.58 * seg * (1 - L.fog * 0.65) * (1 - groundMist);
                tg += neonCol[1] * 0.58 * seg * (1 - L.fog * 0.65) * (1 - groundMist);
                tb += neonCol[2] * 0.58 * seg * (1 - L.fog * 0.65) * (1 - groundMist);
              }

              // Crisp skyscraper window grid
              const colF = localU * tw.winCols;
              const rowF = localV * tw.winRows;
              const ci = Math.floor(colF);
              const ri = Math.floor(rowF);
              const cf = colF - ci;
              const rf = rowF - ri;
              if (cf > 0.18 && cf < 0.82 && rf > 0.24 && rf < 0.74 && localV > 0.03 && v < 0.56) {
                const lit = hash2(ci + tw.seed, ri * 3 + tw.seed, 97, 97, li + 7);
                if (lit > 0.55) {
                  const warm = hash2(ci, ri, 41, 41, tw.seed);
                  const wInt = (lit - 0.53) * 1.85 * L.winBright * (1 - groundMist);
                  if (warm > 0.66) {
                    tr += 0.95 * wInt;
                    tg += 0.74 * wInt;
                    tb += 0.36 * wInt;
                  } else if (warm > 0.32) {
                    tr += 0.52 * wInt;
                    tg += 0.86 * wInt;
                    tb += 1.0 * wInt;
                  } else {
                    tr += neonCol[0] * 0.78 * wInt;
                    tg += neonCol[1] * 0.78 * wInt;
                    tb += neonCol[2] * 0.78 * wInt;
                  }
                }
              }

              // Blend seamlessly into lower rainy city canyon fog (zero hard cutoff line!)
              const mistAmt = clamp01(L.fog * 0.45 + groundMist);
              r = lerp(tr, r, mistAmt);
              g = lerp(tg, g, mistAmt);
              b = lerp(tb, b, mistAmt);
            }
          }
        }
      }

      // Soft horizon neon haze veil unifying skyline with arena fog
      const horizonMist = Math.exp(-Math.pow((v - 0.515) * 16, 2)) * 0.35;
      r += horizonMist * 0.10;
      g += horizonMist * 0.22;
      b += horizonMist * 0.36;

      setRgb(rgba, (y * W + x) * 4, r, g, b);
    }
  }

  writeJpgViaSystemDrawing(path.join(TEX_DIR, 'env_neon_district_360.jpg'), W, H, rgba, 88);
}

// ============================================================================
// 2. SECTOR 04: WET REFLECTIVE ASPHALT PBR MAPS (512x512)
// ============================================================================
function buildNeonAsphaltFloorMaps() {
  const S = 512;
  const albedo = Buffer.alloc(S * S * 4);
  const roughRgba = Buffer.alloc(S * S * 4);
  const height = new Float32Array(S * S);
  const puddleMask = new Float32Array(S * S);

  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const idxPix = y * S + x;

      // Coarse asphalt aggregate + fine pebble grit
      const macro = fbmPeriodic(u, v, 6, 6, 4, 101);
      const grain = fbmPeriodic(u, v, 32, 32, 3, 103);
      const micro = periodicNoise(u, v, 96, 96, 107);

      // Subtle rooftop concrete/asphalt expansion tile seams (2x2 slabs)
      const sx = Math.abs(((u * 2) % 1) - 0.5);
      const sy = Math.abs(((v * 2) % 1) - 0.5);
      const seam = sx > 0.491 || sy > 0.491 ? 1.0 : 0.0;

      // Organic hairline asphalt cracks
      const crkField = Math.abs(fbmPeriodic(u, v, 8, 8, 4, 113) - 0.5);
      const crack = smoothstep(0.016, 0.002, crkField);

      // Rain puddles pooled in low depressions (smoothstep mask)
      const puddleNoise = fbmPeriodic(u, v, 4, 4, 4, 127) + (macro - 0.5) * 0.28;
      const puddle = smoothstep(0.51, 0.62, puddleNoise) * (1 - seam * 0.5);
      puddleMask[idxPix] = puddle;

      // Height field: flat glass-smooth inside puddles, gritty outside, recessed in seams/cracks
      const rawH = clamp01(0.54 + (macro - 0.5) * 0.22 + (grain - 0.5) * 0.26 + (micro - 0.5) * 0.14 - seam * 0.32 - crack * 0.28);
      height[idxPix] = lerp(rawH, 0.5, puddle * 0.92);

      // Wet dark slate-blue asphalt albedo (puddles darken asphalt realistically + catch subtle ambient grit)
      const gritSpeck = (micro - 0.5) * 0.045 * (1 - puddle * 0.85);
      const baseLum = clamp01(lerp(0.15, 0.25, rawH) + gritSpeck) * (1 - puddle * 0.38) * (1 - seam * 0.42);
      const r = baseLum * 0.93;
      const g = baseLum * 1.02;
      const b = baseLum * 1.15;

      setRgb(albedo, idxPix * 4, r, g, b);

      // Roughness: MIRROR-WET puddles (~0.09) vs damp rough asphalt (~0.56–0.78)
      const roughVal = lerp(0.52 + (1 - grain) * 0.28 + seam * 0.14, 0.085, puddle);
      const rByte = Math.max(16, Math.min(242, Math.round(roughVal * 255)));
      const idx = idxPix * 4;
      roughRgba[idx] = rByte;
      roughRgba[idx + 1] = rByte;
      roughRgba[idx + 2] = rByte;
      roughRgba[idx + 3] = 255;
    }
  }

  writeJpgViaSystemDrawing(path.join(TEX_DIR, 'floor_neon_asphalt_albedo.jpg'), S, S, albedo, 90);
  writeRgbaPng(
    path.join(TEX_DIR, 'floor_neon_asphalt_normal.png'),
    S,
    S,
    heightToNormalRgba(height, S, S, 2.35, puddleMask)
  );
  writeRgbaPng(path.join(TEX_DIR, 'floor_neon_asphalt_roughness.png'), S, S, roughRgba);
}

// ============================================================================
// 3. SECTOR 05: GLACIAL ECLIPSE CITADEL — 360° SKYBOX (1536x768)
// ============================================================================
function buildGlacialCitadelSkybox() {
  const W = 1536;
  const H = 768;
  const rgba = Buffer.alloc(W * H * 4);

  // Eclipse sun coordinates in equirectangular UV space (high dramatic rear-horizon elevation)
  const ecU = 0.5;
  const ecV = 0.255;

  for (let y = 0; y < H; y++) {
    const v = y / (H - 1);
    for (let x = 0; x < W; x++) {
      const u = x / W;

      // Sky gradient: deep cosmic midnight indigo zenith -> cold violet-glacial horizon
      const elev = clamp01((0.52 - v) / 0.52);
      const cloudN = fbmPeriodic(u, v * 1.8, 8, 5, 5, 201);
      let r = lerp(0.11, 0.025, Math.pow(elev, 0.65));
      let g = lerp(0.12, 0.032, Math.pow(elev, 0.72));
      let b = lerp(0.24, 0.095, Math.pow(elev, 0.68));

      if (v < 0.56) {
        // Crisp pinpoint sub-pixel starfield (zero blocky squares!)
        const sGridX = 160;
        const sGridY = 80;
        const gx = u * sGridX;
        const gy = v * sGridY;
        const sx = Math.floor(gx);
        const sy = Math.floor(gy);
        const starRoll = hash2(sx, sy, sGridX, sGridY, 211);
        if (starRoll > 0.84 && elev > 0.14) {
          const jx = 0.2 + 0.6 * hash2(sx, sy, sGridX, sGridY, 213);
          const jy = 0.2 + 0.6 * hash2(sx, sy, sGridX, sGridY, 215);
          const sd = Math.hypot((gx - sx) - jx, (gy - sy) - jy);
          const pin = Math.exp(-sd * sd * 85.0) * ((starRoll - 0.84) / 0.16) * elev * 1.15;
          r += pin * 0.85;
          g += pin * 0.94;
          b += pin * 1.15;
        }

        // Rippling Glacial Cyan & Violet Aurora Borealis Curtains
        const auroraWave = Math.sin(u * Math.PI * 4 + cloudN * 3.2) * 0.055 + Math.cos(u * Math.PI * 10) * 0.02;
        const auroraBand = Math.exp(-Math.pow((v - (0.31 + auroraWave)) * 12.0, 2));
        const auroraStreaks = 0.45 + 0.55 * fbmPeriodic(u * 3.0, v * 0.8, 12, 4, 3, 223);
        const auroraAmt = auroraBand * auroraStreaks * 0.52;
        const auMix = 0.5 + 0.5 * Math.sin(u * Math.PI * 6 + v * 9);
        r += auroraAmt * lerp(0.08, 0.55, auMix);
        g += auroraAmt * lerp(0.78, 0.22, auMix);
        b += auroraAmt * lerp(0.95, 0.88, auMix);

        // High-altitude frost cirrus wisps
        const wisp = smoothstep(0.48, 0.82, cloudN) * (1 - elev * 0.45) * 0.22;
        r += wisp * 0.48;
        g += wisp * 0.34;
        b += wisp * 0.65;

        // DRAMATIC CRIMSON-VIOLET TOTAL SOLAR ECLIPSE CORONA (true spherical circle at ecV!)
        let du = u - ecU;
        if (du > 0.5) du -= 1.0;
        if (du < -0.5) du += 1.0;
        const ecLatCos = Math.cos((0.5 - ecV) * Math.PI);
        const dx = du * 2.0 * ecLatCos;
        const dy = v - ecV;
        const dist = Math.hypot(dx, dy);
        const ang = Math.atan2(dy, dx);
        const discR = 0.048;

        // Wide atmospheric crimson-violet sky glow around the eclipse
        const wideGlow = Math.exp(-dist * 5.2) * 0.58;
        r += wideGlow * 0.88;
        g += wideGlow * 0.16;
        b += wideGlow * 0.58;

        // Sharp radial corona streamers & fiery magenta-crimson ring
        const rays = 0.62 + 0.38 * Math.pow(0.5 + 0.5 * Math.sin(ang * 16 + cloudN * 3.6), 2.0);
        const corona = Math.exp(-Math.max(0, dist - discR) * 21.0) * rays;
        const rimRing = Math.exp(-Math.pow((dist - discR * 1.03) * 105.0, 2));

        r += corona * 1.2 + rimRing * 1.55;
        g += corona * 0.22 + rimRing * 0.48;
        b += corona * 0.78 + rimRing * 1.15;

        // Diamond-ring flare on upper-right edge of eclipse disc
        const flareDist = Math.hypot(dx - discR * 0.72, dy + discR * 0.69);
        const diamond = Math.exp(-flareDist * 48.0);
        r += diamond * 1.45;
        g += diamond * 0.98;
        b += diamond * 1.35;

        // Jet-black obsidian moon core occulting the sun
        if (dist < discR) {
          const edgeSoft = smoothstep(discR * 0.88, discR, dist);
          r = lerp(0.010, r, edgeSoft);
          g = lerp(0.008, g, edgeSoft);
          b = lerp(0.024, b, edgeSoft);
        }
      }

      // 360° Sharp Jagged Ridged-Multifractal Snow-Capped Obsidian Glacier Peaks
      const ridged = (uu, freq, seed) => {
        let sum = 0;
        let amp = 0.55;
        let f = freq;
        let norm = 0;
        for (let o = 0; o < 5; o++) {
          const n = periodicNoise(uu, 0.25, f, 2, seed + o * 13);
          const ridge = 1.0 - Math.abs(n * 2.0 - 1.0);
          sum += ridge * ridge * amp;
          norm += amp;
          amp *= 0.48;
          f *= 2;
        }
        return sum / norm;
      };
      const peakA = ridged(u, 8, 241);
      const peakB = ridged(u + 0.27, 13, 257);
      const ridgeA = 0.515 - (0.03 + 0.165 * Math.pow(peakA, 1.45));
      const ridgeB = 0.525 - (0.015 + 0.105 * Math.pow(peakB, 1.35));

      if (v >= ridgeA && v < 0.72) {
        const slope = fbmPeriodic(u, v * 5.0, 28, 20, 4, 263);
        const dH = (ridged(u + 0.002, 8, 241) - peakA) * 35.0;
        const litFace = clamp01(0.45 + dH * 0.42);
        const snowLine = smoothstep(0.085, 0.0, v - ridgeA) * (0.45 + 0.55 * slope);
        const farMist = smoothstep(0.49, 0.62, v);
        let mr = lerp(0.05, 0.42, snowLine * litFace) + 0.10 * Math.exp(-Math.abs(u - ecU) * 4.5) * litFace;
        let mg = lerp(0.08, 0.60, snowLine * litFace);
        let mb = lerp(0.17, 0.82, snowLine * litFace);
        r = lerp(mr, 0.12, farMist * 0.72);
        g = lerp(mg, 0.22, farMist * 0.72);
        b = lerp(mb, 0.40, farMist * 0.72);
      }

      if (v >= ridgeB) {
        const slope = fbmPeriodic(u, v * 6.0, 36, 26, 4, 271);
        const dH = (ridged(u + 0.272, 13, 257) - peakB) * 32.0;
        const litFace = clamp01(0.4 + dH * 0.48);
        const snowCap = smoothstep(0.055, 0.0, v - ridgeB) * (0.42 + 0.58 * slope);
        const valleyDep = clamp01((v - 0.53) / 0.47);
        const mr = lerp(0.035, 0.52, snowCap * litFace);
        const mg = lerp(0.065, 0.78, snowCap * litFace);
        const mb = lerp(0.135, 0.96, snowCap * litFace);
        r = lerp(mr, 0.06, valleyDep * 0.88);
        g = lerp(mg, 0.13, valleyDep * 0.88);
        b = lerp(mb, 0.24, valleyDep * 0.88);
      }

      // Freezing cyan-violet horizon mist band
      const horizonFog = Math.exp(-Math.pow((v - 0.52) * 18, 2)) * 0.32;
      r += horizonFog * 0.22;
      g += horizonFog * 0.48;
      b += horizonFog * 0.74;

      setRgb(rgba, (y * W + x) * 4, r, g, b);
    }
  }

  writeJpgViaSystemDrawing(path.join(TEX_DIR, 'env_glacial_citadel_360.jpg'), W, H, rgba, 88);
}

// ============================================================================
// 4. SECTOR 05: CRACKED GLACIAL CRYSTAL ICE PBR MAPS (512x512)
// ============================================================================
function buildGlacialIceFloorMaps() {
  const S = 512;
  const albedo = Buffer.alloc(S * S * 4);
  const roughRgba = Buffer.alloc(S * S * 4);
  const height = new Float32Array(S * S);

  for (let y = 0; y < S; y++) {
    const v = y / S;
    for (let x = 0; x < S; x++) {
      const u = x / S;
      const idxPix = y * S + x;

      // Domain-warped organic glacier fracture veins (looks like real natural thick lake ice!)
      const warpX = (fbmPeriodic(u, v, 6, 6, 4, 301) - 0.5) * 0.095;
      const warpY = (fbmPeriodic(u + 0.4, v + 0.7, 6, 6, 4, 305) - 0.5) * 0.095;
      const wu = (u + warpX + 1) % 1;
      const wv = (v + warpY + 1) % 1;

      const bigVor = voronoiPeriodic(wu, wv, 4, 307);
      const subVor = voronoiPeriodic(wu, wv, 10, 313);
      const deepVor = voronoiPeriodic((u - warpX * 0.6 + 1) % 1, (v - warpY * 0.6 + 1) % 1, 6, 319);
      const frost = fbmPeriodic(u, v, 10, 10, 5, 317);
      const fine = fbmPeriodic(u, v, 36, 36, 3, 331);

      const mainCrack = smoothstep(0.036, 0.004, bigVor.edge);
      const fineCrack = smoothstep(0.022, 0.003, subVor.edge) * 0.68;
      // Parallax-offset deeper internal glacier crack for realistic ice thickness!
      const deepCrack = smoothstep(0.030, 0.005, deepVor.edge) * 0.35;
      const frostDrift = smoothstep(0.54, 0.80, frost) * (0.45 + 0.55 * fine);

      // Height: mostly mirror-smooth thick ice sheet carved by sharp stress fissures
      const h = clamp01(0.66 + (frost - 0.5) * 0.16 + (fine - 0.5) * 0.07 - mainCrack * 0.46 - fineCrack * 0.20);
      height[idxPix] = h;

      // Continuous deep sapphire-obsidian glacier ice with subsurface cyan-indigo variation
      const iceTone = clamp01(0.28 + frost * 0.45 + (bigVor.cellId - 0.5) * 0.14);
      let r = lerp(0.10, 0.30, iceTone);
      let g = lerp(0.24, 0.56, iceTone);
      let b = lerp(0.42, 0.78, iceTone);

      // Faint deep submerged cyan crack layer
      r = lerp(r, 0.45, deepCrack);
      g = lerp(g, 0.78, deepCrack);
      b = lerp(b, 0.96, deepCrack);

      // Sharp crystalline white-cyan surface fracture lines
      const crackAmt = clamp01(mainCrack * 0.92 + fineCrack * 0.55);
      r = lerp(r, 0.86, crackAmt * 0.82);
      g = lerp(g, 0.96, crackAmt * 0.86);
      b = lerp(b, 1.00, crackAmt * 0.90);

      // Wind-swept matte frost & powder snow drifting across surface pockets
      r = lerp(r, 0.84, frostDrift * 0.58);
      g = lerp(g, 0.93, frostDrift * 0.60);
      b = lerp(b, 0.99, frostDrift * 0.62);

      setRgb(albedo, idxPix * 4, r, g, b);

      // Roughness: Mirror-slick clear ice (~0.10-0.22) vs frosted snow & jagged crack edges (~0.78-0.90)
      const roughVal = clamp01(lerp(0.11 + fine * 0.12, 0.88, clamp01(mainCrack * 0.95 + fineCrack * 0.5 + frostDrift * 0.85)));
      const rByte = Math.max(24, Math.min(244, Math.round(roughVal * 255)));
      const idx = idxPix * 4;
      roughRgba[idx] = rByte;
      roughRgba[idx + 1] = rByte;
      roughRgba[idx + 2] = rByte;
      roughRgba[idx + 3] = 255;
    }
  }

  writeJpgViaSystemDrawing(path.join(TEX_DIR, 'floor_glacial_ice_albedo.jpg'), S, S, albedo, 90);
  writeRgbaPng(
    path.join(TEX_DIR, 'floor_glacial_ice_normal.png'),
    S,
    S,
    heightToNormalRgba(height, S, S, 2.55)
  );
  writeRgbaPng(path.join(TEX_DIR, 'floor_glacial_ice_roughness.png'), S, S, roughRgba);
}

console.log('Generating Sector 04 (Neon Rain District) & Sector 05 (Glacial Eclipse Citadel) textures...');
buildNeonDistrictSkybox();
buildNeonAsphaltFloorMaps();
buildGlacialCitadelSkybox();
buildGlacialIceFloorMaps();
console.log('\nPaket B arena skyboxes & PBR floor maps complete!');
