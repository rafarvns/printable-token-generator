// CR spectrum utilities and shared helpers
const config = require('./config_loader');

let SPECTRUM_CACHE = null;

function parseCRToNumber(cr) {
  if (cr == null) return NaN;
  if (typeof cr === 'number') return cr;
  const s = String(cr).trim();
  if (/^\d+\s*\/\s*\d+$/.test(s)) {
    const [a, b] = s.split('/').map(Number);
    return b ? a / b : NaN;
  }
  const n = Number(s);
  return isNaN(n) ? NaN : n;
}

function parseSpectrumEndpoint(str) {
  if (!str) return null;
  // Splits by comma, space or colon to be more flexible with user input (ex: "1/4, 6" or "20 1")
  const parts = String(str).split(/[,\s:]+/).filter(p => p.length > 0);
  if (parts.length !== 2) return null;
  const crNum = parseCRToNumber(parts[0].trim());
  const copiesNum = Number(parts[1].trim());
  if (isNaN(crNum) || !isFinite(crNum) || isNaN(copiesNum) || !isFinite(copiesNum)) return null;
  return { cr: crNum, copies: copiesNum };
}

function getSpectrumBounds() {
  if (SPECTRUM_CACHE) return SPECTRUM_CACHE;
  const defMin = { cr: parseCRToNumber('1/8'), copies: 6 };
  const defMax = { cr: 20, copies: 1 };
  const envMin = parseSpectrumEndpoint(config.PDF_SETTINGS?.CR_SPECTRUM_MIN);
  const envMax = parseSpectrumEndpoint(config.PDF_SETTINGS?.CR_SPECTRUM_MAX);
  let minEp = envMin || defMin;
  let maxEp = envMax || defMax;
  if (minEp.cr > maxEp.cr) {
    const tmp = minEp; minEp = maxEp; maxEp = tmp;
  }
  SPECTRUM_CACHE = { min: minEp, max: maxEp };
  return SPECTRUM_CACHE;
}

function copiesForCR(cr) {
  const n = parseCRToNumber(cr);
  if (isNaN(n)) return 1;
  const { min, max } = getSpectrumBounds();
  const minCR = min.cr;
  const maxCR = max.cr;
  const minCopies = min.copies;
  const maxCopies = max.copies;

  // Se o CR for maior ou igual ao máximo configurado, retorna o valor de cópias do endpoint máximo.
  // Isso garante que monstros de CR alto (ex: 20) continuem aparecendo se o máximo for menor (ex: 12).
  if (n >= maxCR) return Math.max(1, Math.round(maxCopies));
  if (n <= minCR) return Math.max(1, Math.round(minCopies));

  // Previne divisão por zero se o espectro configurado tiver mesmo CR no min e no max
  if (Math.abs(maxCR - minCR) < 0.0001) return Math.max(1, Math.round(maxCopies));

  const t = (n - minCR) / (maxCR - minCR);
  const copiesFloat = minCopies + t * (maxCopies - minCopies);
  const copies = Math.round(copiesFloat);

  const lo = Math.min(Math.round(minCopies), Math.round(maxCopies));
  const hi = Math.max(Math.round(minCopies), Math.round(maxCopies));
  return Math.max(1, Math.max(lo, Math.min(hi, copies)));
}

// Detecta sufixo de cópias no stem do arquivo (ex: "Goblin_x5" → 5, "Dragon x1" → 1)
// Retorna null se não houver sufixo.
function parseCopiesFromFilename(stem) {
  const match = stem.match(/[_\s]x(\d+)$/i);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return isNaN(n) || n < 1 ? null : n;
}

// Remove o sufixo de cópias do stem para obter o nome limpo.
function stripCopiesSuffix(stem) {
  return stem.replace(/[_\s]x\d+$/i, '');
}

module.exports = {
  parseCRToNumber,
  parseSpectrumEndpoint,
  getSpectrumBounds,
  copiesForCR,
  parseCopiesFromFilename,
  stripCopiesSuffix,
};