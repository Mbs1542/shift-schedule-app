// קובץ: JS/main.js

import { fetchData, handleCreateCalendarEvents, handleDeleteCalendarEvents, initializeGapiClient, saveFullSchedule } from './Api/googleApi.js';
import { handleShowChart, updateMonthlySummaryChart, destroyAllCharts } from './components/charts.js';
import { closeDifferencesModal, closeModal, closeVacationModal, displayDifferences, handleModalSave, showEmployeeSelectionModal, showVacationModal } from './components/modal.js';
import { handleExportToExcel, handleSendEmail, renderSchedule } from './components/schedule.js';
import { EMPLOYEES, DAYS, DEFAULT_SHIFT_TIMES, VACATION_EMPLOYEE_REPLACEMENT, CLIENT_ID, SCOPES, SPREADSHEET_ID, SHEET_NAME } from './config.js';
import * as hilanetParser from './services/hilanetParser.js';
import { formatDate, getWeekId, getWeekDates } from './utils.js';

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
    // This function is being wrapped in requestAnimationFrame for reliability
    requestAnimationFrame(() => {
        if (DOMElements.statusIndicator) {
            const colors = {
                info: 'text-slate-500',
                success: 'text-green-600',
                error: 'text-red-600',
                loading: 'text-blue-600'
            };
            let spinnerHtml = showSpinner ?
                '<div class="spinner animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>' :
                '';
            DOMElements.statusIndicator.innerHTML = `${spinnerHtml}<span class="ml-2">${text}</span>`;
            DOMElements.statusIndicator.className = `flex items-center gap-2 text-sm p-2 rounded-md ${colors[type] || colors.info}`;
        }
    });
    // The console log remains for debugging purposes
    console.log('Status Update:', { text, type, showSpinner });
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
    if (err && (err.status === 401 || err.status === 403)) {
        errorMessage += '<br>בדוק הרשאות ב-Google Cloud Console וגישה לגיליון.';
    }
    updateStatus(errorMessage, 'error', false);
    console.error('API Error:', err);
}

// --- GAPI / GIS Functions ---

function gapiLoaded() {
    gapi.load('client', async () => {
        await initializeGapiClient();
        gapiInited = true;
        maybeInitAuthClient();
    });
}

function gisLoaded() {
    gisInited = true;
    maybeInitAuthClient();
}

export function maybeInitAuthClient() {
    if (gapiInited && gisInited) {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: CLIENT_ID,
            scope: SCOPES,
            callback: onTokenResponse,
        });
        if (DOMElements.authorizeButton) {
            DOMElements.authorizeButton.onclick = authorize;
            DOMElements.signoutButton.onclick = signOut;
            DOMElements.authorizeButton.disabled = false;
        } else {
            console.warn('DOMElements.authorizeButton is not yet defined. Ensure DOM is loaded.');
        }
        checkSignInStatus();
    }
}

async function onTokenResponse(resp) {
    if (resp.error !== undefined) {
        displayAPIError(resp.error, 'שגיאה באימות חשבון Google');
        updateSigninStatus(false);
        return;
    }
    localStorage.setItem('google_access_token', resp.access_token);
    gapi.client.setToken({ access_token: resp.access_token });
    updateSigninStatus(true);
    await fetchData();
}

function checkSignInStatus() {
    const token = localStorage.getItem('google_access_token');
    if (token) {
        gapi.client.setToken({ access_token: token });
        updateSigninStatus(true);
    } else {
        updateSigninStatus(false);
    }
}

function authorize() {
    if (!tokenClient || typeof tokenClient.requestAccessToken !== 'function') {
        updateStatus('שגיאה: אימות Google לא אותחל כהלכה.', 'error');
        console.error('tokenClient is not ready:', tokenClient);
        return;
    }
    if (gapi.client.getToken() === null) {
        tokenClient.requestAccessToken({ prompt: 'consent' });
    } else {
        tokenClient.requestAccessToken({ prompt: '' });
    }
}

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
            closeDifferencesModal(); // סוגר את חלון הפערים
            if (DOMElements.chartCard) DOMElements.chartCard.classList.add('hidden'); // מסתיר את הגרפים
        });
    }
}

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

