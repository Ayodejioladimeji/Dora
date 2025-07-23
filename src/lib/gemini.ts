import axios from "axios";

// Use gemini-2.0-flash as specified in the URL
const GEMINI_MODEL_ID = "gemini-2.0-flash";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:generateContent`;

async function makeGeminiApiRequest(contents: any[], generationConfig?: any): Promise<string> {
    try {
        const payload = {
            contents: contents,
            generationConfig: generationConfig || { maxOutputTokens: 200 },
        };

        const response = await axios.post(
            `${GEMINI_API_URL}?key=${process.env.NEXT_PUBLIC_GOOGLE_GEMINI_API_KEY}`,
            payload,
            {
                headers: {
                    "Content-Type": "application/json",
                },
            }
        );

        // Extract text from the response
        if (response.data && response.data.candidates && response.data.candidates.length > 0) {
            const firstPart = response.data.candidates[0].content.parts[0];
            if (firstPart && firstPart.text) {
                return firstPart.text;
            }
        }
        throw new Error("No text content found in Gemini API response.");
    } catch (error: any) {
        console.error("Gemini API Request Error:", error.response?.data || error.message);
        throw new Error(`Failed to communicate with Gemini API: ${error.response?.data?.error?.message || error.message}`);
    }
}

export async function chatWithDora(userInput: string): Promise<string> {

    const initialHistory = [
        {
            role: "user",
            parts: [{ text: "You are Dora, a friendly and enthusiastic AI assistant specializing in document automation. Your primary goal is to help users transform their text or content into professional PDF documents. You also handle general chat queries. Always explain what you do to the user, reminding them about your PDF conversion capability. When asked to convert text to PDF, acknowledge the request warmly and confirm that you'll process it. If you need more content for PDF, politely ask for it using the tag `[INPUT_REQUIRED_PDF_CONTENT]` at the beginning of your message." }],
        },
        {
            role: "model",
            parts: [{ text: "Hello! 👋 I'm Dora, your dedicated Document & Chat Automation Agent. I'm here to help you effortlessly transform your text and content into polished PDF documents, and I can also assist with any general questions you have. How can I brighten your day today?" }],
        },
    ];

    const currentMessage = {
        role: "user",
        parts: [{ text: userInput }],
    };

    const contents = [...initialHistory, currentMessage];

    return makeGeminiApiRequest(contents, { maxOutputTokens: 300 });
}


export async function determineDoraIntent(userInput: string): Promise<"chat" | "pdf_conversion"> {
    const prompt = `Analyze the following user input and determine if the user intends to:
    1. Have a general chat (respond with "chat")
    2. Request content to be converted into a PDF (respond with "pdf_conversion")

    Examples:
    - "Hello there!" -> chat
    - "Hi Dora" -> chat
    - "What is your name?" -> chat
    - "Convert this text to PDF: This is my document." -> pdf_conversion
    - "Make a PDF of these notes." -> pdf_conversion
    - "Please turn this into a PDF document about blockchain: Blockchain is a distributed ledger." -> pdf_conversion
    - "Generate a PDF from this." -> pdf_conversion
    - "Can you make a PDF of the following content?" -> pdf_conversion
    - "Convert to PDF" -> pdf_conversion

    User input: "${userInput}"
    Intent:`;

    const contents = [{
        role: "user",
        parts: [{ text: prompt }]
    }];

    try {
        const resultText = await makeGeminiApiRequest(contents, { maxOutputTokens: 50 }); // Shorter response expected
        const text = resultText.trim().toLowerCase();

        if (text.includes("pdf_conversion")) {
            return "pdf_conversion";
        }
        return "chat";
    } catch (error) {
        console.error("[Gemini Intent Error]", error);
        return "chat";
    }
}