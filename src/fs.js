const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const paths = require('./paths');

async function createDirWithGitkeep(dir) {
  await fsp.mkdir(dir, { recursive: true });
  const gitkeepPath = path.join(dir, '.gitkeep');
  if (!(await fileExists(gitkeepPath))) {
    await fsp.writeFile(gitkeepPath, '');
  }
}

async function ensureDirs() {
  await createDirWithGitkeep(path.join(process.cwd(), 'rings'));
  
  // Create Token Images subdirectories
  await createDirWithGitkeep(paths.TOKEN_IMAGES_5ETOOLS_DIR);
  for (const folder of ['pequenas', 'medias', 'grandes', 'gigantes']) {
    await createDirWithGitkeep(path.join(paths.TOKEN_IMAGES_YOURS_DIR, folder));
  }

  // Create Output subdirectories
  await createDirWithGitkeep(paths.OUT_YOURS_TOKENS_DIR);
  await createDirWithGitkeep(paths.OUT_YOURS_PDF_DIR);
  await createDirWithGitkeep(paths.OUT_5ETOOLS_PDF_DIR);
}

async function clearPdfOutput() {
  const dirsToClear = [paths.OUT_YOURS_PDF_DIR, paths.OUT_5ETOOLS_PDF_DIR];
  
  for (const dir of dirsToClear) {
    try {
      const entries = await fsp.readdir(dir, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.isFile() && path.extname(ent.name).toLowerCase() === '.pdf') {
          try {
            await fsp.unlink(path.join(dir, ent.name));
          } catch {}
        }
      }
    } catch {
      // ignore if missing
    }
  }
}

async function fileExists(p) {
  try {
    await fsp.access(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function scanExistingImages() {
  const sizeFolders = ['pequenas', 'medias', 'grandes', 'gigantes'];
  const all = [];
  for (const folder of sizeFolders) {
    const dir = path.join(paths.TOKEN_IMAGES_YOURS_DIR, folder);
    let entries = [];
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const ext = path.extname(ent.name).toLowerCase();
      if (ext !== '.png' && ext !== '.jpg' && ext !== '.jpeg') continue;
      const base = path.basename(ent.name, ext);
      const inferredName = base.replace(/[_-]+/g, ' ').trim();
      const rootPath = path.join(dir, ent.name);
      let targetPath = rootPath;
      
      const processedOutPath = path.join(paths.OUT_YOURS_TOKENS_DIR, `${base}.png`);
      if (await fileExists(processedOutPath)) {
          targetPath = processedOutPath;
      }
      
      all.push({ name: inferredName, size: folder, cr: null, folder, path: targetPath, fromApi: false });
    }
  }
  return all;
}

module.exports = {
  ensureDirs,
  clearPdfOutput,
  fileExists,
  scanExistingImages,
};