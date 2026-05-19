const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const PDFDocument = require('pdfkit');
const sharp = global.loadSharp();
const paths = require('./paths');
const { copiesForCR } = require('./utils');
const { overlayLabelOnImageBuffer } = require('./image');

// PDF constants
const config = require('./config_loader');
const CM_TO_PT = 72 / 2.54;
const MM_TO_PT = 72 / 25.4;
const PAGE_SIZE = 'A4';
const PAGE_WIDTH_PT = 595.28;
const PAGE_HEIGHT_PT = 841.89;
const MARGIN_MM = parseFloat(config.PDF_SETTINGS?.MARGIN_MM ?? 10);
const MARGIN_PT = MARGIN_MM * MM_TO_PT;
const GAP_PT = 5;

const BLEED_MM = parseFloat(config.PDF_SETTINGS?.BLEED_MM || 0);
const BLEED_PT = BLEED_MM * MM_TO_PT;
const BLEED_COLOR = config.PDF_SETTINGS?.BLEED_COLOR || '#1a1a1a';

// Converte in de configuração para uso interno (PDF pt/inch)
const TOKEN_SIZE_SMALL = parseFloat(config.TOKEN_SIZES?.SMALL_IN || 1.5);
const TOKEN_SIZE_MEDIUM = parseFloat(config.TOKEN_SIZES?.MEDIUM_IN || 2.5);
const TOKEN_SIZE_LARGE = parseFloat(config.TOKEN_SIZES?.LARGE_IN || 5.0);
const TOKEN_SIZE_HUGE = parseFloat(config.TOKEN_SIZES?.HUGE_IN || 8.5);

// Tamanhos de recorte via JS
const TOKEN_BASE_PX_SMALL = parseInt(config.TOKEN_SIZES?.SMALL_PX || 280);
const TOKEN_BASE_PX_MEDIUM = parseInt(config.TOKEN_SIZES?.MEDIUM_PX || 280);
const TOKEN_BASE_PX_LARGE = parseInt(config.TOKEN_SIZES?.LARGE_PX || 560);
const TOKEN_BASE_PX_HUGE = parseInt(config.TOKEN_SIZES?.HUGE_PX || 560);

const BUCKET_SPECS = {
  smallOrSmaller: { cm: TOKEN_SIZE_SMALL, basePx: TOKEN_BASE_PX_SMALL, folder: 'Tiny_Small', pdfName: 'tokens_small_or_smaller.pdf' },
  medium: { cm: TOKEN_SIZE_MEDIUM, basePx: TOKEN_BASE_PX_MEDIUM, folder: 'Medium', pdfName: 'tokens_medium.pdf' },
  large: { cm: TOKEN_SIZE_LARGE, basePx: TOKEN_BASE_PX_LARGE, folder: 'Large', pdfName: 'tokens_large.pdf' },
  hugePlus: { cm: TOKEN_SIZE_HUGE, basePx: TOKEN_BASE_PX_HUGE, folder: 'Huge_Gargantuan', pdfName: 'tokens_huge_plus.pdf' },
};

function sizeToBucket(sizeStr) {
  const s = String(sizeStr || '').trim().toLowerCase();
  if (s === 'tiny' || s === 'small') return 'smallOrSmaller';
  if (s === 'medium') return 'medium';
  if (s === 'large') return 'large';
  if (s === 'huge' || s === 'gargantuan') return 'hugePlus';
  return 'medium';
}

function groupForPdfs(downloaded) {
  const apiGroups = {
    smallOrSmaller: [],
    medium: [],
    large: [],
    hugePlus: [],
  };
  const randomGroups = {
    smallOrSmaller: [],
    medium: [],
    large: [],
    hugePlus: [],
  };
  
  for (const item of downloaded) {
    const bucket = sizeToBucket(item.size);
    const copies = item.forcedCopies != null ? item.forcedCopies : copiesForCR(item.cr);
    const targetGroups = item.fromApi ? apiGroups : randomGroups;
    
    for (let i = 0; i < copies; i++) {
      targetGroups[bucket].push(item);
    }
  }
  return { apiGroups, randomGroups };
}

// Carrega uma imagem garantindo que o resultado seja exatamente targetPx × targetPx.
// Se a imagem for MENOR que targetPx em qualquer dimensão, upscala antes de aplicar cover.
async function loadTokenBuffer(filePath, targetPx) {
  const meta = await sharp(filePath).metadata();
  const srcW = meta.width || 0;
  const srcH = meta.height || 0;

  let pipeline = sharp(filePath);

  if (srcW < targetPx || srcH < targetPx) {
    // Imagem menor que o alvo: upscala preservando conteúdo, depois cobre exatamente
    pipeline = pipeline.resize(targetPx, targetPx, {
      fit: 'contain',
      background: { r: 0, g: 0, b: 0, alpha: 0 },
      kernel: 'lanczos3',
      withoutEnlargement: false,
    });
  }

  // Resize final garante exatamente targetPx × targetPx
  return pipeline
    .resize(targetPx, targetPx, { fit: 'cover', position: 'center' })
    .png()
    .withMetadata({ density: 72 })
    .toBuffer();
}

