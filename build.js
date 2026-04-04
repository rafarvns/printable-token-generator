#!/usr/bin/env node

/**
 * build.js — Printable Token Generator
 *
 * Builds standalone executables for Windows, Linux and macOS using `pkg`,
 * then organises each into its own dist/<platform>/ folder with:
 *   - config.json.example  (renamed to config.json so the user can edit it)
 *   - how_to_config.txt
 *   - rings/               (empty folder kept via .gitkeep)
 *   - output/              (empty folder kept via .gitkeep)
 *   - token_images/        (subfolders: yours/, 5etools/ — kept via .gitkeep)
 */

const { execSync } = require('child_process');
const fs   = require('fs');
const path = require('path');

// ─── Configuration ────────────────────────────────────────────────────────────

const ROOT   = __dirname;
const DIST   = path.join(ROOT, 'dist');

const TARGETS = [
  { name: 'windows', pkgTarget: 'node20-win-x64',   exe: 'token-generator.exe' },
  { name: 'linux',   pkgTarget: 'node20-linux-x64', exe: 'token-generator'     },
  { name: 'mac',     pkgTarget: 'node20-macos-x64', exe: 'token-generator-mac' },
];

// Files / folders to copy into every platform distribution
const SUPPORT_FILES = [
  'how_to_config.txt',
];

// Paths where sharp native binaries might live
let NATIVE_ADDON_DIRS = [];

/**
 * Modern sharp (0.33+) uses @img/sharp-xxx packages for prebuilt binaries.
 * We need to find the correct ones for each platform and copy them.
 */
function discoverSharpBinaries(platformName) {
  NATIVE_ADDON_DIRS = []; // Reset
  
  // Mapping our internal target names to sharp's runtime platform strings
  const platformMap = {
    'windows': 'win32-x64',
    'linux':   'linux-x64',
    'mac':     'darwin-x64' // or darwin-arm64
  };

  const sharpArch = platformMap[platformName];
  if (!sharpArch) return;

  const pkgBase = path.join(ROOT, 'node_modules', '@img', `sharp-${sharpArch}`, 'lib');
  const vipsBase = path.join(ROOT, 'node_modules', '@img', `sharp-libvips-${sharpArch}`, 'lib');

  if (fs.existsSync(pkgBase)) {
    NATIVE_ADDON_DIRS.push({ src: pkgBase, dest: `sharp/node_modules/@img/sharp-${sharpArch}/node_modules/@img/sharp-${sharpArch}/` });
    // Also copy directly to where sharp.js expects it relative to index.js
    NATIVE_ADDON_DIRS.push({ src: pkgBase, dest: `node_modules/@img/sharp-${sharpArch}/lib` });
  }
  
  if (fs.existsSync(vipsBase)) {
    NATIVE_ADDON_DIRS.push({ src: vipsBase, dest: 'sharp/vendor/lib' });
  }
}

// config.json.example will be copied as config.json (starter config for the user)
const CONFIG_EXAMPLE_SRC  = path.join(ROOT, 'config.json.example');
const CONFIG_EXAMPLE_DEST = 'config.json';

