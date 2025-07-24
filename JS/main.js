import { fetchData, handleCreateCalendarEvents, handleDeleteCalendarEvents, initializeGapiClient, saveData } from './Api/googleApi.js';
import { handleShowChart, updateMonthlySummaryChart, destroyAllCharts } from './components/charts.js';
import { closeDifferencesModal, closeModal, closeVacationModal, displayDifferences, handleModalSave, showEmployeeSelectionModal, showVacationModal } from './components/modal.js';
import { handleExportToExcel, handleSendEmail, renderSchedule } from './components/schedule.js';
import { EMPLOYEES, DAYS, DEFAULT_SHIFT_TIMES, VACATION_EMPLOYEE_REPLACEMENT } from './config.js';
import { processHilanetData, compareSchedules, handleUploadHilanetBtnClick, parseHilanetXLSXForMaor } from './services/hilanetParser.js';import { formatDate, getWeekId, getWeekDates } from './utils.js';

// --- Global Variables & State Management ---
export let gapiInited = false;
let gisInited = false;
let tokenClient;
export let DOMElements = {};

// Application Data Stores
export let allSchedules = {};
export let allCreatedCalendarEvents = {};
let currentHilanetShifts = {};
let currentDifferences = [];
let isProcessing = false; // Flag to prevent concurrent operations
/**
 * Sets the application's processing status. Disables/enables UI elements.
 * @param {boolean} processing - True if a process is starting, false if it's ending.
 */
function setProcessingStatus(processing) {
    isProcessing = processing;
    // Disable buttons that could start conflicting actions
    const buttonsToToggle = [
        'uploadHilanetBtn', 'resetBtn', 'sendEmailBtn', 
        'downloadExcelBtn', 'copyPreviousWeekBtn', 'createCalendarEventsBtn',
        'deleteCalendarEventsBtn', 'refreshDataBtn', 'vacationShiftBtn'
    ];
    buttonsToToggle.forEach(btnId => {
        if (DOMElements[btnId]) {
            DOMElements[btnId].disabled = processing;
        }
    });
}

/**
 * Updates the status indicator in the UI.
 * @param {string} text - The message to display.
 * @param {'info'|'success'|'error'|'loading'} type - The type of status, affects color.
 * @param {boolean} [showSpinner=false] - Whether to show a loading spinner.
 */
export function updateStatus(text, type, showSpinner = false) {
    if (DOMElements.statusIndicator) {
        const colors = {
            info: 'text-slate-500',
            success: 'text-green-600',
            error: 'text-red-600',
            loading: 'text-blue-600'
        };
        let spinnerHtml = showSpinner ? '<span class="spinner"></span>' : '';
        DOMElements.statusIndicator.innerHTML = `${spinnerHtml}<span>${text}</span>`;
        DOMElements.statusIndicator.className = `flex items-center gap-2 text-sm p-2 rounded-md ${colors[type] || colors.info}`;
    }
    console.log('Status Update:', {
        text,
        type,
        showSpinner
    });
}

/**
 * Displays an API error message to the user.
 * @param {Object} err - The error object from the API.
 * @param {string} defaultMessage - A default message to show if specific error details are unavailable.
 */
export function displayAPIError(err, defaultMessage) {
    let errorMessage = defaultMessage;
    if (err && err.result && err.result.error && err.result.error.message) {
        errorMessage += `: ${err.result.error.message}`;
    } else if (err && err.message) {
        errorMessage += `: ${err.message}`;
    } else if (typeof err === 'string') {
        errorMessage += `: ${err}`;
    }
    // Provide specific guidance for authentication/authorization errors
    if (err && (err.status === 401 || err.status === 403)) {
        errorMessage += '<br>בדוק הרשאות ב-Google Cloud Console וגישה לגיליון.';
    }
    updateStatus(errorMessage, 'error', false);
    console.error('API Error:', err);
}

// --- GAPI / GIS Functions (Google API Client and Google Identity Services) ---

/** Initializes GAPI client after script loads. */
function gapiLoaded() {
    gapi.load('client', async () => {
        await initializeGapiClient();
        gapiInited = true;
        maybeInitAuthClient();
    });
}

/** Initializes Google Identity Services after script loads. */
function gisLoaded() {
    gisInited = true;
    maybeInitAuthClient();
}

/**
 * Initializes the Google Auth client when both GAPI and GIS are loaded.
 * Sets up the token client for OAuth2.
 */
export function maybeInitAuthClient() {
    if (gapiInited && gisInited) {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: onTokenResponse,
        });
        // Enable auth buttons once client is ready
        if (DOMElements.authorizeButton) {
            DOMElements.authorizeButton.onclick = authorize;
            DOMElements.signoutButton.onclick = signOut;
            DOMElements.authorizeButton.disabled = false;
        } else {
            console.warn('DOMElements.authorizeButton is not yet defined. Ensure DOM is loaded.');
        }
        checkSignInStatus(); // Check if user is already signed in from previous session
    }
}

/**
 * Handles the response from the Google OAuth2 token client.
 * Stores the access token and updates sign-in status.
 * @param {Object} resp - The token response object.
 */
