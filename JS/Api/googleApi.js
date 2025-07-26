// קובץ: JS/Api/googleApi.js
import { SPREADSHEET_ID, SHEET_NAME, DAYS } from "../config.js";
import { displayAPIError, allSchedules, DOMElements, updateStatus, createMessage, showCustomConfirmation } from "../main.js";
import { renderSchedule } from '../components/schedule.js';
import { getWeekDates, getWeekId } from "../utils.js";

/**
 * Initializes the GAPI client.
 */
export async function initializeGapiClient() {
    try {
        await gapi.client.init({
            discoveryDocs: [
                'https://sheets.googleapis.com/$discovery/rest?version=v4',
                'https://www.googleapis.com/discovery/v1/apis/gmail/v1/rest',
                'https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'
            ],
        });
    } catch (err) {
        displayAPIError(err, 'שגיאה באתחול ספריות Google API');
    }
}

export async function fetchData() {
    if (gapi.client.getToken() === null) {
        updateStatus('יש להתחבר עם חשבון Google כדי לטעון נתונים.', 'info');
        return;
    }
    updateStatus('טוען נתונים...', 'loading', true);

    try {
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:F`,
        });

        const values = response.result.values;
        Object.keys(allSchedules).forEach(key => delete allSchedules[key]);

        if (!values || values.length <= 1) {
            console.log('No data found.');
            updateStatus('לא נמצאו נתונים בגיליון. ניתן להתחיל להוסיף משמרות.', 'info');
            renderSchedule(getWeekId(DOMElements.datePicker.value));
            return;
        }

        const headers = values[0];
        const weekIdIndex = headers.indexOf("week_id");
        const dayIndex = headers.indexOf("day");
        const shiftTypeIndex = headers.indexOf("shift_type");
        const employeeIndex = headers.indexOf("employee");
        const startTimeIndex = headers.indexOf("start_time");
        const endTimeIndex = headers.indexOf("end_time");

        for (let i = 1; i < values.length; i++) {
            const row = values[i];
            if (!row || row.length === 0) continue;

            const weekId = row[weekIdIndex];
            const day = row[dayIndex];
            const shiftType = row[shiftTypeIndex];
            const employee = row[employeeIndex];
            const start = row[startTimeIndex];
            const end = row[endTimeIndex];

            if (weekId && day && shiftType && employee) {
                if (!allSchedules[weekId]) allSchedules[weekId] = {};
                if (!allSchedules[weekId][day]) allSchedules[weekId][day] = {};
                allSchedules[weekId][day][shiftType] = { employee, start, end };
            }
        }

        const currentWeekId = getWeekId(DOMElements.datePicker.value);
        renderSchedule(currentWeekId);
        updateStatus('הנתונים נטענו בהצלחה!', 'success');

    } catch (err) {
        console.error('Error fetching data from Google Sheets:', err);
        const errorMessage = err.result?.error?.message || err.message || 'תקלה לא ידועה';
        displayAPIError(err, `שגיאה בטעינת הנתונים מ-Google Sheets: ${errorMessage}`);
    }
}

/**
 * Saves schedule data for a specific week to Google Sheets.
 */
export async function saveData(weekId, scheduleDataForWeek) {
    if (gapi.client.getToken() === null) {
        updateStatus('יש להתחבר עם חשבון Google כדי לשמור נתונים.', 'info', false);
        return;
    }
    updateStatus('שומר...', 'loading', true);
    DOMElements.scheduleCard.classList.add('loading');
    try {
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:F`,
        });
        let existingValues = response.result.values || [];
        const defaultHeaders = ["week_id", "day", "shift_type", "employee", "start_time", "end_time"];

        if (existingValues.length === 0 || !defaultHeaders.every(h => existingValues[0].includes(h))) {
            existingValues = [defaultHeaders];
        }
        const headers = existingValues[0];

        const rowsToKeep = existingValues.filter((row, index) => index === 0 || row[headers.indexOf("week_id")] !== weekId);

        const newRowsForWeek = [];
        Object.keys(scheduleDataForWeek).forEach(day => {
            Object.keys(scheduleDataForWeek[day]).forEach(shiftType => {
                const shiftDetails = scheduleDataForWeek[day][shiftType];
                const employee = shiftDetails.employee;
                if (employee && employee !== 'none') {
                    newRowsForWeek.push([weekId, day, shiftType, employee, shiftDetails.start || '', shiftDetails.end || '']);
                }
            });
        });

        let dataToWrite = [...rowsToKeep, ...newRowsForWeek];
        const dayOrder = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
        
        // Sort data correctly, keeping headers at the top
        const headerRow = dataToWrite.shift();
        dataToWrite.sort((a, b) => {
            const weekIdA = a[headers.indexOf("week_id")];
            const weekIdB = b[headers.indexOf("week_id")];
            if (weekIdA < weekIdB) return -1;
            if (weekIdA > weekIdB) return 1;

            const dayA = a[headers.indexOf("day")];
            const dayB = b[headers.indexOf("day")];
            return dayOrder.indexOf(dayA) - dayOrder.indexOf(dayB);
        });
        dataToWrite.unshift(headerRow);

        await gapi.client.sheets.spreadsheets.values.clear({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:F`,
        });

        if (dataToWrite.length > 0) {
            await gapi.client.sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME}!A1`,
                valueInputOption: 'RAW',
                resource: { values: dataToWrite },
            });
        }
        updateStatus('השינויים נשמרו בהצלחה!', 'success', false);
    } catch (err) {
        displayAPIError(err, 'שגיאה בשמירת הנתונים ל-Google Sheets');
    } finally {
        DOMElements.scheduleCard.classList.remove('loading');
    }
}

