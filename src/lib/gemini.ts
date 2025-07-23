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
    const prompt = `Analyze the following user input and determine the primary intent:
    1. **chat**: User is having a general conversation, asking questions, or making a statement not directly providing content for conversion.
    2. **pdf_conversion**: User is explicitly providing large content to be converted to PDF, or a clear command to convert given content.

    If the user is only *asking if* you can convert, or *stating a need to convert without providing the content*, categorize it as 'chat'. Only classify as 'pdf_conversion' if content is large and clearly present for conversion or the command is immediate.

    Examples for 'chat':
    - "Hello there!"
    - "Hi Dora"
    - "What is your name?"
    - "I need help to convert a content to pdf document"
    - "Can you make a PDF for me?"
    - "How do I use your PDF converter?"
    - "I want to convert something later."

    Examples for 'pdf_conversion':
    - "Convert this text to PDF: This is my document."
    - "Make a PDF of these notes."
    - "Please turn this into a PDF document about blockchain: Blockchain is a distributed ledger."
    - "Generate a PDF from this."
    - "Convert to PDF" (if content is assumed or provided in context)

    User input: "${userInput}"
    Intent:`;

    const contents = [{
        role: "user",
        parts: [{ text: prompt }]
    }];

    try {
        const resultText = await makeGeminiApiRequest(contents, { maxOutputTokens: 50 });
        const text = resultText.trim().toLowerCase();

        if (text.includes("pdf_conversion")) {
            return "pdf_conversion";
        }
        return "chat";
    } catch (error) {
        console.error("[Gemini Intent Error]", error);
        return "chat"; // Default to chat on error
    }
}