// --- Application Logic Functions ---

async function handleReset() {
    if (gapi.client.getToken() === null) {
        updateStatus('יש להתחבר עם חשבון Google כדי לאפס.', 'info', false);
        return;
    }
    showCustomConfirmation('האם לאפס את כל השיבוצים בשבוע הנוכחי?', async () => {
        const weekId = getWeekId(DOMElements.datePicker.value);
        allSchedules[weekId] = {};
        renderSchedule(weekId);
        await saveFullSchedule(allSchedules);
    });
}

export function createMessage(to, subject, messageBody) {
    const utf8ToBase64 = (str) => {
        try {
            return btoa(unescape(encodeURIComponent(str)));
        } catch (e) {
            console.error("Error in utf8ToBase64 encoding:", e);
            return "";
        }
    };
    const emailParts = [
        `From: me`, `To: ${to}`, `Subject: =?utf-8?B?${utf8ToBase64(subject)}?=`,
        'MIME-Version: 1.0', 'Content-Type: text/html; charset="UTF-8"',
        'Content-Transfer-Encoding: base64', '', utf8ToBase64(messageBody)
    ];
    const fullEmailString = emailParts.join('\r\n');
    return utf8ToBase64(fullEmailString).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

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

    const context = `אני מנהל סידור עבודה. העובדים הזמינים הם: ${EMPLOYEES.join(', ')}. המשמרת הנוכחית היא: יום ${day}, משמרת ${shiftType === 'morning' ? 'בוקר' : 'ערב'}. העובד המשובץ כרגע למשמרת זו הוא: ${currentEmployee === 'none' ? 'אף אחד' : currentEmployee}. העובד המשובץ למשמרת השנייה באותו יום הוא: ${otherShiftEmployee === 'none' ? 'אף אחד' : otherShiftEmployee}. אסור לשבץ את אותו עובד לשתי משמרות באותו יום. הצע לי עובד אחד מתאים למשמרת זו. השב רק עם שם העובד המוצע, ללא הסברים. אם אין עובד מתאים, השב "אף אחד".`;

    updateStatus('מבקש הצעת שיבוץ מ-Gemini...', 'loading', true);

    try {
        const response = await fetch('/.netlify/functions/suggest-shift', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: context })
        });

        if (!response.ok) {
            const errorResult = await response.json();
            throw new Error(errorResult.error || 'תקשורת עם השרת נכשלה');
        }

        const result = await response.json();
        const suggestedEmployee = result.suggestion;

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
        console.error('Error fetching shift suggestion:', error);
        displayAPIError(error, 'שגיאה בקבלת הצעת שיבוץ.');
    }
}

export function showCustomConfirmation(message, onConfirm) {
    const modal = document.createElement('div');
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
        await saveFullSchedule(allSchedules);
        updateStatus('סידור השבוע הקודם הועתק בהצלחה!', 'success', false);
    });
}

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

    updateStatus(`משבץ את ${VACATION_EMPLOYEE_REPLACEMENT} במקום ${vacationingEmployee}...`, 'loading', true);

    let shiftsUpdatedCount = 0;
    let hasChanges = false;

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const currentDayISO = d.toISOString().split('T')[0];
        const weekId = getWeekId(currentDayISO);
        const dayName = DAYS[d.getDay()];

        if (!allSchedules[weekId] || dayName === 'שבת' || !allSchedules[weekId][dayName]) continue;

        const dayData = allSchedules[weekId][dayName];

        if (dayData.morning && dayData.morning.employee === vacationingEmployee) {
            dayData.morning.employee = VACATION_EMPLOYEE_REPLACEMENT;
            shiftsUpdatedCount++;
            hasChanges = true;
        }

        if (dayName !== 'שישי' && dayData.evening && dayData.evening.employee === vacationingEmployee) {
            dayData.evening.employee = VACATION_EMPLOYEE_REPLACEMENT;
            shiftsUpdatedCount++;
            hasChanges = true;
        }
    }

    if (hasChanges) {
        await saveFullSchedule(allSchedules);
        renderSchedule(getWeekId(DOMElements.datePicker.value));
        updateStatus(`שובצו ${shiftsUpdatedCount} משמרות עבור ${VACATION_EMPLOYEE_REPLACEMENT}.`, 'success', false);
    } else {
        updateStatus(`לא נמצאו משמרות עבור ${vacationingEmployee} בטווח התאריכים הנבחר.`, 'info', false);
    }
}

