
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

import puppeteer from "puppeteer"; // Use original puppeteer if not using puppeteer-extra
// import puppeteer from "puppeteer-extra"; // If you prefer puppeteer-extra
// import StealthPlugin from "puppeteer-extra-plugin-stealth"; // If using puppeteer-extra

import { v2 as cloudinary } from "cloudinary";

// If using puppeteer-extra, uncomment this:
// puppeteer.use(StealthPlugin());

// Configure Cloudinary
cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
});

interface ContentBlock {
    type: "heading" | "paragraph" | "bullet" | "numbered" | "link" | "empty" | "code";
    content: string;
    level?: number;
    indent?: number;
}

export async function generatePdfFromText(textContent: string): Promise<string> {
    let browser;

    try {
        // Parse content and generate HTML
        const htmlContent = generateHTML(textContent);

        // Launch browser
        // Puppeteer will automatically look for the installed Chrome/Chromium
        // If you explicitly need to set it for Render, you might use:
        // executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || puppeteer.executablePath(),
        // but the `postinstall` script should make it discoverable.
        browser = await puppeteer.launch({
            headless: true, // true for production, 'new' for new headless mode
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                // These args are crucial for running in constrained environments like Render
            ],
        });

        const page = await browser.newPage();

        // Set content and wait for any fonts/styles to load
        await page.setContent(htmlContent, {
            waitUntil: "networkidle0", // waits until network activity is low
        });

        // Generate PDF with proper settings
        const pdfBuffer = await page.pdf({
            format: "A4",
            printBackground: true,
            margin: {
                top: "0.75in",
                right: "0.75in",
                bottom: "0.75in",
                left: "0.75in",
            },
        });

        // Upload to Cloudinary
        const result = await new Promise<any>((resolve, reject) => {
            const uploadStream = cloudinary.uploader.upload_stream(
                {
                    resource_type: "raw", // Use 'raw' for PDFs
                    folder: "generated_pdfs",
                    format: "pdf",
                },
                (error, uploadResult) => {
                    if (uploadResult && uploadResult.secure_url) {
                        resolve(uploadResult);
                    } else {
                        reject(error || new Error("Cloudinary upload failed."));
                    }
                },
            );
            uploadStream.end(pdfBuffer);
        });

        return result.secure_url;
    } catch (error) {
        console.error("PDF generation error:", error);
        throw new Error(
            `PDF generation failed: ${error instanceof Error ? error.message : String(error)}`,
        );
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

function generateHTML(textContent: string): string {
    const contentBlocks = parseContent(textContent);
    const bodyContent = renderContentBlocks(contentBlocks);

    return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Generated Document</title>
    <style>
        ${getCSS()}
    </style>
</head>
<body>
    <div class="document">
        ${bodyContent}
    </div>
</body>
</html>`;
}

function getCSS(): string {
    return `
    * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
    }

    body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
        line-height: 1.6;
        color: #333;
        background: white;
    }

    .document {
        max-width: 100%;
        padding: 0; /* Ensures content spans full width of PDF if no margins are set on the document itself */
    }

    /* Headings */
    h1 {
        font-size: 28px;
        font-weight: 700;
        margin: 0 0 24px 0;
        color: #1a1a1a;
        border-bottom: 3px solid #e5e5e5;
        padding-bottom: 12px;
    }

    h2 {
        font-size: 24px;
        font-weight: 600;
        margin: 32px 0 16px 0;
        color: #2a2a2a;
        border-bottom: 2px solid #f0f0f0;
        padding-bottom: 8px;
    }

    h3 {
        font-size: 20px;
        font-weight: 600;
        margin: 24px 0 12px 0;
        color: #3a3a3a;
    }

    h4 {
        font-size: 18px;
        font-weight: 600;
        margin: 20px 0 10px 0;
        color: #4a4a4a;
    }

    h5 {
        font-size: 16px;
        font-weight: 600;
        margin: 16px 0 8px 0;
        color: #5a5a5a;
    }

    h6 {
        font-size: 14px;
        font-weight: 600;
        margin: 12px 0 6px 0;
        color: #6a6a6a;
    }

    /* Paragraphs */
    p {
        font-size: 14px;
        line-height: 1.7;
        margin: 0 0 16px 0;
        text-align: justify;
    }

    /* Text formatting */
    strong, b {
        font-weight: 600;
        color: #1a1a1a;
    }

    em, i {
        font-style: italic;
    }

    code {
        font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
        font-size: 13px;
        background: #f8f9fa;
        padding: 2px 6px;
        border-radius: 4px;
        border: 1px solid #e9ecef;
    }

    /* Links */
    a {
        color: #0066cc;
        text-decoration: none;
        border-bottom: 1px solid #0066cc;
    }

    a:hover {
        color: #004499;
        border-bottom-color: #004499;
    }

    /* Lists */
    ul, ol {
        margin: 0 0 16px 0;
        padding-left: 0; /* Remove default browser padding */
    }

    ul {
        list-style: none; /* Remove default bullet */
    }

    ol {
        list-style: none; /* Remove default numbering */
        counter-reset: item; /* Initialize counter for custom numbering */
    }

    li {
        font-size: 14px;
        line-height: 1.6;
        margin: 8px 0;
        position: relative;
        padding-left: 24px; /* Space for custom bullet/number */
    }

    /* Custom Bullet points */
    ul li::before {
        content: "•";
        color: #666;
        font-weight: bold;
        position: absolute;
        left: 0;
        top: 0; /* Align with text baseline */
    }

    ul.level-1 li::before {
        content: "•"; /* Default bullet */
    }

    ul.level-2 li::before {
        content: "◦"; /* Hollow circle for level 2 */
    }

    ul.level-3 li::before {
        content: "▪"; /* Square for level 3 */
    }

    ul.level-4 li::before {
        content: "▫"; /* Hollow square for level 4 */
    }

    /* Custom Numbered lists */
    ol li {
        counter-increment: item; /* Increment counter for each list item */
    }

    ol li::before {
        content: counter(item) "."; /* Display number followed by a dot */
        color: #666;
        font-weight: 600;
        position: absolute;
        left: 0;
        top: 0; /* Align with text baseline */
    }

    /* Nested lists indentation */
    .indent-1 {
        margin-left: 24px;
    }

    .indent-2 {
        margin-left: 48px;
    }

    .indent-3 {
        margin-left: 72px;
    }

    .indent-4 {
        margin-left: 96px;
    }

    /* Empty lines for spacing */
    .empty-line {
        height: 16px; /* Provides vertical spacing */
    }

    /* Standalone links (e.g., URLs on their own line) */
    .standalone-link {
        display: block; /* Ensures it takes full width */
        margin: 12px 0;
        font-size: 14px;
        word-break: break-all; /* Prevents long URLs from overflowing */
    }

    /* Code blocks */
    .code-block {
        font-family: 'SF Mono', Monaco, 'Cascadia Code', 'Roboto Mono', Consolas, 'Courier New', monospace;
        font-size: 13px;
        background: #f8f9fa;
        padding: 16px;
        border-radius: 6px;
        border: 1px solid #e9ecef;
        margin: 16px 0;
        overflow-x: auto; /* For horizontally scrolling code */
    }

    /* Contact info styling (if used in future) */
    .contact-info {
        margin: 16px 0;
        padding: 16px;
        background: #f8f9fa;
        border-radius: 6px;
        border-left: 4px solid #0066cc;
    }

    /* Section dividers (if used in future) */
    hr {
        border: none;
        height: 2px;
        background: #e5e5e5;
        margin: 32px 0;
    }

    /* Print optimizations for consistent rendering */
    @media print {
        body {
            -webkit-print-color-adjust: exact; /* For Webkit browsers */
            print-color-adjust: exact; /* Standard */
        }
        
        .document {
            padding: 0; /* Ensure no extra padding in print layout */
        }
    }
  `;
}

function parseContent(textContent: string): ContentBlock[] {
    const lines = textContent.split("\n");
    const blocks: ContentBlock[] = [];

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const trimmedLine = line.trim();

        if (trimmedLine === "") {
            blocks.push({ type: "empty", content: "" });
            continue;
        }

        // Check for headings (# ## ###)
        const headingMatch = trimmedLine.match(/^(#{1,6})\s+(.+)$/);
        if (headingMatch) {
            blocks.push({
                type: "heading",
                content: headingMatch[2],
                level: headingMatch[1].length,
            });
            continue;
        }

        // Check for bullet points (* - +)
        const bulletMatch = trimmedLine.match(/^[*\-+]\s+(.+)$/);
        if (bulletMatch) {
            const indent = line.length - line.trimStart().length;
            blocks.push({
                type: "bullet",
                content: bulletMatch[1],
                indent: Math.floor(indent / 2),
            });
            continue;
        }

        // Check for numbered lists (1. 2. etc.)
        const numberedMatch = trimmedLine.match(/^\d+\.\s+(.+)$/);
        if (numberedMatch) {
            const indent = line.length - line.trimStart().length;
            blocks.push({
                type: "numbered",
                content: numberedMatch[1],
                indent: Math.floor(indent / 2),
            });
            continue;
        }

        // Check for code blocks (```)
        if (trimmedLine.startsWith("```")) {
            const codeLines = [];
            i++; // Skip the opening ```
            while (i < lines.length && !lines[i].trim().startsWith("```")) {
                codeLines.push(lines[i]);
                i++;
            }
            blocks.push({
                type: "code",
                content: codeLines.join("\n"),
            });
            continue;
        }

        // Check for standalone links
        const linkMatch = trimmedLine.match(/^https?:\/\/[^\s]+$/);
        if (linkMatch) {
            blocks.push({
                type: "link",
                content: trimmedLine,
            });
            continue;
        }

        // Default to paragraph
        blocks.push({
            type: "paragraph",
            content: trimmedLine,
        });
    }

    return blocks;
}

