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

        // This line removes the "data:image/jpeg;base64," prefix from the string.
        const pureBase64 = imageData.includes(',') ? imageData.split(',')[1] : imageData;

        // Use a valid and current model name.
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash-latest:generateContent?key=${apiKey}`;

        // 5. This is the corrected payload to send to Google
        const payload = {
            contents: [{
                parts: [
                    { text: prompt },
                    { 
                        inlineData: {
                            mimeType: "image/jpeg", // We will standardize on JPEG
                            data: pureBase64 
                        } 
                    }
                ]
            }],
            generationConfig: {
                // Gemini is instructed to respond with a JSON object
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
        
        // 7. Extract the clean JSON text and send it back to the browser
        const jsonText = result?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";

        return {
            statusCode: 200,
            // We send back the text content which is the JSON string
            body: jsonText 
        };

    } catch (error) {
        console.error("Error in Netlify function:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};