/**
 * Creates Google Calendar events for selected employees' shifts.
 */
export async function handleCreateCalendarEvents(selectedEmployees) {
    if (gapi.client.getToken() === null) {
        updateStatus('יש להתחבר עם חשבון Google כדי לבצע פעולה זו.', 'info', false);
        return;
    }
    if (!selectedEmployees || selectedEmployees.length === 0) {
        updateStatus('לא נבחרו עובדים ליצירת אירועי יומן.', 'info', false);
        return;
    }
    const weekId = getWeekId(DOMElements.datePicker.value);
    const scheduleDataForWeek = allSchedules[weekId];
    if (!scheduleDataForWeek || Object.keys(scheduleDataForWeek).length === 0) {
        updateStatus('אין נתוני סידור לשבוע זה.', 'info', false);
        return;
    }

    updateStatus(`יוצר אירועי יומן עבור ${selectedEmployees.join(', ')}...`, 'loading', true);
    
    const weekDates = getWeekDates(new Date(weekId));
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const promises = [];

    weekDates.forEach(date => {
        const dayName = DAYS[date.getDay()];
        const dayData = scheduleDataForWeek[dayName] || {};
        const dateISO = date.toISOString().split('T')[0];

        ['morning', 'evening'].forEach(shiftType => {
            if (dayName === 'שבת' || (dayName === 'שישי' && shiftType === 'evening')) return;

            const shiftDetails = dayData[shiftType];
            if (shiftDetails && shiftDetails.employee !== 'none' && selectedEmployees.includes(shiftDetails.employee)) {
                const event = {
                    'summary': `משמרת ${shiftType === 'morning' ? 'בוקר' : 'ערב'} (${shiftDetails.employee})`,
                    'location': 'אסותא',
                    'start': { 'dateTime': `${dateISO}T${shiftDetails.start}`, 'timeZone': timeZone },
                    'end': { 'dateTime': `${dateISO}T${shiftDetails.end}`, 'timeZone': timeZone }
                };
                promises.push(gapi.client.calendar.events.insert({
                    'calendarId': 'primary',
                    'resource': event
                }));
            }
        });
    });

    if (promises.length === 0) {
        updateStatus('לא נמצאו משמרות לעובדים הנבחרים.', 'info', false);
        return;
    }

    try {
        const results = await Promise.all(promises);
        updateStatus(`נוצרו בהצלחה ${results.length} אירועי יומן!`, 'success');
    } catch (err) {
        displayAPIError(err, 'אירעו שגיאות ביצירת אירועי יומן.');
    }
}

/**
 * Deletes Google Calendar events for selected employees.
 */
export async function handleDeleteCalendarEvents(selectedEmployees) {
    // This is a placeholder for a more complex implementation required for deletion.
    showCustomConfirmation(
        'מחיקת אירועים דורשת מימוש מתקדם יותר. האם תרצה להמשיך?',
        () => {
            updateStatus('פונקציונליות המחיקה עדיין בפיתוח.', 'info');
        }
    );
}