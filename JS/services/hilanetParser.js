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
    // תיקון: שימוש במשתנים month ו-year שהתקבלו כפרמטרים
    const prompt = `
        You are an expert at extracting structured data from tables in Hebrew documents.
        The provided image is a page from a work schedule report for month ${month}/${year} for employee ${employeeName}.

        Your task is to find the main table containing daily entries. For each row that represents a day, extract the following information:
        1. "day": The day of the month (the number, e.g., '01', '02', '03').
        2. "dayOfWeekHebrew": The Hebrew day of the week (e.g., 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'). If not explicitly present, infer from the date.
        3. "entryTime": The entry time (כניסה) in HH:MM format. If not present, use an empty string.
        4. "exitTime": The exit time (יציאה) in HH:MM format. If not present, use an empty string.
        5. "comments": Any relevant comments or special status for the day (e.g., 'חופשה', 'ש'). If no comments, use an empty string.

        - Extract data from all rows that represent a day, even if no times are present (e.g., days off).
        - Ensure times are always in HH:MM format (pad with leading zero if needed, e.g., "8:00" -> "08:00").
        - Respond ONLY with a valid JSON array of objects. Do not include markdown, text, or any explanations.

        Example of a valid response:
        [
          { "day": 1, "dayOfWeekHebrew": "ג", "entryTime": "08:00", "exitTime": "16:00", "comments": "" },
          { "day": 2, "dayOfWeekHebrew": "ד", "entryTime": "", "exitTime": "", "comments": "" },
          { "day": 3, "dayOfWeekHebrew": "ה", "entryTime": "07:00", "exitTime": "12:00", "comments": "" },
          { "day": 4, "dayOfWeekHebrew": "ו", "entryTime": "07:00", "exitTime": "16:00", "comments": "" },
          { "day": 5, "dayOfWeekHebrew": "ש", "entryTime": "", "exitTime": "", "comments": "ש" },
          { "day": 6, "dayOfWeekHebrew": "א", "entryTime": "13:00", "exitTime": "22:00", "comments": "" }
        ]
    `; // סוף ה-prompt
    
    try {
        const response = await fetch('/.netlify/functions/callGemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageDataBase64, prompt })
        });

        if (!response.ok) {
            // נסה לקרוא את גוף השגיאה כ-JSON, אך הימנע מקריסה אם הוא ריק
            let errorData = {};
            try {
                errorData = await response.json();
            } catch (e) {
                // גוף השגיאה אינו JSON או שהוא ריק
                errorData = { error: `Server responded with status: ${response.status}` };
            }
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
        // תיקון: שימוש ב-entryTime ו-exitTime במקום startTime ו-endTime
        // וגם בדיקה שהשעות אינן ריקות
        if (!shift.day || !shift.entryTime || !shift.exitTime) {
            return; // דלג על ימים ללא נתוני שעות מלאים
        }

        const dateString = `${year}-${String(month).padStart(2, '0')}-${String(shift.day).padStart(2, '0')}`;
        // תיקון: שימוש ב-entryTime לחישוב סוג המשמרת
        const shiftType = parseInt(shift.entryTime.split(':')[0], 10) < 12 ? 'morning' : 'evening';
        
        if (!structured[dateString]) {
            structured[dateString] = {};
        }
        
        structured[dateString][shiftType] = {
            employee: employeeName,
            // תיקון: שימוש ב-entryTime ו-exitTime והוספת שניות
            start: `${shift.entryTime}:00`,
            end: `${shift.exitTime}:00`,
        };
    });
    return structured;
}

/**
 * פונקציית השוואה.
 */
export function compareSchedules(googleSheetsShifts, hilanetShifts) {
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
        const day = parseInt(row[0], 10);
        if (!isNaN(day) && day >= 1 && day <= 31) {
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

/**
 * מטפל ביבוא של משמרות שנבחרו מההשוואה.
 * @param {Array} currentDifferences - מערך הפערים הנוכחי המוצג למשתמש.
 * @param {Object} allSchedules - אובייקט כלל הסידורים הקיים.
 * @returns {{updatedSchedules: Object, importedCount: number, selectedCount: number}} - אובייקט עם הסידור המעודכן וספירת הפעולות.
 */
export function handleImportSelectedHilanetShifts(currentDifferences, allSchedules) {
    const selectedIds = new Set(
        Array.from(document.querySelectorAll('.difference-checkbox:checked'))
        .map(cb => cb.dataset.diffId)
    );

    if (selectedIds.size === 0) {
        return { updatedSchedules: allSchedules, importedCount: 0, selectedCount: 0 };
    }

    let importedCount = 0;
    const newSchedules = JSON.parse(JSON.stringify(allSchedules));

    currentDifferences
        .filter(diff => selectedIds.has(diff.id))
        .forEach(diff => {
            const weekId = getWeekId(new Date(diff.date));
            const dayName = new Date(diff.date).toLocaleDateString('he-IL', { weekday: 'long' });
            const shiftType = diff.shiftType;

            if (!newSchedules[weekId]) {
                newSchedules[weekId] = {};
            }
            if (!newSchedules[weekId][dayName]) {
                newSchedules[weekId][dayName] = {};
            }

            if (diff.type === 'added' || diff.type === 'changed') {
                newSchedules[weekId][dayName][shiftType] = diff.hilanet;
                importedCount++;
            } else if (diff.type === 'removed') {
                if (newSchedules[weekId][dayName] && newSchedules[weekId][dayName][shiftType]) {
                    delete newSchedules[weekId][dayName][shiftType];
                }
            }
    });

    return { 
        updatedSchedules: newSchedules, 
        importedCount: importedCount, 
        selectedCount: selectedIds.size 
    };
}