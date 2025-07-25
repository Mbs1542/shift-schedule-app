// שם הקובץ: netlify/functions/suggest-shift.js

const fetch = require('node-fetch');

exports.handler = async function(event) {
    // 1. וידוא שהבקשה היא מסוג POST
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        // 2. קריאה מאובטחת של מפתח ה-API ממשתני הסביבה
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            console.error("שגיאה קריטית: משתנה הסביבה GEMINI_API_KEY אינו מוגדר ב-Netlify!");
            return { statusCode: 500, body: JSON.stringify({ error: "Server configuration error." }) };
        }
        
        // 3. חילוץ ה-prompt מגוף הבקשה
        const { prompt } = JSON.parse(event.body);

        if (!prompt) {
            return { statusCode: 400, body: JSON.stringify({ error: "Bad Request: 'prompt' is missing." }) };
        }

        // 4. הכנת הבקשה ל-Gemini API
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        
        const payload = {
            contents: [{
                parts: [{ text: prompt }]
            }]
        };

        // 5. שליחת הבקשה ל-Gemini
        console.log("שולח בקשה ל-Gemini..."); // הודעה שתופיע בלוגים
        const geminiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!geminiResponse.ok) {
            const errorText = await geminiResponse.text();
            console.error("שגיאה שהתקבלה מ-Gemini API:", errorText);
            return { 
                statusCode: geminiResponse.status, 
                body: JSON.stringify({ error: `Failed to fetch from Gemini API. ${errorText}` })
            };
        }

        const result = await geminiResponse.json();
        console.log("תשובה מ-Gemini התקבלה בהצלחה.");

        // 6. חילוץ ההצעה ושליחתה בחזרה לאתר
        const suggestion = result.candidates[0].content.parts[0].text.trim();

        return {
            statusCode: 200,
            body: JSON.stringify({ suggestion: suggestion })
        };

    } catch (error) {
        console.error("אירעה שגיאה לא צפויה בפונקציה:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};