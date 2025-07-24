import { DAYS, DEFAULT_SHIFT_TIMES } from "../config.js";
import { displayAPIError, DOMElements, updateStatus } from "../main.js";

/** Triggers the hidden file input when the "Upload Hilanet" button is clicked. */
export function handleUploadHilanetBtnClick() {
    DOMElements.uploadHilanetInput.click();
}

/**
 * Calls the secure Netlify function to extract shift data from an image.
 * @param {string} imageDataBase64 - Base64 encoded image data (data URL).
 * @param {number} detectedMonth - The month for context.
 * @param {number} detectedYear - The year for context.
 * @param {string} employeeName - The employee name for context.
 * @returns {Promise<Object[]|null>} A promise that resolves to an array of extracted shift objects, or null on error.
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
        // Call our own serverless function
        const response = await fetch('/.netlify/functions/callGemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageDataBase64, prompt })
        });

        if (!response.ok) {
            const errorBody = await response.json();
            throw new Error(`Server function failed: ${errorBody.error || 'Unknown server error'}`);
        }

        const result = await response.json();

        if (result.candidates && result.candidates[0]?.content?.parts[0]?.text) {
            const jsonText = result.candidates[0].content.parts[0].text;
            try {
                return JSON.parse(jsonText);
            } catch (parseError) {
                console.error("Failed to parse Gemini's JSON response:", parseError, "Raw JSON:", jsonText);
                updateStatus("שגיאה: שירות ניתוח התמונה החזיר תשובה בפורמט לא צפוי.", "error");
                return [];
            }
        } else {
            console.warn('Gemini response did not contain expected data structure:', result);
            return [];
        }
    } catch (error) {
        console.error("Error calling Netlify function or parsing response:", error);
        displayAPIError(error, "שגיאה בתקשורת עם שירות ניתוח התמונה");
        return [];
    }
}


/**
 * Structures an array of raw shift data from Gemini into a date-keyed object.
 * @param {Object[]} geminiData - The array of objects returned by Gemini.
 * @param {number} detectedMonth - The detected month of the report.
 * @param {number} detectedYear - The detected year of the report.
 * @param {string} employeeName - The name of the employee.
 * @returns {Object} The structured shifts object, keyed by date.
 */
export function structureShifts(geminiData, detectedMonth, detectedYear, employeeName) {
    const shifts = {};
    if (!Array.isArray(geminiData)) {
        console.error("Gemini response is not an array:", geminiData);
        updateStatus('שגיאה: התשובה מ-Gemini לא הייתה בפורמט הצפוי.', 'error');
        return {};
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

            shifts[dateString][shiftType] = {
                employee: employeeName,
                start: entryTime,
                end: exitTime
            };
        }
    }
    return shifts;
}
export function parseHilanetXLSXForMaor(xlsxData) {
    const shifts = {};
    if (!xlsxData || xlsxData.length < 2) return shifts;

    const headers = xlsxData[0];
    const dateColIndex = headers.indexOf('תאריך');
    const employeeNameColIndex = headers.indexOf('שם עובד');
    const shiftTypeColIndex = headers.indexOf('משמרת');
    const startTimeColIndex = headers.indexOf('שעת התחלה');
    const endTimeColIndex = headers.indexOf('שעת סיום');

    if (dateColIndex === -1 || employeeNameColIndex === -1 || shiftTypeColIndex === -1 || startTimeColIndex === -1 || endTimeColIndex === -1) {
        updateStatus('שגיאה: קובץ חילנט אינו מכיל את העמודות הנדרשות (תאריך, שם עובד, משמרת, שעת התחלה, שעת סעת סיום).', 'error', false);
        return shifts;
    }

    for (let i = 1; i < xlsxData.length; i++) {
        const row = xlsxData[i];
        const rawDate = row[dateColIndex];
        const employee = row[employeeNameColIndex];
        const shiftRaw = row[shiftTypeColIndex];
        const startTime = row[startTimeColIndex];
        const endTime = row[endTimeColIndex];

        if (employee === 'מאור' && rawDate !== undefined && shiftRaw !== undefined && startTime !== undefined && endTime !== undefined) {
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
                    dateString = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
                } else {
                    const parsedDate = new Date(rawDate);
                    if (!isNaN(parsedDate.getTime())) dateString = parsedDate.toISOString().split('T')[0];
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
    const sortedDates = Array.from(allDates).sort();

    sortedDates.forEach(date => {
        const gsDay = googleSheetsShifts[date] || {};
        const hlDay = hilanetShifts[date] || {};
        const dayName = DAYS[new Date(date).getDay()];

        // Check morning shift
        const gsMorning = gsDay.morning;
        const hlMorning = hlDay.morning;

        if (gsMorning && hlMorning) {
            if (gsMorning.start !== hlMorning.start || gsMorning.end !== hlMorning.end || gsMorning.employee !== hlMorning.employee) {
                differences.push({
                    id: `${date}-morning`,
                    type: 'changed',
                    date,
                    dayName,
                    shiftType: 'morning',
                    googleSheets: gsMorning,
                    hilanet: hlMorning
                });
            }
        } else if (gsMorning && !hlMorning) {
            // Shift exists in Google Sheets but not in Hilanet (or Hilanet has it as 'none')
            if (gsMorning.employee !== 'none') { // Only report if it was actually assigned to someone
                differences.push({
                    id: `${date}-morning`,
                    type: 'removed',
                    date,
                    dayName,
                    shiftType: 'morning',
                    googleSheets: gsMorning,
                    hilanet: {
                        employee: 'none',
                        start: '',
                        end: ''
                    }
                });
            }
        } else if (!gsMorning && hlMorning) {
            // Shift exists in Hilanet but not in Google Sheets (or Google Sheets has it as 'none')
            if (hlMorning.employee !== 'none') { // Only report if it was actually assigned to someone
                differences.push({
                    id: `${date}-morning`,
                    type: 'added',
                    date,
                    dayName,
                    shiftType: 'morning',
                    googleSheets: {
                        employee: 'none',
                        start: '',
                        end: ''
                    },
                    hilanet: hlMorning
                });
            }
        }

        // Check evening shift (and ensure it's not Saturday)
        if (dayName !== 'שבת') {
            const gsEvening = gsDay.evening;
            const hlEvening = hlDay.evening;

            if (gsEvening && hlEvening) {
                if (gsEvening.start !== hlEvening.start || gsEvening.end !== hlEvening.end || gsEvening.employee !== hlEvening.employee) {
                    differences.push({
                        id: `${date}-evening`,
                        type: 'changed',
                        date,
                        dayName,
                        shiftType: 'evening',
                        googleSheets: gsEvening,
                        hilanet: hlEvening
                    });
                }
            } else if (gsEvening && !hlEvening) {
                if (gsEvening.employee !== 'none') {
                    differences.push({
                        id: `${date}-evening`,
                        type: 'removed',
                        date,
                        dayName,
                        shiftType: 'evening',
                        googleSheets: gsEvening,
                        hilanet: {
                            employee: 'none',
                            start: '',
                            end: ''
                        }
                    });
                }
            } else if (!gsEvening && hlEvening) {
                if (hlEvening.employee !== 'none') {
                    differences.push({
                        id: `${date}-evening`,
                        type: 'added',
                        date,
                        dayName,
                        shiftType: 'evening',
                        googleSheets: {
                            employee: 'none',
                            start: '',
                            end: ''
                        },
                        hilanet: hlEvening
                    });
                }
            }
        }
    });
    return differences;
}

