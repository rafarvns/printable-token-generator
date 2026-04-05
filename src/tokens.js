const path = require('path');
const fetch = require('node-fetch');
const sharp = global.loadSharp();
const fs = require('fs');
const fsp = require('fs').promises;
const { TOKEN_IMAGES_5ETOOLS_DIR } = require('./paths');
const { fileExists } = require('./fs');
const { applyTokenRing } = require('./shaper');
const config = require('./config_loader');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const ENABLE_DOWNLOADS = config.DOWNLOAD_SETTINGS?.ENABLE_DOWNLOADS === true;
const DOWNLOAD_DELAY_MS = config.DOWNLOAD_SETTINGS?.DELAY_MS !== undefined ? config.DOWNLOAD_SETTINGS.DELAY_MS : 200;

function parseGithubUrl(urlStr) {
  let rawRepoUrl = (urlStr || '').trim().replace(/\/$/, '');
  if (rawRepoUrl.includes('github.com')) {
    rawRepoUrl = rawRepoUrl.replace('github.com', 'raw.githubusercontent.com')
                           .replace('/tree/', '/')
                           .replace('/blob/', '/'); 
    
    // Split to find if branch is already there. 
    // raw.githubusercontent.com/user/repo/branch
    const parts = rawRepoUrl.split('/');
    if (parts.length === 5) {
      // Missing branch? Default to main
      rawRepoUrl += '/main';
    }
  }
  return rawRepoUrl;
}

const GITHUB_REPO = parseGithubUrl(config.DOWNLOAD_SETTINGS?.["5ETOOLS_GITHUB_SRC_REPOSITORY"] || config.DOWNLOAD_SETTINGS?.GITHUB_SRC_REPOSITORY);
const GITHUB_IMG_REPO = parseGithubUrl(config.DOWNLOAD_SETTINGS?.["5ETOOLS_GITHUB_IMG_REPOSITORY"] || config.DOWNLOAD_SETTINGS?.GITHUB_IMG_REPOSITORY);

/**
 * Se o usuário definir o repositório customizado, usamos ele como base.
 * Caso contrário, usamos mirrors padrão.
 */
const MIRRORS = GITHUB_REPO ? 
  [`${GITHUB_REPO}/data/bestiary`] : 
  [
    'https://raw.githubusercontent.com/5etools-mirror-3/5etools-src/main/data/bestiary',
    'https://raw.githubusercontent.com/5etools-mirror-2/5etools-src/main/data/bestiary',
    ...Array.from({ length: 20 }, (_, i) => i + 1)
      .filter(n => n !== 3 && n !== 2)
      .map(n => `https://raw.githubusercontent.com/5etools-mirror-${n}/5etools-src/main/data/bestiary`)
  ];
// URL base para as imagens (Tokens via site oficial)
const BASE_TOKEN_URL = 'https://5e.tools/img/bestiary/tokens';

function ddSizeToFolder(sizeStr) {
  const s = (sizeStr || '').toLowerCase();
  if (s === 't' || s === 's' || s === 'tiny' || s === 'small') return 'tiny-small';
  if (s === 'm' || s === 'medium') return 'medium';
  if (s === 'l' || s === 'large') return 'large';
  if (s === 'h' || s === 'g' || s === 'huge' || s === 'gargantuan') return 'huge-gargantuan';
  return 'tiny-small';
}

function getTokenPixelSize(sizeStr) {
  const s = (sizeStr || '').toLowerCase();
  if (s === 't' || s === 's' || s === 'tiny' || s === 'small') return parseInt(config.TOKEN_SIZES?.SMALL_PX) || 280;
  if (s === 'm' || s === 'medium') return parseInt(config.TOKEN_SIZES?.MEDIUM_PX) || 280;
  if (s === 'l' || s === 'large') return parseInt(config.TOKEN_SIZES?.LARGE_PX) || 560;
  if (s === 'h' || s === 'g' || s === 'huge' || s === 'gargantuan') return parseInt(config.TOKEN_SIZES?.HUGE_PX) || 560;
  return 280;
}

/**
 * Converte o formato de CR do 5etools para número ou string legível (ex: 1/8)
 */
function parseCr(crObj) {
  if (typeof crObj === 'string') return crObj;
  if (typeof crObj === 'number') return String(crObj);
  if (crObj && crObj.cr) return String(crObj.cr);
  return '0';
}

