/**
 * Helper function to fetch with a retry mechanism.
 * @param {string} url - The URL to fetch.
 * @param {object} options - The options for the fetch request.
 * @param {number} retries - The number of times to retry.
 * @param {number} backoff - The initial backoff time in ms.
 * @returns {Promise<Response>} - The fetch response.
 */
async function fetchWithRetry(url, options, retries = 3, backoff = 1000) {
    for (let i = 0; i < retries; i++) {
        try {
            const response = await fetch(url, options);
            if (response.ok) return response;

            if (response.status === 429 || response.status >= 500) {
                console.log(`Gemini API call failed with status ${response.status}. Retrying in ${backoff}ms...`);
                await new Promise(resolve => setTimeout(resolve, backoff));
                backoff *= 2;
                continue;
            }
            return response;
        } catch (error) {
            console.error(`Network error on attempt ${i + 1}:`, error);
            if (i === retries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, backoff));
            backoff *= 2;
        }
    }
    throw new Error('Max retries reached for Gemini API call.');
}

exports.handler = async function(event) {
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        const { imageData, prompt } = JSON.parse(event.body);
        const apiKey = process.env.GEMINI_API_KEY;

        if (!apiKey) {
            console.error("Gemini API key is not configured in Netlify.");
            return { statusCode: 500, body: JSON.stringify({ error: "Server configuration error: API key is missing." }) };
        }
        
        if (!imageData || !prompt) {
             return { statusCode: 400, body: JSON.stringify({ error: "Missing imageData or prompt in request." }) };
        }

        const pureBase64 = imageData.includes(',') ? imageData.split(',')[1] : imageData;
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;

        const payload = {
            contents: [{
                parts: [
                    { text: prompt },
                    { 
                        inlineData: {
                            mimeType: "image/jpeg",
                            data: pureBase64 
                        } 
                    }
                ]
            }],
            generationConfig: {
                responseMimeType: "application/json",
            }
        };

        const geminiResponse = await fetchWithRetry(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        // ### שינוי: טיפול משופר בשגיאות עומס ###
        if (!geminiResponse.ok) {
            if (geminiResponse.status === 429 || geminiResponse.status >= 500) {
                 console.error(`Gemini API is unavailable (status ${geminiResponse.status}) after all retries.`);
                return {
                    statusCode: 503,
                    body: JSON.stringify({ error: "שירות ה-AI עמוס כרגע. אנא נסו שוב בעוד מספר רגעים." })
                };
            }
            const errorBody = await geminiResponse.json().catch(() => ({ error: { message: 'Failed to parse error response.' }}));
            console.error("Gemini API Error after retries:", errorBody);
            const errorMessage = errorBody?.error?.message || `Gemini API responded with status ${geminiResponse.status}`;
            throw new Error(errorMessage);
        }

        const result = await geminiResponse.json();
        const jsonText = result?.candidates?.[0]?.content?.parts?.[0]?.text || "[]";

        return {
            statusCode: 200,
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
