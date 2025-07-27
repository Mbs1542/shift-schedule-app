// In file: JS/services/hilanetParser.js

// **FIX**: Importing DAYS to ensure consistent day names across the app.
import { getWeekId, DAYS } from '../utils.js';

/**
 * Cleans text extracted from a PDF by removing extra spaces.
 * @param {string} text - The raw text from the PDF.
 * @returns {string} Cleaned text ready for processing.
 */
function normalizeText(text) {
    if (!text) return '';
    return text.replace(/\s+/g, ' ').replace(/([א-ת])\s(?=[א-ת])/g, '$1').trim();
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
        /עובד:\s*([\u0590-\u05FF\s]+)\s*\d{9}/i
    ];

    for (const pattern of employeeNamePatterns) {
        const match = cleanedText.match(pattern);
        if (match && match[1] && match[1].includes('מאור')) {
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
    const dateMatch = cleanedText.match(/לחודש\s+(\d{2})\/(\d{2,4})/);
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
    console.log("--- Full Document Text for Hilanet Processing ---");
    console.log(rawText);
    console.log("--- End of Document Text ---");

    const cleanedText = normalizeText(rawText);
    const employeeName = extractEmployeeName(cleanedText);
    const { month, year } = extractDate(cleanedText);

    if (!employeeName) {
        console.error("Employee name not found. Scanned text:", cleanedText.substring(0, 300));
        throw new Error("Employee name not found in the document.");
    }

    console.log(`Data extracted: name=${employeeName}, month=${month}, year=${year}`);
    return { employeeName, detectedMonth: month, detectedYear: year };
}

/**
 * Calls the Gemini server function to extract shifts from an image.
 */
export async function callGeminiForShiftExtraction(imageDataBase64, month, year, employeeName) {
    const prompt = `
        You are an expert at extracting structured data from tables in Hebrew documents.
        The provided image is a page from a work schedule report for month ${month}/${year} for employee ${employeeName}.
        Your task is to find the main table containing daily entries. For each row that represents a day, extract the following information:
        1. "day": The day of the month (e.g., '01', '02').
        2. "entryTime": The entry time (כניסה) in HH:MM format.
        3. "exitTime": The exit time (יציאה) in HH:MM format.
        Respond ONLY with a valid JSON array of objects. Do not include markdown or explanations.
    `;

    try {
        const response = await fetch('/.netlify/functions/callGemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ imageDataBase64, prompt })
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: `Server responded with status: ${response.status}` }));
            throw new Error(errorData.error || 'Failed to communicate with the server.');
        }

        const result = await response.json();
        const jsonText = result.candidates[0].content.parts[0].text.replace(/```json|```/g, '').trim();
        return JSON.parse(jsonText);
    } catch (error) {
        console.error("Error calling Gemini for shift extraction:", error);
        throw new Error("Failed to extract shifts using AI. " + error.message);
    }
}

/**
 * Organizes the extracted shifts into a structured object.
 */
export function structureShifts(shifts, month, year, employeeName) {
    const structured = {};
    if (!Array.isArray(shifts)) return structured;

    shifts.forEach(shift => {
        if (!shift.day || !shift.entryTime || !shift.exitTime) return;

        const dateString = `${year}-${String(month).padStart(2, '0')}-${String(shift.day).padStart(2, '0')}`;
        const shiftType = parseInt(shift.entryTime.split(':')[0], 10) < 12 ? 'morning' : 'evening';
        
        if (!structured[dateString]) structured[dateString] = {};
        
        structured[dateString][shiftType] = {
            employee: employeeName,
            start: `${shift.entryTime}:00`,
            end: `${shift.exitTime}:00`,
        };
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
        // **FIX**: Using the DAYS array to get a consistent day name (e.g., "ראשון").
        const dayName = DAYS[new Date(date).getDay()];

        ['morning', 'evening'].forEach(shiftType => {
            const gsShift = gsDay[shiftType];
            const hlShift = hlDay[shiftType];
            const id = `${date}-${shiftType}`;

            if (gsShift && !hlShift) {
                differences.push({ id, type: 'removed', date, dayName, shiftType, googleSheets: gsShift });
            } else if (!gsShift && hlShift) {
                differences.push({ id, type: 'added', date, dayName, shiftType, hilanet: hlShift });
            } else if (gsShift && hlShift && (gsShift.start !== hlShift.start || gsShift.end !== hlShift.end)) {
                differences.push({ id, type: 'changed', date, dayName, shiftType, googleSheets: gsShift, hilanet: hlShift });
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
            // **FIX**: Using the DAYS array here as well for consistency.
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

export function parseHilanetXLSXForMaor(data) {
    // This function remains unchanged.
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