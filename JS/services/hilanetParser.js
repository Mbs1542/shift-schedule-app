import { getWeekId, DAYS } from '../utils.js';

/**
 * Ensures a time string is always in HH:MM:SS format.
 * @param {string} timeString - The time string to format (e.g., "7:00" or "13:00:00").
 * @returns {string} Formatted time string (e.g., "07:00:00").
 */
function formatTimeToHHMMSS(timeString) {
    if (!timeString || !timeString.includes(':')) {
        return '00:00:00';
    }
    const parts = timeString.split(':');
    const h = parts[0].padStart(2, '0');
    const m = parts[1].padStart(2, '0');
    const s = (parts[2] || '00').padStart(2, '0');
    return `${h}:${m}:${s}`;
}

/**
 * Cleans text extracted from a PDF for metadata purposes.
 * @param {string} text - The raw text from the PDF.
 * @returns {string} Cleaned text ready for processing.
 */
function normalizeText(text) {
    if (!text) return '';
    let cleanedText = text.replace(/\s+/g, ' ');
    cleanedText = cleanedText.replace(/(\d)\s+(\d)\s?:\s?(\d\d)/g, '$1$2:$3');
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
        /מאור\s+(?:בן סימון|סימון)/i
    ];
    for (const pattern of employeeNamePatterns) {
        const match = cleanedText.match(pattern);
        if (match) return 'מאור';
    }
    if (cleanedText.includes('מאור')) return 'מאור';
    return null;
}

/**
 * Extracts the month and year from the text for metadata.
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
    const today = new Date();
    return { month: today.getMonth() + 1, year: today.getFullYear() };
}

/**
 * Processes text from a PDF to extract metadata only (name, month, year).
 * @param {string} rawText - The raw text from the PDF.
 * @returns {Object} An object containing the employee's name, month, and year.
 */
export function processHilanetData(rawText) {
    const cleanedText = normalizeText(rawText);
    const employeeName = extractEmployeeName(cleanedText);
    const { month, year } = extractDate(cleanedText);

    if (!employeeName) {
        console.error("Employee name not found in text:", cleanedText.substring(0, 300));
        throw new Error("Employee name 'מאור' not found in the document.");
    }
    return { employeeName, detectedMonth: month, detectedYear: year };
}


// Prompts are improved for clarity and to ensure consistent output.
const PROMPT_TEMPLATES = {
    'hilanet-report': (employeeName, month, year) => `
        You are an expert at extracting structured data from Hebrew 'Hilanet' attendance reports.
        The image is a report for employee ${employeeName} for month ${month}/${year}.
        Your task is to extract daily work entries from the "כניסה" (entry) and "יציאה" (exit) columns.

        **CRITICAL RULES:**
        1.  **"כניסה" is the START time. "יציאה" is the END time.** Ensure 'entryTime' comes from the "כניסה" column and 'exitTime' comes from the "יציאה" column.
        2.  **Extract ONLY from "כניסה" and "יציאה" columns.** IGNORE all other time columns like "שעות תקן" or "סה"כ שעות".
        3.  For each work day, extract:
            * "day": The day of the month (number).
            * "entryTime": Time from "כניסה" column (HH:MM format).
            * "exitTime": Time from "יציאה" column (HH:MM format).
            * "employee": The name of the employee, which is "${employeeName}".
        4.  Ignore non-work days (like 'שבת', 'חופש', or empty rows).
        5.  You MUST respond ONLY with a valid JSON array. If no shifts are found, return an empty array: [].`,

    'generic': (month, year) => `
        You are an expert at extracting data from Hebrew work schedule images.
        The image is a schedule for ${month}/${year}.
        Task: Extract every shift for every employee.
        
        **RULES:**
        1.  For each shift, create a JSON object with:
            * "day": The day of the month (number).
            * "shiftType": "morning" or "evening".
            * "employee": The employee's name.
            * "start": Start time (HH:MM).
            * "end": End time (HH:MM).
        2.  Default times: morning 07:00-16:00, evening 13:00-22:00. Use if not specified.
        3.  The employee's name is critical. If no name, do not include the shift.
        4.  You MUST respond ONLY with a valid JSON array. If no shifts, return [].`
};

/**
 * Calls the Netlify serverless function to get shift data from an image.
 */
