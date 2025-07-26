// קובץ: JS/services/hilanetParser.js

import { DEFAULT_SHIFT_TIMES } from '../config.js';
import { getWeekId } from '../utils.js';

// --- פונקציות חדשות לניקוי וניתוח טקסט ---

/**
 * מנקה טקסט שחולץ מ-PDF על ידי הסרת רווחים כפולים ומיותרים.
 * @param {string} text - הטקסט הגולמי מה-PDF.
 * @returns {string} טקסט נקי ומוכן לעיבוד.
 */
function normalizeText(text) {
    if (!text) return '';
    return text
        // מחליף תווים מיוחדים ברווחים
        .replace(/[.,\/#!$%\^&\*;:{}=\-_`~()]/g, ' ')
        // מחליף סימני פיסוק נפוצים בעברית
        .replace(/[״"׳']/g, ' ')
        // מחליף רצף של רווחים ברווח בודד
        .replace(/\s+/g, ' ')
        // מסיר רווחים בין אותיות עבריות
        .replace(/([א-ת])\s(?=[א-ת])/g, '$1')
        // מתקן מספרים שהופרדו בטעות
        .replace(/(\d)\s+(?=\d)/g, '$1')
        // מנקה רווחים מיותרים
        .trim();
}

/**
 * מחלץ שם עובד מהטקסט הנקי.
 * @param {string} cleanedText - הטקסט לאחר נורמליזציה.
 * @returns {string|null} שם העובד שנמצא או null.
 */
function extractEmployeeName(cleanedText) {
    // תבניות שונות לזיהוי שם העובד
    const employeeNamePatterns = [
        // תבניות ספציפיות למאור
        /(?:בן[- ]סימון|סימון[- ]בן)\s*(?:מאור|מאיר)/i,
        /(?:מאור|מאיר)\s*(?:בן[- ]סימון|סימון[- ]בן)/i,
        // תבניות כלליות יותר
        /עובד:?\s*([\u0590-\u05FF\s]+(?:\s+בן\s+[\u0590-\u05FF\s]+)?)\s*\d{9}/i,
        /שם\s*(?:עובד|מלא):?\s*([\u0590-\u05FF\s]+)/i,
        /ת\.?ז\.?:?\s*\d{9}\s*([\u0590-\u05FF\s]+)/i
    ];

    // נסה את כל התבניות
    for (const pattern of employeeNamePatterns) {
        const match = cleanedText.match(pattern);
        if (match) {
            const extractedName = match[1] ? match[1].trim() : null;
            // בדוק אם השם מכיל "מאור" או וריאציות שלו
            if (extractedName && /מאור|מאיר/i.test(extractedName)) {
                return 'מאור';
            }
        }
    }

    // חיפוש פשוט של המילה "מאור" בכל הטקסט
    if (/\b(מאור|מאיר)\b/i.test(cleanedText)) {
        return 'מאור';
    }

    return null;
}

/**
 * מחלץ חודש ושנה מהטקסט.
 * @param {string} cleanedText - הטקסט הנקי.
 * @returns {{month: number, year: number}} אובייקט עם חודש ושנה.
 */
function extractDate(cleanedText) {
    // מערך של תבניות תאריך שונות
    const datePatterns = [
        // תבנית סטנדרטית: "לחודש MM/YY" או "לחודש MM/YYYY"
        /לחודש\s*(\d{1,2})\/(\d{2,4})/,
        // תבנית עם מקף: "לחודש MM-YYYY"
        /לחודש\s*(\d{1,2})-(\d{2,4})/,
        // תבנית מלאה בעברית: "חודש MM שנת YYYY" או "חודש MM שנה YYYY"
        /חודש\s*(\d{1,2})\s*שנ[הת]\s*(\d{2,4})/,
        // תבנית עם נקודה: "לחודש MM.YYYY"
        /לחודש\s*(\d{1,2})\.(\d{2,4})/,
        // תבנית כללית: חיפוש של MM/YYYY בכל מקום
        /(\d{1,2})[\/\.-](\d{2,4})/
    ];

    // עבור על כל התבניות עד שנמצא התאמה
    for (const pattern of datePatterns) {
        const match = cleanedText.match(pattern);
        if (match) {
            let month = parseInt(match[1], 10);
            let year = parseInt(match[2], 10);

            // וודא שהחודש תקין
            if (month >= 1 && month <= 12) {
                // טיפול בפורמט שנה קצר
                if (year < 100) {
                    year = 2000 + year;
                }
                // וודא שהשנה הגיונית
                if (year >= 2000 && year <= 2100) {
                    return { month, year };
                }
            }
        }
    }

    // אם לא נמצא תאריך, נסה לחפש שם חודש בעברית
    const hebrewMonths = {
        'ינואר': 1, 'פברואר': 2, 'מרץ': 3, 'אפריל': 4, 'מאי': 5, 'יוני': 6,
        'יולי': 7, 'אוגוסט': 8, 'ספטמבר': 9, 'אוקטובר': 10, 'נובמבר': 11, 'דצמבר': 12
    };

    for (const [monthName, monthNum] of Object.entries(hebrewMonths)) {
        if (cleanedText.includes(monthName)) {
            // חיפוש שנה בסביבת שם החודש
            const yearMatch = cleanedText.match(/\b(20\d{2})\b/);
            if (yearMatch) {
                return { month: monthNum, year: parseInt(yearMatch[1], 10) };
            }
        }
    }

    // אם שום דבר לא עבד, החזר את התאריך הנוכחי
    return { 
        month: new Date().getMonth() + 1, 
        year: new Date().getFullYear() 
    };
}

// --- פונקציות קיימות שעודכנו ---

/**
 * מעבד את כל הטקסט שחולץ מקובץ חילנט.
 * @param {string} rawText - הטקסט הגולמי מה-PDF.
 * @returns {Object} - אובייקט עם שם העובד, חודש ושנה.
 */
export function processHilanetData(rawText) {
    console.log("--- Full Document Text for Hilanet Processing ---");
    console.log(rawText);
    console.log("--- End of Document Text ---");

    const cleanedText = normalizeText(rawText);
    const employeeName = extractEmployeeName(cleanedText);
    const { month, year } = extractDate(cleanedText);

    if (!employeeName) {
        console.error("שם עובד לא נמצא. הטקסט שנסרק:", cleanedText.substring(0, 300));
        throw new Error("לא נמצא שם עובד במסמך");
    }

    console.log(`נתונים שחולצו: שם=${employeeName}, חודש=${month}, שנה=${year}`);
    return { employeeName, detectedMonth: month, detectedYear: year };
}


/**
 * קורא לפונקציית השרת של Gemini כדי לחלץ משמרות מתמונה.
 */
export async function callGeminiForShiftExtraction(imageDataBase64, month, year, employeeName) {
    const prompt = `
        נתח את טבלת הנוכחות בתמונה המצורפת עבור העובד ${employeeName} לחודש ${month}/${year}.
        התעלם משורות ריקות או שורות סיכום.
        עבור כל שורה עם תאריך ושעות, חלץ את הנתונים בפורמט JSON בלבד.
        הפורמט הרצוי הוא מערך של אובייקטים, כאשר כל אובייקט מייצג יום עבודה:
        [
          { "day": <מספר היום בחודש>, "startTime": "HH:MM", "endTime": "HH:MM" },
          ...
        ]
        אם יש כניסה ויציאה באותה שורה, זו משמרת אחת.
        אם יש שתי כניסות ושתי יציאות, פצל אותן לשתי משמרות נפרדות באותו יום.
        השב עם JSON בלבד, ללא טקסט מקדים או הסברים.
    `;

    try {
        const response = await fetch('/.netlify/functions/callGemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageDataBase64, prompt })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to communicate with the server.');
        }

        const result = await response.json();
        const jsonText = result.candidates[0].content.parts[0].text
            .replace(/```json/g, '')
            .replace(/```/g, '')
            .trim();

        return JSON.parse(jsonText);
    } catch (error) {
        console.error("Error calling Gemini for shift extraction:", error);
        throw new Error("Failed to extract shifts using AI. " + error.message);
    }
}


/**
 * מארגן את המשמרות שחולצו למבנה נתונים תקין.
 */
export function structureShifts(shifts, month, year, employeeName) {
    const structured = {};
    if (!Array.isArray(shifts)) return structured;

    shifts.forEach(shift => {
        const dateString = `${year}-${String(month).padStart(2, '0')}-${String(shift.day).padStart(2, '0')}`;
        const shiftType = parseInt(shift.startTime.split(':')[0], 10) < 10 ? 'morning' : 'evening';
        
        if (!structured[dateString]) {
            structured[dateString] = {};
        }
        
        structured[dateString][shiftType] = {
            employee: employeeName,
            start: shift.startTime.length === 5 ? `${shift.startTime}:00` : shift.startTime,
            end: shift.endTime.length === 5 ? `${shift.endTime}:00` : shift.endTime,
        };
    });
    return structured;
}

/**
 * פונקציית השוואה (נשארת ללא שינוי)
 */
export function compareSchedules(googleSheetsShifts, hilanetShifts) {
    // ... קוד ההשוואה שלך נשאר כאן ...
    const differences = [];
    const allDates = new Set([...Object.keys(googleSheetsShifts), ...Object.keys(hilanetShifts)]);

    allDates.forEach(date => {
        const gsDay = googleSheetsShifts[date] || {};
        const hlDay = hilanetShifts[date] || {};
        const dayName = new Date(date).toLocaleDateString('he-IL', { weekday: 'long' });

        ['morning', 'evening'].forEach(shiftType => {
            const gsShift = gsDay[shiftType];
            const hlShift = hlDay[shiftType];
            const id = `${date}-${shiftType}`;

            if (gsShift && !hlShift) {
                differences.push({ id, type: 'removed', date, dayName, shiftType, googleSheets: gsShift });
            } else if (!gsShift && hlShift) {
                differences.push({ id, type: 'added', date, dayName, shiftType, hilanet: hlShift });
            } else if (gsShift && hlShift) {
                if (gsShift.start !== hlShift.start || gsShift.end !== hlShift.end) {
                    differences.push({ id, type: 'changed', date, dayName, shiftType, googleSheets: gsShift, hilanet: hlShift });
                }
            }
        });
    });

    return differences.sort((a, b) => new Date(a.date) - new Date(b.date));
}

export function handleUploadHilanetBtnClick() {
    document.getElementById('upload-hilanet-input').click();
}

export function parseHilanetXLSXForMaor(data) {
    // ... קוד ה-XLSX שלך נשאר כאן ...
    const shifts = {};
    let employeeName = "מאור";
    let month = -1, year = -1;

    const dateRow = data.find(row => row.some(cell => typeof cell === 'string' && cell.includes('לחודש')));
    if (dateRow) {
        const dateCell = dateRow.find(cell => typeof cell === 'string' && cell.includes('לחודש'));
        const match = dateCell.match(/(\d{2})\/(\d{2,4})/);
        if (match) {
            month = parseInt(match[1]);
            year = parseInt(match[2]) < 100 ? 2000 + parseInt(match[2]) : parseInt(match[2]);
        }
    }

    if (month === -1 || year === -1) {
        console.error("Could not determine month/year from XLSX file.");
        return {};
    }

    data.forEach(row => {
        // Find a valid day number (numeric, first column)
        const day = parseInt(row[0], 10);
        if (!isNaN(day) && day >= 1 && day <= 31) {
            // Find start and end times in the row
            const timePattern = /\d{1,2}:\d{2}/;
            const times = row.filter(cell => typeof cell === 'string' && timePattern.test(cell));

            if (times.length >= 2) {
                const startTime = times[0];
                const endTime = times[1];
                const dateString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const shiftType = parseInt(startTime.split(':')[0]) < 12 ? 'morning' : 'evening';

                if (!shifts[dateString]) {
                    shifts[dateString] = {};
                }
                shifts[dateString][shiftType] = {
                    employee: employeeName,
                    start: `${startTime}:00`,
                    end: `${endTime}:00`
                };
            }
        }
    });

    return shifts;
}