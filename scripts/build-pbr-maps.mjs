/**
 * Pure Node.js PBR Normal & Roughness Map Generator (Zero External Dependencies).
 * Generates seamless tileable Tokusatsu live-action micro-surface maps and
 * Sobel-derived Normal/Roughness maps from the photographic concrete arena albedo.
 */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const TEX_DIR = path.resolve(process.cwd(), 'public/assets/textures');
fs.mkdirSync(TEX_DIR, { recursive: true });

// ---- Pure Node RGBA PNG Encoder (CRC32 + zlib.deflateSync) ----
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
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
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter None
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
  console.log(`[TEX] ${path.basename(filePath).padEnd(32)} | ${width}x${height} | ${(png.length / 1024).toFixed(1)} KB`);
}

function heightToNormalRgba(heightField, width, height, strength = 2.6) {
  const out = Buffer.alloc(width * height * 4);
  const sample = (x, y) => {
    const wx = ((x % width) + width) % width;
    const wy = ((y % height) + height) % height;
    return heightField[wy * width + wx];
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      // 3x3 Sobel operator (seamless wrapping)
      const tl = sample(x - 1, y - 1);
      const t = sample(x, y - 1);
      const tr = sample(x + 1, y - 1);
      const l = sample(x - 1, y);
      const r = sample(x + 1, y);
      const bl = sample(x - 1, y + 1);
      const b = sample(x, y + 1);
      const br = sample(x + 1, y + 1);

      const dx = (tr + 2 * r + br - (tl + 2 * l + bl)) * strength;
      const dy = (bl + 2 * b + br - (tl + 2 * t + tr)) * strength;
      const dz = 1.0;
      const invLen = 1 / Math.hypot(dx, dy, dz);

      const idx = (y * width + x) * 4;
      out[idx] = Math.max(0, Math.min(255, Math.round((-dx * invLen * 0.5 + 0.5) * 255)));
      out[idx + 1] = Math.max(0, Math.min(255, Math.round((-dy * invLen * 0.5 + 0.5) * 255)));
      out[idx + 2] = Math.max(0, Math.min(255, Math.round((dz * invLen * 0.5 + 0.5) * 255)));
      out[idx + 3] = 255;
    }
  }
  return out;
}

// Fast deterministic periodic hash noise for seamless tileable maps
function hash2(ix, iy, period) {
  const x = ((ix % period) + period) % period;
  const y = ((iy % period) + period) % period;
  let n = Math.imul(x, 374761393) + Math.imul(y, 668265263);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  return ((n ^ (n >>> 16)) >>> 0) / 4294967295;
}

function periodicNoise(u, v, freq) {
  const x = u * freq;
  const y = v * freq;
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  const a = hash2(ix, iy, freq);
  const b = hash2(ix + 1, iy, freq);
  const c = hash2(ix, iy + 1, freq);
  const d = hash2(ix + 1, iy + 1, freq);
  return (a * (1 - sx) + b * sx) * (1 - sy) + (c * (1 - sx) + d * sx) * sy;
}

function fbmPeriodic(u, v, baseFreq = 8, octaves = 4) {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  let freq = baseFreq;
  for (let o = 0; o < octaves; o++) {
    sum += periodicNoise(u, v, freq) * amp;
    norm += amp;
    amp *= 0.5;
    freq *= 2;
  }
  return sum / norm;
}

// 1. Ribbed Neoprene / Leather Kamen Rider Undersuit Normal Map (256x256)
function buildUndersuitNormal() {
  const size = 256;
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    const rib = Math.sin(v * Math.PI * 2 * 24) * 0.5 + 0.5;
    const sharpRib = Math.pow(rib, 0.72);
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const microWeave = Math.sin((u * 48 + v * 48) * Math.PI * 2) * 0.08;
      const grain = (fbmPeriodic(u, v, 16, 3) - 0.5) * 0.12;
      h[y * size + x] = sharpRib * 0.75 + microWeave + grain;
    }
  }
  writeRgbaPng(path.join(TEX_DIR, 'undersuit_ribbed_normal.png'), size, size, heightToNormalRgba(h, size, size, 2.8));
}

// 2. Hexagonal Insectoid Compound-Eye Normal Map (256x256)
function buildCompoundEyeNormal() {
  const size = 256;
  const h = new Float32Array(size * size);
  const cols = 18;
  const rows = 16;

  for (let y = 0; y < size; y++) {
    const v = (y / size) * rows;
    for (let x = 0; x < size; x++) {
      const u = (x / size) * cols;
      let minDistSq = 99;
      const baseRow = Math.floor(v);
      const baseCol = Math.floor(u);

      for (let dr = -1; dr <= 1; dr++) {
        const rr = baseRow + dr;
        const offset = (rr & 1) ? 0.5 : 0.0;
        for (let dc = -1; dc <= 1; dc++) {
          const cx = baseCol + dc + offset;
          const cy = rr + 0.5;
          const dx = u - cx;
          const dy = (v - cy) * 1.12;
          const d2 = dx * dx + dy * dy;
          if (d2 < minDistSq) minDistSq = d2;
        }
      }

      // Convex micro-lens dome inside each hexagonal facet cell
      const dome = Math.max(0, 1 - minDistSq * 3.4);
      h[y * size + x] = Math.sqrt(dome);
    }
  }
  writeRgbaPng(path.join(TEX_DIR, 'compound_eye_hex_normal.png'), size, size, heightToNormalRgba(h, size, size, 3.6));
}

