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
    // מחליף כל רצף של רווחים ברווח בודד ומסיר רווחים בין אותיות עבריות
    return text.replace(/\s+/g, ' ').replace(/([א-ת])\s(?=[א-ת])/g, '$1').trim();
}

/**
 * מחלץ שם עובד מהטקסט הנקי.
 * @param {string} cleanedText - הטקסט לאחר נורמליזציה.
 * @returns {string|null} שם העובד שנמצא או null.
 */
function extractEmployeeName(cleanedText) {
    const employeeNamePatterns = [
        /(?:בן סימון|סימון בן)\s+(מאור)/i,
        /מאור\s+(?:בן סימון|סימון)/i,
        /עובד:\s*([\u0590-\u05FF\s]+)\s*\d{9}/i // תבנית כללית יותר
    ];

    for (const pattern of employeeNamePatterns) {
        const match = cleanedText.match(pattern);
        if (match && match[1]) {
            // החזר את השם "מאור" אם נמצאה התאמה
            if (match[1].includes('מאור')) return 'מאור';
        }
    }
    // נסה למצוא את השם "מאור" באופן כללי
     if (cleanedText.includes('מאור')) {
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
    const dateMatch = cleanedText.match(/לחודש\s+(\d{2})\/(\d{2,4})/);
    if (dateMatch) {
        const year = parseInt(dateMatch[2], 10);
        return {
            month: parseInt(dateMatch[1], 10),
            year: year < 100 ? 2000 + year : year
        };
    }
    return { month: new Date().getMonth() + 1, year: new Date().getFullYear() }; // ברירת מחדל
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