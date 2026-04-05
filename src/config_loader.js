const fs = require('fs');
const path = require('path');

function getConfig() {
  const exeDir = process.pkg ? path.dirname(process.execPath) : process.cwd();
  const configPath = path.join(exeDir, 'config.json');

  if (fs.existsSync(configPath)) {
    try {
      return JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (err) {
      console.error(`[ERROR] Parsing config.json failed: ${err.message}`);
      return {};
    }
  }
  
  // Fallback if file not found - return empty object so code doesn't crash on undefined accesses
  return {};
}

module.exports = getConfig();
