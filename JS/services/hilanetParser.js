import { DAYS, DEFAULT_SHIFT_TIMES } from "../config.js";

/** Triggers the hidden file input when the "Upload Hilanet" button is clicked. */
export function handleUploadHilanetBtnClick() {
    // This function needs access to DOMElements, which creates a circular dependency.
    // It's better to keep this logic in main.js where DOMElements is defined.
    // For now, we assume this will be called from an event listener in main.js
    const uploadInput = document.getElementById('upload-hilanet-input');
    if (uploadInput) {
        uploadInput.click();
    }
}

/**
 * Calls the secure Netlify function to extract shift data from an image.
 * @param {string} imageDataBase64 - Base64 encoded image data (data URL).
 * @param {number} detectedMonth - The month for context.
 * @param {number} detectedYear - The year for context.
 * @param {string} employeeName - The employee name for context.
 * @returns {Promise<Object[]|null>} A promise that resolves to an array of extracted shift objects, or null on error.
 * @throws {Error} If there is a server or parsing error.
 */
export async function callGeminiForShiftExtraction(imageDataBase64, detectedMonth, detectedYear, employeeName) {
    const prompt = `
        You are an expert at extracting structured data from tables in Hebrew documents.
        The provided image is a page from a work schedule report for month ${detectedMonth}/${detectedYear} for employee ${employeeName}.
        Your task is to find the main table containing daily entries. For each row that represents a day, extract the following information:
        1. "day": The day of the month (the number, e.g., '01', '02', '03').
        2. "dayOfWeekHebrew": The Hebrew day of the week (e.g., 'א', 'ב', 'ג', 'ד', 'ה', 'ו', 'ש'). If not explicitly present, infer from the date.
        3. "entryTime": The entry time (כניסה) in HH:MM format. If not present, use an empty string.
        4. "exitTime": The exit time (יציאה) in HH:MM format. If not present, use an empty string.
        5. "comments": Any relevant comments or special status for the day (e.g., 'חופשה', 'ש'). If no comments, use an empty string.
        Extract data from all rows that represent a day, even if no times are present (e.g., days off).
        Ensure times are always in HH:MM format (pad with leading zero if needed, e.g., "8:00" -> "08:00").
        Respond ONLY with a valid JSON array of objects. Do not include markdown, text, or any explanations.
    `;

    try {
        const response = await fetch('/.netlify/functions/callGemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageDataBase64, prompt })
        });

        if (!response.ok) {
            const errorBody = await response.json().catch(() => ({ error: 'Unknown server error' }));
            throw new Error(`Server function failed: ${errorBody.error}`);
        }

        const result = await response.json();

        if (result.candidates && result.candidates[0]?.content?.parts[0]?.text) {
            const jsonText = result.candidates[0].content.parts[0].text;
            try {
                return JSON.parse(jsonText);
            } catch (parseError) {
                console.error("Failed to parse Gemini's JSON response:", parseError, "Raw JSON:", jsonText);
                throw new Error("שירות ניתוח התמונה החזיר תשובה בפורמט לא צפוי.");
            }
        } else {
            console.warn('Gemini response did not contain expected data structure:', result);
            return [];
        }
    } catch (error) {
        console.error("Error calling Netlify function or parsing response:", error);
        throw new Error(`שגיאה בתקשורת עם שירות ניתוח התמונה: ${error.message}`);
    }
}


/**
 * Structures an array of raw shift data from Gemini into a date-keyed object.
 * @param {Object[]} geminiData - The array of objects returned by Gemini.
 * @param {number} detectedMonth - The detected month of the report.
 * @param {number} detectedYear - The detected year of the report.
 * @param {string} employeeName - The name of the employee.
 * @returns {Object} The structured shifts object, keyed by date.
 * @throws {Error} If the Gemini data is not in the expected format.
 */