// 3. Brushed Metallic-Fiberglass Clearcoat Roughness Map (256x256)
function buildArmorWearRoughness() {
  const size = 256;
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const brush = periodicNoise(u, v * 0.25, 32) * 0.25 + fbmPeriodic(u, v, 8, 3) * 0.75;
      // Smooth painted clearcoat base (~0.22–0.38 roughness range)
      const val = Math.max(45, Math.min(130, Math.round(52 + brush * 68)));
      const idx = (y * size + x) * 4;
      out[idx] = val;
      out[idx + 1] = val;
      out[idx + 2] = val;
      out[idx + 3] = 255;
    }
  }
  writeRgbaPng(path.join(TEX_DIR, 'armor_wear_roughness.png'), size, size, out);
}

// 4. Organic Chitin / Scarred Toei Rubber-Suit Monster Normal Map (256x256)
function buildKaijinChitinNormal() {
  const size = 256;
  const h = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    const v = y / size;
    for (let x = 0; x < size; x++) {
      const u = x / size;
      const n1 = fbmPeriodic(u, v, 10, 4);
      const ridge = 1 - Math.abs(n1 * 2 - 1);
      const pores = fbmPeriodic(u, v, 24, 3);
      h[y * size + x] = ridge * ridge * 0.72 + pores * 0.28;
    }
  }
  writeRgbaPng(path.join(TEX_DIR, 'kaijin_chitin_normal.png'), size, size, heightToNormalRgba(h, size, size, 3.4));
}

// 5. Floor Concrete Normal & Roughness Maps (512x512)
// Uses raw pixel-aligned luminance extracted from photographic floor_concrete_albedo.jpg if present,
// otherwise synthesizes high-detail weathered concrete slabs + cracks + aggregate!
function buildConcreteFloorMaps() {
  const size = 512;
  const rawHeightPath = path.join(TEX_DIR, '.floor_height_512.raw');
  const h = new Float32Array(size * size);

  if (fs.existsSync(rawHeightPath)) {
    const rawBuf = fs.readFileSync(rawHeightPath);
    for (let i = 0; i < size * size; i++) {
      h[i] = (rawBuf[i] ?? 128) / 255;
    }
    fs.unlinkSync(rawHeightPath);
    console.log('[TEX] Derived floor normal & roughness directly from photographic floor_concrete_albedo.jpg!');
  } else {
    for (let y = 0; y < size; y++) {
      const v = y / size;
      for (let x = 0; x < size; x++) {
        const u = x / size;
        const grain = fbmPeriodic(u, v, 12, 5);
        const fine = fbmPeriodic(u, v, 48, 3);
        const crackNoise = Math.abs(fbmPeriodic(u, v, 6, 4) - 0.5);
        const crack = crackNoise < 0.018 ? -0.35 * (1 - crackNoise / 0.018) : 0;
        const seamX = Math.abs((u * 2) % 1 - 0.5) > 0.492 ? -0.25 : 0;
        const seamY = Math.abs((v * 2) % 1 - 0.5) > 0.492 ? -0.25 : 0;
        h[y * size + x] = Math.max(0, Math.min(1, 0.55 + (grain - 0.5) * 0.45 + (fine - 0.5) * 0.25 + crack + seamX + seamY));
      }
    }
  }

  writeRgbaPng(
    path.join(TEX_DIR, 'floor_concrete_normal.png'),
    size,
    size,
    heightToNormalRgba(h, size, size, 2.2)
  );

  // Roughness map: dusty crevices & cracks = high roughness (matte), worn polished slab centers = medium-low roughness (subtle sunlight glint!)
  const roughRgba = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const heightVal = h[i];
    const rough = Math.max(135, Math.min(248, Math.round(242 - heightVal * 95)));
    const idx = i * 4;
    roughRgba[idx] = rough;
    roughRgba[idx + 1] = rough;
    roughRgba[idx + 2] = rough;
    roughRgba[idx + 3] = 255;
  }
  writeRgbaPng(path.join(TEX_DIR, 'floor_concrete_roughness.png'), size, size, roughRgba);
}

buildUndersuitNormal();
buildCompoundEyeNormal();
buildArmorWearRoughness();
buildKaijinChitinNormal();
buildConcreteFloorMaps();
console.log('\nAll Phase 4.5 PBR normal & roughness maps generated successfully.');
