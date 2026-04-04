const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const PDFDocument = require('pdfkit');
const sharp = require('sharp');
const paths = require('./paths');
const { copiesForCR } = require('./utils');
const { overlayLabelOnImageBuffer } = require('./image');

// PDF constants
const config = require('../config.json');
const CM_TO_PT = 72 / 2.54;
const PAGE_SIZE = 'A4';
const PAGE_WIDTH_PT = 595.28;
const PAGE_HEIGHT_PT = 841.89;
const MARGIN_PT = 28.35;
const GAP_PT = 5;

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
    const copies = copiesForCR(item.cr);
    const targetGroups = item.fromApi ? apiGroups : randomGroups;
    
    for (let i = 0; i < copies; i++) {
      targetGroups[bucket].push(item);
    }
  }
  return { apiGroups, randomGroups };
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
    let x = MARGIN_PT;
    let y = MARGIN_PT;
    const maxX = PAGE_WIDTH_PT - MARGIN_PT;
    const maxY = PAGE_HEIGHT_PT - MARGIN_PT;

    (async () => {
      for (let i = 0; i < items.length; i++) {
        const item = items[i];

        // wrap linha
        if (x + tokenSizePt > maxX) {
          x = MARGIN_PT;
          y += tokenSizePt + GAP_PT;
        }
        // nova página
        if (y + tokenSizePt > maxY) {
          doc.addPage();
          x = MARGIN_PT;
          y = MARGIN_PT;
        }
        try {
          // sempre use o basePx do bucket
          const standardPx = spec.basePx;

          // carrega / resiza e força density 72 para uniformizar
          let buf = bufferCache.get(item.path);
          if (!buf) {
            buf = await sharp(item.path)
                .resize(standardPx, standardPx, {
                  fit: 'cover',
                  position: 'center'
                })
                .extract({ left: 0, top: 0, width: standardPx, height: standardPx })
                .png()
                .withMetadata({ density: 72 })
                .toBuffer();
            bufferCache.set(item.path, buf);
          }

          let renderBuf = buf;
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
          }

          // garante dimensão fixa no PDF (pt) para o bucket
          doc.image(renderBuf, x, y, {
            width: tokenSizePt,
            height: tokenSizePt
          });
        } catch (e) {
          // ignora imagem inválida, mas imprima se quiser debugar
          // console.error('Erro ao processar imagem:', item.path, e);
        }
        x += tokenSizePt + GAP_PT;
      }
      doc.end();
    })().catch(err => {
      try { doc.end(); } catch {}
      reject(err);
    });

    stream.on('finish', resolve);
    stream.on('error', reject);
  });

  console.log(`PDF created: ${pdfPath}`);
  return pdfPath;
}

async function generatePdfs(downloaded) {
  const { apiGroups, randomGroups } = groupForPdfs(downloaded);

  const created = [];
  
  // Generate PDFs for API tokens (5etools folder)
  for (const [key, spec] of Object.entries(BUCKET_SPECS)) {
    const items = apiGroups[key] || [];
    if (items.length > 0) {
      const pdf = await createPdfForGroup(items, spec, key, paths.OUT_5ETOOLS_PDF_DIR);
      if (pdf) created.push(pdf);
    }
  }
  
  // Generate PDFs for random tokens (yours folder)
  for (const [key, spec] of Object.entries(BUCKET_SPECS)) {
    const items = randomGroups[key] || [];
    if (items.length > 0) {
      const pdf = await createPdfForGroup(items, spec, key, paths.OUT_YOURS_PDF_DIR);
      if (pdf) created.push(pdf);
    }
  }
  
  return created;
}

module.exports = {
  BUCKET_SPECS,
  generatePdfs,
};