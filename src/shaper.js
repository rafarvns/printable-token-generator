const sharp = require('sharp');
const fetch = require('node-fetch');
const config = require('../config.json');
const fsp = require('fs').promises;
const path = require('path');

const ringCache = new Map();
let cachedRingPaths = null;

/**
 * Sorteia um item de um array
 */
function getRandomItem(array) {
  if (!array || array.length === 0) return null;
  return array[Math.floor(Math.random() * array.length)];
}

/**
 * Cria uma máscara circular para o recorte
 */
function createCircleMask(size) {
  const r = size / 2;
  return Buffer.from(
    `<svg width="${size}" height="${size}">
      <circle cx="${r}" cy="${r}" r="${r}" fill="white" />
    </svg>`
  );
}

/**
 * Cria um anel simples colorido via SVG
 */
function createSimpleRing(size, color) {
  const r = size / 2;
  const ringsConf = config.TOKEN_RINGS || {};
  const strokePercent = parseFloat(ringsConf.STROKE_PERCENT || 0.05);
  const strokeWidth = Math.max(2, Math.round(size * strokePercent));
  const rRing = r - (strokeWidth / 2);
  
  return Buffer.from(
    `<svg width="${size}" height="${size}">
      <circle cx="${r}" cy="${r}" r="${rRing}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" />
    </svg>`
  );
}

/**
 * Obtém o buffer da imagem do anel (local ou remoto)
 */
async function getRingBuffer(pathOrUrl, size) {
  const cacheKey = `${pathOrUrl}_${size}`;
  if (ringCache.has(cacheKey)) {
    return ringCache.get(cacheKey);
  }

  let buffer;
  try {
    if (pathOrUrl.startsWith('http')) {
      const res = await fetch(pathOrUrl);
      if (res.ok) buffer = await res.buffer();
    } else {
      const fs = require('fs').promises;
      const absolutePath = require('path').isAbsolute(pathOrUrl) 
        ? pathOrUrl 
        : require('path').join(process.cwd(), pathOrUrl);
      buffer = await fs.readFile(absolutePath);
    }

    if (buffer) {
      // Redimensiona o anel para o tamanho EXATO do token
      const resized = await sharp(buffer)
        .resize(size, size, { 
            fit: 'fill',
            ignoreAspectRatio: true 
        })
        .png()
        .toBuffer();
      ringCache.set(cacheKey, resized);
      return resized;
    }
  } catch (e) {
    console.warn(`Erro ao carregar anel ${pathOrUrl}: ${e.message}`);
  }
  return null;
}

/**
 * Aplica o formato circular e o anel ao buffer da imagem
 */
async function getAvailableRings() {
  const ringsConf = config.TOKEN_RINGS || {};
  if (cachedRingPaths !== null) return cachedRingPaths;

  if (ringsConf.USE_FROM_RINGS_FOLDER) {
    try {
      const ringsDir = path.join(process.cwd(), 'rings');
      const files = await fsp.readdir(ringsDir);
      cachedRingPaths = files
        .filter(f => f.toLowerCase().endsWith('.png'))
        .map(f => path.join(ringsDir, f));
    } catch (e) {
      cachedRingPaths = [];
    }
  } else {
    cachedRingPaths = ringsConf.PATHS || [];
  }
  return cachedRingPaths;
}

/**
 * Aplica o formato circular e o anel ao buffer da imagem
 */
async function applyTokenRing(imageBuffer, size) {
  const ringsConf = config.TOKEN_RINGS || {};
  if (!ringsConf.ENABLED) return imageBuffer;

  try {
    // 1. Recorta a imagem base em círculo
    const mask = createCircleMask(size);
    let processed = await sharp(imageBuffer)
      .resize(size, size, { fit: 'cover' })
      .composite([{ input: mask, blend: 'dest-in' }])
      .png()
      .toBuffer();

    // 2. Decide qual anel usar
    let ringOverlay;
    const availablePaths = await getAvailableRings();
    const ringPath = getRandomItem(availablePaths);

    if (ringPath) {
      ringOverlay = await getRingBuffer(ringPath, size);
    }

    // Se não tem imagem de anel ou falhou, usa anel colorido simples
    if (!ringOverlay) {
      const color = getRandomItem(ringsConf.COLORS) || 'black';
      ringOverlay = createSimpleRing(size, color);
    }

    // 3. Aplica o anel sobre a imagem circular
    return await sharp(processed)
      .composite([{ input: ringOverlay }])
      .png()
      .toBuffer();

  } catch (err) {
    console.error('Erro ao aplicar anel de token:', err);
    return imageBuffer;
  }
}

module.exports = {
  applyTokenRing
};