async function applyBleedBorder(buf, tokenPx, bleedPx) {
  const totalPx = tokenPx + 2 * bleedPx;
  const r = totalPx / 2;
  const blackCircle = Buffer.from(
    `<svg width="${totalPx}" height="${totalPx}">
      <circle cx="${r}" cy="${r}" r="${r}" fill="${BLEED_COLOR}" />
    </svg>`
  );
  return await sharp({ create: { width: totalPx, height: totalPx, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: blackCircle },
      { input: buf, left: bleedPx, top: bleedPx }
    ])
    .png()
    .toBuffer();
}

async function createPdfForGroup(items, spec, bucketKey, subfolder = '') {
  const totalsByName = new Map();
  const seenByName = new Map();
  for (const it of items) {
    if (it && it.fromApi) {
      const key = it.name || '';
      totalsByName.set(key, (totalsByName.get(key) || 0) + 1);
    }
  }
  if (!items.length) return null;

  const doc = new PDFDocument({ size: PAGE_SIZE, margins: { top: MARGIN_PT, left: MARGIN_PT, right: MARGIN_PT, bottom: MARGIN_PT } });
  const pdfPath = path.join(subfolder, spec.pdfName);
  await new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(pdfPath);
    doc.pipe(stream);

    const bufferCache = new Map();

    // calculos por bucket - feitos uma vez
    const tokenSizePt = spec.cm * CM_TO_PT;
    const cellSizePt = tokenSizePt + 2 * BLEED_PT; // tamanho total da imagem (token + sangria)
    let x = MARGIN_PT;
    let y = MARGIN_PT;
    const maxX = PAGE_WIDTH_PT - MARGIN_PT;
    const maxY = PAGE_HEIGHT_PT - MARGIN_PT;

    (async () => {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        // wrap e paginação usam cellSizePt para a sangria não sobrepor o token seguinte
        if (x + cellSizePt > maxX) {
          x = MARGIN_PT;
          y += cellSizePt + GAP_PT;
        }
        if (y + cellSizePt > maxY) {
          doc.addPage();
          x = MARGIN_PT;
          y = MARGIN_PT;
        }
        try {
          // sempre use o basePx do bucket
          const standardPx = spec.basePx;
          const bleedPx = BLEED_PT > 0 ? Math.round(BLEED_PT / tokenSizePt * standardPx) : 0;

          let buf = bufferCache.get(item.path);
          if (!buf) {
            buf = await loadTokenBuffer(item.path, standardPx);
            bufferCache.set(item.path, buf);
          }

          let renderBuf = buf;
          let renderKey = item.path;
          if (item.fromApi) {
            const total = totalsByName.get(item.name || '') || 0;
            const idx = (seenByName.get(item.name || '') || 0) + 1;
            seenByName.set(item.name || '', idx);
            const counterText = total > 1 ? `${idx}` : null;

            const namePos = 'top-flat';
            const counterPos = 'bottom';
            const labeledKey = `${item.path}|${standardPx}|${item.name ?? ''}|${counterText ?? ''}|${namePos}|${counterPos}`;
            if (!bufferCache.has(labeledKey)) {
              // overlay usa o buffer já padronizado e o mesmo standardPx
              const labeled = await overlayLabelOnImageBuffer(buf, standardPx, item.name, counterText, { namePosition: namePos, counterPosition: counterPos });
              bufferCache.set(labeledKey, labeled);
            }
            renderBuf = bufferCache.get(labeledKey);
            renderKey = labeledKey;
          }

          if (bleedPx > 0) {
            const bleedKey = `${renderKey}|bleed${bleedPx}`;
            if (!bufferCache.has(bleedKey)) {
              bufferCache.set(bleedKey, await applyBleedBorder(renderBuf, standardPx, bleedPx));
            }
            renderBuf = bufferCache.get(bleedKey);
          }

          doc.image(renderBuf, x, y, {
            width: cellSizePt,
            height: cellSizePt
          });
        } catch (e) {
          // ignora imagem inválida, mas imprima se quiser debugar
          // console.error('Erro ao processar imagem:', item.path, e);
        }
        x += cellSizePt + GAP_PT;
      }
      doc.end();
    })().catch(err => {
      try { doc.end(); } catch {}
      reject(err);
    });

    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  console.log(`[SUCCESS] PDF created: ${pdfPath}`);
  return pdfPath;
}

async function generatePdfs(downloaded, customOutDir = null) {
  const { apiGroups, randomGroups } = groupForPdfs(downloaded);

  const created = [];
  
  // Determina a pasta de saída (customizada ou padrão)
  const getOutDir = (isApi) => {
    if (customOutDir) return customOutDir;
    return isApi ? paths.OUT_5ETOOLS_PDF_DIR : paths.OUT_YOURS_PDF_DIR;
  };

  // Generate PDFs for API tokens
  for (const [key, spec] of Object.entries(BUCKET_SPECS)) {
    const items = apiGroups[key] || [];
    if (items.length > 0) {
      const pdf = await createPdfForGroup(items, spec, key, getOutDir(true));
      if (pdf) created.push(pdf);
    }
  }
  
  // Generate PDFs for random tokens
  for (const [key, spec] of Object.entries(BUCKET_SPECS)) {
    const items = randomGroups[key] || [];
    if (items.length > 0) {
      const pdf = await createPdfForGroup(items, spec, key, getOutDir(false));
      if (pdf) created.push(pdf);
    }
  }
  
  return created;
}