async function onTokenResponse(resp) {
    if (resp.error !== undefined) {
        displayAPIError(resp.error, 'שגיאה באימות חשבון Google');
        updateSigninStatus(false);
        return;
    }
    // Store token in localStorage for persistence across sessions
    localStorage.setItem('google_access_token', resp.access_token);
    gapi.client.setToken({
        access_token: resp.access_token
    });
    updateSigninStatus(true);
    await fetchData(); // Fetch data immediately after successful sign-in
}

/**
 * Checks if a Google access token exists in localStorage and updates sign-in status accordingly.
 */
function checkSignInStatus() {
    const token = localStorage.getItem('google_access_token');
    if (token) {
        gapi.client.setToken({
            access_token: token
        });
        updateSigninStatus(true);
    } else {
        updateSigninStatus(false);
    }
}

/** Initiates the Google OAuth2 authorization flow. */
function authorize() {
    if (!tokenClient || typeof tokenClient.requestAccessToken !== 'function') {
        updateStatus('שגיאה: אימות Google לא אותחל כהלכה.', 'error');
        console.error('tokenClient is not ready:', tokenClient);
        return;
    }
    if (gapi.client.getToken() === null) {
        tokenClient.requestAccessToken({
            prompt: 'consent'
        });
    } else {
        tokenClient.requestAccessToken({
            prompt: ''
        });
    }
}

/** Signs out the user by revoking the access token and clearing localStorage. */
function signOut() {
    const token = gapi.client.getToken();
    if (token !== null) {
        google.accounts.oauth2.revoke(token.access_token, () => {
            console.log('Access token revoked.');
            gapi.client.setToken(null);
            localStorage.removeItem('google_access_token');
            updateSigninStatus(false);
            DOMElements.scheduleBody.innerHTML = '';
            DOMElements.scheduleTitle.textContent = 'התחבר כדי לראות את הסידור';
        });
    }
}

/**
 * Updates the UI based on the user's sign-in status.
 * @param {boolean} isSignedIn - True if the user is signed in, false otherwise.
 */
function updateSigninStatus(isSignedIn) {
    if (isSignedIn) {
        DOMElements.authorizeButton.classList.add('hidden');
        DOMElements.signoutButton.classList.remove('hidden');
        DOMElements.appContent.classList.remove('hidden');
        updateStatus('מחובר בהצלחה!', 'success');
    } else {
        DOMElements.authorizeButton.classList.remove('hidden');
        DOMElements.signoutButton.classList.add('hidden');
        DOMElements.appContent.classList.add('hidden');
        updateStatus('יש להתחבר עם חשבון Google', 'info');
    }
}

/** Handles resetting all shifts for the current week. */
async function handleReset() {
    if (gapi.client.getToken() === null) {
        updateStatus('יש להתחבר עם חשבון Google כדי לאפס.', 'info', false);
        return;
    }
    showCustomConfirmation('האם לאפס את כל השיבוצים בשבוע הנוכחי?', async () => {
        const weekId = getWeekId(DOMElements.datePicker.value);
        allSchedules[weekId] = {};
        renderSchedule(weekId);
        await saveData(weekId, {});
    });
}

/**
 * Creates a base64url encoded email message string.
 * @param {string} to - Recipient email address.
 * @param {string} subject - Email subject.
 * @param {string} messageBody - Email body (HTML content).
 * @returns {string} Base64url encoded message.
 */
