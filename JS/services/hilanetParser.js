
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
 * @fileoverview
 * This service handles interactions with the Gemini AI model
 * for extracting work shift data from images. It supports multiple contexts:
 * 1. 'hilanet-report': For structured, detailed PDF reports from Hilanet.
 * 2. 'hilanet-calendar': For calendar-view hour summaries from Hilanet.
 * 3. 'generic': For general work schedule images with multiple employees.
 */

// Storing prompt templates in a dedicated object improves code clarity and maintainability.
const PROMPT_TEMPLATES = {
    /**
     * Generates the prompt for extracting data from a detailed Hilanet attendance report.
     * @param {string} employeeName - The name of the employee.
     * @param {string|number} month - The relevant month.
     * @param {string|number} year - The relevant year.
     * @returns {string} The formatted prompt for the AI model.
     */
    'hilanet-report': (employeeName, month, year) => `
        You are a world-class expert at extracting structured data from complex Hebrew work schedule reports from 'Hilanet'.
        The provided image is a page from a detailed attendance report for employee ${employeeName} for month ${month}/${year}.
        Your task is to find the main table and extract daily work entries based on entry and exit times.

        **CRITICAL INSTRUCTIONS - FOLLOW THESE RULES PRECISELY:**
        1.  **Identify Key Columns:** The only columns that matter for shift times are labeled "כניסה" (entry) and "יציאה" (exit).
        2.  **IGNORE ALL OTHER TIME COLUMNS:** The report contains other columns with hours like "שעות תקן", "שעות רגיל", or "סה"כ שעות". You MUST IGNORE these columns completely. Your focus is ONLY on the raw "כניסה" and "יציאה" columns.
        3.  **Extract these fields for each row that represents a work day:**
            * "day": The day of the month (a number, usually in the leftmost column).
            * "entryTime": The entry time from the "כניסה" column, in strict HH:MM format.
            * "exitTime": The exit time from the "יציאה" column, in strict HH:MM format.
        4.  **Data Quality:**
            * Ignore non-work days (like 'שבת', rows marked with 'חופש', or empty rows).
            * If a day has entry/exit times, it is a valid work day.
            * Convert all times to HH:MM format.
        5.  **Output Format:** Respond ONLY with a valid JSON array. If no shifts are found, return an empty array: [].
    `,

    /**
     * Generates the prompt for extracting data from a Hilanet calendar view.
     * @param {string} employeeName - The name of the employee.
     * @param {string|number} month - The relevant month.
     * @param {string|number} year - The relevant year.
     * @returns {string} The formatted prompt for the AI model.
     */
    'hilanet-calendar': (employeeName, month, year) => `
        You are an expert at extracting data from Hebrew work-hour calendar summaries from 'Hilanet'.
        The image provided is a calendar grid view for employee ${employeeName} for the month ${month}/${year}.
        Your task is to extract the total hours worked for each day presented in the calendar.

        **INSTRUCTIONS:**
        1.  **Analyze the Grid:** The data is in a calendar grid. Each cell with a number in the corner is a day.
        2.  **Extract Data:** For each day that has a time value inside its cell, extract the day number and the time value.
        3.  **Fields to Extract:**
            * "day": The day of the month (a number).
            * "totalHours": The time value shown for that day (e.g., "9:00", "5:00").
        4.  **Data Quality:** Ignore days with no time value listed. The time is the primary value inside the day's cell.
        5.  **Output Format:** Respond ONLY with a valid JSON array of objects. If no data is found, return an empty array: [].

        **Example Response:**
        [
          { "day": 2, "totalHours": "9:00" },
          { "day": 4, "totalHours": "5:00" },
          { "day": 6, "totalHours": "9:00" }
        ]
    `,

    /**
     * Generates the prompt for extracting data from a generic, multi-employee schedule image.
     * @param {string|number} month - The relevant month.
     * @param {string|number} year - The relevant year.
     * @returns {string} The formatted prompt for the AI model.
     */
    'generic': (month, year) => `
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
        - Default shift times are morning: 07:00-16:00, evening: 13:00-22:00. If times are not explicitly written, use these defaults.
        - Respond ONLY with a valid JSON array. If the image is unreadable or contains no shifts, return an empty array: [].
    `
};