export async function callGeminiForShiftExtraction(imageData, month, year, employeeName, contextType = 'hilanet-report') {
    const promptGenerator = PROMPT_TEMPLATES[contextType] || PROMPT_TEMPLATES['hilanet-report'];
    const prompt = promptGenerator(employeeName, month, year);

    try {
        const response = await fetch('/.netlify/functions/callGemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageData, prompt })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ 
                error: `Server responded with status: ${response.status}` 
            }));
            throw new Error(errorData.error || 'Failed to communicate with the server.');
        }

        const result = await response.json();
        return Array.isArray(result) ? result : [];

    } catch (error) {
        console.error(`Error calling Gemini via Netlify function for context '${contextType}':`, error);
        throw new Error(`Failed to extract shifts using AI. ${error.message}`);
    }
}


/**
 * Organizes shifts extracted by Gemini into a structured object, with a safeguard for swapped times.
 */
export function structureShifts(shifts, month, year, employeeName) {
    const structured = {};
    if (!Array.isArray(shifts)) return structured;

    shifts.forEach(shift => {
        const entryTime = shift.entryTime || shift.start;
        const exitTime = shift.exitTime || shift.end;

        if (shift.day && entryTime && exitTime) {
            let entry = entryTime;
            let exit = exitTime;

            if (new Date(`1970-01-01T${entry}`) > new Date(`1970-01-01T${exit}`)) {
                [entry, exit] = [exit, entry]; 
            }
            
            const dateString = `${year}-${String(month).padStart(2, '0')}-${String(shift.day).padStart(2, '0')}`;
            const shiftType = parseInt(entry.split(':')[0], 10) < 12 ? 'morning' : 'evening';
            
            if (!structured[dateString]) structured[dateString] = {};
            
            structured[dateString][shiftType] = {
                employee: shift.employee || employeeName,
                start: formatTimeToHHMMSS(entry),
                end: formatTimeToHHMMSS(exit),
            };
        } 
        else if (shift.day && shift.shiftType && shift.employee) {
            const dateString = `${year}-${String(month).padStart(2, '0')}-${String(shift.day).padStart(2, '0')}`;
             if (!structured[dateString]) structured[dateString] = {};
            structured[dateString][shift.shiftType] = {
                employee: shift.employee,
                start: shift.start ? formatTimeToHHMMSS(shift.start) : '00:00:00',
                end: shift.end ? formatTimeToHHMMSS(shift.end) : '00:00:00',
            };
        }
    });
    return structured;
}

/**
 * Compares the Google Sheets schedule with the Hilanet schedule.
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
 * *** MODIFIED: Handles the import of selected shifts from the comparison. ***
 * A new rule was added to filter out any differences that fall on a Saturday ('שבת')
 * before attempting to import them. This prevents the bug of adding shifts on non-working days.
 * @param {Array} selectedDifferences - The array of difference objects selected by the user.
 * @param {Object} allSchedules - The main schedules data store.
 * @returns {{updatedSchedules: Object, importedCount: number}} - The updated schedule object and a count of imported shifts.
 */
export function handleImportSelectedHilanetShifts(selectedDifferences, allSchedules) {
    if (!selectedDifferences || selectedDifferences.length === 0) {
        return { updatedSchedules: allSchedules, importedCount: 0 };
    }

    let importedCount = 0;
    const newSchedules = JSON.parse(JSON.stringify(allSchedules));

    // **CRITICAL FIX**: Filter out any shifts on Saturday before processing.
    const validDifferencesToImport = selectedDifferences.filter(diff => {
        return diff.dayName !== 'שבת' && (diff.type === 'added' || diff.type === 'changed');
    });

    validDifferencesToImport.forEach(diff => {
        const weekId = getWeekId(diff.date);
        const dayName = DAYS[new Date(diff.date).getDay()];
        
        if (!newSchedules[weekId]) newSchedules[weekId] = {};
        if (!newSchedules[weekId][dayName]) newSchedules[weekId][dayName] = {};

        // Import the shift from Hilanet data
        newSchedules[weekId][dayName][diff.shiftType] = diff.hilanet;
        importedCount++;
    });

    return { 
        updatedSchedules: newSchedules, 
        importedCount: importedCount
    };
}