export function createMessage(to, subject, messageBody) {
    // Helper function to safely encode UTF-8 strings to Base64 using a standard and safe method.
    const utf8ToBase64 = (str) => {
        try {
            // This is a robust way to handle all Unicode characters
            return btoa(unescape(encodeURIComponent(str)));
        } catch (e) {
            console.error("Error in utf8ToBase64 encoding:", e);
            return "";
        }
    };

    const emailParts = [
        `From: me`,
        `To: ${to}`,
        `Subject: =?utf-8?B?${utf8ToBase64(subject)}?=`, // Correctly encode the subject
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset="UTF-8"',
        'Content-Transfer-Encoding: base64',
        '',
        utf8ToBase64(messageBody) // Correctly encode the body
    ];

    const fullEmailString = emailParts.join('\r\n'); // Use CRLF which is standard for emails

    // The Gmail API expects the final raw message to be base64url encoded.
    // We don't need to re-encode the whole thing, just the parts.
    // The final string needs to be encoded for the API.
    return utf8ToBase64(fullEmailString).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Requests a shift suggestion from Gemini API for the current selected shift cell.
 */
async function handleGeminiSuggestShift() {
    if (gapi.client.getToken() === null) {
        updateStatus('יש להתחבר עם חשבון Google כדי לקבל הצעות.', 'info', false);
        return;
    }
    const weekId = getWeekId(DOMElements.datePicker.value);
    const day = DOMElements.shiftModal.dataset.day;
    const shiftType = DOMElements.shiftModal.dataset.shift;
    const currentEmployee = allSchedules[weekId]?.[day]?.[shiftType]?.employee || 'none';
    const otherShiftEmployee = DOMElements.shiftModal.dataset.otherShiftEmployee;

    updateStatus('מבקש הצעת שיבוץ מ-Gemini...', 'loading', true);
    try {
        const context = `
                    אני מנהל סידור עבודה.
                    העובדים הזמינים הם: ${EMPLOYEES.join(', ')}.
                    המשמרת הנוכחית היא: יום ${day}, משמרת ${shiftType === 'morning' ? 'בוקר' : 'ערב'}.
                    העובד המשובץ כרגע למשמרת זו הוא: ${currentEmployee === 'none' ? 'אף אחד' : currentEmployee}.
                    העובד המשובץ למשמרת השנייה באותו יום הוא: ${otherShiftEmployee === 'none' ? 'אף אחד' : otherShiftEmployee}.
                    אסור לשבץ את אותו עובד לשתי משמרות באותו יום.
                    הצע לי עובד אחד מתאים למשמרת זו, תוך התחשבות בעובד המשובץ למשמרת השנייה באותו יום.
                    השב רק עם שם העובד המוצע, ללא הסברים נוספים. אם אין עובד מתאים, השב "אף אחד".
                `;
        let chatHistory = [{
            role: "user",
            parts: [{
                text: context
            }]
        }];
        const payload = {
            contents: chatHistory
        };

        const apiKey = process.env.GEMINI_API_KEY; // If you want to use models other than gemini-2.0-flash or imagen-3.0-generate-002, provide an API key here. Otherwise, leave this as-is.
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const result = await response.json();

        let suggestedEmployee = "אף אחד";
        if (result.candidates && result.candidates.length > 0 && result.candidates[0].content && result.candidates[0].content.parts && result.candidates[0].content.parts.length > 0) {
            suggestedEmployee = result.candidates[0].content.parts[0].text.trim();
        } else {
            console.error('Unexpected Gemini API response:', result);
        }

        const suggestedBtn = DOMElements.modalOptions.querySelector(`button[data-employee="${suggestedEmployee}"]`);
        if (suggestedBtn && !suggestedBtn.disabled) {
            suggestedBtn.click();
            updateStatus(`Gemini הציע: ${suggestedEmployee}`, 'success', false);
        } else if (suggestedEmployee === 'אף אחד') {
            const noOneBtn = DOMElements.modalOptions.querySelector(`button[data-employee="none"]`);
            if (noOneBtn) noOneBtn.click();
            updateStatus('Gemini לא מצא שיבוץ מתאים.', 'info', false);
        } else {
            updateStatus(`Gemini הציע: ${suggestedEmployee}, אך הוא אינו זמין או קיים.`, 'info', false);
        }
    } catch (error) {
        displayAPIError(error, 'שגיאה בקבלת הצעת שיבוץ מ-Gemini.');
    }
}

/**
 * Displays a custom confirmation modal instead of `window.confirm`.
 * @param {string} message - The confirmation message.
 * @param {Function} onConfirm - Callback function to execute if confirmed.
 */
export function showCustomConfirmation(message, onConfirm) {
    const modal = document.createElement('div');
    // Changed z-index to a higher value (1050) and used Tailwind's justify-center
    modal.className = 'fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[1050] p-4';
    modal.innerHTML = `
                <div class="bg-white rounded-lg shadow-xl p-6 w-full max-w-sm text-center">
                    <p class="text-lg font-semibold mb-6">${message}</p>
                    <div class="flex justify-center gap-4">
                        <button id="confirm-yes-btn" class="btn btn-red px-6 py-2">אישור</button>
                        <button id="confirm-no-btn" class="btn bg-slate-200 text-slate-700 hover:bg-slate-300 px-6 py-2">ביטול</button>
                    </div>
                </div>
            `;
    document.body.appendChild(modal);

    document.getElementById('confirm-yes-btn').addEventListener('click', () => {
        onConfirm();
        modal.remove();
    });
    document.getElementById('confirm-no-btn').addEventListener('click', () => modal.remove());
    modal.addEventListener('click', (e) => {
        if (e.target === modal) modal.remove();
    });
}

/** Handles copying the schedule from the previous week to the current week. */
async function handleCopyPreviousWeek() {
    if (gapi.client.getToken() === null) {
        updateStatus('יש להתחבר עם חשבון Google כדי להעתיק סידורים.', 'info', false);
        return;
    }
    const currentWeekId = getWeekId(DOMElements.datePicker.value);
    const currentDate = new Date(currentWeekId);
    const previousDate = new Date(currentDate);
    previousDate.setDate(currentDate.getDate() - 7);
    const previousWeekId = getWeekId(previousDate.toISOString().split('T')[0]);

    if (!allSchedules[previousWeekId] || Object.keys(allSchedules[previousWeekId]).length === 0) {
        updateStatus(`לא נמצא סידור לשבוע הקודם (${formatDate(previousDate)}).`, 'info', false);
        return;
    }

    showCustomConfirmation(`האם להעתיק את הסידור מהשבוע של ${formatDate(previousDate)} לשבוע הנוכחי?`, async () => {
        allSchedules[currentWeekId] = JSON.parse(JSON.stringify(allSchedules[previousWeekId]));
        renderSchedule(currentWeekId);
        await saveData(currentWeekId, allSchedules[currentWeekId]);
        updateStatus('סידור השבוע הקודם הועתק בהצלחה!', 'success', false);
    });
}

/**
 * Handles assigning a replacement employee for a vacationing employee over a date range.
 * @param {string} vacationingEmployee - The employee going on vacation.
 * @param {string} startDateString - Start date of vacation (YYYY-MM-DD).
 * @param {string} endDateString - End date of vacation (YYYY-MM-DD).
 */
async function handleVacationShift(vacationingEmployee, startDateString, endDateString) {
    if (gapi.client.getToken() === null) {
        updateStatus('יש להתחבר עם חשבון Google כדי לבצע פעולה זו.', 'info', false);
        return;
    }
    if (!vacationingEmployee || !startDateString || !endDateString) {
        updateStatus('יש לבחור עובד ותאריכי התחלה וסיום לחופשה.', 'info', false);
        return;
    }
    const startDate = new Date(startDateString);
    const endDate = new Date(endDateString);

    if (startDate > endDate) {
        updateStatus('תאריך ההתחלה חייב להיות לפני או זהה לתאריך הסיום.', 'error', false);
        return;
    }

    updateStatus(`משבץ את ${VACATION_EMPLOYEE_REPLACEMENT} במקום ${vacationingEmployee} בין ${formatDate(startDate)} ל-${formatDate(endDate)}...`, 'loading', true);

    let shiftsUpdatedCount = 0;
    const affectedWeeks = new Set();

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const currentDayISO = d.toISOString().split('T')[0];
        const weekId = getWeekId(currentDayISO);
        const dayName = DAYS[d.getDay()];

        if (!allSchedules[weekId]) continue;

        const dayData = allSchedules[weekId][dayName] || {};

        if (dayName === 'שבת') continue;

        // Check and update morning shift
        if (dayData.morning && dayData.morning.employee === vacationingEmployee) {
            // Check if replacement is already in the evening shift on the same day
            if (dayData.evening && dayData.evening.employee === VACATION_EMPLOYEE_REPLACEMENT) {
                console.warn(`Skipping morning shift for ${dayName} as ${VACATION_EMPLOYEE_REPLACEMENT} is already in evening shift.`);
                updateStatus(`אזהרה: ${VACATION_EMPLOYEE_REPLACEMENT} כבר משובץ למשמרת ערב ביום ${dayName}. דילוג על שיבוץ בוקר.`, 'info');
            } else {
                dayData.morning.employee = VACATION_EMPLOYEE_REPLACEMENT;
                shiftsUpdatedCount++;
                affectedWeeks.add(weekId);
            }
        }

        // Check and update evening shift
        if (dayName !== 'שישי' && dayData.evening && dayData.evening.employee === vacationingEmployee) {
            // Check if replacement is already in morning shift on the same day
            if (dayData.morning && dayData.morning.employee === VACATION_EMPLOYEE_REPLACEMENT) {
                console.warn(`Skipping evening shift for ${dayName} as ${VACATION_EMPLOYEE_REPLACEMENT} is already in morning shift.`);
                updateStatus(`אזהרה: ${VACATION_EMPLOYEE_REPLACEMENT} כבר משובץ למשמרת בוקר ביום ${dayName}. דילוג על שיבוץ ערב.`, 'info');
            } else {
                dayData.evening.employee = VACATION_EMPLOYEE_REPLACEMENT;
                shiftsUpdatedCount++;
                affectedWeeks.add(weekId);
            }
        }
    }

    if (affectedWeeks.size > 0) {
        for (const weekToSaveId of affectedWeeks) {
            await saveData(weekToSaveId, allSchedules[weekToSaveId]);
        }
        renderSchedule(getWeekId(DOMElements.datePicker.value));
        updateStatus(`שובצו ${shiftsUpdatedCount} משמרות עבור ${vacationingEmployee} על ידי ${VACATION_EMPLOYEE_REPLACEMENT}.`, 'success', false);
    } else {
        updateStatus(`לא נמצאו משמרות עבור ${vacationingEmployee} בטווח התאריכים הנבחר.`, 'info', false);
    }
}