/**
 * Calls a serverless function to interact with the Gemini AI for shift extraction from an image.
 * @param {string} imageData - The base64 encoded image data.
 * @param {string|number} month - The month of the schedule.
 * @param {string|number} year - The year of the schedule.
 * @param {string} employeeName - The name of the employee.
 * @param {('hilanet-report'|'hilanet-calendar'|'generic')} [contextType='hilanet-report'] - The type of document being processed.
 * @returns {Promise<Array<Object>>} A promise that resolves to an array of shift objects.
 * @throws {Error} If the AI call fails or the response is invalid.
 */
export async function callGeminiForShiftExtraction(imageData, month, year, employeeName, contextType = 'hilanet-report') {
    // Select the correct prompt template based on the context.
    const promptGenerator = PROMPT_TEMPLATES[contextType] || PROMPT_TEMPLATES['hilanet-report'];
    const prompt = promptGenerator(employeeName, month, year);

    try {
        // Call the serverless function which acts as a proxy to the Gemini API.
        const response = await fetch('/.netlify/functions/callGemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageData, prompt })
        });

        // Handle non-successful HTTP responses.
        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ 
                error: `Server responded with status: ${response.status}` 
            }));
            throw new Error(errorData.error || 'Failed to communicate with the server.');
        }

        const result = await response.json();
        
        // Safely access the text response from the Gemini API result.
        const textResponse = result?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!textResponse) {
            console.error("Invalid response structure from Gemini:", result);
            return [];
        }
        
        // The AI might sometimes include extra text. We use a regex to reliably extract the JSON array string.
        const jsonMatch = textResponse.match(/\[.*\]/s);
        if (!jsonMatch) {
            console.error("Gemini did not return a valid JSON array. Response:", textResponse);
            return [];
        }

        // Parse the extracted string into a JavaScript array.
        return JSON.parse(jsonMatch[0]);

    } catch (error) {
        console.error(`Error calling Gemini for context '${contextType}':`, error);
        // Re-throw a more user-friendly error to be caught by the calling function.
        throw new Error(`Failed to extract shifts using AI. ${error.message}`);
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
/**
 * Parses text items extracted from a Hilanet PDF to find shift data.
 * @param {Array} textItems - The array of items from pdf.js's getTextContent().
 * @returns {Array} An array of structured shift objects.
 */
function parseShiftsFromTextItems(textItems) {
    const shifts = [];
    const lines = {};

    // 1. Group text items into lines based on their vertical position (transform[5])
    textItems.forEach(item => {
        const y = Math.round(item.transform[5]);
        if (!lines[y]) lines[y] = [];
        lines[y].push({
            text: item.str.trim(),
            x: Math.round(item.transform[4])
        });
    });

    // 2. Process each line to find valid shifts
    for (const y in lines) {
        const lineItems = lines[y].sort((a, b) => a.x - b.x); // Sort items by horizontal position
        const lineText = lineItems.map(item => item.text).join(' ');

        // A valid shift line typically starts with a day number (e.g., "02", "03", ...)
        const dayMatch = lineText.match(/^\d{1,2}/);
        if (!dayMatch) continue;

        const day = parseInt(dayMatch[0], 10);

        // Find all time-like strings (e.g., "07:00", "16:00")
        const timeMatches = lineText.match(/(\d{1,2}:\d{2})/g) || [];

        // Expect pairs of times (start and end)
        if (timeMatches.length >= 2) {
            // Hilanet reports can have multiple shifts on one line, process them in pairs.
            for (let i = 0; i < timeMatches.length; i += 2) {
                if (timeMatches[i+1]) {
                     shifts.push({
                        day: day,
                        entryTime: timeMatches[i],
                        exitTime: timeMatches[i+1]
                    });
                }
            }
        }
    }
    return shifts;
}

// Don't forget to export it if it's in a separate module
// export { parseShiftsFromTextItems };