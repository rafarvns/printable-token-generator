var fs = require('fs');
var path = require('path');

if (process.pkg) {
  const exeDir = path.dirname(process.execPath);
  process.env.SHARP_IGNORE_GLOBAL_LIBVIPS = '1';
  
  // 1. Fix DLL search path for Windows
  const vipsPaths = [
    path.join(exeDir, 'node_modules', '@img', 'sharp-win32-x64', 'lib'),
    path.join(exeDir, 'sharp', 'vendor', 'lib'),
  ];
  for (const vipsPath of vipsPaths) {
    if (fs.existsSync(vipsPath)) {
      process.env.PATH = `${vipsPath}${path.delimiter}${process.env.PATH || ''}`;
    }
  }
}

// 2. Define a global loader for sharp to avoid pkg bundling issues
global.loadSharp = function() {
  if (process.pkg) {
    const exeDir = path.dirname(process.execPath);
    const externalPath = path.join(exeDir, 'node_modules', 'sharp');
    if (fs.existsSync(externalPath)) {
      return require(externalPath);
    }
  }
  return require('sharp');
};

// ── config loading ────────────────────────────────────────────────────────
const config = require('./src/config_loader');
const exeDir = process.pkg ? path.dirname(process.execPath) : process.cwd();
const configPath = path.join(exeDir, 'config.json');

// ── version 1.0.0 ──

if (!fs.existsSync(configPath)) {
  console.error(`[ERROR] config.json not found! Searched at: ${configPath}`);
  process.exit(1);
}

// ── inquirer and logic ───────────────────────────────────────────────────
const inquirer = require('inquirer');
const { downloadTokensFromBook } = require('./src/tokens');
const { generatePdfs } = require('./src/pdf');
const { main: normalizeAllImages } = require('./src/image_normalizer');

