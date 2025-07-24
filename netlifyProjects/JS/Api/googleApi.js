import { SPREADSHEET_ID, SHEET_NAME, DAYS, DEFAULT_SHIFT_TIMES } from "../config.js";
import { gapiInited, maybeInitAuthClient, displayAPIError, allSchedules, DOMElements, updateStatus, createMessage, allCreatedCalendarEvents, showCustomConfirmation } from "../main.js";
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

/** Fetches schedule data from Google Sheets. */
export async function fetchData() {
    if (gapi.client.getToken() === null) {
        updateStatus('יש להתחבר עם חשבון Google כדי לטעון נתונים.', 'info', false);
        return;
    }
    updateStatus('טוען נתונים...', 'loading', true);
    DOMElements.scheduleCard.classList.add('loading'); // Show loading overlay
    
    try {
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:F`,
        });
        
        // Clear the existing schedules object without reassigning it
        for (const key in allSchedules) {
            delete allSchedules[key];
        }

        if (values && values.length > 1) {
            const headers = values[0];
            for (let i = 1; i < values.length; i++) {
                const row = values[i];
                if (row.length >= 6) {
                    const weekId = row[headers.indexOf("week_id")] || '';
                    const day = row[headers.indexOf("day")] || '';
                    const shiftType = row[headers.indexOf("shift_type")] || '';
                    const employee = row[headers.indexOf("employee")] || '';
                    const startTime = row[headers.indexOf("start_time")] || '';
                    const endTime = row[headers.indexOf("end_time")] || '';

                    if (weekId && day && shiftType) {
                        if (!allSchedules[weekId]) allSchedules[weekId] = {};
                        if (!allSchedules[weekId][day]) allSchedules[weekId][day] = {};
                        allSchedules[weekId][day][shiftType] = {
                            employee: employee,
                            start: startTime,
                            end: endTime
                        };
                    }
                }
            }
        }
        updateStatus('הנתונים נטענו בהצלחה!', 'success', false);
        const currentPickerDate = DOMElements.datePicker.value;
        renderSchedule(getWeekId(currentPickerDate));
    } catch (err) {
        displayAPIError(err, 'שגיאה בטעינת הנתונים מ-Google Sheets');
        DOMElements.scheduleBody.innerHTML = '<tr><td colspan="4" class="p-3 text-center text-red-500">שגיאה בטעינת הנתונים.</td></tr>';
        DOMElements.scheduleTitle.textContent = 'שגיאה בטעינת סידור';
    }
    finally {
        DOMElements.scheduleCard.classList.remove('loading'); // Hide loading overlay
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
    DOMElements.scheduleCard.classList.add('loading'); // Show loading overlay
    try {
        const response = await gapi.client.sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:F`,
        });
        let existingValues = response.result.values || [];
        const defaultHeaders = ["week_id", "day", "shift_type", "employee", "start_time", "end_time"];

        if (existingValues.length === 0 || !defaultHeaders.every(h => existingValues[0].includes(h))) {
            existingValues.unshift(defaultHeaders);
        }
        const headers = existingValues[0];

        const rowsToKeep = existingValues.filter((row, index) => index === 0 || row[headers.indexOf("week_id")] !== weekId);

        const newRowsForWeek = [];
        Object.keys(scheduleDataForWeek).forEach(day => {
            Object.keys(scheduleDataForWeek[day]).forEach(shiftType => {
                const shiftDetails = scheduleDataForWeek[day][shiftType];
                const employee = shiftDetails.employee;
                const startTime = shiftDetails.start || '';
                const endTime = shiftDetails.end || '';
                if (employee && employee !== 'none') {
                    newRowsForWeek.push([weekId, day, shiftType, employee, startTime, endTime]);
                }
            });
        });

        let dataToWrite = [...rowsToKeep, ...newRowsForWeek];

        const dayOrder = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
        dataToWrite.sort((a, b) => {
            const weekIdA = a[headers.indexOf("week_id")];
            const weekIdB = b[headers.indexOf("week_id")];
            const dayA = a[headers.indexOf("day")];
            const dayB = b[headers.indexOf("day")];

            if (weekIdA < weekIdB) return -1;
            if (weekIdA > weekIdB) return 1;
            return dayOrder.indexOf(dayA) - dayOrder.indexOf(dayB);
        });

        if (dataToWrite[0] !== headers) {
            dataToWrite = [headers, ...dataToWrite.filter(row => row !== headers)];
        }

        await gapi.client.sheets.spreadsheets.values.clear({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:F`,
        });

        if (dataToWrite.length > 0) {
            await gapi.client.sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME}!A1`,
                valueInputOption: 'RAW',
                resource: {
                    values: dataToWrite
                },
            });
        }
        updateStatus('השינויים נשמרו בהצלחה!', 'success', false);
        // REMOVED: updateMonthlySummaryChart();
     updateStatus('השינויים נשמרו בהצלחה!', 'success', false);
    } catch (err) {
        displayAPIError(err, 'שגיאה בשמירת הנתונים ל-Google Sheets');
    } finally {
        DOMElements.scheduleCard.classList.remove('loading'); // Hide loading overlay in all cases
    }
}
}
/**
 * Sends an email using the Gmail API.
 * @param {string} to - Recipient email address.
 * @param {string} subject - Email subject.
 * @param {string} messageBody - Email body (HTML content).
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
            'resource': {
                'raw': rawMessage
            }
        });
        updateStatus('המייל נשלח בהצלחה!', 'success', false);
    } catch (err) {
        displayAPIError(err, 'שגיאה בשליחת המייל דרך Gmail API');
    }
}
/**
 * Creates Google Calendar events for selected employees' shifts.
 * @param {string[]} selectedEmployees - Array of employee names for whom to create events.
 */
