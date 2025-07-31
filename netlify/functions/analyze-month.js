const { promisify } = require('util');

// Constants
const MAX_SHIFTS_PER_REQUEST = 100;
const MAX_EMPLOYEE_NAME_LENGTH = 100;
const MAX_MONTH_LENGTH = 20;
const API_TIMEOUT = 30000; // 30 seconds
const VALID_SHIFT_TYPES = ['morning', 'evening'];
const HEBREW_MONTHS = [
    'ינואר', 'פברuary', 'מרץ', 'אפריל', 'מאי', 'יוני',
    'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'
];

// Rate limiting (simple in-memory store - for production use Redis/DynamoDB)
const requestTracker = new Map();
const RATE_LIMIT_WINDOW = 60000; // 1 minute
const MAX_REQUESTS_PER_MINUTE = 10;

// Utility functions
const sleep = promisify(setTimeout);

function sanitizeString(str, maxLength) {
    if (typeof str !== 'string') return '';
    return str.trim().substring(0, maxLength).replace(/[<>\"'&]/g, '');
}

function validateShiftStructure(shift) {
    const requiredFields = ['date', 'dayName', 'shiftType', 'start', 'end'];
    
    // Check all required fields exist
    for (const field of requiredFields) {
        if (!shift.hasOwnProperty(field)) {
            return false;
        }
    }
    
    // Validate shift type
    if (!VALID_SHIFT_TYPES.includes(shift.shiftType)) {
        return false;
    }
    
    // Validate date format (basic check)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(shift.date)) {
        return false;
    }
    
    // Validate time format (HH:MM)
    const timeRegex = /^\d{2}:\d{2}$/;
    if (!timeRegex.test(shift.start) || !timeRegex.test(shift.end)) {
        return false;
    }
    
    return true;
}

function checkRateLimit(clientId) {
    const now = Date.now();
    
    if (!requestTracker.has(clientId)) {
        requestTracker.set(clientId, []);
    }
    
    const requests = requestTracker.get(clientId);
    
    // Remove old requests outside the window
    const validRequests = requests.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW);
    
    if (validRequests.length >= MAX_REQUESTS_PER_MINUTE) {
        return false;
    }
    
    validRequests.push(now);
    requestTracker.set(clientId, validRequests);
    
    return true;
}

async function callGeminiWithRetry(apiUrl, payload, maxRetries = 3) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT);
            
            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 
                    'Content-Type': 'application/json',
                    'User-Agent': 'Netlify-Function/1.0'
                },
                body: JSON.stringify(payload),
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                const errorBody = await response.json().catch(() => ({}));
                throw new Error(`Gemini API Error (${response.status}): ${errorBody?.error?.message || 'Unknown error'}`);
            }
            
            return await response.json();
            
        } catch (error) {
            lastError = error;
            console.error(`Attempt ${attempt} failed:`, error.message);
            
            if (attempt < maxRetries) {
                // Exponential backoff
                await sleep(Math.pow(2, attempt) * 1000);
            }
        }
    }
    
    throw lastError;
}

function generateEnhancedPrompt(employee, month, shifts) {
    const shiftsSummary = shifts.map(s => 
        `- ${s.date} (יום ${s.dayName}, ${s.shiftType === 'morning' ? 'בוקר' : 'ערב'}): ${s.start.substring(0,5)}-${s.end.substring(0,5)}`
    ).join('\n');

    return `
        אתה מנתח משאבי אנוש בכיר המספק סקירה מפורטת ומבוססת נתונים של לוח עבודה חודשי. הניתוח שלך חייב להיות בעברית מקצועית וברורה.
        הנתונים הם עבור העובד: ${employee} לחודש ${month}.

        הנה רשימת המשמרות שעבד:
        ${shiftsSummary}

        אנא ספק ניתוח יסודי ומעמיק על בסיס נתונים זה. בנה את התגובה שלך עם כותרת ברורה ונקודות מפורטות. עבור מעבר להצהרות גנריות וספק מספרים ותצפיות ספציפיות.

        **הניתוח שלך חייב לכלול את הנקודות הספציפיות הבאות:**
        1. **סך כמות המשמרות:** ציין את המספר הכולל של המשמרות, והפילוח המדויק בין משמרות בוקר וערב.
        2. **עבודה בימי שישי:** ספור במדויק כמה משמרות שישי עבד העובד החודש.
        3. **ימי עבודה רצופים:** זהה את הרצף הארוך ביותר של ימי עבודה רצופים.
        4. **חלוקת עומס העבודה:** הערה על חלוקת עומס העבודה. האם יש שבועות שהיו כבדים או קלים במיוחד בהשוואה לאחרים?
        5. **שינויים בזמני המשמרות:** זהה כל משמרות עם זמני התחלה או סיום שחורגים מהסטנדרט והערה עליהן.
        6. **מסקנות כלליות:** ספק משפט מסכם המתאר את דפוס העבודה של החודש, תוך מתן תובנה מקצועית מבוססת נתונים.
        7. **המלצות:** הצע המלצות לשיפור או התאמות אם נדרש.

        השב רק עם טקסט הניתוח בעברית. אל תוסיף הערות פתיחה או סיכום מחוץ לניתוח עצמו.
    `;
}

