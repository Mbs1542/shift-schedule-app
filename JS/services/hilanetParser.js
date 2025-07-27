
import { getWeekId, DAYS } from '../utils.js';

/**
 * Cleans text extracted from a PDF by removing extra spaces, focusing on time formats.
 * @param {string} text - The raw text from the PDF.
 * @returns {string} Cleaned text ready for processing.
 */
function normalizeText(text) {
    if (!text) return '';
    let cleanedText = text.replace(/\s+/g, ' ');
    cleanedText = cleanedText.replace(/(\d)\s+(\d)\s+:\s+(\d)\s+(\d)/g, '$1$2:$3$4');
    cleanedText = cleanedText.replace(/(\d)\s+(\d)\s?:\s?(\d\d)/g, '$1$2:$3');
    cleanedText = cleanedText.replace(/(\d\d)\s?:\s?(\d)\s+(\d)/g, '$1:$2$3');
    cleanedText = cleanedText.replace(/([א-ת])\s(?=[א-ת])/g, '$1').trim();
    return cleanedText;
}

/**
 * Extracts the employee's name from the cleaned text.
 * @param {string} cleanedText - The normalized text.
 * @returns {string|null} The found employee name or null.
 */
function extractEmployeeName(cleanedText) {
    const employeeNamePatterns = [
        /(?:בן סימון|סימון בן)\s+(מאור)/i,
        /מאור\s+(?:בן סימון|סימון)/i,
        /עובד\s*.*?(\d{9}).*?(מאור)/i,
        /עובד\s*([\u0590-\u05FF\s]+?)\s*\d{9}/i
    ];
    for (const pattern of employeeNamePatterns) {
        const match = cleanedText.match(pattern);
        if (match && (match[1]?.includes('מאור') || match[2]?.includes('מאור'))) {
            return 'מאור';
        }
    }
    if (cleanedText.includes('מאור')) {
        return 'מאור';
    }
    return null;
}

/**
 * Extracts the month and year from the text.
 * @param {string} cleanedText - The cleaned text.
 * @returns {{month: number, year: number}} An object with the month and year.
 */
function extractDate(cleanedText) {
    const dateMatch = cleanedText.match(/לחודש\s+(\d{1,2})\s*\/\s*(\d{2,4})/);
    if (dateMatch) {
        const year = parseInt(dateMatch[2], 10);
        return {
            month: parseInt(dateMatch[1], 10),
            year: year < 100 ? 2000 + year : year
        };
    }
    return { month: new Date().getMonth() + 1, year: new Date().getFullYear() };
}

/**
 * Processes the full text extracted from the Hilanet file.
 * @param {string} rawText - The raw text from the PDF.
 * @returns {Object} An object containing the employee's name, month, and year.
 */
export function processHilanetData(rawText) {
    const cleanedText = normalizeText(rawText);
    const employeeName = extractEmployeeName(cleanedText);
    const { month, year } = extractDate(cleanedText);

    if (!employeeName) {
        console.error("Employee name not found. Scanned text:", cleanedText.substring(0, 300));
        throw new Error("Employee name not found in the document.");
    }
    return { employeeName, detectedMonth: month, detectedYear: year };
}

/**
 * Calls the Gemini server function to extract shifts from an image, using context-specific prompts.
 * @param {string} imageData - Base64 image data.
 * @param {number} month - The relevant month.
 * @param {number} year - The relevant year.
 * @param {string} employeeName - The employee's name.
 * @param {'hilanet' | 'generic'} contextType - The type of analysis to perform.
 * @returns {Promise<Array<Object>>}
 */

