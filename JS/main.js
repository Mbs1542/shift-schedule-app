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
let isProcessing = false;

function setProcessingStatus(processing) {
    isProcessing = processing;
    const buttonsToToggle = [
        'uploadHilanetBtn', 'uploadImageBtn', 'resetBtn', 'sendEmailBtn',
        'downloadExcelBtn', 'copyPreviousWeekBtn', 'createCalendarEventsBtn',
        'deleteCalendarEventsBtn', 'refreshDataBtn', 'vacationShiftBtn'
    ];
    buttonsToToggle.forEach(btnId => {
        if (DOMElements[btnId]) {
            DOMElements[btnId].disabled = processing;
            DOMElements[btnId].classList.toggle('opacity-50', processing);
            DOMElements[btnId].classList.toggle('cursor-not-allowed', processing);
        }
    });
}

export function updateStatus(text, type, showSpinner = false) {
    requestAnimationFrame(() => {
        if (DOMElements.statusIndicator) {
            const colors = {
                info: 'text-slate-500',
                success: 'text-green-600',
                error: 'text-red-600',
                loading: 'text-blue-600'
            };
            let spinnerHtml = showSpinner ?
                '<div class="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-500"></div>' :
                '';
            DOMElements.statusIndicator.innerHTML = `${spinnerHtml}<span class="ml-2">${text}</span>`;
            DOMElements.statusIndicator.className = `flex items-center gap-2 text-sm p-2 rounded-md ${colors[type] || colors.info}`;
        }
    });
    console.log('Status Update:', { text, type, showSpinner });
}

export function displayAPIError(err, defaultMessage) {
    let errorMessage = defaultMessage;
    if (err && err.result && err.result.error && err.result.error.message) {
        errorMessage += `: ${err.result.error.message}`;
    } else if (err && err.message) {
        errorMessage += `: ${err.message}`;
    } else if (typeof err === 'string') {
        errorMessage += `: ${err}`;
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
            closeDifferencesModal();
            destroyAllCharts();
            if (DOMElements.chartCard) DOMElements.chartCard.classList.add('hidden');
        });
    }
}

function updateSigninStatus(isSignedIn) {
    if (isSignedIn) {
        DOMElements.authorizeButton.classList.add('hidden');
        DOMElements.signoutButton.classList.remove('hidden');
        DOMElements.appContent.classList.remove('hidden');
        updateStatus('מחובר בהצלחה!', 'success');
        fetchData();
    } else {
        DOMElements.authorizeButton.classList.remove('hidden');
        DOMElements.signoutButton.classList.add('hidden');
        DOMElements.appContent.classList.add('hidden');
        updateStatus('יש להתחבר עם חשבון Google', 'info');
    }
}


// --- Application Logic Functions ---

async function runAnalysisPipeline(imageDataBase64, context, employeeName, month, year) {
    if (!imageDataBase64) {
        displayAPIError(null, "שגיאה: נתוני התמונה ריקים.");
        setProcessingStatus(false);
        return;
    }
    
    updateStatus('שולח תמונה לניתוח AI...', 'loading', true);

    try {
        const extractedShifts = await hilanetParser.callGeminiForShiftExtraction(
            imageDataBase64, month, year, employeeName, context
        );

        let relevantShifts = extractedShifts;
        if (context === 'generic') {
            relevantShifts = extractedShifts.filter(shift => shift.employee === employeeName);
        }
        
        if (!relevantShifts || relevantShifts.length === 0) {
            updateStatus(`לא נמצאו משמרות עבור ${employeeName} בקובץ שהועלה.`, 'info');
            return;
        }

        currentHilanetShifts = hilanetParser.structureShifts(relevantShifts, month, year, employeeName);
        
        updateStatus('משווה סידורים מול Google Sheets...', 'loading', true);
        const googleSheetsShifts = await getAllGoogleSheetsShiftsForMaor();
        currentDifferences = hilanetParser.compareSchedules(googleSheetsShifts, currentHilanetShifts);
        
        displayDifferences(currentDifferences);
        updateStatus('השוואת הסידורים הושלמה!', 'success');

    } catch (error) {
        displayAPIError(error, 'אירעה שגיאה בניתוח הקובץ באמצעות AI.');
    } finally {
        setProcessingStatus(false);
    }
}