// Directories to scaffold (with a .gitkeep so Git tracks them)
const SCAFFOLD_DIRS = [
  'output/pdf',
  'output/png',
  'rings',
  'token_images/yours',
  'token_images/5etools',
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function log(msg)  { console.log(`\n  ▸ ${msg}`); }
function ok(msg)   { console.log(`  ✔ ${msg}`);   }
function warn(msg) { console.warn(`  ⚠ ${msg}`);  }

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyFile(src, dest) {
  ensureDir(path.dirname(dest));
  fs.copyFileSync(src, dest);
  ok(`Copied ${path.basename(src)} → ${path.relative(ROOT, dest)}`);
}

function scaffoldDir(base, rel) {
  const dir      = path.join(base, rel);
  const gitkeep  = path.join(dir, '.gitkeep');
  ensureDir(dir);
  if (!fs.existsSync(gitkeep)) fs.writeFileSync(gitkeep, '');
  ok(`Scaffolded ${rel}/`);
}

function copyDir(src, dest) {
  if (!fs.existsSync(src)) {
    warn(`Native dir not found, skipping: ${path.relative(ROOT, src)}`);
    return;
  }
  ensureDir(dest);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath  = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
  ok(`Copied native dir → ${path.relative(ROOT, dest)}`);
}

// ─── Pre-flight checks ────────────────────────────────────────────────────────

function checkPkg() {
  try {
    execSync('npx pkg --version', { stdio: 'pipe' });
  } catch {
    log('`@yao-pkg/pkg` not found locally — installing as devDependency…');
    execSync('npm install --save-dev @yao-pkg/pkg', { stdio: 'inherit', cwd: ROOT });
  }
}

// ─── Build ────────────────────────────────────────────────────────────────────

function buildAll() {
  console.log('\n══════════════════════════════════════════════');
  console.log('  Printable Token Generator — Build Script');
  console.log('══════════════════════════════════════════════');

  checkPkg();
  discoverSharpVendor();

  // Ensure dist root exists
  ensureDir(DIST);

  // Se BUILD_TARGET estiver definido (ex: 'linux'), builda só ele.
  // Caso contrário, builda todos (comportamento padrão local).
  const activeTargets = process.env.BUILD_TARGET
    ? TARGETS.filter(t => t.name === process.env.BUILD_TARGET)
    : TARGETS;

  if (process.env.BUILD_TARGET && activeTargets.length === 0) {
    warn(`Target "${process.env.BUILD_TARGET}" not found in TARGETS definition.`);
    return;
  }

  for (const target of activeTargets) {
    const outDir  = path.join(DIST, target.name);
    const exeDest = path.join(outDir, target.exe);

    log(`Building for ${target.name} (${target.pkgTarget})…`);
    ensureDir(outDir);

    // ── 1. Compile executable ─────────────────────────────────────────────────
    const pkgCmd = [
      'npx pkg',
      'index.js',
      `--target ${target.pkgTarget}`,
      `--output "${exeDest}"`,
      '--compress GZip',
    ].join(' ');

    try {
      execSync(pkgCmd, { stdio: 'inherit', cwd: ROOT });
      ok(`Executable → ${path.relative(ROOT, exeDest)}`);
    } catch (err) {
      warn(`Build failed for ${target.name}: ${err.message}`);
      continue;
    }

    // ── 2. Copy support files ─────────────────────────────────────────────────
    for (const file of SUPPORT_FILES) {
      const src = path.join(ROOT, file);
      if (fs.existsSync(src)) {
        copyFile(src, path.join(outDir, file));
      } else {
        warn(`Support file not found, skipping: ${file}`);
      }
    }

    // ── 3. Copy config.json.example → config.json ─────────────────────────────
    if (fs.existsSync(CONFIG_EXAMPLE_SRC)) {
      copyFile(CONFIG_EXAMPLE_SRC, path.join(outDir, CONFIG_EXAMPLE_DEST));
    } else {
      warn('config.json.example not found — skipping starter config copy.');
    }

    // ── 4. Scaffold empty runtime directories ─────────────────────────────────
    for (const rel of SCAFFOLD_DIRS) {
      scaffoldDir(outDir, rel);
    }

    // ── 5. Copy sharp native binaries (pkg cannot bundle these) ───────────────
    log('Copying sharp native binaries…');
    discoverSharpBinaries(target.name);
    for (const { src, dest } of NATIVE_ADDON_DIRS) {
      copyDir(src, path.join(outDir, dest));
    }

    console.log(`\n  ✅ ${target.name.toUpperCase()} distribution ready → dist/${target.name}/\n`);
  }

  console.log('══════════════════════════════════════════════');
  console.log('  All builds complete!');
  console.log('══════════════════════════════════════════════\n');

  console.log('  Distribution layout:');
  console.log('  dist/');
  for (const t of TARGETS) {
    console.log(`    ${t.name}/`);
    console.log(`      ${t.exe}`);
    console.log(`      config.json          ← edit this before running`);
    console.log(`      how_to_config.txt`);
    console.log(`      rings/               ← drop custom ring PNGs here`);
    console.log(`      output/              ← generated PDFs/PNGs land here`);
    console.log(`      token_images/        ← place your own tokens here`);
  }
  console.log('');
}

buildAll();
