#!/usr/bin/env node

// image_normalizer.js - Script separado para normalizar/redimensionar todas as imagens
// Executa independentemente do código principal, lendo as envs e redimensionando TODAS as imagens

const config = require('./config_loader');
const sharp = global.loadSharp();
const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const paths = require('./paths');
const { applyTokenRing } = require('./shaper');

/**
 * Obtém os tamanhos de token das variáveis de ambiente
 */
function getTokenSizes() {
    const targetSizes = {
        pequenas: parseInt(config.TOKEN_SIZES?.SMALL_PX || 280),
        medias: parseInt(config.TOKEN_SIZES?.MEDIUM_PX || 280),
        grandes: parseInt(config.TOKEN_SIZES?.LARGE_PX || 560),
        gigantes: parseInt(config.TOKEN_SIZES?.HUGE_PX || 560)
    };
    return targetSizes;
}

/**
 * Verifica se um arquivo é uma imagem válida
 */
function isImageFile(filename) {
    const ext = path.extname(filename).toLowerCase();
    return ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.tiff', '.tif'].includes(ext);
}

/**
 * Procura recursivamente por todas as imagens em um diretório
 */
async function findAllImages(dir) {
    const images = [];
    
    try {
        const entries = await fsp.readdir(dir, { withFileTypes: true });
        
        for (const entry of entries) {
            const fullPath = path.join(dir, entry.name);
            
            if (entry.isDirectory()) {
                // Busca recursivamente em subdiretórios
                const subImages = await findAllImages(fullPath);
                images.push(...subImages);
            } else if (entry.isFile() && isImageFile(entry.name)) {
                images.push(fullPath);
            }
        }
    } catch (error) {
        console.warn(`Aviso: Não foi possível ler o diretório ${dir}: ${error.message}`);
    }
    
    return images;
}

/**
 * Determina o tamanho alvo baseado na pasta ou usa um padrão
 */
function getTargetSize(imagePath, tokenSizes) {
    const normalizedPath = imagePath.toLowerCase();
    
    if (normalizedPath.includes('pequenas') || normalizedPath.includes('small')) {
        return tokenSizes.pequenas;
    } else if (normalizedPath.includes('medias') || normalizedPath.includes('medium')) {
        return tokenSizes.medias;
    } else if (normalizedPath.includes('grandes') || normalizedPath.includes('large')) {
        return tokenSizes.grandes;
    } else if (normalizedPath.includes('gigantes') || normalizedPath.includes('huge') || normalizedPath.includes('gargantuan')) {
        return tokenSizes.gigantes;
    }
    
    // Se não conseguir determinar pela pasta, usa o tamanho médio como padrão
    return tokenSizes.medias;
}

/**
 * Detecta se uma imagem tem bordas alpha espessas e encontra o centro do token
 */
async function detectAlphaBorderAndGetCenter(imagePath) {
    try {
        const image = sharp(imagePath);
        const { data, info } = await image
            .raw()
            .toBuffer({ resolveWithObject: true });
        
        const { width, height, channels } = info;
        
        // Se não tem canal alpha, não precisa verificar
        if (channels < 4) {
            return null;
        }
        
        // Encontra os limites do conteúdo não-transparente
        let minX = width, maxX = 0, minY = height, maxY = 0;
        let hasNonTransparentPixels = false;
        
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const alphaIndex = (y * width + x) * channels + (channels - 1);
                const alpha = data[alphaIndex];
                
                // Se o pixel não é transparente (alpha > threshold)
                if (alpha > 50) {
                    hasNonTransparentPixels = true;
                    minX = Math.min(minX, x);
                    maxX = Math.max(maxX, x);
                    minY = Math.min(minY, y);
                    maxY = Math.max(maxY, y);
                }
            }
        }
        
        if (!hasNonTransparentPixels) {
            return null;
        }
        
        const contentWidth = maxX - minX + 1;
        const contentHeight = maxY - minY + 1;
        const totalArea = width * height;
        const contentArea = contentWidth * contentHeight;
        
        // Se o conteúdo ocupa menos de 50% da imagem, considera que tem borda alpha espessa
        const hasThickAlphaBorder = (contentArea / totalArea) < 0.5;
        
        if (hasThickAlphaBorder) {
            return {
                hasThickAlphaBorder: true,
                contentBounds: { minX, maxX, minY, maxY },
                contentWidth,
                contentHeight
            };
        }
        
        return { hasThickAlphaBorder: false };
        
    } catch (error) {
    console.warn(`[WARN] Failed to detect alpha borders in ${imagePath}: ${error.message}`);
        return null;
    }
}

/**
 * Redimensiona uma imagem para o tamanho especificado
 */