/**
 * Handles the upload of Hilanet files, directing them to the correct parser.
 * @param {Event} event - The file input change event.
 */
async function handleUploadHilanet(event) {
    if (isProcessing) {
        updateStatus('תהליך אחר כבר רץ, אנא המתן.', 'info');
        return;
    }

    const file = event.target.files[0];
    if (!file) return;

    resetFileProcessingState(); // <-- איפוס המצב לפני תחילת עיבוד חדש
    setProcessingStatus(true); // Lock the UI

    try {
        const fileType = file.type;
        if (fileType === 'application/pdf') {
            await processPdfFile(file);
        } else if (fileType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || fileType === 'application/vnd.ms-excel') {
            await processXlsxFile(file);
        } else {
            updateStatus('סוג קובץ לא נתמך. אנא העלה קובץ PDF או Excel.', 'error');
        }
    } catch (error) {
        displayAPIError(error, 'אירעה שגיאה כללית בעת עיבוד הקובץ.');
    } finally {
        // Reset the file input to allow uploading the same file again
        event.target.value = '';
        setProcessingStatus(false); // Unlock the UI
    }
}
/**
 * Processes a PDF file: extracts shifts using Gemini and compares schedules.
 * @param {File} file - The PDF file to process.
 */
async function processPdfFile(file) {
    updateStatus('מעבד קובץ PDF...', 'loading', true);
    currentHilanetShifts = await processHilanetData(file);
    
    if (Object.keys(currentHilanetShifts).length > 0) {
        updateStatus('משווה סידורים...', 'loading', true);
        const allGoogleSheetsShiftsForMaor = await getAllGoogleSheetsShiftsForMaor();
        currentDifferences = compareSchedules(allGoogleSheetsShiftsForMaor, currentHilanetShifts);
        displayDifferences(currentDifferences);
        updateStatus('השוואת הסידורים הושלמה!', 'success');
    } else {
        updateStatus('לא נמצאו משמרות לניתוח בקובץ ה-PDF.', 'info');
    }
}
/**
 * Processes an XLSX file: extracts shifts and compares schedules.
 * @param {File} file - The XLSX file to process.
 */