// קובץ: JS/main.js

// ... (קוד קודם)

async function handleUploadHilanet(event) {
    if (isProcessing) {
        updateStatus('תהליך אחר כבר רץ, אנא המתן.', 'info');
        return;
    }
    const file = event.target.files[0];
    if (!file || file.type !== 'application/pdf') {
        updateStatus('אנא בחר קובץ PDF בלבד.', 'info');
        return;
    }

    setProcessingStatus(true);
    updateStatus('מעבד קובץ PDF...', 'loading', true);

    try {
        const fileReader = new FileReader();
        fileReader.readAsArrayBuffer(file);

        fileReader.onload = async (e) => {
            try {
                const pdfData = new Uint8Array(e.target.result);
                const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
                
                // שלב 1: חילוץ טקסט נקי מהעמוד הראשון לצורך מטא-דאטה
                const firstPage = await pdf.getPage(1);
                const textContent = await firstPage.getTextContent();
                const rawText = textContent.items.map(item => item.str).join(' ');
                
                const { employeeName, detectedMonth, detectedYear } = hilanetParser.processHilanetData(rawText);

                // שלב 2: עיבוד כל עמוד כתמונה ושליחה ל-Gemini
                updateStatus(`מכין ${pdf.numPages} עמודים לעיבוד...`, 'loading', true);

                const pagePromises = [];
                for (let i = 1; i <= pdf.numPages; i++) {
                    pagePromises.push(pdf.getPage(i));
                }
                const pages = await Promise.all(pagePromises);

                const extractionPromises = pages.map(async (page, index) => {
                    updateStatus(`שולח עמוד ${index + 1} מתוך ${pdf.numPages} לניתוח...`, 'loading', true);
                    
                    const scale = 1.5; // ניתן לשקול להקטין ל-1.2 או 1.0 לשיפור ביצועים
                    const viewport = page.getViewport({ scale });
                    const canvas = document.createElement('canvas');
                    const context = canvas.getContext('2d');
                    canvas.height = viewport.height;
                    canvas.width = viewport.width;

                    await page.render({ canvasContext: context, viewport: viewport }).promise;                    
                    const imageDataBase64 = canvas.toDataURL('image/jpeg', 0.7);
                    
                    return hilanetParser.callGeminiForShiftExtraction(imageDataBase64, detectedMonth, detectedYear, employeeName);
                });

                const results = await Promise.all(extractionPromises);
                const allShifts = results.flat();
                // שלב 3: המשך התהליך עם המשמרות שחולצו
                if (allShifts.length === 0) {
                    updateStatus('לא נמצאו משמרות לניתוח בקובץ ה-PDF.', 'info');
                    return; // אין צורך להמשיך
                }

                currentHilanetShifts = hilanetParser.structureShifts(allShifts, detectedMonth, detectedYear, employeeName);
                
                updateStatus('משווה סידורים...', 'loading', true);
                const allGoogleSheetsShiftsForMaor = await getAllGoogleSheetsShiftsForMaor();
                currentDifferences = hilanetParser.compareSchedules(allGoogleSheetsShiftsForMaor, currentHilanetShifts);
                
                displayDifferences(currentDifferences);
                updateStatus('השוואת הסידורים הושלמה!', 'success');

            } catch (error) {
                // תפיסת שגיאות מכל התהליך הפנימי
                displayAPIError(error, 'אירעה שגיאה בעיבוד הקובץ.');
            } finally {
                // איפוס והפעלה מחדש של כפתורים
                event.target.value = ''; 
                setProcessingStatus(false);
            }
        };

        fileReader.onerror = (error) => {
            displayAPIError(error, 'שגיאה בקריאת הקובץ.');
            setProcessingStatus(false);
        };

    } catch (error) {
        displayAPIError(error, 'אירעה שגיאה כללית בהעלאת הקובץ.');
        setProcessingStatus(false);
    }
}


