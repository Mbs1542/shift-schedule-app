// This is a Node.js function, so we use 'require'
const fetch = require('node-fetch');

exports.handler = async function(event) {
    // Only allow POST requests
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { imageDataBase64, prompt } = JSON.parse(event.body);
        
        // Securely access the API key from Netlify's environment variables
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            console.error("Gemini API key is not configured in Netlify.");
            return { statusCode: 500, body: JSON.stringify({ error: "Server configuration error: API key is missing." }) };
        }

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

        const payload = {
            contents: [{
                parts: [
                    { text: prompt },
                    { inline_data: { mime_type: "image/png", data: imageDataBase64.split(',')[1] } }
                ]
            }],
            generationConfig: {
                responseMimeType: "application/json",
            }
        };

        const geminiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!geminiResponse.ok) {
            const errorBody = await geminiResponse.json();
            console.error("Gemini API Error:", errorBody);
            return {
                statusCode: geminiResponse.status,
                body: JSON.stringify({ error: `Gemini API Error: ${errorBody.error.message}` })
            };
        }

        const result = await geminiResponse.json();
        
        // Return the successful result back to the client
        return {
            statusCode: 200,
            body: JSON.stringify(result)
        };

    } catch (error) {
        console.error("Error in Netlify function:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};