async function processXlsxFile(file) {
    updateStatus('מעבד קובץ Excel...', 'loading', true);
    const data = await file.arrayBuffer();
    const workbook = XLSX.read(new Uint8Array(data), { type: 'array' });
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const json = XLSX.utils.sheet_to_json(worksheet, { header: 1, raw: true });

    currentHilanetShifts = parseHilanetXLSXForMaor(json);
    
    if (Object.keys(currentHilanetShifts).length > 0) {
        updateStatus('משווה סידורים...', 'loading', true);
        const allGoogleSheetsShiftsForMaor = await getAllGoogleSheetsShiftsForMaor();
        currentDifferences = compareSchedules(allGoogleSheetsShiftsForMaor, currentHilanetShifts);
        displayDifferences(currentDifferences);
        updateStatus('השוואת הסידורים הושלמה!', 'success');
    } else {
        updateStatus('לא נמצאו משמרות לניתוח בקובץ ה-Excel.', 'info');
    }
}

/**
 * Fetches all shifts for 'מאור' from the Google Sheets data.
 * @returns {Object} An object containing Maor's shifts, keyed by date and shift type.
 */
async function getAllGoogleSheetsShiftsForMaor() {
    const maorShifts = {};
    // Ensure allSchedules is populated
    if (Object.keys(allSchedules).length === 0) {
        await fetchData(); // Re-fetch if empty, or ensure fetchData is called once on app load
    }
    for (const weekId in allSchedules) {
        if (allSchedules.hasOwnProperty(weekId)) {
            const weekData = allSchedules[weekId];
            const weekDates = getWeekDates(new Date(weekId));
            weekDates.forEach(dateObj => {
                const dateString = dateObj.toISOString().split('T')[0];
                const dayName = DAYS[dateObj.getDay()];
                const dayData = weekData[dayName] || {};

                if (dayData.morning && dayData.morning.employee === 'מאור') {
                    if (!maorShifts[dateString]) maorShifts[dateString] = {};
                    maorShifts[dateString].morning = { ...dayData.morning
                    };
                }
                if (dayData.evening && dayData.evening.employee === 'מאור') {
                    if (!maorShifts[dateString]) maorShifts[dateString] = {};
                    maorShifts[dateString].evening = { ...dayData.evening
                    };
                }
            });
        }
    }
    return maorShifts;
}

/** Handles importing selected Hilanet shifts into the Google Sheets schedule. */
async function handleImportSelectedHilanetShifts() {
    const selectedDiffIds = Array.from(document.querySelectorAll('.difference-checkbox:checked'))
        .map(checkbox => checkbox.dataset.diffId);

    if (selectedDiffIds.length === 0) {
        updateStatus('לא נבחרו פערים לייבוא.', 'info', false);
        return;
    }

    showCustomConfirmation('האם לייבא את המשמרות הנבחרות מחילנט ולעדכן את המערכת?', async () => {
        updateStatus('מייבא משמרות נבחרות...', 'loading', true);
        closeDifferencesModal();

        const shiftsToUpdate = {};
        currentDifferences.forEach(diff => {
            if (selectedDiffIds.includes(diff.id)) {
                if (diff.type === 'added' || diff.type === 'changed') {
                    if (!shiftsToUpdate[diff.date]) shiftsToUpdate[diff.date] = {};
                    // Ensure both morning and evening shifts are considered for update,
                    // even if only one is different, to avoid partial updates.
                    // We take the Hilanet data for the specific shift type.
                    shiftsToUpdate[diff.date][diff.shiftType] = { ...diff.hilanet
                    };
                } else if (diff.type === 'removed') {
                    if (!shiftsToUpdate[diff.date]) shiftsToUpdate[diff.date] = {};
                    // If removed, set the employee to 'none' and use default times
                    shiftsToUpdate[diff.date][diff.shiftType] = {
                        employee: 'none',
                        start: DEFAULT_SHIFT_TIMES[diff.shiftType].start,
                        end: DEFAULT_SHIFT_TIMES[diff.shiftType].end
                    };
                }
            }
        });
        await saveMultipleShifts(shiftsToUpdate);
        await fetchData(); // Fetch and re-render after saving
    });
}

