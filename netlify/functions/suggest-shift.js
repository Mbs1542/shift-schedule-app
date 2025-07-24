// קובץ חדש: netlify/functions/suggest-shift.js

const fetch = require('node-fetch');

exports.handler = async function(event) {
    // ודא שהבקשה היא מסוג POST
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { prompt } = JSON.parse(event.body);

        // קריאה מאובטחת למפתח ה-API ממשתני הסביבה של Netlify
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            return { statusCode: 500, body: JSON.stringify({ error: "API key is not configured" }) };
        }
         if (!prompt) {
            return { statusCode: 400, body: JSON.stringify({ error: "Prompt is missing" }) };
        }

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

        const payload = {
            contents: [{
                parts: [{ text: prompt }]
            }]
        };

        const geminiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!geminiResponse.ok) {
            const errorBody = await geminiResponse.text();
            console.error("Gemini API Error:", errorBody);
            return { statusCode: 500, body: JSON.stringify({ error: 'Failed to fetch from Gemini' })};
        }

        const result = await geminiResponse.json();
        const suggestion = result.candidates[0].content.parts[0].text.trim();

        // החזרת ההצעה הנקייה חזרה לדפדפן
        return {
            statusCode: 200,
            body: JSON.stringify({ suggestion: suggestion })
        };

    } catch (error) {
        console.error("Error in suggest-shift function:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};