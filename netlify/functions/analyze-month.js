exports.handler = async function(event) {
    // 1. קבל רק בקשות POST
    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, body: 'Method Not Allowed' };
    }

    try {
        // 2. קבל את מפתח ה-API ממשתני הסביבה של Netlify
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error("Server configuration error: Gemini API key is missing.");
            return { statusCode: 500, body: JSON.stringify({ error: "Server configuration error: API key is missing." }) };
        }
        
        // 3. פענח את המידע שנשלח מהדפדפן
        const { employee, month, shifts } = JSON.parse(event.body);
        if (!employee || !month || !shifts) {
             return { statusCode: 400, body: JSON.stringify({ error: "Missing employee, month, or shifts data in request." }) };
        }

        // 4. בנה סיכום טקסטואלי של המשמרות
        const shiftsSummary = shifts.map(s => 
            `- ${s.date} (יום ${s.dayName}, ${s.shiftType === 'morning' ? 'בוקר' : 'ערב'}): ${s.start.substring(0,5)}-${s.end.substring(0,5)}`
        ).join('\n');

        // 5. בנה את ה-prompt עבור Gemini
        const prompt = `
            You are a human resources analyst reviewing a monthly work schedule.
            The data is for employee: ${employee} for the month of ${month}.
            
            Here is the list of shifts worked:
            ${shiftsSummary}

            Please provide a brief, insightful analysis in Hebrew based on this data. Focus on patterns, workload, and potential points of interest. 
            Keep the analysis concise, friendly, and professional. Structure your response with a title and bullet points.
            For example:
            - Total number of shifts (morning vs. evening).
            - Any long stretches of consecutive work days.
            - Frequency of weekend (Friday) work.
            - Any unusual shift patterns.
            - A concluding positive or advisory sentence.
            
            Respond only with the analysis text.
        `;

        // 6. הגדר את ה-API ושלח את הבקשה
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        
        const payload = {
            contents: [{ parts: [{ text: prompt }] }]
        };

        const geminiResponse = await fetch(apiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (!geminiResponse.ok) {
            const errorBody = await geminiResponse.json();
            console.error("Gemini API Error:", errorBody);
            throw new Error(errorBody.error.message || 'Gemini API Error');
        }

        const result = await geminiResponse.json();
        
        // 7. חלץ את התשובה והחזר אותה לדפדפן
        const analysis = result?.candidates?.[0]?.content?.parts?.[0]?.text || "לא ניתן היה להפיק ניתוח.";

        return {
            statusCode: 200,
            body: JSON.stringify({ analysis: analysis.trim() })
        };

    } catch (error) {
        console.error("Error in analyze-month function:", error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: error.message })
        };
    }
};