async function resizeImage(imagePath, targetSize) {
    try {
        console.log(`[INFO] Processing: ${path.basename(imagePath)} -> ${targetSize}x${targetSize}px`);
        
        // Detecta bordas alpha espessas
        const alphaInfo = await detectAlphaBorderAndGetCenter(imagePath);
        
        let sharpInstance = sharp(imagePath);
        
        if (alphaInfo && alphaInfo.hasThickAlphaBorder) {
            console.log(`  ⚠ Thick alpha border detected - expanding token from center`);
            
            const { contentBounds, contentWidth, contentHeight } = alphaInfo;
            
            // Extrai apenas a área com conteúdo
            const { data, info } = await sharp(imagePath)
                .extract({
                    left: contentBounds.minX,
                    top: contentBounds.minY,
                    width: contentWidth,
                    height: contentHeight
                })
                .raw()
                .toBuffer({ resolveWithObject: true });
            
            // Cria uma nova imagem expandindo o token extraído para o tamanho alvo
            sharpInstance = sharp(data, {
                raw: {
                    width: contentWidth,
                    height: contentHeight,
                    channels: info.channels
                }
            });
        }

        // Verifica se a imagem precisa de upscale antes do resize principal
        const srcMeta = await sharpInstance.clone().metadata();
        const srcW = srcMeta.width || 0;
        const srcH = srcMeta.height || 0;
        if (srcW < targetSize || srcH < targetSize) {
            console.log(`  [INFO] Image smaller than target (${srcW}x${srcH} → ${targetSize}x${targetSize}px), upscaling...`);
            sharpInstance = sharpInstance.resize(targetSize, targetSize, {
                fit: 'contain',
                background: { r: 0, g: 0, b: 0, alpha: 0 },
                kernel: 'lanczos3',
                withoutEnlargement: false,
            });
        }

        // Redimensiona a imagem para as dimensões exatas do alvo
        sharpInstance = sharpInstance
            .resize(targetSize, targetSize, {
                fit: 'cover',
                position: 'center'
            });

        // Aplica ajustes de brilho e saturação (se diferentes de 1.0)
        const bright = parseFloat(config.IMAGE_ADJUSTMENTS?.BRIGHTNESS || 1.0);
        const sat = parseFloat(config.IMAGE_ADJUSTMENTS?.SATURATION || 1.0);

        if (bright !== 1.0 || sat !== 1.0) {
            sharpInstance = sharpInstance.modulate({
                brightness: bright,
                saturation: sat
            });
        }

        let processedBuffer = await sharpInstance
            .png({ quality: 90 })
            .toBuffer();
        
        // Aplicar anel de token (forçar aplicação no normalizador)
        processedBuffer = await applyTokenRing(processedBuffer, targetSize, true);
        
        // Salva o resultado com prefixo 'token_'
        const parsed = path.parse(imagePath);
        const relativePath = path.relative(paths.TOKEN_IMAGES_YOURS_DIR, parsed.dir);
        const outDir = path.join(paths.OUT_YOURS_TOKENS_DIR, relativePath);
        
        if (!fs.existsSync(outDir)) {
            await fsp.mkdir(outDir, { recursive: true });
        }

        const outPath = path.join(outDir, `token_${parsed.name}.png`);
        await fsp.writeFile(outPath, processedBuffer);
        
        console.log(`  ✔ Resized, ring applied and saved: ${path.basename(outPath)}`);
        
    } catch (error) {
        console.error(`  ✖ Error processing ${imagePath}: ${error.message}`);
    }
}

/**
 * Função principal
 */
async function main() {
    console.log('=== Image Normalizer ===');
    console.log('[INFO] Loading configurations...\n');
    
    const tokenSizes = getTokenSizes();
    console.log('[INFO] Configured sizes:');
    console.log(`  Small: ${tokenSizes.pequenas}px`);
    console.log(`  Medium: ${tokenSizes.medias}px`);
    console.log(`  Large: ${tokenSizes.grandes}px`);
    console.log(`  Huge: ${tokenSizes.gigantes}px\n`);
    
    // Diretórios para processar
    const searchDirs = [
        paths.TOKEN_IMAGES_YOURS_DIR
    ];
    
    // Procura por imagens em todos os diretórios
    const allImages = [];
    
    for (const searchDir of searchDirs) {
        try {
            await fsp.access(searchDir);
            console.log(`[INFO] Searching images in: ${searchDir}`);
            const images = await findAllImages(searchDir);
            allImages.push(...images);
            console.log(`  Found ${images.length} images\n`);
        } catch {
            console.log(`  Directory not found (skipping): ${searchDir}\n`);
        }
    }
    
    if (allImages.length === 0) {
        console.log('[WARN] No images found to process.');
        return;
    }
    
    console.log(`[INFO] Total of ${allImages.length} images found. Starting processing...\n`);
    
    let processedCount = 0;
    let errorCount = 0;
    
    // Processa todas as imagens
    for (const imagePath of allImages) {
        const targetSize = getTargetSize(imagePath, tokenSizes);
        
        try {
            await resizeImage(imagePath, targetSize);
            processedCount++;
        } catch (error) {
            errorCount++;
            console.error(`[ERROR] Critical error processing ${imagePath}: ${error.message}`);
        }
    }
    
    console.log('\n=== Summary ===');
    console.log(`Total Images: ${allImages.length}`);
    console.log(`Successfully Processed: ${processedCount}`);
    console.log(`Errors: ${errorCount}`);
    
    if (errorCount > 0) {
        console.log('\n[WARN] Some images could not be processed. See errors above.');
    } else {
        console.log('\n[SUCCESS] All images were normalized successfully!');
    }
}

// Executa o script apenas se chamado diretamente
if (require.main === module) {
    main().catch(error => {
        console.error('Erro fatal:', error);
        process.exit(1);
    });
}

module.exports = {
    main,
    findAllImages,
    resizeImage,
    getTokenSizes
};