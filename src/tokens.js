const path = require('path');
const fetch = require('node-fetch');
const sharp = require('sharp');
const fsp = require('fs').promises;
const { TOKEN_IMAGES_5ETOOLS_DIR } = require('./paths');
const { fileExists } = require('./fs');
const { applyTokenRing } = require('./shaper');
const config = require('../config.json');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const ENABLE_DOWNLOADS = config.DOWNLOAD_SETTINGS?.ENABLE_DOWNLOADS === true;
const DOWNLOAD_DELAY_MS = config.DOWNLOAD_SETTINGS?.DELAY_MS !== undefined ? config.DOWNLOAD_SETTINGS.DELAY_MS : 200;

function parseGithubUrl(urlStr) {
  let rawRepoUrl = (urlStr || '').trim().replace(/\/$/, '');
  if (rawRepoUrl.includes('github.com')) {
    rawRepoUrl = rawRepoUrl.replace('github.com', 'raw.githubusercontent.com')
                           .replace('/tree/', '/')
                           .replace('/blob/', '/'); // Trata caso o usuário cole link de um arquivo exato
    const parts = rawRepoUrl.split('/');
    if (parts.length === 5) {
      rawRepoUrl += '/main';
    }
  }
  return rawRepoUrl;
}

const GITHUB_REPO = parseGithubUrl(config.DOWNLOAD_SETTINGS?.GITHUB_SRC_REPOSITORY);
const GITHUB_IMG_REPO = parseGithubUrl(config.DOWNLOAD_SETTINGS?.GITHUB_IMG_REPOSITORY);

/**
 * Gera uma lista dinâmica de mirrors (1 até 20)
 * Se o usuário definir o repositório customizado, usamos EXCLUSIVAMENTE ELE (sem fallback).
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
  if (s === 't' || s === 's' || s === 'tiny' || s === 'small') return 'pequenas';
  if (s === 'm' || s === 'medium') return 'medias';
  if (s === 'l' || s === 'large') return 'grandes';
  if (s === 'h' || s === 'g' || s === 'huge' || s === 'gargantuan') return 'gigantes';
  return 'pequenas';
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
    console.log('[DEBUG] Download de tokens desativado (ENABLE_DOWNLOADS=false)');
    return [];
  }

  let data = null;
  let successUrl = '';

  for (const mirrorBase of MIRRORS) {
    const fullUrl = `${mirrorBase}/${bookUrl}`;
    try {
      const res = await fetch(fullUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      if (res.ok) {
        data = await res.json();
        successUrl = fullUrl;
        break;
      }
    } catch (e) {
      // Ignora erro e tenta o próximo mirror
    }
  }

  if (!data) {
    console.error(`Erro: Não foi possível encontrar o livro ${bookUrl} em nenhum dos mirrors (${MIRRORS.join(', ')})`);
    return [];
  }

  console.log(`Dados carregados com sucesso de: ${successUrl}`);
  const monsters = data.monster || [];
  console.log(`Encontrados ${monsters.length} monstros no livro.`);

  const downloaded = [];
  let processed = 0;

  for (const monster of monsters) {
    if (processed >= limit) break;
    
    // No 5etools, se não tem hasToken: true, passamos para o próximo
    if (!monster.hasToken) continue;

    processed++;
    const name = monster.name;
    const size = Array.isArray(monster.size) ? monster.size[0] : monster.size;
    const cr = parseCr(monster.cr);
    const source = (monster.source || bookSource).toUpperCase();
    
    const folder = ddSizeToFolder(size);
    const safeFileName = name.replace(/[^A-Za-z0-9-_ ]+/g, '').replace(/\s+/g, '_');
    const outFileName = `${bookSource}_${safeFileName}.png`;
    const outPath = path.join(TOKEN_IMAGES_5ETOOLS_DIR, outFileName);

    if (await fileExists(outPath)) {
      downloaded.push({ name, size, cr, folder, path: outPath, from5etools: true });
      continue;
    }

    // Delay para evitar Rate Limiting / 429 Too Many Requests do Github/Cloudflare
    if (DOWNLOAD_DELAY_MS > 0 && processed > 1) {
      await sleep(DOWNLOAD_DELAY_MS);
    }

    process.stdout.write(`Baixando: ${name} [${size}] CR:${cr} ... `);

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
        console.log(`erro no download do token (${tokenRes ? tokenRes.statusText : 'Falha na rede'})`);
        continue;
      }

      const webpBuf = await tokenRes.buffer();
      const targetPixelSize = getTokenPixelSize(size);

      // Processar imagem (converter webp -> png, resize, anel)
      let processedBuf = await sharp(webpBuf)
        .resize(targetPixelSize, targetPixelSize, { fit: 'cover', position: 'center' })
        .png()
        .toBuffer();

      processedBuf = await applyTokenRing(processedBuf, targetPixelSize);

      await fsp.writeFile(outPath, processedBuf);
      console.log(`salvo no cache!`);
      downloaded.push({ name, size, cr, folder, path: outPath, from5etools: true });

    } catch (err) {
      console.log(`falha (${err.message})`);
    }
  }

  return downloaded;
}

module.exports = {
  downloadTokensFromBook
};