async function main() {
  // ── Inicializar pastas de Yours se não existirem ─────────────────────────
  const { TOKEN_IMAGES_YOURS_DIR } = require('./src/paths');
  const sizes = ['tiny-small', 'medium', 'large', 'huge-gargantuan'];
  if (!fs.existsSync(TOKEN_IMAGES_YOURS_DIR)) {
    fs.mkdirSync(TOKEN_IMAGES_YOURS_DIR, { recursive: true });
  }
  for (const s of sizes) {
    const sDir = path.join(TOKEN_IMAGES_YOURS_DIR, s);
    if (!fs.existsSync(sDir)) {
      fs.mkdirSync(sDir, { recursive: true });
    }
    // Cria .gitkeep apenas se NÃO for o executável final (PKG)
    if (!process.pkg) {
      const gitKeep = path.join(sDir, '.gitkeep');
      if (!fs.existsSync(gitKeep)) {
        fs.writeFileSync(gitKeep, '');
      }
    }
  }

  console.log('══════════════════════════════════════════════');
  console.log('  Printable Token Generator');
  console.log('══════════════════════════════════════════════\n');

  try {
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: 'Download Tokens from 5eTools', value: 'download' },
          { name: 'Apply Rings to my tokens', value: 'normalize' },
          { name: 'Generate Printable PDF from tokens', value: 'pdf' },
          { name: 'How to Use / Help', value: 'help' },
          { name: 'Exit', value: 'exit' }
        ]
      }
    ]);

    if (action === 'exit') process.exit(0);

    if (action === 'download') {
      const booksIndex = require('./src/books_index.json');
      const { bookSelection } = await inquirer.prompt([
        {
          type: 'list',
          name: 'bookSelection',
          message: 'Select a book to download tokens from:',
          choices: [
            { name: '--- DOWNLOAD ALL BOOKS ---', value: 'all' },
            new inquirer.Separator(),
            ...booksIndex.map(b => ({
              name: `${b.name} (${b.source})`,
              value: b
            })),
            new inquirer.Separator(),
            { name: '<-- Return to Main Menu', value: 'back' }
          ],
          pageSize: 15
        }
      ]);

      if (bookSelection === 'back') return main();

      if (bookSelection === 'all') {
        console.log(`\n[INFO] Starting batch download of ${booksIndex.length} books...\n`);
        for (let i = 0; i < booksIndex.length; i++) {
          const b = booksIndex[i];
          console.log(`\n[INFO] [${i+1}/${booksIndex.length}] Downloading book: ${b.name} (${b.source})`);
          await downloadTokensFromBook(b.url, b.source);
        }
      } else {
        await downloadTokensFromBook(bookSelection.url, bookSelection.source);
      }
    } else if (action === 'normalize') {
      await normalizeAllImages();
    } else if (action === 'pdf') {
      const { TOKEN_IMAGES_5ETOOLS_DIR, TOKEN_IMAGES_YOURS_DIR } = require('./src/paths');
      const { fileExists } = require('./src/fs');
      
      // 1. Identificar fontes disponíveis
      const availableSources = [];
      if (fs.existsSync(TOKEN_IMAGES_YOURS_DIR)) {
        availableSources.push({ name: 'Your Collection (Yours)', value: { dir: TOKEN_IMAGES_YOURS_DIR, fromApi: false, source: 'yours' } });
      }
      
      if (fs.existsSync(TOKEN_IMAGES_5ETOOLS_DIR)) {
        const booksIndex = require('./src/books_index.json');
        const folders = fs.readdirSync(TOKEN_IMAGES_5ETOOLS_DIR, { withFileTypes: true })
                          .filter(dirent => dirent.isDirectory());
        
        for (const folder of folders) {
          const bookInfo = booksIndex.find(b => b.source === folder.name);
          const displayName = bookInfo ? `${bookInfo.name} (${folder.name})` : folder.name;
          availableSources.push({ 
            name: `5eTools: ${displayName}`, 
            value: { dir: path.join(TOKEN_IMAGES_5ETOOLS_DIR, folder.name), fromApi: true, source: folder.name } 
          });
        }
      }

      if (availableSources.length === 0) {
        console.log('[WARN] No token images found in token_images/! Download some tokens first.');
        await main();
        return;
      }

      const { selectedSources } = await inquirer.prompt([
        {
          type: 'checkbox',
          name: 'selectedSources',
          message: 'Select books/sources to generate PDF from:',
          choices: [
            { name: '--- Select All ---', value: 'all' },
            new inquirer.Separator(),
            ...availableSources,
            new inquirer.Separator(),
            { name: '<-- Return to Main Menu', value: 'back' }
          ],
          validate: (answer) => {
            if (answer.includes('back')) return true;
            return answer.length > 0 ? true : 'Please select at least one source!';
          }
        }
      ]);

      if (selectedSources.includes('back')) return main();

      const finalSources = selectedSources.includes('all') ? availableSources.map(s => s.value) : selectedSources;
      const tokens = [];

      // Função auxiliar para escanear recursivamente
      async function scanDir(dir, fromApi = false, currentSource = null, currentSize = null, currentCr = null) {
        if (!fs.existsSync(dir)) return;
        const files = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const file of files) {
          const res = path.resolve(dir, file.name);
          if (file.isDirectory()) {
            let nextSource = currentSource;
            let nextSize = currentSize;
            let nextCr = currentCr;

            if (fromApi) {
              // Se estamos na raiz do 5etools, a pasta é a SOURCE (MM, VGM...)
              if (dir === TOKEN_IMAGES_5ETOOLS_DIR) nextSource = file.name;
              // Se o parent já era a SOURCE, então esta pasta é o SIZE (medium, large...)
              else if (currentSource && !currentSize) nextSize = file.name;
              // Se o parent já era o SIZE, então esta pasta é o CR (1, 1-2, 5...)
              else if (currentSize && !currentCr) nextCr = file.name;
            } else {
              // Se estamos no YOURS e a pasta é um dos tamanhos válidos, capturamos
              // yours/[SIZE]/[CR]/[NAME].png
              if (dir === TOKEN_IMAGES_YOURS_DIR) {
                const validSizes = ['tiny-small', 'medium', 'large', 'huge-gargantuan'];
                if (validSizes.includes(file.name)) nextSize = file.name;
              } else if (currentSize && !currentCr) {
                // Se já temos o SIZE mas não o CR, a próxima pasta é o CR
                nextCr = file.name;
              }
            }

            await scanDir(res, fromApi, nextSource, nextSize, nextCr);
          } else if (file.name.endsWith('.png') || file.name.endsWith('.jpg') || file.name.endsWith('.jpeg')) {
            // Melhora a extração do nome: remove prefixo 'token_' se houver, remove extensão, 
            // e remove o prefixo de CR (ex: '20_' ou '1-8_') buscando o primeiro underscore.
            const name = file.name
              .replace(/^token_/, '')
              .replace(/\.[^/.]+$/, "")
              .replace(/^[\d\/\-]+_/, "")  // Somente remove se o prefixo antes do '_' for numérico/CR (ex: '20_' ou '1-8_')
              .replace(/_/g, " ");
            
            // Mapeia o nome da pasta de tamanho para o valor esperado pelo pdf.js (tiny, medium, etc)
            let mappedSize = 'medium';
            if (currentSize === 'tiny-small') mappedSize = 'small';
            if (currentSize === 'medium') mappedSize = 'medium';
            if (currentSize === 'large') mappedSize = 'large';
            if (currentSize === 'huge-gargantuan') mappedSize = 'huge';

            tokens.push({
              name: name,
              path: res,
              size: mappedSize,
              cr: (currentCr || '1').replace('-', '/'), // Volta o '-' para '/' para o cálculo do spectrum
              fromApi: fromApi,
              source: currentSource || 'yours'
            });
          }
        }
      }

      console.log('\n[INFO] Scanning tokens from selected sources...');
      for (const sourceInfo of finalSources) {
        // Para 5etools, passamos a source dinamicamente com base na pasta raiz selecionada
        await scanDir(sourceInfo.dir, sourceInfo.fromApi, sourceInfo.source);
      }

      if (tokens.length === 0) {
        console.log('[WARN] No valid tokens found in selected sources!');
      } else {
        console.log(`\n[INFO] Generating PDFs for ${tokens.length} tokens...\n`);
        
        // Agrupar por source para criar pastas no output
        const sourcesMap = new Map();
        for (const t of tokens) {
          if (!sourcesMap.has(t.source)) sourcesMap.set(t.source, []);
          sourcesMap.get(t.source).push(t);
        }

        for (const [source, sourceTokens] of sourcesMap.entries()) {
          const { OUT_5ETOOLS_PDF_DIR, OUT_YOURS_PDF_DIR } = require('./src/paths');
          const isFromApi = sourceTokens[0].fromApi;
          const baseOutDir = isFromApi ? OUT_5ETOOLS_PDF_DIR : OUT_YOURS_PDF_DIR;
          const sourceOutDir = path.join(baseOutDir, source);

          if (!fs.existsSync(sourceOutDir)) {
            fs.mkdirSync(sourceOutDir, { recursive: true });
          }

          console.log(`\n[INFO] Processing source: ${source} (${sourceTokens.length} tokens)`);
          await generatePdfs(sourceTokens, sourceOutDir);
        }
        
        console.log('\nPDF individual files generated in output sources.');
      }
    } else if (action === 'help') {
      await showHelpMenu();
    }
  } catch (err) {
    console.error(`\nAn error occurred: ${err.message}`);
    console.error(err);
    process.exit(1);
  }

  // Volta para o menu principal em vez de encerrar
  console.log('\nReturning to main menu...');
  return main();
}

