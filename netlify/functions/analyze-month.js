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

        // 5. *** שדרוג ה-prompt לניתוח מפורט יותר ***
        const prompt = `
            You are a senior human resources analyst providing a detailed, data-driven review of a monthly work schedule. Your analysis must be in professional, clear Hebrew.
            The data is for employee: ${employee} for the month of ${month}.

            Here is the list of shifts worked:
            ${shiftsSummary}

            Please provide a thorough and insightful analysis based on this data. Structure your response with a clear title and detailed bullet points. Go beyond generic statements and provide specific numbers and observations.

            **Your analysis must include the following specific points:**
            1.  **Total Shift Count:** State the total number of shifts, and the exact breakdown between morning and evening shifts.
            2.  **Friday Work:** Precisely count how many Friday shifts the employee worked this month.
            3.  **Consecutive Work Days:** Identify the longest stretch of consecutive work days.
            4.  **Workload Distribution:** Comment on the workload distribution. Are there any weeks that were particularly heavy or light compared to others?
            5.  **Shift Time Variations:** Identify any shifts with start or end times that deviate from the standard and comment on them.
            6.  **Overall Summary:** Provide a concluding sentence that summarizes the month's work pattern, offering a professional, data-based insight.

            Respond ONLY with the analysis text in Hebrew. Do not add any introductory or concluding remarks outside of the analysis itself.
        `;

        // 6. הגדר את ה-API ושלח את הבקשה
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        
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