export async function handleCreateCalendarEvents(selectedEmployees) {
    if (gapi.client.getToken() === null) {
        updateStatus('יש להתחבר עם חשבון Google כדי לבצע פעולה זו.', 'info', false);
        return;
    }
    if (selectedEmployees.length === 0) {
        updateStatus('לא נבחרו עובדים ליצירת אירועי יומן.', 'info', false);
        return;
    }
    const weekId = getWeekId(DOMElements.datePicker.value);
    if (!allSchedules[weekId] || Object.keys(allSchedules[weekId]).length === 0) {
        updateStatus('אין נתוני סידור לשבוע זה.', 'info', false);
        return;
    }

    updateStatus('יוצר אירועי יומן...', 'loading', true);
    const weekDates = getWeekDates(new Date(weekId));
    const scheduleDataForWeek = allSchedules[weekId] || {};
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

    let eventsCreatedCount = 0;
    let errorsCount = 0;

    if (!allCreatedCalendarEvents[weekId]) allCreatedCalendarEvents[weekId] = {};

    for (let i = 0; i < weekDates.length; i++) {
        const date = weekDates[i];
        const dayName = DAYS[i];
        const dayData = scheduleDataForWeek[dayName] || {};

        if (dayName === 'שבת') continue;

        if (dayData.morning && dayData.morning.employee !== 'none' && selectedEmployees.includes(dayData.morning.employee)) {
            const employee = dayData.morning.employee;
            const startTime = dayData.morning.start || DEFAULT_SHIFT_TIMES.morning.start;
            const endTime = dayData.morning.end || DEFAULT_SHIFT_TIMES.morning.end;

            const event = {
                'summary': `משמרת בוקר, אסותא (${employee})`,
                'location': 'אסותא',
                'description': `משמרת בוקר של ${employee}`,
                'start': {
                    'dateTime': `${date.toISOString().split('T')[0]}T${startTime}`,
                    'timeZone': timeZone
                },
                'end': {
                    'dateTime': `${date.toISOString().split('T')[0]}T${endTime}`,
                    'timeZone': timeZone
                }
            };
            try {
                const response = await gapi.client.calendar.events.insert({
                    'calendarId': 'primary',
                    'resource': event
                });
                if (!allCreatedCalendarEvents[weekId][dayName]) allCreatedCalendarEvents[weekId][dayName] = {};
                allCreatedCalendarEvents[weekId][dayName].morning = response.result.id;
                eventsCreatedCount++;
            } catch (err) {
                console.error(`Error creating morning event for ${dayName}:`, err);
                errorsCount++;
            }
        }

        if (dayName !== 'שישי' && dayData.evening && dayData.evening.employee !== 'none' && selectedEmployees.includes(dayData.evening.employee)) {
            const employee = dayData.evening.employee;
            const startTime = dayData.evening.start || DEFAULT_SHIFT_TIMES.evening.start;
            const endTime = dayData.evening.end || DEFAULT_SHIFT_TIMES.evening.end;

            const event = {
                'summary': `משמרת ערב, אסותא (${employee})`,
                'location': 'אסותא',
                'description': `משמרת ערב של ${employee}`,
                'start': {
                    'dateTime': `${date.toISOString().split('T')[0]}T${startTime}`,
                    'timeZone': timeZone
                },
                'end': {
                    'dateTime': `${date.toISOString().split('T')[0]}T${endTime}`,
                    'timeZone': timeZone
                }
            };
            try {
                const response = await gapi.client.calendar.events.insert({
                    'calendarId': 'primary',
                    'resource': event
                });
                if (!allCreatedCalendarEvents[weekId][dayName]) allCreatedCalendarEvents[weekId][dayName] = {};
                allCreatedCalendarEvents[weekId][dayName].evening = response.result.id;
                eventsCreatedCount++;
            } catch (err) {
                console.error(`Error creating evening event for ${dayName}:`, err);
                errorsCount++;
            }
        }
    }

    if (eventsCreatedCount > 0) {
        updateStatus(`נוצרו בהצלחה ${eventsCreatedCount} אירועי יומן!`, 'success', false);
    } else if (errorsCount > 0) {
        updateStatus(`אירעו שגיאות ביצירת ${errorsCount} אירועי יומן.`, 'error', false);
    } else {
        updateStatus('לא נמצאו משמרות לעובדים הנבחרים.', 'info', false);
    }
}
/**
 * Deletes Google Calendar events previously created by the app for selected employees.
 * @param {string[]} selectedEmployees - Array of employee names for whom to delete events.
 */
