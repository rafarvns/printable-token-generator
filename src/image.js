const sharp = global.loadSharp();
const config = require('../config.json');

/**
 * Adds line breaks to text if it's longer than maxCharsPerLine
 * @param {string} text - The text to add line breaks to
 * @param {number} maxCharsPerLine - Maximum characters per line
 * @returns {string} Text with line breaks
 */
function addLineBreaks(text, maxCharsPerLine) {
    if (!text || text.length <= maxCharsPerLine) {
        return text;
    }

    const words = text.split(' ');
    let lines = [];
    let currentLine = '';

    for (const word of words) {
        if (currentLine.length + word.length + 1 <= maxCharsPerLine) {
            currentLine += (currentLine ? ' ' : '') + word;
        } else {
            // If a single word is too long for a line, we need to split it
            if (!currentLine) {
                // Split the word at maxCharsPerLine
                for (let i = 0; i < word.length; i += maxCharsPerLine) {
                    lines.push(word.substring(i, i + maxCharsPerLine));
                }
                currentLine = '';
                continue;
            }
            
            lines.push(currentLine);
            currentLine = word;
        }
    }

    if (currentLine) {
        lines.push(currentLine);
    }

    return lines.join('\n');
}

function buildTokenOverlaySvg(name, counterText, px, options = {}) {
    const { namePosition = 'arc-top', counterPosition = 'bottom' } = options;

    const padding = Math.max(Math.round(px * 0.06), 8);
    const cx = Math.round(px / 2);
    const cy = Math.round(px / 2);
    const r = Math.max(Math.round(px / 2 - padding), 10);

    const fontFamily = 'Calibri, Courier New, Courier, monospace';
    
    // Get font size from environment or use default
    const fontSizePercent = parseFloat(config.TEXT_SETTINGS?.SIZE_PERCENT || 0.08);
    const fontSize = Math.max(8, Math.round(px * fontSizePercent));
    
    // Get stroke width and colors from environment or use defaults
    const strokeW = Math.max(1, Math.round(px * 0.01));
    const textFill = config.TEXT_SETTINGS?.COLOR || 'white';
    const textStroke = config.TEXT_SETTINGS?.STROKE_COLOR || 'black';

    const originalName = String(name || '');
    
    // Sanitize name for SVG
    const safeName = originalName
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');

    // Get top position offset from environment or use default
    const topOffset = parseFloat(config.TEXT_SETTINGS?.TOP_OFFSET || 0.9);
    const topY = padding + Math.round(fontSize * topOffset);
    const bottomY = px - padding - Math.round(fontSize * 0.2);

    let nameSvg = '';

    if (safeName) {
        if (namePosition === 'arc-top') {
            // --- Calcular arco para o texto ---
            const totalAngle = 140; // ângulo em graus reservado para o texto
            const charCount = safeName.length;
            const anglePerChar = totalAngle / charCount;

            // começamos no -totalAngle/2 e vamos até +totalAngle/2
            const startAngle = -90 - totalAngle / 2 + anglePerChar / 2;

            let tspans = '';
            for (let i = 0; i < charCount; i++) {
                const ch = safeName[i];
                const angleDeg = startAngle + i * anglePerChar;
                const angleRad = (angleDeg * Math.PI) / 180;

                const x = cx + r * Math.cos(angleRad);
                const y = cy + r * Math.sin(angleRad);

                // Rotacionar a letra para ficar tangente ao círculo
                const rotate = angleDeg + 90;

                tspans += `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" 
            transform="rotate(${rotate.toFixed(2)},${x.toFixed(2)},${y.toFixed(2)})"
            fill="${textFill}" stroke="${textStroke}" stroke-width="${strokeW}" 
            paint-order="stroke fill" font-family="${fontFamily}" font-size="${fontSize}" 
            text-anchor="middle" dominant-baseline="middle">${ch}</text>`;
            }

            nameSvg = tspans;
        } else if (namePosition === 'bottom') {
            // Add line breaks for long text
            const defaultMaxChars = parseInt(config.TEXT_SETTINGS?.MAX_CHARS_PER_LINE || 0) || 
                Math.max(8, Math.round(20 - (safeName.length / 5)));
            const nameWithLineBreaks = addLineBreaks(safeName, defaultMaxChars);
            
            // Calculate Y position based on number of lines
            const lineCount = nameWithLineBreaks.split('\n').length;
            const lineHeight = fontSize * 1.2;
            // Add additional offset when there are multiple lines, especially for 2 lines
            const multiLineOffset = lineCount > 1 ? fontSize * 0.5 : 0; // Extra offset for multi-line text
            const startY = bottomY - ((lineCount - 1) * lineHeight / 2) - multiLineOffset;
            
            let tspans = '';
            nameWithLineBreaks.split('\n').forEach((line, index) => {
                tspans += `<tspan x="${cx}" dy="${index === 0 ? 0 : lineHeight}" text-anchor="middle">${line}</tspan>`;
            });
            
            nameSvg = `<text x="${cx}" y="${startY}" fill="${textFill}" stroke="${textStroke}" stroke-width="${strokeW}" 
        paint-order="stroke fill" font-family="${fontFamily}" font-size="${fontSize}" 
        dominant-baseline="middle">${tspans}</text>`;
        } else if (namePosition === 'top-flat') {
            // Add line breaks for long text
            const defaultMaxChars = parseInt(config.TEXT_SETTINGS?.MAX_CHARS_PER_LINE || 0) || 
                Math.max(8, Math.round(20 - (safeName.length / 5)));
            const nameWithLineBreaks = addLineBreaks(safeName, defaultMaxChars);
            
            // Calculate Y position based on number of lines
            const lineCount = nameWithLineBreaks.split('\n').length;
            const lineHeight = fontSize * 1.2;
            // Add additional offset when there are multiple lines, especially for 2 lines
            const multiLineOffset = lineCount > 1 ? fontSize * 0.5 : 0; // Extra offset for multi-line text
            const startY = topY - ((lineCount - 1) * lineHeight / 2) + multiLineOffset; // Note: positive offset for top position
            
            let tspans = '';
            nameWithLineBreaks.split('\n').forEach((line, index) => {
                tspans += `<tspan x="${cx}" dy="${index === 0 ? 0 : lineHeight}" text-anchor="middle">${line}</tspan>`;
            });
            
            nameSvg = `<text x="${cx}" y="${startY}" fill="${textFill}" stroke="${textStroke}" stroke-width="${strokeW}" 
        paint-order="stroke fill" font-family="${fontFamily}" font-size="${fontSize}" 
        dominant-baseline="middle">${tspans}</text>`;
        }
    }

    let counterSvg = '';
    if (counterText) {
        // For counter text, we typically expect numbers, but for consistency, also apply line breaks
        const safeCounterText = String(counterText)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
            
        if (counterPosition === 'bottom') {
            // Add line breaks for counter text if needed
            const counterMaxChars = parseInt(config.TEXT_SETTINGS?.MAX_CHARS_PER_LINE || 0) || 8;
            const counterWithLineBreaks = addLineBreaks(safeCounterText, counterMaxChars);
            
            // Calculate Y position based on number of lines
            const lineCount = counterWithLineBreaks.split('\n').length;
            const lineHeight = fontSize * 1.2;
            // Add additional offset when there are multiple lines, especially for 2 lines
            const multiLineOffset = lineCount > 1 ? fontSize * 0.5 : 0; // Extra offset for multi-line text
            const startY = bottomY - ((lineCount - 1) * lineHeight / 2) - multiLineOffset;
            
            let tspans = '';
            counterWithLineBreaks.split('\n').forEach((line, index) => {
                tspans += `<tspan x="${cx}" dy="${index === 0 ? 0 : lineHeight}" text-anchor="middle">${line}</tspan>`;
            });
            
            counterSvg = `<text x="${cx}" y="${startY}" fill="${textFill}" stroke="${textStroke}" stroke-width="${strokeW}" 
        paint-order="stroke fill" font-family="${fontFamily}" font-size="${fontSize}" 
        dominant-baseline="middle">${tspans}</text>`;
        } else if (counterPosition === 'top') {
            // Add line breaks for counter text if needed
            const counterMaxChars = parseInt(config.TEXT_SETTINGS?.MAX_CHARS_PER_LINE || 0) || 8;
            const counterWithLineBreaks = addLineBreaks(safeCounterText, counterMaxChars);
            
            // Calculate Y position based on number of lines
            const lineCount = counterWithLineBreaks.split('\n').length;
            const lineHeight = fontSize * 1.2;
            // Add additional offset when there are multiple lines, especially for 2 lines
            const multiLineOffset = lineCount > 1 ? fontSize * 0.5 : 0; // Extra offset for multi-line text
            const startY = topY - ((lineCount - 1) * lineHeight / 2) + multiLineOffset; // Note: positive offset for top position
            
            let tspans = '';
            counterWithLineBreaks.split('\n').forEach((line, index) => {
                tspans += `<tspan x="${cx}" dy="${index === 0 ? 0 : lineHeight}" text-anchor="middle">${line}</tspan>`;
            });
            
            counterSvg = `<text x="${cx}" y="${startY}" fill="${textFill}" stroke="${textStroke}" stroke-width="${strokeW}" 
        paint-order="stroke fill" font-family="${fontFamily}" font-size="${fontSize}" 
        dominant-baseline="middle">${tspans}</text>`;
        }
    }

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}">
  ${nameSvg}
  ${counterSvg}
</svg>`;

    return Buffer.from(svg);
}

async function overlayLabelOnImageBuffer(basePngBuffer, px, name, counterText, options = {}) {
    const svgBuf = buildTokenOverlaySvg(name, counterText, px, options);

    // primeiro redimensiona/extrai para garantir que a imagem base esteja EXATAMENTE px x px
    // depois compõe o SVG posicionado com coords calculadas para esse px
    return await sharp(basePngBuffer)
        .resize(px, px, {
            fit: 'cover',
            position: 'center'
        })
        .extract({ left: 0, top: 0, width: px, height: px })
        .composite([{ input: svgBuf }])
        .png()
        .withMetadata({ density: 72 })
        .toBuffer();
}


module.exports = {
    overlayLabelOnImageBuffer,
};
