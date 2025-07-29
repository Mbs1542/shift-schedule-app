import { SPREADSHEET_ID, SHEET_NAME, DAYS } from "../config.js";
import { displayAPIError, allSchedules, DOMElements, updateStatus } from "../main.js";
import { renderSchedule } from '../components/schedule.js';
import { getWeekDates, getWeekId, createMessage, showCustomConfirmation } from "../utils.js"; 

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
export async function saveFullSchedule(fullScheduleData) {
    if (gapi.client.getToken() === null) {
        updateStatus('יש להתחבר עם חשבון Google כדי לשמור נתונים.', 'info', false);
        return;
    }
    updateStatus('שומר...', 'loading', true);
    DOMElements.scheduleCard.classList.add('loading');
    try {
        const dataToWrite = [
            ["week_id", "day", "shift_type", "employee", "start_time", "end_time"]
        ];

        const sortedWeekIds = Object.keys(fullScheduleData).sort();

        for (const weekId of sortedWeekIds) {
            const scheduleDataForWeek = fullScheduleData[weekId];
            const dayOrder = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
            const sortedDays = Object.keys(scheduleDataForWeek).sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));

            for (const day of sortedDays) {
                const dayData = scheduleDataForWeek[day];
                if (dayData.morning && dayData.morning.employee !== 'none') {
                    const shift = dayData.morning;
                    dataToWrite.push([weekId, day, 'morning', shift.employee, shift.start, shift.end]);
                }
                if (dayData.evening && dayData.evening.employee !== 'none') {
                    const shift = dayData.evening;
                    dataToWrite.push([weekId, day, 'evening', shift.employee, shift.start, shift.end]);
                }
            }
        }

        await gapi.client.sheets.spreadsheets.values.clear({
            spreadsheetId: SPREADSHEET_ID,
            range: SHEET_NAME,
        });

        if (dataToWrite.length > 1) { // Only write if there's more than just the header
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
 * Sends an email using the Gmail API.
 */
export async function sendEmailWithGmailApi(to, subject, messageBody) {
    if (gapi.client.getToken() === null) {
        updateStatus('יש להתחבר עם חשבון Google כדי לשלוח מייל.', 'info', false);
        return;
    }
    updateStatus('שולח מייל...', 'loading', true);
    try {
        const rawMessage = createMessage(to, subject, messageBody);
        await gapi.client.gmail.users.messages.send({
            'userId': 'me',
            'resource': { 'raw': rawMessage }
        });
        updateStatus('המייל נשלח בהצלחה!', 'success', false);
    } catch (err) {
        displayAPIError(err, 'שגיאה בשליחת המייל דרך Gmail API');
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