async function downloadTokensFromBook(bookUrl, bookSource, limit = Infinity) {
  if (!ENABLE_DOWNLOADS) {
    console.log('[INFO] Token download is disabled (ENABLE_DOWNLOADS=false)');
    return [];
  }

  let data = null;
  let successUrl = '';

  for (const mirrorBase of MIRRORS) {
    const fullUrl = `${mirrorBase}/${bookUrl}`;
    try {
      console.log(`[DEBUG] Trying mirror: ${fullUrl}`);
      const res = await fetch(fullUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (res.ok) {
        data = await res.json();
        successUrl = fullUrl;
        break;
      } else {
        console.log(`[DEBUG] Failed at ${fullUrl}: ${res.status} ${res.statusText}`);
      }
    } catch (e) {
      console.log(`[DEBUG] Network error at ${fullUrl}: ${e.message}`);
    }
  }

  if (!data) {
    console.error(`[ERROR] Could not find book ${bookUrl} in any mirrors.`);
    return [];
  }

  console.log(`[SUCCESS] Data loaded successfully from mirror.`);
  const monsters = data.monster || [];
  console.log(`[INFO] Found ${monsters.length} monsters in the book.`);

  const downloaded = [];
  let processed = 0;

  for (const monster of monsters) {
    if (processed >= limit) break;
    
    // No 5etools, se não tem hasToken: true, passamos para o próximo
    if (!monster.hasToken) continue;

    processed++;
    const name = monster.name;
    const size = Array.isArray(monster.size) ? monster.size[0] : monster.size;
    const rawCr = parseCr(monster.cr);
    const cr = rawCr.replace(/\s+/g, '').replace('/', '-'); // Limpar CR para ser path-safe
    const source = (monster.source || bookSource).toUpperCase();
    
    const folder = ddSizeToFolder(size);
    const safeFileName = name.replace(/[^A-Za-z0-9-_ ]+/g, '').replace(/\s+/g, '_');
    
    // Agora criamos: 5etools/[SOURCE]/[SIZE]/[CR]/[NAME].png
    const targetDir = path.join(TOKEN_IMAGES_5ETOOLS_DIR, source, folder, cr);
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    
    const outFileName = `${cr}_${safeFileName}.png`;
    const outPath = path.join(targetDir, outFileName);

    if (await fileExists(outPath)) {
      downloaded.push({ name, size, cr, folder, path: outPath, from5etools: true });
      continue;
    }

    // Delay para evitar Rate Limiting / 429 Too Many Requests do Github/Cloudflare
    if (DOWNLOAD_DELAY_MS > 0 && processed > 1) {
      await sleep(DOWNLOAD_DELAY_MS);
    }

    process.stdout.write(`[INFO] Downloading: ${name} [${size}] CR:${cr} ... `);

    // Preparar sufixo da URL
    const encodedName = encodeURIComponent(name);
    const apiTokenSuffix = `${source}/${encodedName}.webp`;
    
    let tokenRes = null;

    try {
      // Usa *apenas* o repositório de imgs se definido (sem fallback ao oficial)
      if (GITHUB_IMG_REPO) {
        // No repositório de imagens dedicado o path costuma ser /bestiary/tokens direto
        const gitTokenUrl = `${GITHUB_IMG_REPO}/bestiary/tokens/${apiTokenSuffix}`;
        tokenRes = await fetch(gitTokenUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      } else {
        // Usa o site original apenas se não tiver repo configurado
        const tokenUrl = `${BASE_TOKEN_URL}/${apiTokenSuffix}`;
        tokenRes = await fetch(tokenUrl, { 
          headers: { 
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Referer': 'https://5e.tools/bestiary.html'
          } 
        });
      }
      
      if (!tokenRes || !tokenRes.ok) {
        console.log(`FAILED (${tokenRes ? tokenRes.statusText : 'Network error'})`);
        continue;
      }

      const webpBuf = await tokenRes.buffer();
      const targetPixelSize = getTokenPixelSize(size);

      // Processar imagem (converter webp -> png, resize, anel)
      let sharpInstance = sharp(webpBuf)
        .resize(targetPixelSize, targetPixelSize, { fit: 'cover', position: 'center' });

      // Aplica ajustes de brilho e saturação (se diferentes de 1.0)
      const bright = parseFloat(config.IMAGE_ADJUSTMENTS?.BRIGHTNESS || 1.0);
      const sat = parseFloat(config.IMAGE_ADJUSTMENTS?.SATURATION || 1.0);
      
      if (bright !== 1.0 || sat !== 1.0) {
        sharpInstance = sharpInstance.modulate({
          brightness: bright,
          saturation: sat
        });
      }

      let processedBuf = await sharpInstance
        .png()
        .toBuffer();

      processedBuf = await applyTokenRing(processedBuf, targetPixelSize);

      await fsp.writeFile(outPath, processedBuf);
      console.log(`SUCCESS (saved to cache)`);
      downloaded.push({ name, size, cr, folder, path: outPath, from5etools: true });

    } catch (err) {
      console.log(`FAILED (${err.message})`);
    }
  }

  return downloaded;
}

module.exports = {
  downloadTokensFromBook
};