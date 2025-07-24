const fetch = require('node-fetch');

exports.handler = async function(event, context) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { imageDataBase64, prompt } = JSON.parse(event.body);
        const apiKey = process.env.GEMINI_API_KEY; // קורא את המפתח ממשתני הסביבה של Netlify

        if (!apiKey) {
            throw new Error("API key for Gemini is not configured.");
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

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            const errorBody = await response.json();
            return {
                statusCode: response.status,
                body: JSON.stringify({ error: errorBody.error.message })
            };
        }

        const result = await response.json();
        return {
            statusCode: 200,
            body: JSON.stringify(result)
        };

    } catch (error) {
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};