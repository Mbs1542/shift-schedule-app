import { SPREADSHEET_ID, SHEET_NAME, SHEET_NAME_LOGS, DAYS } from "../config.js";
import { displayAPIError, allSchedules, DOMElements, updateStatus, allCreatedCalendarEvents } from "../main.js";
import { renderSchedule } from '../components/schedule.js';
import { getWeekDates, getWeekId, createMessage, setButtonLoading, restoreButton } from "../utils.js";

/**
 * Initializes the GAPI client for Sheets, Gmail, and Calendar.
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

/**
 * [NEW] Logs a user login event to a separate Google Sheet.
 * @param {string} userEmail - The email of the user who logged in.
 */
export async function logLoginEvent(userEmail) {
    if (gapi.client.getToken() === null) return; // Don't log if not authenticated

    try {
        const timestamp = new Date().toISOString();
        const values = [[timestamp, userEmail]]; // Data to append

        // Check if headers exist
        const headerResponse = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME_LOGS}!A1:B1`,
        });

        if (!headerResponse.result.values || headerResponse.result.values.length === 0) {
            // Headers do not exist, so add them first
            await gapi.client.sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME_LOGS}!A1`,
                valueInputOption: 'RAW',
                resource: {
                    values: [["Login Timestamp", "User Email"]]
                },
            });
        }
        
        // Append the login data
        await gapi.client.sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: SHEET_NAME_LOGS,
            valueInputOption: 'RAW',
            insertDataOption: 'INSERT_ROWS',
            resource: {
                values: values
            },
        });
        console.log(`Login event for ${userEmail} logged successfully.`);
    } catch (err) {
        // This is a background task, so we just log the error without showing it to the user
        console.error('Failed to log login event:', err);
    }
}


/**
 * Fetches all schedule data from the Google Sheet.
 */