/**
 * Saves multiple shift updates to Google Sheets.
 * @param {Object} shiftsToImport - An object containing shifts to be imported/updated.
 */
async function saveMultipleShifts(shiftsToImport) {
    if (gapi.client.getToken() === null) {
        updateStatus('יש להתחבר עם חשבון Google כדי לייבא משמרות.', 'info', false);
        return;
    }
    updateStatus('מייבא משמרות...', 'loading', true);
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

        const existingShiftsMap = {};
        for (let i = 1; i < existingValues.length; i++) {
            const row = existingValues[i];
            const weekId = row[headers.indexOf("week_id")];
            const day = row[headers.indexOf("day")];
            const shiftType = row[headers.indexOf("shift_type")];
            if (weekId && day && shiftType) {
                if (!existingShiftsMap[weekId]) existingShiftsMap[weekId] = {};
                if (!existingShiftsMap[weekId][day]) existingShiftsMap[weekId][day] = {};
                existingShiftsMap[weekId][day][shiftType] = {
                    employee: row[headers.indexOf("employee")],
                    start: row[headers.indexOf("start_time")],
                    end: row[headers.indexOf("end_time")],
                    originalRowIndex: i
                };
            }
        }

        const updates = [];
        const rowsToDelete = new Set();

        for (const dateString in shiftsToImport) {
            const weekId = getWeekId(dateString);
            const dayName = DAYS[new Date(dateString).getDay()];
            const hilanetDayShifts = shiftsToImport[dateString];

            for (const shiftType in hilanetDayShifts) {
                const hilanetShift = hilanetDayShifts[shiftType];
                const existingShift = existingShiftsMap[weekId]?.[dayName]?.[shiftType];

                if (hilanetShift.employee && hilanetShift.employee !== 'none') {
                    if (existingShift) {
                        if (existingShift.employee !== hilanetShift.employee || existingShift.start !== hilanetShift.start || existingShift.end !== hilanetShift.end) {
                            rowsToDelete.add(existingShift.originalRowIndex);
                            updates.push([weekId, dayName, shiftType, hilanetShift.employee, hilanetShift.start, hilanetShift.end]);
                        }
                    } else {
                        updates.push([weekId, dayName, shiftType, hilanetShift.employee, hilanetShift.start, hilanetShift.end]);
                    }
                } else { // hilanetShift.employee is 'none' or empty, meaning we need to remove/clear it
                    if (existingShift) { // Only delete if there was an existing shift to clear
                        rowsToDelete.add(existingShift.originalRowIndex);
                    }
                }
            }
        }

        let finalDataToWrite = existingValues.filter((_, index) => index === 0 || !rowsToDelete.has(index)); // remove unused 'row'
        finalDataToWrite.push(...updates);

        const dayOrder = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
        finalDataToWrite.sort((a, b) => {
            if (a === headers) return -1;
            if (b === headers) return 1;
            const weekIdA = a[headers.indexOf("week_id")];
            const weekIdB = b[headers.indexOf("week_id")];
            const dayA = a[headers.indexOf("day")];
            const dayB = b[headers.indexOf("day")];
            if (weekIdA < weekIdB) return -1;
            if (weekIdA > weekIdB) return 1;
            return dayOrder.indexOf(dayA) - dayOrder.indexOf(dayB);
        });

        if (finalDataToWrite[0] !== headers) {
            finalDataToWrite = [headers, ...finalDataToWrite.filter(row => row !== headers)];
        }

        await gapi.client.sheets.spreadsheets.values.clear({
            spreadsheetId: SPREADSHEET_ID,
            range: `${SHEET_NAME}!A:F`,
        });
        if (finalDataToWrite.length > 0) {
            await gapi.client.sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${SHEET_NAME}!A1`,
                valueInputOption: 'RAW',
                resource: {
                    values: finalDataToWrite
                },
            });
        }
        updateStatus('המשמרות יובאו בהצלחה!', 'success', false);
    } catch (err) {
        displayAPIError(err, 'שגיאה בייבוא המשמרות ל-Google Sheets');
    }
}

/** Downloads the identified differences as a CSV file. */
function handleDownloadDifferences() {
    if (currentDifferences.length === 0) {
        updateStatus('אין פערים להורדה.', 'info', false);
        return;
    }
    const csvContent = [];
    csvContent.push(['סוג שינוי', 'תאריך', 'יום', 'משמרת', 'סידור Google Sheets', 'סידור חילנט']);

    currentDifferences.forEach(diff => {
        const dateFormatted = formatDate(diff.date, {
            day: '2-digit',
            month: '2-digit'
        });
        const shiftTypeHebrew = diff.shiftType === 'morning' ? 'בוקר' : 'ערב';
        let gsDetails = '—';
        let hlDetails = '—';

        if (diff.type === 'added') {
            hlDetails = `${diff.hilanet.employee} (${diff.hilanet.start.substring(0,5)}-${diff.hilanet.end.substring(0,5)})`;
        } else if (diff.type === 'removed') {
            gsDetails = `${diff.googleSheets.employee} (${diff.googleSheets.start.substring(0,5)}-${diff.googleSheets.end.substring(0,5)})`;
        } else if (diff.type === 'changed') {
            gsDetails = `${diff.googleSheets.employee} (${diff.googleSheets.start.substring(0,5)}-${diff.googleSheets.end.substring(0,5)})`;
            hlDetails = `${diff.hilanet.employee} (${diff.hilanet.start.substring(0,5)}-${diff.hilanet.end.substring(0,5)})`;
        }
        const typeHebrew = {
            'added': 'נוסף בחילנט',
            'removed': 'חסר בחילנט',
            'changed': 'שונה'
        } [diff.type];
        csvContent.push([typeHebrew, dateFormatted, diff.dayName, shiftTypeHebrew, gsDetails, hlDetails]);
    });

    const csvString = csvContent.map(row => row.join(',')).join('\n');
    const blob = new Blob([`\ufeff${csvString}`], {
        type: 'text/csv;charset=utf-8;'
    });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `הבדלים_סידור_מאור_${getWeekId(DOMElements.datePicker.value)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    updateStatus('מסמך ההבדלים הורד בהצלחה!', 'success', false);
}

/** Initializes all DOM element references and event listeners. */
function initializeAppLogic() {
    DOMElements = {
        datePicker: document.getElementById('date-picker'),
        scheduleBody: document.getElementById('schedule-body'),
        scheduleCard: document.getElementById('schedule-card'), 
        scheduleTitle: document.getElementById('schedule-title'),
        downloadBtn: document.getElementById('download-excel-btn'),
        resetBtn: document.getElementById('reset-btn'),
        emailBtn: document.getElementById('send-email-btn'),
        shiftModal: document.getElementById('shift-modal'),
        modalTitle: document.getElementById('modal-title'),
        modalOptions: document.getElementById('modal-options'),
        modalCloseBtn: document.getElementById('modal-close-btn'),
        modalSaveBtn: document.getElementById('modal-save-btn'),
        shiftStartTimeInput: document.getElementById('shift-start-time'),
        shiftEndTimeInput: document.getElementById('shift-end-time'),
        statusIndicator: document.getElementById('status-indicator'),
        appContent: document.getElementById('app-content'),
        authorizeButton: document.getElementById('authorize_button'),
        signoutButton: document.getElementById('signout_button'),
        scheduleTable: document.getElementById('schedule-table'),
        copyPreviousWeekBtn: document.getElementById('copy-previous-week-btn'),
        createCalendarEventsBtn: document.getElementById('create-calendar-events-btn'),
        deleteCalendarEventsBtn: document.getElementById('delete-calendar-events-btn'),
        refreshDataBtn: document.getElementById('refresh-data-btn'),
        vacationShiftBtn: document.getElementById('vacation-shift-btn'),
        employeeSelectionModal: document.getElementById('employee-selection-modal'),
        employeeSelectionModalTitle: document.getElementById('employee-selection-modal-title'),
        employeeCheckboxesContainer: document.getElementById('employee-checkboxes-container'),
        employeeSelectionConfirmBtn: document.getElementById('employee-selection-confirm-btn'),
        employeeSelectionCancelBtn: document.getElementById('employee-selection-cancel-btn'),
        vacationModal: document.getElementById('vacation-modal'),
        vacationEmployeeSelect: document.getElementById('vacation-employee-select'),
        vacationStartDateInput: document.getElementById('vacation-start-date'),
        vacationEndDateInput: document.getElementById('vacation-end-date'),
        vacationConfirmBtn: document.getElementById('vacation-confirm-btn'),
        downloadHilanetBtn: document.getElementById('download-hilanet-btn'),
        uploadHilanetInput: document.getElementById('upload-hilanet-input'),
        uploadHilanetBtn: document.getElementById('upload-hilanet-btn'),
        differencesModal: document.getElementById('differences-modal'),
        differencesDisplay: document.getElementById('differences-display'),
        closeDifferencesModalBtn: document.getElementById('close-differences-modal-btn'),
        importSelectedHilanetShiftsBtn: document.getElementById('import-selected-hilanet-shifts-btn'), // Updated ID
        downloadDifferencesBtn: document.getElementById('download-differences-btn'),
        geminiSuggestionBtn: document.getElementById('gemini-suggestion-btn'),
        showChartBtn: document.getElementById('show-chart-btn'),
        chartCard: document.getElementById('chart-card'),
        monthlySummaryChartCard: document.getElementById('monthly-summary-chart-card'),
        monthlySummaryEmployeeSelect: document.getElementById('monthly-summary-employee-select')
        
    };
    /**
 * Loads the Google API and Google Identity Services scripts dynamically.
 */
function loadGoogleApiScripts() {
    // Create script for Google API (gapi)
    const gapiScript = document.createElement('script');
    gapiScript.src = 'https://apis.google.com/js/api.js';
    gapiScript.defer = true;
    // The gapiLoaded function is in scope here and will be called on load
    gapiScript.onload = () => gapiLoaded();
    document.head.appendChild(gapiScript);

    // Create script for Google Identity Services (gis)
    const gisScript = document.createElement('script');
    gisScript.src = 'https://accounts.google.com/gsi/client';
    gisScript.defer = true;
    // The gisLoaded function is in scope here and will be called on load
    gisScript.onload = () => gisLoaded();
    document.head.appendChild(gisScript);
}
    if (DOMElements.uploadHilanetInput) DOMElements.uploadHilanetInput.addEventListener('change', handleUploadHilanet);
    // Populate employee select for monthly summary
    if (DOMElements.monthlySummaryEmployeeSelect) {
        EMPLOYEES.forEach(emp => {
            const option = document.createElement('option');
            option.value = emp;
            option.textContent = emp;
            DOMElements.monthlySummaryEmployeeSelect.appendChild(option);
        });
        DOMElements.monthlySummaryEmployeeSelect.addEventListener('change', updateMonthlySummaryChart);
    }

    if (DOMElements.datePicker) DOMElements.datePicker.addEventListener('change', async () => {
        const selectedDate = DOMElements.datePicker.value;
        const weekIdForSelectedDate = getWeekId(selectedDate);
        if (selectedDate !== weekIdForSelectedDate) DOMElements.datePicker.value = weekIdForSelectedDate;
        await fetchData();
    });
    if (DOMElements.resetBtn) DOMElements.resetBtn.addEventListener('click', handleReset);
    if (DOMElements.downloadBtn) DOMElements.downloadBtn.addEventListener('click', handleExportToExcel);
    if (DOMElements.emailBtn) DOMElements.emailBtn.addEventListener('click', handleSendEmail);
    if (DOMElements.modalCloseBtn) DOMElements.modalCloseBtn.addEventListener('click', closeModal);
    if (DOMElements.modalSaveBtn) DOMElements.modalSaveBtn.addEventListener('click', handleModalSave);
    if (DOMElements.shiftModal) DOMElements.shiftModal.addEventListener('click', e => {
        if (e.target === DOMElements.shiftModal) closeModal();
    });
    if (DOMElements.copyPreviousWeekBtn) DOMElements.copyPreviousWeekBtn.addEventListener('click', handleCopyPreviousWeek);
    if (DOMElements.createCalendarEventsBtn) DOMElements.createCalendarEventsBtn.addEventListener('click', () => showEmployeeSelectionModal(handleCreateCalendarEvents, 'בחר עובדים ליצירת אירועי יומן'));
    if (DOMElements.deleteCalendarEventsBtn) DOMElements.deleteCalendarEventsBtn.addEventListener('click', () => showEmployeeSelectionModal(handleDeleteCalendarEvents, 'בחר עובדים למחיקת אירועי יומן'));
    if (DOMElements.refreshDataBtn) DOMElements.refreshDataBtn.addEventListener('click', fetchData);
    if (DOMElements.vacationShiftBtn) DOMElements.vacationShiftBtn.addEventListener('click', showVacationModal);
    if (DOMElements.vacationConfirmBtn) DOMElements.vacationConfirmBtn.addEventListener('click', () => {
        const vacationingEmployee = DOMElements.vacationEmployeeSelect.value;
        const startDate = DOMElements.vacationStartDateInput.value;
        const endDate = DOMElements.vacationEndDateInput.value;
        closeVacationModal();
        handleVacationShift(vacationingEmployee, startDate, endDate);
    });
    if (DOMElements.vacationCancelBtn) DOMElements.vacationCancelBtn.addEventListener('click', closeVacationModal);
    if (DOMElements.uploadHilanetBtn) DOMElements.uploadHilanetBtn.addEventListener('click', handleUploadHilanetBtnClick);
    if (DOMElements.uploadHilanetInput) DOMElements.uploadHilanetInput.addEventListener('change', handleUploadHilanet);
    if (DOMElements.closeDifferencesModalBtn) DOMElements.closeDifferencesModalBtn.addEventListener('click', closeDifferencesModal);
    if (DOMElements.importSelectedHilanetShiftsBtn) DOMElements.importSelectedHilanetShiftsBtn.addEventListener('click', handleImportSelectedHilanetShifts); // Updated event listener
    if (DOMElements.downloadDifferencesBtn) DOMElements.downloadDifferencesBtn.addEventListener('click', handleDownloadDifferences);
    if (DOMElements.geminiSuggestionBtn) DOMElements.geminiSuggestionBtn.addEventListener('click', handleGeminiSuggestShift);
    if (DOMElements.showChartBtn) DOMElements.showChartBtn.addEventListener('click', handleShowChart);

    // Ensure the differences modal closes when clicking outside its content
    if (DOMElements.differencesModal) DOMElements.differencesModal.addEventListener('click', e => {
        if (e.target === DOMElements.differencesModal) closeDifferencesModal();
    });
    
    // Set the date picker to the Sunday of the current week
    const today = new Date().toISOString().split('T')[0];
    DOMElements.datePicker.value = getWeekId(today);
}

// Initialize the app logic after the DOM is fully loaded
document.addEventListener('DOMContentLoaded', initializeAppLogic);כ