const path = require('path');

// Root Paths
const TOKEN_IMAGES_DIR = path.join(process.cwd(), 'token_images');
const OUT_DIR = path.join(process.cwd(), 'output');

// Token Images (Sources)
const TOKEN_IMAGES_YOURS_DIR = path.join(TOKEN_IMAGES_DIR, 'yours');
const TOKEN_IMAGES_5ETOOLS_DIR = path.join(TOKEN_IMAGES_DIR, '5etools');

// Output branches
const OUT_YOURS_DIR = path.join(OUT_DIR, 'yours');
const OUT_YOURS_TOKENS_DIR = path.join(OUT_YOURS_DIR, 'tokens');
const OUT_YOURS_PDF_DIR = path.join(OUT_YOURS_DIR, 'pdf');

const OUT_5ETOOLS_DIR = path.join(OUT_DIR, '5etools');
const OUT_5ETOOLS_PDF_DIR = path.join(OUT_5ETOOLS_DIR, 'pdf');

module.exports = {
  TOKEN_IMAGES_DIR,
  TOKEN_IMAGES_YOURS_DIR,
  TOKEN_IMAGES_5ETOOLS_DIR,
  OUT_DIR,
  OUT_YOURS_DIR,
  OUT_YOURS_TOKENS_DIR,
  OUT_YOURS_PDF_DIR,
  OUT_5ETOOLS_DIR,
  OUT_5ETOOLS_PDF_DIR
};