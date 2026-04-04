#!/usr/bin/env node

// image_normalizer.js - Script separado para normalizar/redimensionar todas as imagens
// Executa independentemente do código principal, lendo as envs e redimensionando TODAS as imagens

const config = require('../config.json');
const sharp = require('sharp');
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
        console.warn(`  ⚠ Aviso: Erro ao detectar bordas alpha em ${imagePath}: ${error.message}`);
        return null;
    }
}

/**
 * Redimensiona uma imagem para o tamanho especificado
 */
async function resizeImage(imagePath, targetSize) {
    try {
        console.log(`Processando: ${imagePath} -> ${targetSize}x${targetSize}px`);
        
        // Detecta bordas alpha espessas
        const alphaInfo = await detectAlphaBorderAndGetCenter(imagePath);
        
        let sharpInstance = sharp(imagePath);
        
        if (alphaInfo && alphaInfo.hasThickAlphaBorder) {
            console.log(`  ⚠ Detectada borda alpha espessa - expandindo token do centro`);
            
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
        
        // Redimensiona a imagem e aplica anel
        let processedBuffer = await sharpInstance
            .resize(targetSize, targetSize, {
                fit: 'cover',
                position: 'center'
            })
            .png({ quality: 90 })
            .toBuffer();
        
        // Aplicar anel de token
        processedBuffer = await applyTokenRing(processedBuffer, targetSize);
        
        // Salva o resultado
        const parsed = path.parse(imagePath);
        const outPath = path.join(paths.OUT_YOURS_TOKENS_DIR, `${parsed.name}.png`);
        await fsp.writeFile(outPath, processedBuffer);
        
        console.log(`  ✓ Redimensionado e anel aplicado com sucesso (${outPath})`);
        
    } catch (error) {
        console.error(`  ✗ Erro ao processar ${imagePath}: ${error.message}`);
    }
}

/**
 * Função principal
 */
async function main() {
    console.log('=== Image Normalizer ===');
    console.log('Carregando configurações das variáveis de ambiente...\n');
    
    const tokenSizes = getTokenSizes();
    console.log('Tamanhos configurados:');
    console.log(`  Pequenas: ${tokenSizes.pequenas}px`);
    console.log(`  Médias: ${tokenSizes.medias}px`);
    console.log(`  Grandes: ${tokenSizes.grandes}px`);
    console.log(`  Gigantes: ${tokenSizes.gigantes}px\n`);
    
    // Diretórios para processar
    const searchDirs = [
        paths.TOKEN_IMAGES_YOURS_DIR
    ];
    
    // Procura por imagens em todos os diretórios
    const allImages = [];
    
    for (const searchDir of searchDirs) {
        try {
            await fsp.access(searchDir);
            console.log(`Buscando imagens em: ${searchDir}`);
            const images = await findAllImages(searchDir);
            allImages.push(...images);
            console.log(`  Encontradas ${images.length} imagens\n`);
        } catch {
            console.log(`  Diretório não encontrado: ${searchDir}\n`);
        }
    }
    
    if (allImages.length === 0) {
        console.log('Nenhuma imagem encontrada para processar.');
        return;
    }
    
    console.log(`Total de ${allImages.length} imagens encontradas. Iniciando processamento...\n`);
    
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
            console.error(`Erro geral ao processar ${imagePath}: ${error.message}`);
        }
    }
    
    console.log('\n=== Resumo ===');
    console.log(`Total de imagens: ${allImages.length}`);
    console.log(`Processadas com sucesso: ${processedCount}`);
    console.log(`Erros: ${errorCount}`);
    
    if (errorCount > 0) {
        console.log('\nAlgumas imagens não puderam ser processadas. Verifique os erros acima.');
        // Evita derrubar o processo principal se for chamado do index.js
    } else {
        console.log('\nTodas as imagens foram normalizadas com sucesso!');
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