async function showHelpMenu() {
  const { helpTopic } = await inquirer.prompt([
    {
      type: 'list',
      name: 'helpTopic',
      message: 'What would you like to learn about?',
      choices: [
        { name: '1. How to Download Tokens (5eTools)', value: 'h_download' },
        { name: '2. How to Use My Own Images (Yours)', value: 'h_yours' },
        { name: '3. How to Generate PDFs', value: 'h_pdf' },
        { name: '4. About CR and Auto-Copies', value: 'h_cr' },
        { name: '5. Using Custom Rings/Borders', value: 'h_rings' },
        { name: '6. Fixing Dark Prints (Brightness)', value: 'h_bright' },
        new inquirer.Separator(),
        { name: '<-- Return to Main Menu', value: 'back' }
      ]
    }
  ]);

  if (helpTopic === 'back') return;

  if (helpTopic === 'h_download') {
    console.log('\n--- HOW TO DOWNLOAD TOKENS ---');
    console.log('1. Select "Download Tokens from 5eTools" in the main menu.');
    console.log('2. Pick a book (like Monster Manual) or "Download All".');
    console.log('3. The tokens will be saved in "token_images/5etools/[Book]/...".');
    console.log('4. They are automatically organized by Size and CR folder.');
  } else if (helpTopic === 'h_yours') {
    console.log('\n--- HOW TO USE YOUR OWN IMAGES ---');
    console.log('1. Place your PNG/JPG files in the "token_images/yours" folder.');
    console.log('2. If you put them in the root, they are treated as "Medium" and "CR 1".');
    console.log('3. Best practice: Use subfolders like "medium/5/monster.png"');
    console.log('   (Size: medium, CR: 5). The PDF will automatically print correct copies.');
    console.log('4. Tip: Filenames don\'t need a prefix anymore, but "token_" still works.');
  } else if (helpTopic === 'h_pdf') {
    console.log('\n--- HOW TO GENERATE PDFS ---');
    console.log('1. Select "Generate Printable PDF from tokens".');
    console.log('2. Select the sources you want (Yours, MM, etc.) using the Space key.');
    console.log('3. The PDFs will appear in the "output/[Source]/pdf" folder.');
  } else if (helpTopic === 'h_cr') {
    console.log('\n--- ABOUT CR AND AUTO-COPIES ---');
    console.log('The system reads the CR from the folder name (ex: folder "1-4" = CR 1/4).');
    console.log('Lower CR monsters get MORE copies per page.');
    console.log('Higher CR monsters (Elite/Bosses) get only 1 copy.');
    console.log('You can change these amounts in "config.json" [CR_SPECTRUM].');
  } else if (helpTopic === 'h_rings') {
    console.log('\n--- USING CUSTOM RINGS/BORDERS ---');
    console.log('1. Put your custom circular PNG borders in the "rings" folder.');
    console.log('2. Enable "USE_FROM_RINGS_FOLDER" in config.json.');
    console.log('3. Select "Apply Rings to my tokens" to process your local images.');
  } else if (helpTopic === 'h_bright') {
    console.log('\n--- FIXING DARK PRINTS ---');
    console.log('Home printers often print darker than what you see on screen.');
    console.log('1. Open "config.json".');
    console.log('2. Find "IMAGE_ADJUSTMENTS".');
    console.log('3. Increase "BRIGHTNESS" (e.g., 1.2 for +20%).');
    console.log('4. Increase "SATURATION" for more vivid colors.');
    console.log('5. These settings apply during Download and Ring Application.');
  }

  await inquirer.prompt([{ type: 'input', name: 'continue', message: '\nPress Enter to return to help menu...' }]);
  return showHelpMenu(); // Recursão para voltar ao menu de ajuda
}

// ── verification for testing ──────────────────────────────────────────────
if (process.env.TEST_SHARP) {
  try {
    const s = global.loadSharp();
    console.log(`✅ Sharp loaded successfully! Version: ${JSON.stringify(s.versions)}`);
    process.exit(0);
  } catch (err) {
    console.error(`❌ Sharp load FAILED: ${err.message}`);
    process.exit(1);
  }
}

main();