function renderContentBlocks(blocks: ContentBlock[]): string {
    let html = "";
    let currentList: { type: "bullet" | "numbered"; level: number } | null = null;

    for (let i = 0; i < blocks.length; i++) {
        const block = blocks[i];
        const nextBlock = blocks[i + 1];

        switch (block.type) {
            case "heading":
                // Close any open lists
                if (currentList) {
                    html += currentList.type === "bullet" ? "</ul>" : "</ol>";
                    currentList = null;
                }
                html += `<h${block.level || 1}>${processInlineFormatting(block.content)}</h${block.level || 1}>`;
                break;

            case "paragraph":
                // Close any open lists
                if (currentList) {
                    html += currentList.type === "bullet" ? "</ul>" : "</ol>";
                    currentList = null;
                }
                html += `<p>${processInlineFormatting(block.content)}</p>`;
                break;

            case "bullet":
                const bulletLevel = Math.min(block.indent || 0, 3); // Max 4 levels for example

                // If no current list, or different type/level, open new list
                if (!currentList || currentList.type !== "bullet" || currentList.level !== bulletLevel) {
                    // Close previous list if open
                    if (currentList) {
                        html += currentList.type === "bullet" ? "</ul>" : "</ol>";
                    }
                    html += `<ul class="level-${bulletLevel + 1} ${bulletLevel > 0 ? `indent-${bulletLevel}` : ""}">`;
                    currentList = { type: "bullet", level: bulletLevel };
                }

                html += `<li>${processInlineFormatting(block.content)}</li>`;

                // Close list if next block is not a bullet or is at a different level
                if (!nextBlock || nextBlock.type !== "bullet" || (nextBlock.indent || 0) !== bulletLevel) {
                    html += "</ul>";
                    currentList = null;
                }
                break;

            case "numbered":
                const numberedLevel = Math.min(block.indent || 0, 3); // Max 4 levels for example

                // If no current list, or different type/level, open new list
                if (!currentList || currentList.type !== "numbered" || currentList.level !== numberedLevel) {
                    // Close previous list if open
                    if (currentList) {
                        html += currentList.type === "bullet" ? "</ul>" : "</ol>";
                    }
                    html += `<ol class="${numberedLevel > 0 ? `indent-${numberedLevel}` : ""}">`;
                    currentList = { type: "numbered", level: numberedLevel };
                }

                html += `<li>${processInlineFormatting(block.content)}</li>`;

                // Close list if next block is not numbered or is at a different level
                if (!nextBlock || nextBlock.type !== "numbered" || (nextBlock.indent || 0) !== numberedLevel) {
                    html += "</ol>";
                    currentList = null;
                }
                break;

            case "link":
                // Close any open lists
                if (currentList) {
                    html += currentList.type === "bullet" ? "</ul>" : "</ol>";
                    currentList = null;
                }
                html += `<div class="standalone-link"><a href="${block.content}" target="_blank">${block.content}</a></div>`;
                break;

            case "code":
                // Close any open lists
                if (currentList) {
                    html += currentList.type === "bullet" ? "</ul>" : "</ol>";
                    currentList = null;
                }
                html += `<div class="code-block">${escapeHtml(block.content)}</div>`;
                break;

            case "empty":
                html += '<div class="empty-line"></div>';
                break;
        }
    }

    // Close any remaining open lists at the very end
    if (currentList) {
        html += currentList.type === "bullet" ? "</ul>" : "</ol>";
    }

    return html;
}

// Fixed escapeHtml for Node.js environment
function escapeHtml(text: string): string {
    return text
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}


function processInlineFormatting(text: string): string {
    // Handle bold text (**text**)
    text = text.replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")

    // Handle italic text (*text* or _text_)
    text = text.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>")
    text = text.replace(/_([^_]+)_/g, "<em>$1</em>")

    // Handle inline code (`code`)
    text = text.replace(/`([^`]+)`/g, "<code>$1</code>")

    // Handle inline links [text](url)
    text = text.replace(/\[([^\]]+)\]$$([^)]+)$$/g, '<a href="$2" target="_blank">$1</a>')

    // Handle standalone URLs in text
    text = text.replace(/(https?:\/\/[^\s]+)/g, '<a href="$1" target="_blank">$1</a>')

    return text
}