export async function callGeminiForShiftExtraction(imageData, month, year, employeeName, contextType = 'hilanet') {
    // Prompt for Hilanet PDF reports (remains the same)
    const hilanetPrompt = `
        You are a world-class expert at extracting structured data from complex Hebrew work schedule reports from 'Hilanet'.
        The provided image is a page from a work schedule for employee ${employeeName} for month ${month}/${year}.
        Your task is to find the main table and extract daily work entries.

        **CRITICAL INSTRUCTIONS - FOLLOW THESE RULES PRECISELY:**
        1.  **Identify Correct Columns:** The key columns for shift times are labeled "כניסה" (entry) and "יציאה" (exit). Locate these specific columns.
        2.  **IGNORE OTHER TIME COLUMNS:** The table contains other columns with hours like "שעות תקן" or "שעות רגיל". You MUST IGNORE these columns completely. Your focus is ONLY on the "כניסה" and "יציאה" columns.
        3.  **Extract these fields for each valid work day row:**
            * "day": The day of the month (a number).
            * "entryTime": The entry time from the "כניסה" column, in strict HH:MM format.
            * "exitTime": The exit time from the "יציאה" column, in strict HH:MM format.
        4.  **Data Quality:** Ignore non-work days. Convert all times to HH:MM format.
        5.  **Output Format:** Respond ONLY with a valid JSON array. If no shifts are found, return an empty array: [].
    `;

    // --- ההנחיה המשופרת כאן ---
    // Prompt for general schedule images, now extracts ALL employees
    const genericImagePrompt = `
        You are an expert at extracting structured data from images of work schedules in Hebrew.
        The image is a work schedule for the month of ${month}/${year}.
        Your task is to analyze the entire schedule and extract every shift for every employee.
        
        For each shift found in the schedule, create a JSON object with the following fields:
        1. "day": The day of the month (number).
        2. "shiftType": The type of shift, either "morning" or "evening".
        3. "employee": The name of the employee assigned to the shift.
        4. "start": The start time in HH:MM format.
        5. "end": The end time in HH:MM format.
        
        IMPORTANT RULES:
        - The employee's name is critical. If you cannot identify the employee for a shift, do not include that shift.
        - The table structure may vary. Find employee names within the cells for morning (בוקר) and evening (ערב) shifts.
        - Default shift times are morning: 07:00-16:00, evening: 13:00-22:00. If times are not written, use these defaults.
        - Respond ONLY with a valid JSON array. If the image is unreadable or contains no shifts, return an empty array: [].

        Example Response:
        [
          { "day": 1, "shiftType": "morning", "employee": "מאור", "start": "07:00", "end": "16:00" },
          { "day": 1, "shiftType": "evening", "employee": "מור", "start": "13:00", "end": "22:00" },
          { "day": 2, "shiftType": "morning", "employee": "מאור", "start": "08:00", "end": "16:30" }
        ]
    `;
    
    const prompt = contextType === 'generic' ? genericImagePrompt : hilanetPrompt;

    try {
        const response = await fetch('/.netlify/functions/callGemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageData, prompt })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: `Server responded with status: ${response.status}` }));
            throw new Error(errorData.error || 'Failed to communicate with the server.');
        }

        const result = await response.json();
        const textResponse = result.candidates[0].content.parts[0].text;
        const jsonMatch = textResponse.match(/\[.*\]/s);

        if (!jsonMatch) {
            console.error("Gemini did not return a valid JSON array. Response:", textResponse);
            return [];
        }

        return JSON.parse(jsonMatch[0]);
    } catch (error) {
        console.error("Error calling Gemini for shift extraction:", error);
        throw new Error("Failed to extract shifts using AI. " + error.message);
    }
}


/**
 * Organizes the extracted shifts from Gemini (PDF) into a structured object.
 */