export async function fetchData() {
    if (gapi.client.getToken() === null) {
        updateStatus('יש להתחבר עם חשבון Google כדי לטעון נתונים.', 'info');
        return;
    }
    
    const button = DOMElements.refreshDataBtn;
    setButtonLoading(button, 'מרענן...');

    try {
        updateStatus('טוען נתונים...', 'loading', true);
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:G`, // Read up to column G to include the new timestamp
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
        // We don't need to read the last_updated index for the app logic itself

        for (let i = 1; i < values.length; i++) {
            const row = values[i];
            if (!row || row.length === 0) continue;

            const weekId = row[weekIdIndex];
            const day = row[dayIndex];
            const shiftType = row[shiftTypeIndex];
            const employee = row[employeeIndex]?.trim(); 
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
    } finally {
        restoreButton(button);
    }
}

/**
 * [FEATURE ADDED] Saves the entire schedule object to the Google Sheet,
 * including a `last_updated` timestamp for each shift row.
 */
export async function saveFullSchedule(fullScheduleData) {
    if (gapi.client.getToken() === null) {
        updateStatus('יש להתחבר עם חשבון Google כדי לשמור נתונים.', 'info', false);
        return;
    }
    updateStatus('שומר...', 'loading', true);
    DOMElements.scheduleCard.classList.add('loading');
    try {
        const timestamp = new Date().toISOString(); // Generate a single timestamp for the entire save operation.

        const dataToWrite = [
            // [NEW] Added "last_updated" to the header row
            ["week_id", "day", "shift_type", "employee", "start_time", "end_time", "last_updated"]
        ];

        const sortedWeekIds = Object.keys(fullScheduleData).sort();

        for (const weekId of sortedWeekIds) {
            const scheduleDataForWeek = fullScheduleData[weekId];
            const dayOrder = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
            const sortedDays = Object.keys(scheduleDataForWeek).sort((a, b) => dayOrder.indexOf(a) - dayOrder.indexOf(b));

            for (const day of sortedDays) {
                const dayData = scheduleDataForWeek[day];
                if (dayData.morning && dayData.morning.employee && dayData.morning.employee !== 'none') {
                    const shift = dayData.morning;
                    // [NEW] Push the timestamp with the row data
                    dataToWrite.push([weekId, day, 'morning', shift.employee.trim(), shift.start, shift.end, timestamp]);
                }
                if (dayData.evening && dayData.evening.employee && dayData.evening.employee !== 'none') {
                    const shift = dayData.evening;
                    // [NEW] Push the timestamp with the row data
                    dataToWrite.push([weekId, day, 'evening', shift.employee.trim(), shift.start, shift.end, timestamp]);
                }
            }
        }

        await gapi.client.sheets.spreadsheets.values.clear({
            spreadsheetId: SPREADSHEET_ID,
            range: SHEET_NAME,
        });

        if (dataToWrite.length > 1) {
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
        throw err;
    }
}

/**
 * Creates events in Google Calendar.
 */
export async function handleCreateCalendarEvents(selectedEmployees) {
    if (gapi.client.getToken() === null) {
        updateStatus('יש להתחבר עם חשבון Google.', 'info');
        return;
    }
    if (!selectedEmployees || selectedEmployees.length === 0) {
        updateStatus('לא נבחרו עובדים.', 'info');
        return;
    }

    const button = DOMElements.createCalendarEventsBtn;
    setButtonLoading(button, 'יוצר...');
    try {
        const weekId = getWeekId(DOMElements.datePicker.value);
        const scheduleDataForWeek = allSchedules[weekId];
        if (!scheduleDataForWeek) {
            updateStatus('אין נתוני סידור לשבוע זה.', 'info');
            return; 
        }

        updateStatus(`יוצר אירועי יומן עבור ${selectedEmployees.join(', ')}...`, 'loading', true);
        
        const weekDates = getWeekDates(new Date(weekId));
        const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
        const creationTasks = [];

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

                    creationTasks.push({
                        promise: gapi.client.calendar.events.insert({ 'calendarId': 'primary', 'resource': event }),
                        shiftKey: `${weekId}-${dayName}-${shiftType}`
                    });
                }
            });
        });

        if (creationTasks.length === 0) {
            updateStatus('לא נמצאו משמרות לעובדים הנבחרים.', 'info');
            return;
        }

        const promises = creationTasks.map(task => task.promise);
        const results = await Promise.all(promises);
        
        results.forEach((response, index) => {
            const createdEvent = response.result;
            if (createdEvent && createdEvent.id) {
                const task = creationTasks[index];
                allCreatedCalendarEvents[task.shiftKey] = createdEvent.id;
            }
        });

        console.log("אירועים שנוצרו ונשמרו:", allCreatedCalendarEvents);
        updateStatus(`נוצרו בהצלחה ${results.length} אירועי יומן!`, 'success');

    } catch (err) {
        displayAPIError(err, 'אירעו שגיאות ביצירת אירועי יומן.');
    } finally {
        restoreButton(button);
    }
}

/**
 * Deletes events from Google Calendar.
 */
export async function handleDeleteCalendarEvents(selectedEmployees) {
    if (gapi.client.getToken() === null) {
        updateStatus('יש להתחבר עם חשבון Google.', 'info');
        return;
    }
    if (!selectedEmployees || selectedEmployees.length === 0) {
        updateStatus('לא נבחרו עובדים.', 'info');
        return;
    }
    
    const button = DOMElements.deleteCalendarEventsBtn;
    setButtonLoading(button, 'מוחק...');
    try {
        const weekId = getWeekId(DOMElements.datePicker.value);
        const scheduleDataForWeek = allSchedules[weekId];
        if (!scheduleDataForWeek) {
            updateStatus('אין נתוני סידור לשבוע זה.', 'info');
            return;
        }

        const deletionPromises = [];
        const keysToDelete = [];

        Object.keys(scheduleDataForWeek).forEach(dayName => {
            const dayData = scheduleDataForWeek[dayName];
            ['morning', 'evening'].forEach(shiftType => {
                const shiftDetails = dayData[shiftType];
                if (shiftDetails && selectedEmployees.includes(shiftDetails.employee)) {
                    const shiftKey = `${weekId}-${dayName}-${shiftType}`;
                    const eventId = allCreatedCalendarEvents[shiftKey];

                    if (eventId) {
                        deletionPromises.push(gapi.client.calendar.events.delete({
                            'calendarId': 'primary',
                            'eventId': eventId
                        }));
                        keysToDelete.push(shiftKey);
                    }
                }
            });
        });

        if (deletionPromises.length === 0) {
            updateStatus('לא נמצאו אירועי יומן שמורים למחיקה עבור העובדים הנבחרים.', 'info');
            return;
        }

        updateStatus(`מוחק ${deletionPromises.length} אירועים...`, 'loading', true);
        await Promise.all(deletionPromises);

        keysToDelete.forEach(key => {
            delete allCreatedCalendarEvents[key];
        });
        
        console.log("אירועים שנותרו לאחר המחיקה:", allCreatedCalendarEvents);
        updateStatus(`נמחקו בהצלחה ${deletionPromises.length} אירועי יומן!`, 'success');

    } catch (err) {
        if (err.result && err.result.error.code === 410) {
            updateStatus('חלק מהאירועים כבר נמחקו בעבר. הרשימה נוקתה.', 'info');
        } else {
            displayAPIError(err, 'אירעו שגיאות במחיקת אירועי יומן.');
        }
    } finally {
        restoreButton(button);
    }
}