async function handleUploadHilanet(event) {
    if (isProcessing) {
        updateStatus('תהליך אחר כבר רץ, אנא המתן.', 'info');
        return;
    }
    const file = event.target.files[0];
    if (!file || file.type !== 'application/pdf') {
        updateStatus('אנא בחר קובץ PDF בלבד.', 'info');
        event.target.value = '';
        return;
    }

    setProcessingStatus(true);
    updateStatus('מעבד קובץ PDF...', 'loading', true);

    const fileReader = new FileReader();
    fileReader.readAsArrayBuffer(file);

    fileReader.onload = async (e) => {
        try {
            const pdfData = new Uint8Array(e.target.result);
            const pdf = await pdfjsLib.getDocument({ data: pdfData }).promise;
            
            const firstPageForText = await pdf.getPage(1);
            const textContent = await firstPageForText.getTextContent();
            const rawText = textContent.items.map(item => item.str).join(' ');
            const { employeeName, detectedMonth, detectedYear } = hilanetParser.processHilanetData(rawText);

            updateStatus('ממיר PDF לתמונה...', 'loading', true);
            const page = await pdf.getPage(1);
            const viewport = page.getViewport({ scale: 2.0 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;

            await page.render({ canvasContext: context, viewport: viewport }).promise;

            const imageDataBase64 = canvas.toDataURL('image/jpeg', 0.9);
            
            await runAnalysisPipeline(imageDataBase64, 'hilanet-report', employeeName, detectedMonth, detectedYear);

        } catch (error) {
            displayAPIError(error, 'אירעה שגיאה בעיבוד קובץ ה-PDF.');
            setProcessingStatus(false);
        } finally {
            event.target.value = ''; 
        }
    };

    fileReader.onerror = (error) => {
        displayAPIError(error, 'שגיאה בקריאת הקובץ.');
        setProcessingStatus(false);
    };
}

async function handleUploadImage(event) {
    if (isProcessing) {
        updateStatus('תהליך אחר כבר רץ, אנא המתן.', 'info');
        return;
    }
    const file = event.target.files[0];
    if (!file || !file.type.startsWith('image/')) {
        updateStatus('אנא בחר קובץ תמונה בלבד.', 'info');
        event.target.value = '';
        return;
    }

    setProcessingStatus(true);
    updateStatus('קורא את קובץ התמונה...', 'loading', true);

    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = () => {
        const imageDataBase64 = reader.result;
        showImageMetadataModal(imageDataBase64);
    };
    reader.onerror = (error) => {
        displayAPIError(error, 'שגיאה בקריאת קובץ התמונה.');
        setProcessingStatus(false);
    };
    event.target.value = '';
}

function showImageMetadataModal(imageDataBase64) {
    const modal = DOMElements.imageMetadataModal;
    const monthSelect = DOMElements.imageMonthSelect;
    const yearSelect = DOMElements.imageYearSelect;
    const confirmBtn = DOMElements.imageMetadataConfirmBtn;
    const cancelBtn = DOMElements.imageMetadataCancelBtn;

    monthSelect.innerHTML = '';
    for (let i = 1; i <= 12; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = i;
        monthSelect.appendChild(option);
    }

    yearSelect.innerHTML = '';
    const currentYear = new Date().getFullYear();
    for (let i = currentYear - 2; i <= currentYear + 1; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = i;
        yearSelect.appendChild(option);
    }

    monthSelect.value = new Date().getMonth() + 1;
    yearSelect.value = currentYear;

    updateStatus('אנא בחר חודש, שנה, ועובד להשוואה.', 'info');
    modal.classList.remove('hidden');
    
    const confirmHandler = async () => {
        modal.classList.add('hidden');
        const employeeToCompare = DOMElements.imageEmployeeSelect.value;
        const month = DOMElements.imageMonthSelect.value;
        const year = DOMElements.imageYearSelect.value;
        
        await runAnalysisPipeline(imageDataBase64, 'generic', employeeToCompare, month, year);
    };

    const cancelHandler = () => {
        modal.classList.add('hidden');
        setProcessingStatus(false);
        updateStatus('העלאת התמונה בוטלה.', 'info');
    };

    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
    DOMElements.imageMetadataConfirmBtn = newConfirmBtn;
    newConfirmBtn.addEventListener('click', confirmHandler);
    
    const newCancelBtn = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
    DOMElements.imageMetadataCancelBtn = newCancelBtn;
    newCancelBtn.addEventListener('click', cancelHandler);
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
    // *** THIS IS THE FIX: Changed maor_shifts to maorShifts ***
    return maorShifts;
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
        customCloseDiffModalBtn: document.getElementById('custom-close-diff-modal-btn'),
        uploadImageBtn: document.getElementById('upload-image-btn'),
        uploadImageInput: document.getElementById('upload-image-input'),
        imageMetadataModal: document.getElementById('image-metadata-modal'),
        imageEmployeeSelect: document.getElementById('image-employee-select'),
        imageMonthSelect: document.getElementById('image-month-select'),
        imageYearSelect: document.getElementById('image-year-select'),
        imageMetadataConfirmBtn: document.getElementById('image-metadata-confirm-btn'),
        imageMetadataCancelBtn: document.getElementById('image-metadata-cancel-btn')
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
    
    // Attach event listeners
    if (DOMElements.uploadHilanetInput) DOMElements.uploadHilanetInput.addEventListener('change', handleUploadHilanet);
    if (DOMElements.uploadImageInput) DOMElements.uploadImageInput.addEventListener('change', handleUploadImage);
    
    // Attach all other event listeners
    if (DOMElements.datePicker) DOMElements.datePicker.addEventListener('change', () => renderSchedule(getWeekId(DOMElements.datePicker.value)));
    if (DOMElements.resetBtn) DOMElements.resetBtn.addEventListener('click', () => { /* Logic from old main.js */ });
    if (DOMElements.emailBtn) DOMElements.emailBtn.addEventListener('click', () => { /* Logic from old main.js */ });
    if (DOMElements.modalSaveBtn) DOMElements.modalSaveBtn.addEventListener('click', handleModalSave);


    const today = new Date().toISOString().split('T')[0];
    DOMElements.datePicker.value = getWeekId(today);

    loadGoogleApiScripts();
}

document.addEventListener('DOMContentLoaded', initializeAppLogic);