export function structureShifts(shifts, month, year, employeeName) {
    const structured = {};
    if (!Array.isArray(shifts)) return structured;

    shifts.forEach(shift => {
        if (!shift.day || !shift.entryTime || !shift.exitTime) return;

        let entryTime = shift.entryTime;
        let exitTime = shift.exitTime;

        if (new Date(`1970-01-01T${exitTime}`) < new Date(`1970-01-01T${entryTime}`)) {
            [entryTime, exitTime] = [exitTime, entryTime];
        }

        const dateString = `${year}-${String(month).padStart(2, '0')}-${String(shift.day).padStart(2, '0')}`;
        const shiftType = parseInt(entryTime.split(':')[0], 10) < 12 ? 'morning' : 'evening';
        
        if (!structured[dateString]) structured[dateString] = {};
        
        structured[dateString][shiftType] = {
            employee: employeeName,
            start: `${entryTime}:00`,
            end: `${exitTime}:00`,
        };
    });
    return structured;
}

/**
 * Compares the Google Sheets schedule with the Hilanet schedule with improved time normalization.
 */
export function compareSchedules(googleSheetsShifts, hilanetShifts) {
    const differences = [];
    const allDates = new Set([...Object.keys(googleSheetsShifts), ...Object.keys(hilanetShifts)]);

    allDates.forEach(date => {
        const gsDay = googleSheetsShifts[date] || {};
        const hlDay = hilanetShifts[date] || {};
        const dayName = DAYS[new Date(date).getDay()];

        ['morning', 'evening'].forEach(shiftType => {
            const gsShift = gsDay[shiftType];
            const hlShift = hlDay[shiftType];
            const id = `${date}-${shiftType}`;

            if (gsShift && !hlShift) {
                differences.push({ id, type: 'removed', date, dayName, shiftType, googleSheets: gsShift });
            } else if (!gsShift && hlShift) {
                differences.push({ id, type: 'added', date, dayName, shiftType, hilanet: hlShift });
            } else if (gsShift && hlShift) {
                // --- התיקון המרכזי כאן: השוואה לפי שעות ודקות בלבד ---
                const gsStart = gsShift.start.substring(0, 5);
                const hlStart = hlShift.start.substring(0, 5);
                const gsEnd = gsShift.end.substring(0, 5);
                const hlEnd = hlShift.end.substring(0, 5);

                if (gsStart !== hlStart || gsEnd !== hlEnd) {
                    differences.push({ id, type: 'changed', date, dayName, shiftType, googleSheets: gsShift, hilanet: hlShift });
                }
            }
        });
    });

    return differences.sort((a, b) => new Date(a.date) - new Date(b.date));
}

/**
 * Handles the import of selected shifts from the comparison.
 */
export function handleImportSelectedHilanetShifts(selectedDifferences, allSchedules) {
    if (!selectedDifferences || selectedDifferences.length === 0) {
        return { updatedSchedules: allSchedules, importedCount: 0 };
    }

    let importedCount = 0;
    const newSchedules = JSON.parse(JSON.stringify(allSchedules));

    selectedDifferences.forEach(diff => {
        if (diff.type === 'added' || diff.type === 'changed') {
            const weekId = getWeekId(diff.date);
            const dayName = DAYS[new Date(diff.date).getDay()];
            
            if (!newSchedules[weekId]) newSchedules[weekId] = {};
            if (!newSchedules[weekId][dayName]) newSchedules[weekId][dayName] = {};

            newSchedules[weekId][dayName][diff.shiftType] = diff.hilanet;
            importedCount++;
        }
    });

    return { 
        updatedSchedules: newSchedules, 
        importedCount: importedCount
    };
}

// --- Helper Functions ---

export function handleUploadHilanetBtnClick() {
    document.getElementById('upload-hilanet-input').click();
}

/**
 * Parses XLSX data from Hilanet specifically for "מאור".
 */
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
                let startTime = times[0];
                let endTime = times[1];

                if (new Date(`1970-01-01T${endTime}`) < new Date(`1970-01-01T${startTime}`)) {
                    [startTime, endTime] = [endTime, startTime];
                }

                const dateString = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                const shiftType = parseInt(startTime.split(':')[0]) < 12 ? 'morning' : 'evening';

                if (!shifts[dateString]) shifts[dateString] = {};
                
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