async function getAllGoogleSheetsShiftsForMaor() {
    const maorShifts = {};
    if (Object.keys(allSchedules).length === 0) {
        await fetchData();
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
                    maorShifts[dateString].morning = { ...dayData.morning };
                }
                if (dayData.evening && dayData.evening.employee === 'מאור') {
                    if (!maorShifts[dateString]) maorShifts[dateString] = {};
                    maorShifts[dateString].evening = { ...dayData.evening };
                }
            });
        }
    }
    return maorShifts;
}

async function handleImportSelectedHilanetShifts() {
    // This part is new: Get selected shift IDs from the checkboxes in the modal
    const selectedDiffIds = Array.from(DOMElements.differencesDisplay.querySelectorAll('.difference-checkbox:checked'))
        .map(cb => cb.dataset.diffId);

    if (selectedDiffIds.length === 0) {
        updateStatus('לא נבחרו פערים לייבוא.', 'info', false);
        return;
    }

    updateStatus('מייבא משמרות נבחרות...', 'loading', true);
    try {
        // Create a filtered list of differences that the user actually selected
        const selectedDifferences = currentDifferences.filter(diff => selectedDiffIds.includes(diff.id));

        // The hilanetParser function will now receive only the selected differences
        const { updatedSchedules, importedCount } = hilanetParser.handleImportSelectedHilanetShifts(selectedDifferences, allSchedules);

        if (importedCount > 0) {
            allSchedules = updatedSchedules;
            await saveFullSchedule(allSchedules); // Ensure changes are saved to Google Sheets

            // Refresh the main schedule view to show the imported shift
            const currentWeekId = getWeekId(DOMElements.datePicker.value);
            renderSchedule(currentWeekId);

            // This is key: Re-compare and refresh the differences modal instead of closing it
            const allGoogleSheetsShiftsForMaor = await getAllGoogleSheetsShiftsForMaor();
            currentDifferences = hilanetParser.compareSchedules(allGoogleSheetsShiftsForMaor, currentHilanetShifts);
            displayDifferences(currentDifferences); // Refresh the modal content

            updateStatus(`יובאו ${importedCount} משמרות בהצלחה.`, 'success', false);
        } else {
            updateStatus('לא נמצאו משמרות לייבא. ייתכן שהן כבר מעודכנות.', 'info', false);
        }
    } catch (error) {
        console.error("שגיאה במהלך ייבוא משמרות מחילנט:", error);
        updateStatus('שגיאה בעדכון המשמרות.', 'error', false);
    }
    // The call to closeDifferencesModal() is removed from here.
}