exports.handler = async function(event, context) {
    // Add CORS headers
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Content-Type': 'application/json'
    };

    // Handle preflight requests
    if (event.httpMethod === 'OPTIONS') {
        return {
            statusCode: 200,
            headers,
            body: ''
        };
    }

    // 1. Accept only POST requests
    if (event.httpMethod !== 'POST') {
        return { 
            statusCode: 405, 
            headers,
            body: JSON.stringify({ error: 'Method Not Allowed' })
        };
    }

    try {
        // 2. Rate limiting
        const clientId = event.headers['x-forwarded-for'] || event.headers['client-ip'] || 'unknown';
        if (!checkRateLimit(clientId)) {
            return {
                statusCode: 429,
                headers,
                body: JSON.stringify({ 
                    error: 'חריגה ממגבלת הבקשות. נסה שוב בעוד דקה.',
                    retryAfter: 60
                })
            };
        }

        // 3. Get API key from Netlify environment variables
        const apiKey = process.env.GEMINI_API_KEY;
        if (!apiKey) {
            console.error("Server configuration error: Gemini API key is missing.");
            return { 
                statusCode: 500, 
                headers,
                body: JSON.stringify({ 
                    error: "שגיאת תצורת שרת: מפתח API חסר." 
                }) 
            };
        }
        
        // 4. Parse and validate request body
        let requestData;
        try {
            requestData = JSON.parse(event.body);
        } catch (parseError) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: "פורמט JSON לא תקין בבקשה." 
                })
            };
        }

        const { employee, month, shifts } = requestData;
        
        // Enhanced input validation
        if (!employee || !month || !shifts) {
            return { 
                statusCode: 400, 
                headers,
                body: JSON.stringify({ 
                    error: "חסרים נתוני עובד, חודש או משמרות בבקשה." 
                }) 
            };
        }

        // Sanitize inputs
        const sanitizedEmployee = sanitizeString(employee, MAX_EMPLOYEE_NAME_LENGTH);
        const sanitizedMonth = sanitizeString(month, MAX_MONTH_LENGTH);

        if (!sanitizedEmployee || !sanitizedMonth) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: "נתוני עובד או חודש לא תקינים." 
                })
            };
        }

        // Validate shifts array
        if (!Array.isArray(shifts)) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: "נתוני המשמרות חייבים להיות מערך." 
                })
            };
        }

        if (shifts.length === 0) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: "לא נמצאו משמרות לניתוח." 
                })
            };
        }

        if (shifts.length > MAX_SHIFTS_PER_REQUEST) {
            return {
                statusCode: 400,
                headers,
                body: JSON.stringify({ 
                    error: `מספר המשמרות חורג מהמגבלה של ${MAX_SHIFTS_PER_REQUEST} משמרות לבקשה.` 
                })
            };
        }

        // Validate each shift structure
        for (let i = 0; i < shifts.length; i++) {
            if (!validateShiftStructure(shifts[i])) {
                return {
                    statusCode: 400,
                    headers,
                    body: JSON.stringify({ 
                        error: `מבנה משמרת לא תקין במשמרת מספר ${i + 1}.` 
                    })
                };
            }
        }

        // 5. Generate enhanced prompt
        const prompt = generateEnhancedPrompt(sanitizedEmployee, sanitizedMonth, shifts);

        // 6. Configure API and send request with retry logic
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-exp:generateContent?key=${apiKey}`;
        
        const payload = {
            contents: [{ 
                parts: [{ text: prompt }] 
            }],
            generationConfig: {
                temperature: 0.3,
                topK: 40,
                topP: 0.95,
                maxOutputTokens: 2048,
            },
            safetySettings: [
                {
                    category: "HARM_CATEGORY_HARASSMENT",
                    threshold: "BLOCK_MEDIUM_AND_ABOVE"
                },
                {
                    category: "HARM_CATEGORY_HATE_SPEECH", 
                    threshold: "BLOCK_MEDIUM_AND_ABOVE"
                }
            ]
        };

        console.log(`Processing analysis request for employee: ${sanitizedEmployee}, month: ${sanitizedMonth}, shifts: ${shifts.length}`);

        const result = await callGeminiWithRetry(apiUrl, payload);
        
        // 7. Enhanced response validation and extraction
        if (!result?.candidates?.[0]?.content?.parts?.[0]?.text) {
            console.error("Invalid response structure from Gemini API:", JSON.stringify(result));
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ 
                    error: "לא התקבלה תשובה תקינה מהשירות. נסה שוב מאוחר יותר." 
                })
            };
        }

        const analysis = result.candidates[0].content.parts[0].text.trim();
        
        if (!analysis || analysis.length < 50) {
            console.error("Analysis too short or empty:", analysis);
            return {
                statusCode: 500,
                headers,
                body: JSON.stringify({ 
                    error: "הניתוח שהתקבל קצר מדי או ריק. נסה שוב." 
                })
            };
        }

        console.log(`Successfully generated analysis for ${sanitizedEmployee} - ${sanitizedMonth}`);

        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ 
                analysis: analysis,
                metadata: {
                    employee: sanitizedEmployee,
                    month: sanitizedMonth,
                    shiftsAnalyzed: shifts.length,
                    timestamp: new Date().toISOString()
                }
            })
        };

    } catch (error) {
        console.error("Error in analyze-month function:", error);
        
        // Handle specific error types
        let errorMessage = "שגיאה פנימית בשרת.";
        let statusCode = 500;
        
        if (error.name === 'AbortError') {
            errorMessage = "הבקשה הופסקה בגלל timeout. נסה שוב.";
            statusCode = 408;
        } else if (error.message.includes('Gemini API Error')) {
            errorMessage = "שגיאה בשירות הניתוח. נסה שוב מאוחר יותר.";
            statusCode = 502;
        }
        
        return {
            statusCode,
            headers,
            body: JSON.stringify({ 
                error: errorMessage,
                requestId: context.awsRequestId || 'unknown'
            })
        };
    }
};