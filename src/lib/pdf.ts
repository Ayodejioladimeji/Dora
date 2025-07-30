
import PDFDocument from 'pdfkit';
import { PassThrough } from 'stream';

export async function generatePdfFromText(textContent: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument();
        const buffers: Buffer[] = [];
        const stream = new PassThrough();

        stream.on('data', buffers.push.bind(buffers));
        stream.on('end', () => {
            const pdfBuffer = Buffer.concat(buffers);
            const pdfBase64 = pdfBuffer.toString('base64');
            resolve(`data:application/pdf;base64,${pdfBase64}`);
        });
        doc.on('error', reject);

        doc.pipe(stream);

        doc.font('Helvetica').fontSize(11); // Default font and size

        const lines = textContent.split('\n');

        lines.forEach(line => {
            // Handle bullet points
            if (line.trim().startsWith('* ')) {
                doc.font('Helvetica').fontSize(11).text('• ', { continued: true, indent: 20 });
                // Process content after bullet for bolding
                processInlineFormatting(doc, line.trim().substring(2), { indent: 40 });
                doc.moveDown(0.3); // Less space for list items
            } else {
                // Process regular lines for bolding
                processInlineFormatting(doc, line);
                if (line.trim() === '') {
                    doc.moveDown(0.5); // More space for empty lines (paragraph breaks)
                } else {
                    doc.moveDown(0.7); // Standard line spacing
                }
            }
        });

        doc.end();
    });
}

// Helper function to process bold text within a line
function processInlineFormatting(doc: any, text: string, options?: any) {
    const boldRegex = /\*\*(.*?)\*\*/g;
    let lastIndex = 0;
    let match;
    const parts: { text: string, bold: boolean }[] = [];

    // Find all bold parts and non-bold parts
    while ((match = boldRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push({ text: text.substring(lastIndex, match.index), bold: false });
        }
        parts.push({ text: match[1], bold: true });
        lastIndex = boldRegex.lastIndex;
    }

    // Add any remaining text after the last bold part
    if (lastIndex < text.length) {
        parts.push({ text: text.substring(lastIndex), bold: false });
    }

    // Render each part with appropriate formatting
    parts.forEach((part) => {
        if (part.bold) {
            doc.font('Helvetica-Bold').text(part.text, { continued: true, ...options });
        } else {
            doc.font('Helvetica').text(part.text, { continued: true, ...options });
        }
    });

    // Ensure the line ends after all parts are processed, forcing a new line
    doc.text('', { continued: false });
}

