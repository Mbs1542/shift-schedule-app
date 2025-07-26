import { fetchData, handleCreateCalendarEvents, handleDeleteCalendarEvents, initializeGapiClient, saveData } from './Api/googleApi.js';
import { handleShowChart, updateMonthlySummaryChart, destroyAllCharts } from './components/charts.js';
import { closeDifferencesModal, closeModal, closeVacationModal, displayDifferences, handleModalSave, showEmployeeSelectionModal, showVacationModal } from './components/modal.js';
import { handleExportToExcel, handleSendEmail, renderSchedule } from './components/schedule.js';
import { EMPLOYEES, DAYS, DEFAULT_SHIFT_TIMES, VACATION_EMPLOYEE_REPLACEMENT, CLIENT_ID, SCOPES, SPREADSHEET_ID, SHEET_NAME } from './config.js';
import { processHilanetData, compareSchedules, handleUploadHilanetBtnClick, parseHilanetXLSXForMaor, callGeminiForShiftExtraction, structureShifts } from './services/hilanetParser.js';
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
        await saveData(weekId, {});
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

/**
 * מבקש הצעת שיבוץ מ-Gemini API דרך פונקציית שרת מאובטחת.
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
        await saveData(currentWeekId, allSchedules[currentWeekId]);
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

    updateStatus(`משבץ את ${VACATION_EMPLOYEE_REPLACEMENT} במקום ${vacationingEmployee} בין ${formatDate(startDate)} ל-${formatDate(endDate)}...`, 'loading', true);

    let shiftsUpdatedCount = 0;
    const affectedWeeks = new Set();

    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        const currentDayISO = d.toISOString().split('T')[0];
        const weekId = getWeekId(currentDayISO);
        const dayName = DAYS[d.getDay()];

        if (!allSchedules[weekId] || dayName === 'שבת') continue;

        const dayData = allSchedules[weekId][dayName] || {};

        if (dayData.morning && dayData.morning.employee === vacationingEmployee) {
            if (dayData.evening && dayData.evening.employee === VACATION_EMPLOYEE_REPLACEMENT) {
                console.warn(`Skipping morning shift for ${dayName} as ${VACATION_EMPLOYEE_REPLACEMENT} is already in evening shift.`);
                updateStatus(`אזהרה: ${VACATION_EMPLOYEE_REPLACEMENT} כבר משובץ למשמרת ערב ביום ${dayName}. דילוג על שיבוץ בוקר.`, 'info');
            } else {
                dayData.morning.employee = VACATION_EMPLOYEE_REPLACEMENT;
                shiftsUpdatedCount++;
                affectedWeeks.add(weekId);
            }
        }

        if (dayName !== 'שישי' && dayData.evening && dayData.evening.employee === vacationingEmployee) {
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

// ... (rest of your main.js code)

async function handleUploadHilanet(event) {
    if (isProcessing) {
        updateStatus('תהליך אחר כבר רץ, אנא המתן.', 'info');
        return;
    }
    const file = event.target.files[0];
    if (!file) return;

    setProcessingStatus(true);
    try {
        if (file.type === 'application/pdf') {
            // Call the function that correctly extracts text from PDF
            await processPdfFileAsImages(file);
        } else if (file.type === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || file.type === 'application/vnd.ms-excel') {
            await processXlsxFile(file);
        } else {
            updateStatus('סוג קובץ לא נתמך. אנא העלה קובץ PDF או Excel.', 'error');
        }
    } catch (error) {
        displayAPIError(error, 'אירעה שגיאה כללית בעת עיבוד הקובץ.');
    } finally {
        event.target.value = '';
        setProcessingStatus(false);
    }
}

// Keep the existing processPdfFileAsImages function as is, it's correct.
// Make sure to remove or comment out the incorrect processPdfFile function if it still exists.

// ... (rest of your main.js code)

// Alternative approach: Process PDF as images for better table extraction
async function processPdfFileAsImages(file) {
    updateStatus('מעבד קובץ PDF...', 'loading', true);
    try {
        const fileReader = new FileReader();
        const arrayBuffer = await new Promise((resolve, reject) => {
            fileReader.onload = e => resolve(e.target.result);
            fileReader.onerror = reject;
            fileReader.readAsArrayBuffer(file);
        });

        const typedArray = new Uint8Array(arrayBuffer);
        const pdf = await pdfjsLib.getDocument({ data: typedArray }).promise;
        
        // First, extract text from PDF to get employee info and dates
        let fullText = '';
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            const page = await pdf.getPage(pageNum);
            const textContent = await page.getTextContent();
            const pageText = textContent.items.map(item => item.str).join(' ');
            fullText += pageText + '\n';
        }
        
        console.log('Extracted PDF text for metadata:', fullText.substring(0, 500));
        
        // Extract employee info and dates from text
        const { employeeName, detectedMonth, detectedYear } = processHilanetData(fullText);
        
        // Now process pages as images for table extraction
        const allShifts = {};
        
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
            updateStatus(`מעבד עמוד ${pageNum} מתוך ${pdf.numPages}...`, 'loading', true);
            
            const page = await pdf.getPage(pageNum);
            const imageDataUrl = await getPageImage(page);
            
            try {
                const shiftsFromPage = await callGeminiForShiftExtraction(
                    imageDataUrl, 
                    detectedMonth, 
                    detectedYear, 
                    employeeName
                );
                
                if (shiftsFromPage && Array.isArray(shiftsFromPage)) {
                    const structuredShifts = structureShifts(
                        shiftsFromPage, 
                        detectedMonth, 
                        detectedYear, 
                        employeeName
                    );
                    
                    // Merge shifts from this page
                    Object.assign(allShifts, structuredShifts);
                }
            } catch (pageError) {
                console.warn(`Error processing page ${pageNum}:`, pageError);
                // Continue with other pages
            }
        }
        
        currentHilanetShifts = allShifts;
        
        if (Object.keys(currentHilanetShifts).length > 0) {
            updateStatus('משווה סידורים...', 'loading', true);
            const allGoogleSheetsShiftsForMaor = await getAllGoogleSheetsShiftsForMaor();
            currentDifferences = compareSchedules(allGoogleSheetsShiftsForMaor, currentHilanetShifts);
            displayDifferences(currentDifferences);
            updateStatus('השוואת הסידורים הושלמה!', 'success');
        } else {
            updateStatus('לא נמצאו משמרות לניתוח בקובץ ה-PDF.', 'info');
        }
        
    } catch (error) {
        console.error('Error processing PDF:', error);
        displayAPIError(error, 'שגיאה בעיבוד קובץ ה-PDF');
    }
}

// Helper function to render a PDF page to a canvas and get a data URL
async function getPageImage(page) {
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    canvas.height = viewport.height;
    canvas.width = viewport.width;

    await page.render({ canvasContext: context, viewport: viewport }).promise;
    return canvas.toDataURL();
}

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
    const selectedDiffIds = Array.from(document.querySelectorAll('.difference-checkbox:checked'))
        .map(checkbox => checkbox.dataset.diffId);

    if (selectedDiffIds.length === 0) {
        // שימוש בסטטוס הכללי כי המודאל לא בהכרח יתרענן
        updateStatus('לא נבחרו פערים לייבוא.', 'info', false);
        return;
    }

    // קבלת רפרנס לאזור הסטטוס בתוך המודאל
    const modalStatusEl = document.getElementById('differences-modal-status');

    showCustomConfirmation('האם לייבא את המשמרות הנבחרות מחילנט ולעדכן את המערכת?', async () => {
        // עדכון הסטטוס המקומי בתוך המודאל
        if (modalStatusEl) {
            modalStatusEl.textContent = 'מייבא משמרות נבחרות...';
            modalStatusEl.className = 'text-center text-sm font-medium mb-4 text-blue-600';
        }

        const shiftsToUpdate = {};
        currentDifferences.forEach(diff => {
            if (selectedDiffIds.includes(diff.id)) {
                if (diff.type === 'added' || diff.type === 'changed') {
                    if (!shiftsToUpdate[diff.date]) {
                        shiftsToUpdate[diff.date] = {};
                    }
                    shiftsToUpdate[diff.date][diff.shiftType] = { ...diff.hilanet };
                } else if (diff.type === 'removed') {
                    if (!shiftsToUpdate[diff.date]) {
                        shiftsToUpdate[diff.date] = {};
                    }
                    // תיקון: מבטיח שהמשמרת המוסרת תקבל ערכי ברירת מחדל
                    shiftsToUpdate[diff.date][diff.shiftType] = {
                        employee: 'none',
                        start: DEFAULT_SHIFT_TIMES[diff.shiftType].start,
                        end: DEFAULT_SHIFT_TIMES[diff.shiftType].end
                    };
                }
            }
        });

        // שמירת השינויים ורענון הנתונים מהשרת
        await saveMultipleShifts(shiftsToUpdate);
        await fetchData();

        // עדכון הסטטוס המקומי
        if (modalStatusEl) {
            modalStatusEl.textContent = 'מעדכן את תצוגת הפערים...';
        }

        // רענון תצוגת הפערים
        const allGoogleSheetsShiftsForMaor = await getAllGoogleSheetsShiftsForMaor();
        currentDifferences = compareSchedules(allGoogleSheetsShiftsForMaor, currentHilanetShifts);
        displayDifferences(currentDifferences);

        // עדכון סטטוס סופי בתוך המודאל
        if (modalStatusEl) {
            if (currentDifferences.length === 0) {
                modalStatusEl.textContent = 'הייבוא הושלם וכל הפערים טופלו!';
                modalStatusEl.className = 'text-center text-sm font-medium mb-4 text-green-600';
            } else {
                modalStatusEl.textContent = 'הייבוא הושלם. ניתן לייבא פערים נוספים.';
                modalStatusEl.className = 'text-center text-sm font-medium mb-4 text-green-600';
            }
        }
    });
}
async function saveMultipleShifts(shiftsToImport) {
    // בדיקה ראשונית אם המשתמש מחובר
    if (gapi.client.getToken() === null) {
        updateStatus('יש להתחבר עם חשבון Google כדי לייבא משמרות.', 'info', false);
        return;
    }

    updateStatus('מייבא משמרות...', 'loading', true);

    try {
        // שלב 1: קבץ את כל השינויים הנדרשים לפי שבוע (weekId)
        const changesByWeek = {};
        for (const dateString in shiftsToImport) {
            const weekId = getWeekId(dateString);
            if (!changesByWeek[weekId]) {
                changesByWeek[weekId] = {};
            }
            // הוסף את כל השינויים של אותו תאריך לשבוע המתאים
            changesByWeek[weekId][dateString] = shiftsToImport[dateString];
        }

        // שלב 2: עבור כל שבוע שהושפע מהשינויים, בצע שמירה
        for (const weekId in changesByWeek) {
            const weeklyChanges = changesByWeek[weekId];
            
            // ודא שהשבוע קיים בזיכרון המקומי (allSchedules)
            if (!allSchedules[weekId]) {
                allSchedules[weekId] = {};
            }
            
            // עדכן את הנתונים בזיכרון המקומי עם השינויים החדשים
            for (const dateString in weeklyChanges) {
                const dayName = DAYS[new Date(dateString).getDay()];
                if (!allSchedules[weekId][dayName]) {
                    allSchedules[weekId][dayName] = {};
                }
                const dayChanges = weeklyChanges[dateString];
                for (const shiftType in dayChanges) {
                    allSchedules[weekId][dayName][shiftType] = dayChanges[shiftType];
                }
            }

            // שלב 3: השתמש בפונקציה האמינה 'saveData' כדי לשמור את כל נתוני השבוע המעודכן
            await saveData(weekId, allSchedules[weekId]);
        }

        updateStatus('המשמרות יובאו בהצלחה!', 'success', false);

    } catch (err) {
        displayAPIError(err, 'שגיאה בייבוא המשמרות ל-Google Sheets');
    }
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
        vacationCancelBtn: document.getElementById('vacation-cancel-btn'), // <-- תיקון: הוספת כפתור הביטול
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

    // --- הגדרת מאזיני אירועים ---

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

    // Event listeners grouped together for clarity
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
    if (DOMElements.vacationCancelBtn) DOMElements.vacationCancelBtn.addEventListener('click', closeVacationModal); // <-- תיקון: הפעלת הכפתור
    if (DOMElements.uploadHilanetBtn) DOMElements.uploadHilanetBtn.addEventListener('click', handleUploadHilanetBtnClick);
    if (DOMElements.closeDifferencesModalBtn) DOMElements.closeDifferencesModalBtn.addEventListener('click', closeDifferencesModal);
    if (DOMElements.importSelectedHilanetShiftsBtn) DOMElements.importSelectedHilanetShiftsBtn.addEventListener('click', handleImportSelectedHilanetShifts);
    if (DOMElements.downloadDifferencesBtn) DOMElements.downloadDifferencesBtn.addEventListener('click', handleDownloadDifferences);
    if (DOMElements.geminiSuggestionBtn) DOMElements.geminiSuggestionBtn.addEventListener('click', handleGeminiSuggestShift);
    if (DOMElements.showChartBtn) DOMElements.showChartBtn.addEventListener('click', handleShowChart);
    if (DOMElements.differencesModal) DOMElements.differencesModal.addEventListener('click', e => {
        if (e.target === DOMElements.differencesModal) closeDifferencesModal();
    });

    // --- Initial setup ---
    const today = new Date().toISOString().split('T')[0];
    DOMElements.datePicker.value = getWeekId(today);

    loadGoogleApiScripts();
}

document.addEventListener('DOMContentLoaded', initializeAppLogic);