export function structureShifts(geminiData, detectedMonth, detectedYear, employeeName) {
    const shifts = {};
    if (!Array.isArray(geminiData)) {
        console.error("Gemini response is not an array:", geminiData);
        throw new Error('התשובה מ-Gemini לא הייתה בפורמט הצפוי (Array).');
    }

    for (const item of geminiData) {
        if (item === null || typeof item !== 'object' || !item.day) {
            console.warn(`Skipping invalid item (missing day or invalid type):`, item);
            continue;
        }

        const day = String(parseInt(item.day, 10)).padStart(2, '0');
        const monthStr = String(detectedMonth).padStart(2, '0');
        const dateString = `${detectedYear}-${monthStr}-${day}`;

        const rawEntryTime = typeof item.entryTime === 'string' ? item.entryTime : '';
        const rawExitTime = typeof item.exitTime === 'string' ? item.exitTime : '';
        const comments = typeof item.comments === 'string' ? item.comments : '';

        if (!shifts[dateString]) {
            shifts[dateString] = {};
        }

        if (comments.includes('ש') || comments.includes('חופשה') || item.dayOfWeekHebrew?.includes('ש')) {
            shifts[dateString]['morning'] = { employee: 'none', ...DEFAULT_SHIFT_TIMES.morning };
            shifts[dateString]['evening'] = { employee: 'none', ...DEFAULT_SHIFT_TIMES.evening };
            continue;
        }

        if (rawEntryTime && rawExitTime) {
            const formatTime = (timeStr) => {
                if (!timeStr) return '';
                const parts = timeStr.split(':');
                if (parts.length === 2) {
                    const [hours, minutes] = parts;
                    return `${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}:00`;
                }
                return timeStr;
            };

            const entryTime = formatTime(rawEntryTime);
            const exitTime = formatTime(rawExitTime);
            const startHour = parseInt(entryTime.split(':')[0], 10);

            let shiftType = 'other';
            if (startHour >= 6 && startHour < 14) {
                shiftType = 'morning';
            } else if (startHour >= 14 && startHour < 23) {
                shiftType = 'evening';
            }

            if (shiftType !== 'other') {
                shifts[dateString][shiftType] = {
                    employee: employeeName,
                    start: entryTime,
                    end: exitTime
                };
            }
        }
    }
    return shifts;
}

/**
 * Parses XLSX data for a specific employee ('מאור').
 * @param {Array<Array<string>>} xlsxData - The data parsed from the Excel file.
 * @returns {Object} A structured object of shifts.
 * @throws {Error} If required columns are missing in the Excel file.
 */
export function parseHilanetXLSXForMaor(xlsxData) {
    const shifts = {};
    if (!xlsxData || xlsxData.length < 2) return shifts;

    const headers = xlsxData[0];
    const dateColIndex = headers.indexOf('תאריך');
    const employeeNameColIndex = headers.indexOf('שם עובד');
    const shiftTypeColIndex = headers.indexOf('משמרת');
    const startTimeColIndex = headers.indexOf('שעת התחלה');
    const endTimeColIndex = headers.indexOf('שעת סיום');

    if ([dateColIndex, employeeNameColIndex, shiftTypeColIndex, startTimeColIndex, endTimeColIndex].includes(-1)) {
        throw new Error('קובץ חילנט אינו מכיל את העמודות הנדרשות (תאריך, שם עובד, משמרת, שעת התחלה, שעת סיום).');
    }

    for (let i = 1; i < xlsxData.length; i++) {
        const row = xlsxData[i];
        const rawDate = row[dateColIndex];
        const employee = row[employeeNameColIndex];
        const shiftRaw = row[shiftTypeColIndex];
        const startTime = row[startTimeColIndex];
        const endTime = row[endTimeColIndex];

        if (employee === 'מאור' && rawDate && shiftRaw && startTime && endTime) {
            let dateString;
            if (typeof rawDate === 'number') {
                const excelEpoch = new Date(Date.UTC(1899, 11, 30));
                const jsDate = new Date(excelEpoch.getTime() + rawDate * 24 * 60 * 60 * 1000);
                dateString = jsDate.toISOString().split('T')[0];
            } else if (typeof rawDate === 'string') {
                const parts = rawDate.split(/[\/\-.]/);
                if (parts.length >= 2) {
                    const day = parts[0];
                    const month = parts[1];
                    const year = parts[2] || new Date().getFullYear();
                    dateString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                }
            }
            if (!dateString) continue;

            let shiftType;
            const shiftLower = String(shiftRaw).toLowerCase();
            const startTimeStr = String(startTime);

            if (shiftLower.includes('בוקר') || startTimeStr.startsWith('07') || startTimeStr.startsWith('08')) {
                shiftType = 'morning';
            } else if (shiftLower.includes('ערב') || startTimeStr.startsWith('13') || startTimeStr.startsWith('14')) {
                shiftType = 'evening';
            } else {
                continue;
            }

            if (!shifts[dateString]) shifts[dateString] = {};
            shifts[dateString][shiftType] = {
                employee: employee,
                start: String(startTime).substring(0, 5) + ':00',
                end: String(endTime).substring(0, 5) + ':00'
            };
        }
    }
    return shifts;
}

