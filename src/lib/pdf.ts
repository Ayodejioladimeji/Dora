import PDFDocument from 'pdfkit';
import { PassThrough } from 'stream';
import { v2 as cloudinary } from 'cloudinary';

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
});

export async function generatePdfFromText(textContent: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument();
        const buffers: Buffer[] = [];
        const stream = new PassThrough();

        stream.on('data', buffers.push.bind(buffers));
        stream.on('end', async () => {
            const pdfBuffer = Buffer.concat(buffers);

            try {
                const result = await new Promise<any>((uploadResolve, uploadReject) => {
                    const uploadStream = cloudinary.uploader.upload_stream(
                        {
                            resource_type: 'raw',
                            folder: 'generated_cvs', // Ensure this folder is appropriate for your use case
                            format: 'pdf',
                        },
                        (error, uploadResult) => {
                            if (uploadResult?.secure_url) uploadResolve(uploadResult);
                            else uploadReject(error || new Error('Cloudinary upload failed.'));
                        }
                    );

                    const bufferReadStream = new PassThrough();
                    bufferReadStream.end(pdfBuffer);
                    bufferReadStream.pipe(uploadStream);
                });

                resolve(result.secure_url);
            } catch (uploadError) {
                console.error("Cloudinary upload error:", uploadError);
                reject(new Error(`Upload failed: ${uploadError instanceof Error ? uploadError.message : String(uploadError)}`));
            }
        });

        doc.on('error', (err) => {
            console.error("PDF generation error:", err);
            reject(new Error(`PDF generation failed: ${err.message}`));
        });

        doc.pipe(stream);
        doc.font('Helvetica').fontSize(12);

        // --- FIXED: Set lineGap on the document object for consistent line spacing ---
        // A line height of 1.6 for a 12pt font means (1.6 * 12) = 19.2pt total line height.
        // Since font size is 12pt, the lineGap needed is 19.2 - 12 = 7.2pt.
        doc.lineGap(7.2); // This sets the extra space between lines for all subsequent text.

        // Spacing to add AFTER a paragraph block (in multiples of current line height)
        const paragraphBlockMoveDown = 0.8; // Adds 0.8 * (12 + 7.2) = 15.36pt after paragraph
        // Spacing for empty lines (larger gap)
        const emptyLineMoveDown = 1.5; // Adds 1.5 * (12 + 7.2) = 28.8pt for an empty line
        // Spacing between bullet points within a list (smaller gap)
        const listItemMoveDown = 0.2; // Adds 0.2 * (12 + 7.2) = 3.84pt additional space between list items

        // Splits text into blocks based on double newlines
        const lines = textContent.split('\n\n');

        lines.forEach(line => {
            const trimmedLine = line.trim();

            if (trimmedLine.startsWith('* ')) {
                // Apply a small space before each list item for visual separation
                doc.moveDown(listItemMoveDown);

                // Print bullet symbol with continued text
                doc.font('Helvetica').text('• ', { continued: true, indent: 20 });

                // Process the rest of the list item text with inline formatting
                // No lineHeight option needed here, as it's set globally by doc.lineGap
                processInlineFormatting(doc, trimmedLine.substring(2), { indent: 40 });

            } else if (trimmedLine === '') {
                // Handle explicitly empty lines to create a larger vertical gap
                doc.moveDown(emptyLineMoveDown);
            } else {
                // Process regular paragraph blocks
                // No lineHeight option needed here, as it's set globally by doc.lineGap
                processInlineFormatting(doc, trimmedLine);

                // Add consistent spacing after each paragraph block
                doc.moveDown(paragraphBlockMoveDown);
            }
        });

        doc.end();
    });
}

// This function is updated to remove the 'lineHeight' option from doc.text() calls.
function processInlineFormatting(doc: any, text: string, options?: any) {
    const boldRegex = /\*\*(.*?)\*\*/g;
    let lastIndex = 0;
    let match;
    const parts: { text: string, bold: boolean }[] = [];

    // Extract bold and normal text segments
    while ((match = boldRegex.exec(text)) !== null) {
        if (match.index > lastIndex) {
            parts.push({ text: text.substring(lastIndex, match.index), bold: false });
        }
        parts.push({ text: match[1], bold: true });
        lastIndex = boldRegex.lastIndex;
    }

    if (lastIndex < text.length) {
        parts.push({ text: text.substring(lastIndex), bold: false });
    }

    // Write each part to the document, continuing on the same line
    parts.forEach((part) => {
        if (part.bold) {
            doc.font('Helvetica-Bold').text(part.text, { continued: true, ...options });
        } else {
            doc.font('Helvetica').text(part.text, { continued: true, ...options });
        }
    });

    // Ensure a newline is added after the entire formatted segment
    // This is crucial for paragraph separation. Removed lineHeight from options here too.
    doc.text('', { continued: false, ...options });
}