export async function handleDeleteCalendarEvents(selectedEmployees) {
    if (gapi.client.getToken() === null) {
        updateStatus('יש להתחבר עם חשבון Google כדי לבצע פעולה זו.', 'info', false);
        return;
    }
    if (selectedEmployees.length === 0) {
        updateStatus('לא נבחרו עובדים למחיקת אירועי יומן.', 'info', false);
        return;
    }
    const weekId = getWeekId(DOMElements.datePicker.value);
    const eventsToDeleteForWeek = allCreatedCalendarEvents[weekId];

    if (!eventsToDeleteForWeek || Object.keys(eventsToDeleteForWeek).length === 0) {
        updateStatus('לא נמצאו אירועי יומן שנוצרו בסשן זה.', 'info', false);
        return;
    }

    showCustomConfirmation('האם למחוק את כל אירועי היומן שנוצרו לשבוע זה עבור העובדים הנבחרים?', async () => {
        updateStatus('מוחק אירועי יומן...', 'loading', true);
        let eventsDeletedCount = 0;
        let deleteErrorsCount = 0;

        for (const dayName in eventsToDeleteForWeek) {
            if (eventsToDeleteForWeek.hasOwnProperty(dayName)) {
                const dayEvents = eventsToDeleteForWeek[dayName];
                for (const shiftType in dayEvents) {
                    if (dayEvents.hasOwnProperty(shiftType)) {
                        const eventId = dayEvents[shiftType];
                        const employeeForShift = allSchedules[weekId]?.[dayName]?.[shiftType]?.employee;

                        if (eventId && employeeForShift && selectedEmployees.includes(employeeForShift)) {
                            try {
                                await gapi.client.calendar.events.delete({
                                    'calendarId': 'primary',
                                    'eventId': eventId
                                });
                                eventsDeletedCount++;
                                delete dayEvents[shiftType];
                            } catch (err) {
                                console.error(`Error deleting event ID ${eventId}:`, err);
                                deleteErrorsCount++;
                            }
                        }
                    }
                }
            }
        }

        if (Object.keys(eventsToDeleteForWeek).every(dayName => Object.keys(eventsToDeleteForWeek[dayName]).length === 0)) {
            delete allCreatedCalendarEvents[weekId];
        }

        if (eventsDeletedCount > 0) {
            updateStatus(`נמחקו בהצלחה ${eventsDeletedCount} אירועי יומן.`, 'success', false);
        } else if (deleteErrorsCount > 0) {
            updateStatus(`אירעו שגיאות במחיקת ${deleteErrorsCount} אירועי יומן.`, 'error', false);
        } else {
            updateStatus('לא נמצאו אירועים למחיקה.', 'info', false);
        }
    });
}