const SIZE_ORDER = { small: 0, medium: 1, large: 2, huge: 3 };

async function generateSinglePdf(downloaded, outPath) {
  // Expande por cópias (forcedCopies tem prioridade sobre CR spectrum)
  const allItems = [];
  for (const item of downloaded) {
    const copies = item.forcedCopies != null ? item.forcedCopies : copiesForCR(item.cr);
    for (let i = 0; i < copies; i++) allItems.push(item);
  }
  if (!allItems.length) return null;

  // Ordena menor→maior para empacotar tokens pequenos juntos e aproveitar espaço
  allItems.sort((a, b) => (SIZE_ORDER[a.size] ?? 1) - (SIZE_ORDER[b.size] ?? 1));

  const totalsByName = new Map();
  const seenByName = new Map();
  for (const it of allItems) {
    if (it.fromApi) totalsByName.set(it.name || '', (totalsByName.get(it.name || '') || 0) + 1);
  }

  const doc = new PDFDocument({ size: PAGE_SIZE, margins: { top: MARGIN_PT, left: MARGIN_PT, right: MARGIN_PT, bottom: MARGIN_PT } });

  return new Promise((resolve, reject) => {
    const stream = fs.createWriteStream(outPath);
    doc.pipe(stream);

    const bufferCache = new Map();
    let x = MARGIN_PT;
    let y = MARGIN_PT;
    let rowHeight = 0;
    const maxX = PAGE_WIDTH_PT - MARGIN_PT;
    const maxY = PAGE_HEIGHT_PT - MARGIN_PT;

    (async () => {
      for (const item of allItems) {
        const spec = BUCKET_SPECS[sizeToBucket(item.size)];
        const tokenSizePt = spec.cm * CM_TO_PT;
        const cellSizePt = tokenSizePt + 2 * BLEED_PT;
        const standardPx = spec.basePx;
        const bleedPx = BLEED_PT > 0 ? Math.round(BLEED_PT / tokenSizePt * standardPx) : 0;

        // wrap de linha — usa cellSizePt para a sangria não sobrepor o token seguinte
        if (x + cellSizePt > maxX) {
          x = MARGIN_PT;
          y += rowHeight + GAP_PT;
          rowHeight = 0;
        }
        // nova página
        if (y + cellSizePt > maxY) {
          doc.addPage();
          x = MARGIN_PT;
          y = MARGIN_PT;
          rowHeight = 0;
        }

        try {
          let buf = bufferCache.get(item.path);
          if (!buf) {
            buf = await loadTokenBuffer(item.path, standardPx);
            bufferCache.set(item.path, buf);
          }

          let renderBuf = buf;
          let renderKey = item.path;
          if (item.fromApi) {
            const total = totalsByName.get(item.name || '') || 0;
            const idx = (seenByName.get(item.name || '') || 0) + 1;
            seenByName.set(item.name || '', idx);
            const counterText = total > 1 ? `${idx}` : null;
            const namePos = 'top-flat';
            const counterPos = 'bottom';
            const labeledKey = `${item.path}|${standardPx}|${item.name ?? ''}|${counterText ?? ''}|${namePos}|${counterPos}`;
            if (!bufferCache.has(labeledKey)) {
              bufferCache.set(labeledKey, await overlayLabelOnImageBuffer(buf, standardPx, item.name, counterText, { namePosition: namePos, counterPosition: counterPos }));
            }
            renderBuf = bufferCache.get(labeledKey);
            renderKey = labeledKey;
          }

          if (bleedPx > 0) {
            const bleedKey = `${renderKey}|bleed${bleedPx}`;
            if (!bufferCache.has(bleedKey)) {
              bufferCache.set(bleedKey, await applyBleedBorder(renderBuf, standardPx, bleedPx));
            }
            renderBuf = bufferCache.get(bleedKey);
          }

          doc.image(renderBuf, x, y, { width: cellSizePt, height: cellSizePt });
          rowHeight = Math.max(rowHeight, cellSizePt);
        } catch (e) {
          // ignora imagem inválida
        }

        x += cellSizePt + GAP_PT;
      }

      doc.end();
    })().catch(err => {
      try { doc.end(); } catch {}
      reject(err);
    });

    stream.on('finish', () => {
      console.log(`[SUCCESS] Single PDF created: ${outPath}`);
      resolve(outPath);
    });
    stream.on('error', reject);
  });
}

module.exports = {
  BUCKET_SPECS,
  generatePdfs,
  generateSinglePdf,
};