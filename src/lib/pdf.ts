
// import PDFDocument from 'pdfkit';
// import { PassThrough } from 'stream';

// export async function generatePdfFromText(textContent: string): Promise<string> {
//     return new Promise((resolve, reject) => {
//         const doc = new PDFDocument();
//         const buffers: Buffer[] = [];
//         const stream = new PassThrough();

//         stream.on('data', buffers.push.bind(buffers));
//         stream.on('end', () => {
//             const pdfBuffer = Buffer.concat(buffers);
//             const pdfBase64 = pdfBuffer.toString('base64');
//             resolve(`data:application/pdf;base64,${pdfBase64}`);
//         });
//         doc.on('error', reject);

//         doc.pipe(stream);

//         doc.font('Helvetica').fontSize(11); // Default font and size

//         const lines = textContent.split('\n');

//         lines.forEach(line => {
//             // Handle bullet points
//             if (line.trim().startsWith('* ')) {
//                 doc.font('Helvetica').fontSize(11).text('• ', { continued: true, indent: 20 });
//                 // Process content after bullet for bolding
//                 processInlineFormatting(doc, line.trim().substring(2), { indent: 40 });
//                 doc.moveDown(0.3); // Less space for list items
//             } else {
//                 // Process regular lines for bolding
//                 processInlineFormatting(doc, line);
//                 if (line.trim() === '') {
//                     doc.moveDown(0.5); // More space for empty lines (paragraph breaks)
//                 } else {
//                     doc.moveDown(0.7); // Standard line spacing
//                 }
//             }
//         });

//         doc.end();
//     });
// }

// // Helper function to process bold text within a line
// function processInlineFormatting(doc: any, text: string, options?: any) {
//     const boldRegex = /\*\*(.*?)\*\*/g;
//     let lastIndex = 0;
//     let match;
//     const parts: { text: string, bold: boolean }[] = [];

//     // Find all bold parts and non-bold parts
//     while ((match = boldRegex.exec(text)) !== null) {
//         if (match.index > lastIndex) {
//             parts.push({ text: text.substring(lastIndex, match.index), bold: false });
//         }
//         parts.push({ text: match[1], bold: true });
//         lastIndex = boldRegex.lastIndex;
//     }

//     // Add any remaining text after the last bold part
//     if (lastIndex < text.length) {
//         parts.push({ text: text.substring(lastIndex), bold: false });
//     }

//     // Render each part with appropriate formatting
//     parts.forEach((part) => {
//         if (part.bold) {
//             doc.font('Helvetica-Bold').text(part.text, { continued: true, ...options });
//         } else {
//             doc.font('Helvetica').text(part.text, { continued: true, ...options });
//         }
//     });

//     // Ensure the line ends after all parts are processed, forcing a new line
//     doc.text('', { continued: false });
// }


import PDFDocument from 'pdfkit';
import { PassThrough } from 'stream';
import { v2 as cloudinary } from 'cloudinary'; // Import Cloudinary SDK

// Configure Cloudinary (should be done once, typically at application startup)
// IMPORTANT: Replace with your actual Cloudinary credentials, preferably from environment variables
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

        // Capture the PDF content as a Buffer
        stream.on('data', buffers.push.bind(buffers));

        stream.on('end', async () => {
            const pdfBuffer = Buffer.concat(buffers);

            try {
                // Upload the PDF Buffer to Cloudinary
                const result = await new Promise<any>((uploadResolve, uploadReject) => {
                    const uploadStream = cloudinary.uploader.upload_stream(
                        {
                            resource_type: 'raw', // Use 'raw' for non-image/video files like PDFs
                            folder: 'generated_cvs', // Optional: Organize your uploads in a specific folder
                            format: 'pdf', // Explicitly set format for Cloudinary
                        },
                        (error, uploadResult) => {
                            if (uploadResult && uploadResult.secure_url) {
                                uploadResolve(uploadResult);
                            } else {
                                uploadReject(error || new Error('Cloudinary upload failed.'));
                            }
                        }
                    );
                    // Create a readable stream from the buffer and pipe it to Cloudinary
                    const bufferReadStream = new PassThrough();
                    bufferReadStream.end(pdfBuffer);
                    bufferReadStream.pipe(uploadStream);
                });

                resolve(result.secure_url); // Resolve with the Cloudinary URL

            } catch (uploadError) {
                console.error("Cloudinary upload error:", uploadError);
                reject(new Error(`Failed to upload PDF to Cloudinary: ${uploadError instanceof Error ? uploadError.message : String(uploadError)}`));
            }
        });

        // Handle errors during PDF generation
        doc.on('error', (err) => {
            console.error("PDF generation error:", err);
            reject(new Error(`PDF generation failed: ${err.message}`));
        });

        doc.pipe(stream);

        // --- PDF Content Generation Logic (remains the same) ---
        doc.font('Helvetica').fontSize(12); // Default font and size

        const lines = textContent.split('\n\n');

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
                // Adjust spacing based on empty lines or standard content
                if (line.trim() === '') {
                    // Check for markdown <br> tags and handle them explicitly if present
                    if (line.includes('<br>')) {
                        // For explicit <br> tags, add less aggressive moveDown
                        doc.moveDown(0.2); // Adjust as needed to match your desired <br> spacing
                    } else {
                        doc.moveDown(0.5); // More space for actual empty lines (paragraph breaks)
                    }
                } else {
                    doc.moveDown(0.7); // Standard line spacing
                }
            }
        });
        // --- End of PDF Content Generation Logic ---

        doc.end();
    });
}

// Helper function to process bold text within a line (remains the same)
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