/**
 * Compares two schedule objects (Google Sheets vs. Hilanet) and identifies differences.
 * @param {Object} googleSheetsShifts - Shifts from Google Sheets.
 * @param {Object} hilanetShifts - Shifts from Hilanet file.
 * @returns {Object[]} An array of difference objects.
 */
export function compareSchedules(googleSheetsShifts, hilanetShifts) {
    const differences = [];
    const allDates = new Set([...Object.keys(googleSheetsShifts), ...Object.keys(hilanetShifts)]);
    const sortedDates = Array.from(allDates).sort((a, b) => new Date(a) - new Date(b));

    sortedDates.forEach(date => {
        const gsDay = googleSheetsShifts[date] || {};
        const hlDay = hilanetShifts[date] || {};
        const dayName = DAYS[new Date(date).getDay()];

        ['morning', 'evening'].forEach(shiftType => {
            // Skip evening check on Shabbat
            if (shiftType === 'evening' && dayName === 'שבת') return;

            const gsShift = gsDay[shiftType];
            const hlShift = hlDay[shiftType];
            const id = `${date}-${shiftType}`;

            const isGsShiftPresent = gsShift && gsShift.employee !== 'none';
            const isHlShiftPresent = hlShift && hlShift.employee !== 'none';

            if (isGsShiftPresent && !isHlShiftPresent) {
                differences.push({ id, type: 'removed', date, dayName, shiftType, googleSheets: gsShift, hilanet: { employee: 'none', start: '', end: '' } });
            } else if (!isGsShiftPresent && isHlShiftPresent) {
                differences.push({ id, type: 'added', date, dayName, shiftType, googleSheets: { employee: 'none', start: '', end: '' }, hilanet: hlShift });
            } else if (isGsShiftPresent && isHlShiftPresent) {
                if (gsShift.start !== hlShift.start || gsShift.end !== hlShift.end || gsShift.employee !== hlShift.employee) {
                    differences.push({ id, type: 'changed', date, dayName, shiftType, googleSheets: gsShift, hilanet: hlShift });
                }
            }
        });
    });
    return differences;
}

// Helper function to render a PDF page to a canvas and get a data URL
async function getPageImage(page) {
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({ canvasContext: context, viewport: viewport }).promise;
    return canvas.toDataURL();
}


export async function processHilanetData(file) {
    const pdf = await pdfjsLib.getDocument(URL.createObjectURL(file)).promise;
    const page = await pdf.getPage(1);
    const textContent = await page.getTextContent();
    const rawText = textContent.items.map(item => item.str).join(' ');

    const monthYearMatch = rawText.match(/לחודש (\d{2})\/(\d{2,4})/);
    const employeeNameMatch = rawText.match(/(\S+ \d{9} \S+)/);

    if (!monthYearMatch || !employeeNameMatch) {
        throw new Error('לא ניתן היה לחלץ את שם העובד או החודש מהמסמך.');
    }

    const detectedMonth = parseInt(monthYearMatch[1], 10);
    let detectedYear = parseInt(monthYearMatch[2], 10);
    if (detectedYear < 100) {
        detectedYear += 2000;
    }
    const employeeName = employeeNameMatch[1].split(' ')[0];
    const imageDataBase64 = await getPageImage(page);
    const geminiData = await callGeminiForShiftExtraction(imageDataBase64, detectedMonth, detectedYear, employeeName);

    return structureShifts(geminiData, detectedMonth, detectedYear, employeeName);
}