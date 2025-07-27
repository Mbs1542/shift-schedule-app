exports.handler = async function(event) {
    // 1. Only accept POST requests
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        // 2. Parse the incoming data from the browser.
        const { imageData, prompt } = JSON.parse(event.body);
        
        // 3. Securely get the API key from Netlify's environment variables
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            console.error("Gemini API key is not configured in Netlify.");
            return { statusCode: 500, body: JSON.stringify({ error: "Server configuration error: API key is missing." }) };
        }
        
        // 4. Validate the data from the browser
        if (!imageData || !prompt) {
             return { statusCode: 400, body: JSON.stringify({ error: "Missing imageData or prompt in request." }) };
        }

        // ======================= THE FINAL FIX IS HERE =======================
        // This line removes the "data:image/jpeg;base64," prefix from the string.
        const pureBase64 = imageData.includes(',') ? imageData.split(',')[1] : imageData;
        // =====================================================================

        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

        // 5. This is the corrected payload to send to Google
        const payload = {
            contents: [{
                parts: [
                    { text: prompt },
                    { 
                        inlineData: {
                            mimeType: "image/jpeg",
                            data: pureBase64 // Use the cleaned data
                        } 
                    }
                ]
            }],
            generationConfig: {
                responseMimeType: "application/json",
            }
        };

        // 6. Send the request to Google
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
        
        // 7. Send the successful result back to the browser
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