function handleDownloadDifferences() {
    if (currentDifferences.length === 0) {
        updateStatus('אין פערים להורדה.', 'info', false);
        return;
    }
    const csvContent = [];
    csvContent.push(['סוג שינוי', 'תאריך', 'יום', 'משמרת', 'סידור Google Sheets', 'סידור חילנט']);
    currentDifferences.forEach(diff => {
        const dateFormatted = formatDate(diff.date, { day: '2-digit', month: '2-digit' });
        const shiftTypeHebrew = diff.shiftType === 'morning' ? 'בוקר' : 'ערב';
        let gsDetails = '—';
        let hlDetails = '—';
        if (diff.type === 'added') {
            hlDetails = `${diff.hilanet.employee} (${diff.hilanet.start.substring(0, 5)}-${diff.hilanet.end.substring(0, 5)})`;
        } else if (diff.type === 'removed') {
            gsDetails = `${diff.googleSheets.employee} (${diff.googleSheets.start.substring(0, 5)}-${diff.googleSheets.end.substring(0, 5)})`;
        } else if (diff.type === 'changed') {
            gsDetails = `${diff.googleSheets.employee} (${diff.googleSheets.start.substring(0, 5)}-${diff.googleSheets.end.substring(0, 5)})`;
            hlDetails = `${diff.hilanet.employee} (${diff.hilanet.start.substring(0, 5)}-${diff.hilanet.end.substring(0, 5)})`;
        }
        const typeHebrew = { 'added': 'נוסף בחילנט', 'removed': 'חסר בחילנט', 'changed': 'שונה' }[diff.type];
        csvContent.push([typeHebrew, dateFormatted, diff.dayName, shiftTypeHebrew, gsDetails, hlDetails]);
    });
    const csvString = csvContent.map(row => row.join(',')).join('\n');
    const blob = new Blob([`\ufeff${csvString}`], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `הבדלים_סידור_מאור_${getWeekId(DOMElements.datePicker.value)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    updateStatus('מסמך ההבדלים הורד בהצלחה!', 'success', false);
}

// --- Initialization ---

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
        vacationCancelBtn: document.getElementById('vacation-cancel-btn'),
        downloadHilanetBtn: document.getElementById('download-hilanet-btn'),
        uploadHilanetInput: document.getElementById('upload-hilanet-input'),
        uploadHilanetBtn: document.getElementById('upload-hilanet-btn'),
        differencesModal: document.getElementById('differences-modal'),
        differencesDisplay: document.getElementById('differences-display'),
        closeDifferencesModalBtn: document.getElementById('close-differences-modal-btn'),
        importSelectedHilanetShiftsBtn: document.getElementById('import-selected-hilanet-shifts-btn'),
        downloadDifferencesBtn: document.getElementById('download-differences-btn'),
        geminiSuggestionBtn: document.getElementById('gemini-suggestion-btn'),
        showChartBtn: document.getElementById('show-chart-btn'),
        chartCard: document.getElementById('chart-card'),
        monthlySummaryChartCard: document.getElementById('monthly-summary-chart-card'),
        monthlySummaryEmployeeSelect: document.getElementById('monthly-summary-employee-select'),
        customCloseDiffModalBtn: document.getElementById('custom-close-diff-modal-btn')
    };

    function loadGoogleApiScripts() {
        const gapiScript = document.createElement('script');
        gapiScript.src = 'https://apis.google.com/js/api.js';
        gapiScript.defer = true;
        gapiScript.onload = () => gapiLoaded();
        document.head.appendChild(gapiScript);

        const gisScript = document.createElement('script');
        gisScript.src = 'https://accounts.google.com/gsi/client';
        gisScript.defer = true;
        gisScript.onload = () => gisLoaded();
        document.head.appendChild(gisScript);
    }

    if (DOMElements.customCloseDiffModalBtn) DOMElements.customCloseDiffModalBtn.addEventListener('click', closeDifferencesModal);
    if (DOMElements.uploadHilanetInput) DOMElements.uploadHilanetInput.addEventListener('change', handleUploadHilanet);
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
    if (DOMElements.uploadHilanetBtn) DOMElements.uploadHilanetBtn.addEventListener('click', () => hilanetParser.handleUploadHilanetBtnClick());
    if (DOMElements.closeDifferencesModalBtn) DOMElements.closeDifferencesModalBtn.addEventListener('click', closeDifferencesModal);
    if (DOMElements.importSelectedHilanetShiftsBtn) DOMElements.importSelectedHilanetShiftsBtn.addEventListener('click', handleImportSelectedHilanetShifts);
    if (DOMElements.downloadDifferencesBtn) DOMElements.downloadDifferencesBtn.addEventListener('click', handleDownloadDifferences);
    if (DOMElements.geminiSuggestionBtn) DOMElements.geminiSuggestionBtn.addEventListener('click', handleGeminiSuggestShift);
    if (DOMElements.showChartBtn) DOMElements.showChartBtn.addEventListener('click', handleShowChart);
    if (DOMElements.differencesModal) DOMElements.differencesModal.addEventListener('click', e => {
        if (e.target === DOMElements.differencesModal) closeDifferencesModal();
    });

    const today = new Date().toISOString().split('T')[0];
    DOMElements.datePicker.value = getWeekId(today);

    loadGoogleApiScripts();
}

document.addEventListener('DOMContentLoaded', initializeAppLogic);