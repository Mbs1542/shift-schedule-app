
exports.handler = async function(event) {
    // ודא שהבקשה היא מסוג POST
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { imageDataBase64, prompt } = JSON.parse(event.body);
        
        // קריאה מאובטחת למפתח ה-API ממשתני הסביבה של Netlify
        const apiKey = process.env.GEMINI_API_KEY;

        // בדיקה אם המפתח הוגדר
        if (!apiKey) {
            console.error("Gemini API key is not configured in Netlify.");
            return { statusCode: 500, body: JSON.stringify({ error: "Server configuration error: API key is missing." }) };
        }
        
        // בדיקה אם הנתונים מהלקוח הגיעו
        if (!imageDataBase64 || !prompt) {
             return { statusCode: 400, body: JSON.stringify({ error: "Missing imageDataBase64 or prompt in request." }) };
        }

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

        const payload = {
            contents: [{
                parts: [
                    { text: prompt },
                    { inline_data: { mime_type: "image/jpeg", data: imageDataBase64.split(',')[1] } }
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

        // טיפול בתשובת שגיאה מה-API של Gemini
        if (!geminiResponse.ok) {
            const errorBody = await geminiResponse.json();
            console.error("Gemini API Error:", errorBody);
            return {
                statusCode: geminiResponse.status,
                body: JSON.stringify({ error: `Gemini API Error: ${errorBody.error.message}` })
            };
        }

        const result = await geminiResponse.json();
        
        return {
            statusCode: 200,
            body: JSON.stringify(result)
        };

    } catch (error) {
        // טיפול בשגיאות כלליות בפונקציה
        console.error("Error in Netlify function:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};