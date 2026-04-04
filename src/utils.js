// CR spectrum utilities and shared helpers
const config = require('../config.json');

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
  const parts = String(str).split(',');
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

  if (n <= minCR) return Math.round(minCopies);
  if (n >= maxCR) return Math.round(maxCopies);

  const t = (n - minCR) / (maxCR - minCR);
  const copiesFloat = minCopies + t * (maxCopies - minCopies);
  const copies = Math.round(copiesFloat);

  const lo = Math.min(Math.round(minCopies), Math.round(maxCopies));
  const hi = Math.max(Math.round(minCopies), Math.round(maxCopies));
  return Math.max(lo, Math.min(hi, copies));
}

module.exports = {
  parseCRToNumber,
  parseSpectrumEndpoint,
  getSpectrumBounds,
  copiesForCR,
};