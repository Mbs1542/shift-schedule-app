import { SPREADSHEET_ID, SHEET_NAME, DAYS } from "../config.js";
import { displayAPIError, allSchedules, DOMElements, updateStatus, allCreatedCalendarEvents } from "../main.js";
import { renderSchedule } from '../components/schedule.js';
// ייבוא כל הפונקציות הנדרשות מהקוד החדש והישן
import { getWeekDates, getWeekId, createMessage, showCustomConfirmation, setButtonLoading, restoreButton } from "../utils.js";

/**
 * מאתחל את ה-GAPI client (מהקוד הישן).
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
 * טוען נתונים מ-Google Sheets עם הלוגיקה המלאה מהקוד הישן.
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
            range: `${SHEET_NAME}!A:F`,
        });

        // --- התחלת לוגיקה מהקוד הישן ---
        const values = response.result.values;
        Object.keys(allSchedules).forEach(key => delete allSchedules[key]);

        if (!values || values.length <= 1) {
            console.log('No data found.');
            updateStatus('לא נמצאו נתונים בגיליון. ניתן להתחיל להוסיף משמרות.', 'info');
            renderSchedule(getWeekId(DOMElements.datePicker.value));
            return; // היציאה המוקדמת תפעיל את בלוק ה-finally
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
        // --- סוף לוגיקה מהקוד הישן ---

    } catch (err) {
        console.error('Error fetching data from Google Sheets:', err);
        const errorMessage = err.result?.error?.message || err.message || 'תקלה לא ידועה';
        displayAPIError(err, `שגיאה בטעינת הנתונים מ-Google Sheets: ${errorMessage}`);
    } finally {
        restoreButton(button);
    }
}

/**
 * שומר את כל סידור העבודה ל-Google Sheets (מהקוד הישן).
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
 * שולח אימייל עם Gmail API.
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
        // זריקה מחדש כדי שפונקציה קוראת תוכל לתפוס את השגיאה במידת הצורך
        throw err;
    }
}

/**
 * יוצר אירועים ביומן גוגל עם הלוגיקה המלאה מהקוד הישן.
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
        // --- התחלת לוגיקה מהקוד הישן ---
        const weekId = getWeekId(DOMElements.datePicker.value);
        const scheduleDataForWeek = allSchedules[weekId];
        if (!scheduleDataForWeek) {
            updateStatus('אין נתוני סידור לשבוע זה.', 'info');
            return; // יציאה מוקדמת תפעיל את finally
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
        // --- סוף לוגיקה מהקוד הישן ---

        if (creationTasks.length === 0) {
            updateStatus('לא נמצאו משמרות לעובדים הנבחרים.', 'info');
            return; // יציאה מוקדמת תפעיל את finally
        }

        const promises = creationTasks.map(task => task.promise);
        const results = await Promise.all(promises);
        
        // --- התחלת לוגיקה מהקוד הישן ---
        results.forEach((response, index) => {
            const createdEvent = response.result;
            if (createdEvent && createdEvent.id) {
                const task = creationTasks[index];
                allCreatedCalendarEvents[task.shiftKey] = createdEvent.id;
            }
        });

        console.log("אירועים שנוצרו ונשמרו:", allCreatedCalendarEvents);
        // --- סוף לוגיקה מהקוד הישן ---
        updateStatus(`נוצרו בהצלחה ${results.length} אירועי יומן!`, 'success');

    } catch (err) {
        displayAPIError(err, 'אירעו שגיאות ביצירת אירועי יומן.');
    } finally {
        restoreButton(button);
    }
}

/**
 * מוחק אירועים מיומן גוגל עם הלוגיקה המלאה מהקוד הישן.
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
        // --- התחלת לוגיקה מהקוד הישן ---
        const weekId = getWeekId(DOMElements.datePicker.value);
        const scheduleDataForWeek = allSchedules[weekId];
        if (!scheduleDataForWeek) {
            updateStatus('אין נתוני סידור לשבוע זה.', 'info');
            return; // יציאה מוקדמת תפעיל את finally
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
        // --- סוף לוגיקה מהקוד הישן ---

        if (deletionPromises.length === 0) {
            updateStatus('לא נמצאו אירועי יומן שמורים למחיקה עבור העובדים הנבחרים.', 'info');
            return; // יציאה מוקדמת תפעיל את finally
        }

        updateStatus(`מוחק ${deletionPromises.length} אירועים...`, 'loading', true);
        await Promise.all(deletionPromises);

        // --- התחלת לוגיקה מהקוד הישן ---
        keysToDelete.forEach(key => {
            delete allCreatedCalendarEvents[key];
        });
        
        console.log("אירועים שנותרו לאחר המחיקה:", allCreatedCalendarEvents);
        // --- סוף לוגיקה מהקוד הישן ---
        updateStatus(`נמחקו בהצלחה ${deletionPromises.length} אירועי יומן!`, 'success');

    } catch (err) {
        // --- התחלת לוגיקה מהקוד הישן ---
        if (err.result && err.result.error.code === 410) {
            updateStatus('חלק מהאירועים כבר נמחקו בעבר. הרשימה נוקתה.', 'info');
        } else {
            displayAPIError(err, 'אירעו שגיאות במחיקת אירועי יומן.');
        }
        // --- סוף לוגיקה מהקוד הישן ---
    } finally {
        restoreButton(button);
    }
}