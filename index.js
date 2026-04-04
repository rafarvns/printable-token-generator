// ── pkg executable fix ────────────────────────────────────────────────────────
// When bundled by pkg, __dirname is a virtual snapshot path. Sharp needs its
// native .node addon to live on the real filesystem (next to the exe).
// We resolve the actual executable directory and point sharp there.
if (process.pkg) {
  const path = require('path');
  const exeDir = path.dirname(process.execPath);
  process.env.SHARP_IGNORE_GLOBAL_LIBVIPS = '1';
  // Tell Node where to look for the native addon
  process.env.PATH = `${path.join(exeDir, 'sharp', 'build', 'Release')}${require('path').delimiter}${process.env.PATH || ''}`;
}
// ─────────────────────────────────────────────────────────────────────────────

const config = require('./config.json');
const inquirer = require('inquirer');
const fs = require('fs');
const { ensureDirs, clearPdfOutput, scanExistingImages } = require('./src/fs');
const { downloadTokensFromBook } = require('./src/tokens');
const { generatePdfs } = require('./src/pdf');

async function main() {
  await ensureDirs();

  const delFlag = String(config.PDF_SETTINGS?.DELETE_ON_START || '').toLowerCase();
  if (delFlag === 'true' || delFlag === '1' || delFlag === 'yes') {
    await clearPdfOutput();
    console.log('Existing PDFs removed due to DELETE_PDF_ON_START.');
  }

  let downloaded = [];

  // Se a funcionalidade de anéis estiver ligada, normalizamos as imagens pré-existentes nas pastas de output
  if (config.TOKEN_RINGS && config.TOKEN_RINGS.ENABLED === true) {
    console.log('\n[Normalizador] ENABLE_TOKEN_RINGS ativo. Padronizando imagens locais...');
    const { main: runImageNormalizer } = require('./src/image_normalizer');
    await runImageNormalizer();
    console.log('[Normalizador] Concluído.\n');
  }
  
  if (config.DOWNLOAD_SETTINGS && config.DOWNLOAD_SETTINGS.USE_5ETOOLS_TOKENS === true) {
    // 1. Carregar lista de livros
    const booksIndex = JSON.parse(fs.readFileSync('./src/books_index.json', 'utf8'));
    
    // 2. Preparar menu interativo com paginação (inquirer)
    const { selectedBookSource } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selectedBookSource',
        message: 'Selecione o livro da 5etools para baixar os tokens:',
        pageSize: 15,
        choices: booksIndex.map(b => ({
          name: `${b.name} (${b.source})`,
          value: b.source
        }))
      }
    ]);
    
    const selectedBook = booksIndex.find(b => b.source === selectedBookSource);
    console.log(`\nLivro selecionado: ${selectedBook.name}`);

    const limitEnv = config.TOKEN_LIMIT;
    const limit = limitEnv ? Number(limitEnv) : Infinity;

    // 3. Iniciar processo de download do livro específico
    downloaded = await downloadTokensFromBook(selectedBook.url, selectedBook.source, limit);
  }

  // Escanear disco em busca de tokens locais
  const existing = await scanExistingImages();
  const byPath = new Map();
  for (const it of downloaded) byPath.set(it.path, it);
  for (const it of existing) {
    if (!byPath.has(it.path)) byPath.set(it.path, it);
  }
  
  const allItems = Array.from(byPath.values());
  console.log(`\nResumo: ${allItems.length} imagens totais para o PDF (${downloaded.length} novas, ${existing.length} em disco).`);

  if (allItems.length > 0) {
    await generatePdfs(allItems);
  } else {
    console.log('Nenhum token encontrado para gerar o PDF.');
  }

  console.log('Fim do processo.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
