import { fetchData, handleCreateCalendarEvents, handleDeleteCalendarEvents, initializeGapiClient, saveFullSchedule } from './Api/googleApi.js';
import { handleShowChart, updateMonthlySummaryChart, destroyAllCharts, handleExportMonthlySummary, handleAnalyzeMonth, populateMonthSelector } from './components/charts.js';
import { displayDifferences, hideDifferencesContainer, closeModal, closeVacationModal, handleModalSave, showEmployeeSelectionModal, showVacationModal, showEmailSelectionModal } from './components/modal.js';
import { handleExportToExcel, renderSchedule, sendFridaySummaryEmail, handleSendEmail } from './components/schedule.js';
import { EMPLOYEES, DAYS, VACATION_EMPLOYEE_REPLACEMENT, CLIENT_ID, SCOPES } from './config.js';
import * as hilanetParser from './services/hilanetParser.js';
// *** MODIFIED: Import new helper functions ***
import { formatDate, getWeekId, getWeekDates, showCustomConfirmation, setButtonLoading, restoreButton } from './utils.js';
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
        'deleteCalendarEventsBtn', 'refreshDataBtn', 'vacationShiftBtn',
        'geminiSuggestionBtn'
    ];
    buttonsToToggle.forEach(btnId => {
        if (DOMElements[btnId]) {
            DOMElements[btnId].disabled = processing;
            DOMElements[btnId].classList.toggle('opacity-50', processing);
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

// --- NEW: Stepper UI Function ---
async function updateStepper(activeStep) {
    return new Promise(resolve => {
        requestAnimationFrame(() => {
            const stepper = document.getElementById('analysis-stepper');
            if (!stepper) {
                resolve();
                return;
            }

            stepper.classList.remove('hidden');

            for (let i = 1; i <= 3; i++) {
                const step = document.getElementById(`step-${i}`);
                if (!step) continue;
                const span = step.querySelector('span:first-child');

                // Reset all styles first
                step.classList.remove('text-blue-600', 'text-green-600');
                span.classList.remove('border-blue-600', 'border-green-600', 'bg-blue-100', 'bg-green-100');
                span.classList.add('border-gray-500');
                if (span.firstChild && span.firstChild.tagName === 'svg') {
                span.innerHTML = i;
                }

                if (i < activeStep) {
                    // --- UPDATED: Completed step is now GREEN ---
                    step.classList.add('text-green-600');
                    span.classList.remove('border-gray-500');
                    span.classList.add('border-green-600', 'bg-green-100');
                    span.innerHTML = `<svg class="w-3.5 h-3.5" aria-hidden="true" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 16 12"><path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M1 5.917 5.724 10.5 15 1.5"/></svg>`;
                } else if (i === activeStep) {
                    // Active step remains BLUE
                    step.classList.add('text-blue-600');
                    span.classList.remove('border-gray-500');
                    span.classList.add('border-blue-600');
                    span.textContent = i;
                } else {
                    // Future step remains GRAY
                    span.textContent = i;
                }
            }
            resolve();
        });
    });
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

async function checkSignInStatus() {
    const token = localStorage.getItem('google_access_token');
    if (token) {
        gapi.client.setToken({ access_token: token });
        updateSigninStatus(true);
        await fetchData();
    } else {
        updateSigninStatus(false);
    }
}

function authorize() {
    if (!tokenClient) return;
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
            gapi.client.setToken(null);
            localStorage.removeItem('google_access_token');
            updateSigninStatus(false);
            DOMElements.scheduleBody.innerHTML = '';
            DOMElements.scheduleTitle.textContent = 'התחבר כדי לראות את הסידור';
            hideDifferencesContainer();
            destroyAllCharts();
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
    showCustomConfirmation('האם לאפס את כל השיבוצים בשבוע הנוכחי?', async () => {
        const weekId = getWeekId(DOMElements.datePicker.value);
        allSchedules[weekId] = {};
        renderSchedule(weekId);
        await saveFullSchedule(allSchedules);
        updateStatus('השבוע אופס בהצלחה', 'success');
    });
}

async function handleCopyPreviousWeek() {
    const currentWeekId = getWeekId(DOMElements.datePicker.value);
    const currentDate = new Date(currentWeekId);
    currentDate.setDate(currentDate.getDate() - 7);
    const previousWeekId = getWeekId(currentDate.toISOString().split('T')[0]);

    if (!allSchedules[previousWeekId] || Object.keys(allSchedules[previousWeekId]).length === 0) {
        updateStatus(`לא נמצא סידור לשבוע הקודם (${formatDate(previousWeekId)}).`, 'info');
        return;
    }

    showCustomConfirmation(`האם להעתיק את הסידור מהשבוע של ${formatDate(previousWeekId)}?`, async () => {
        const button = DOMElements.copyPreviousWeekBtn;
        setButtonLoading(button, 'מעתיק...');
        try {
            allSchedules[currentWeekId] = JSON.parse(JSON.stringify(allSchedules[previousWeekId]));
            renderSchedule(currentWeekId);
            await saveFullSchedule(allSchedules);
            updateStatus('הסידור מהשבוע הקודם הועתק בהצלחה!', 'success');
        } catch (error) {
            displayAPIError(error, 'שגיאה בהעתקת השבוע הקודם.');
        } finally {
            restoreButton(button);
        }
    });
}

async function handleVacationShift() {
    const vacationingEmployee = DOMElements.vacationEmployeeSelect.value;
    const startDateString = DOMElements.vacationStartDateInput.value;
    const endDateString = DOMElements.vacationEndDateInput.value;

    if (!vacationingEmployee || !startDateString || !endDateString) {
        updateStatus('יש לבחור עובד ותאריכי התחלה וסיום.', 'info');
        return;
    }
    closeVacationModal();

    const button = DOMElements.vacationShiftBtn;
    setButtonLoading(button, 'משבץ...');
    try {
        updateStatus(`משבץ את ${VACATION_EMPLOYEE_REPLACEMENT} במקום ${vacationingEmployee}...`, 'loading', true);
        let shiftsUpdatedCount = 0;

        for (let d = new Date(startDateString); d <= new Date(endDateString); d.setDate(d.getDate() + 1)) {
            const weekId = getWeekId(d.toISOString().split('T')[0]);
            const dayName = DAYS[d.getDay()];

            if (!allSchedules[weekId] || !allSchedules[weekId][dayName]) continue;

            ['morning', 'evening'].forEach(shiftType => {
                const shift = allSchedules[weekId][dayName][shiftType];
                if (shift && shift.employee === vacationingEmployee) {
                    shift.employee = VACATION_EMPLOYEE_REPLACEMENT;
                    shiftsUpdatedCount++;
                }
            });
        }

        if (shiftsUpdatedCount > 0) {
            await saveFullSchedule(allSchedules);
            renderSchedule(getWeekId(DOMElements.datePicker.value));
            updateStatus(`שובצו ${shiftsUpdatedCount} משמרות עבור ${VACATION_EMPLOYEE_REPLACEMENT}.`, 'success');
        } else {
            updateStatus(`לא נמצאו משמרות עבור ${vacationingEmployee} בטווח הנבחר.`, 'info');
        }
    } catch (error) {
        displayAPIError(error, 'שגיאה בשיבוץ חופשה.');
    } finally {
        restoreButton(button);
    }
}

async function handleGeminiSuggestShift() {
    const button = DOMElements.geminiSuggestionBtn;
    setButtonLoading(button, 'מציע...');

    try {
        const weekId = getWeekId(DOMElements.datePicker.value);
        const day = DOMElements.shiftModal.dataset.day;
        const shiftType = DOMElements.shiftModal.dataset.shift;

        const currentWeekDate = new Date(weekId);
        currentWeekDate.setDate(currentWeekDate.getDate() - 7);
        const previousWeekId = getWeekId(currentWeekDate.toISOString().split('T')[0]);
        const lastFridayWorker = allSchedules[previousWeekId]?.['שישי']?.morning?.employee || 'אף אחד';

        const availableEmployees = EMPLOYEES.filter(e => e !== VACATION_EMPLOYEE_REPLACEMENT);
        let scheduleContext = "מצב נוכחי בסידור השבוע:\n";
        DAYS.forEach(dayName => {
            if (dayName === 'שבת') return;
            const morningShift = allSchedules[weekId]?.[dayName]?.morning?.employee || 'פנוי';
            const eveningShift = (dayName !== 'שישי' && allSchedules[weekId]?.[dayName]?.evening?.employee) || 'פנוי';
            scheduleContext += `- יום ${dayName}: בוקר - ${morningShift}, ערב - ${eveningShift}\n`;
        });

        const prompt = `
            You are an expert shift scheduler. Your task is to suggest one suitable employee for a specific shift based on a complex set of rules.
            Shift to schedule: Day: ${day}, Shift: ${shiftType}.
            Available employees: ${availableEmployees.join(', ')}.
            Current week's schedule:
            ${scheduleContext}
            Additional info: The employee who worked last Friday morning was ${lastFridayWorker}.

            Strict rules:
            1. No double shifts on the same day.
            2. An employee working Friday morning cannot work Thursday evening before it.
            3. If scheduling for Friday morning, the chosen employee cannot work more than 4 morning shifts and 2 evening shifts in total that week.
            4. If scheduling for Thursday evening, the chosen employee cannot work on Friday at all, and no more than 3 evening shifts and 2 morning shifts that week.
            5. Friday rotation: When scheduling for Friday morning, you must not assign the employee who worked last Friday morning (${lastFridayWorker}).

            Based on all data and rules, who is the most suitable employee? Respond with only the employee's name. If no employee fits all rules, respond with "אף אחד".
        `;

        updateStatus('מבקש הצעת שיבוץ מ-Gemini...', 'loading', true);
        const response = await fetch('/.netlify/functions/suggest-shift', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt })
        });
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to get suggestion');
        }

        const result = await response.json();
        const suggestedEmployee = result.suggestion.trim();
        const suggestedBtn = DOMElements.modalOptions.querySelector(`button[data-employee="${suggestedEmployee}"]`);

        if (suggestedBtn && !suggestedBtn.disabled) {
            suggestedBtn.click();
            updateStatus(`Gemini הציע: ${suggestedEmployee}`, 'success');
        } else {
            updateStatus(`Gemini הציע: ${suggestedEmployee}, אך השיבוץ אינו אפשרי.`, 'info');
        }
    } catch (error) {
        displayAPIError(error, 'שגיאה בקבלת הצעת שיבוץ.');
    } finally {
        restoreButton(button);
    }
}

async function handleUpload(file, isPdf, inputElement) {
    if (isProcessing) return;

    if (!isPdf) {
        showImageMetadataModal(file, inputElement);
        return;
    }

    DOMElements.differencesContainer.classList.remove('hidden');
    DOMElements.differencesContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    DOMElements.differencesDisplay.innerHTML = ''; // Clear previous results
    setProcessingStatus(true);
    await updateStepper(1);
    
    const fileReader = new FileReader();
    fileReader.readAsArrayBuffer(file);

    fileReader.onload = async (e) => {
        try {
            updateStatus('מעבד את קובץ ה-PDF...', 'loading', true);
            const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(e.target.result) }).promise;
            const textContent = await (await pdf.getPage(1)).getTextContent();
            const rawText = textContent.items.map(item => item.str).join(' ');
            const { employeeName, detectedMonth, detectedYear } = hilanetParser.processHilanetData(rawText);

            const imagePromises = [];
            for (let i = 1; i <= pdf.numPages; i++) {
                const page = await pdf.getPage(i);
                const viewport = page.getViewport({ scale: 1.5 });
                const canvas = document.createElement('canvas');
                canvas.height = viewport.height;
                canvas.width = viewport.width;
                await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
                imagePromises.push(canvas.toDataURL('image/jpeg', 0.8));
            }

            await updateStepper(2);
            updateStatus('שולח תמונות לניתוח AI...', 'loading', true);
            const extractionPromises = imagePromises.map(imageData =>
                hilanetParser.callGeminiForShiftExtraction(imageData, detectedMonth, detectedYear, employeeName, 'hilanet-report')
            );

            const allShifts = (await Promise.all(extractionPromises)).flat();
            
            // MODIFIED: Added status update for better UI feedback
            updateStatus('ניתוח AI הושלם!', 'success');
            await updateStepper(3);
            updateStatus('הנתונים התקבלו, מבצע השוואה...', 'loading', true);

            if (allShifts.length === 0) {
                updateStatus('לא נמצאו משמרות לניתוח בקובץ.', 'info');
                hideDifferencesContainer();
                return;
            }

            currentHilanetShifts = hilanetParser.structureShifts(allShifts, detectedMonth, detectedYear, employeeName);
            const googleSheetsShifts = await getAllGoogleSheetsShiftsForEmployee(employeeName);
            currentDifferences = hilanetParser.compareSchedules(googleSheetsShifts, currentHilanetShifts);

            displayDifferences(currentDifferences);
            updateStatus('השוואת הסידורים הושלמה!', 'success');
            await updateStepper(4); // Mark all steps as complete

        } catch (error) {
            displayAPIError(error, 'אירעה שגיאה בעיבוד הקובץ.');
            hideDifferencesContainer();
        } finally {
            setProcessingStatus(false);
            if(inputElement) inputElement.value = '';
        }
    };
    fileReader.onerror = () => {
        setProcessingStatus(false);
        if(inputElement) inputElement.value = '';
        updateStatus('שגיאה בקריאת הקובץ.', 'error');
        hideDifferencesContainer();
    };
}

async function getAllGoogleSheetsShiftsForEmployee(employeeName) {
    const employeeShifts = {};
    if (Object.keys(allSchedules).length === 0) await fetchData();

    for (const weekId in allSchedules) {
        const weekData = allSchedules[weekId];
        const weekDates = getWeekDates(new Date(weekId));
        weekDates.forEach(dateObj => {
            const dateString = dateObj.toISOString().split('T')[0];
            const dayName = DAYS[dateObj.getDay()];
            if (!weekData[dayName]) return;

            ['morning', 'evening'].forEach(shiftType => {
                const shift = weekData[dayName][shiftType];
                if (shift && shift.employee === employeeName) {
                    if (!employeeShifts[dateString]) employeeShifts[dateString] = {};
                    employeeShifts[dateString][shiftType] = { ...shift };
                }
            });
        });
    }
    return employeeShifts;
}

async function handleImportSelectedHilanetShifts() {
    const selectedDiffIds = Array.from(DOMElements.differencesDisplay.querySelectorAll('.difference-checkbox:checked')).map(cb => cb.dataset.diffId);
    if (selectedDiffIds.length === 0) {
        updateStatus('לא נבחרו פערים לייבוא.', 'info');
        return;
    }

    const selectedDifferences = currentDifferences.filter(diff => selectedDiffIds.includes(diff.id));
    const { updatedSchedules, importedCount } = hilanetParser.handleImportSelectedHilanetShifts(selectedDifferences, allSchedules);
    
    if (importedCount > 0) {
        const hourglass = document.getElementById('hourglass-loader');
        
        // Hide table content and show loader overlay
        DOMElements.differencesDisplay.innerHTML = '';
        if (hourglass) hourglass.classList.remove('hidden');
        setProcessingStatus(true);
        
        try {
            allSchedules = updatedSchedules;
            await saveFullSchedule(allSchedules);
            renderSchedule(getWeekId(DOMElements.datePicker.value));
            
            // Re-run comparison to show remaining differences
            const employeeName = selectedDifferences[0]?.hilanet?.employee || selectedDifferences[0]?.googleSheets?.employee;
            if (employeeName) {
                const googleSheetsShifts = await getAllGoogleSheetsShiftsForEmployee(employeeName);
                currentDifferences = hilanetParser.compareSchedules(googleSheetsShifts, currentHilanetShifts);
                // Re-display the updated differences table
                displayDifferences(currentDifferences);
            } else {
                hideDifferencesContainer(); // Fallback if no employee name found
            }

            updateStatus(`יובאו ${importedCount} משמרות בהצלחה.`, 'success');
        } catch(error) {
            displayAPIError(error, 'שגיאה בשמירת המשמרות שיובאו.');
            // Restore the view even on error
            displayDifferences(currentDifferences);
        } finally {
            if (hourglass) hourglass.classList.add('hidden');
            setProcessingStatus(false);
        }
    }
}

function showImageMetadataModal(file, inputElement) {
    const yearSelect = document.getElementById('image-year-select');
    const monthSelect = document.getElementById('image-month-select');

    yearSelect.innerHTML = '';
    monthSelect.innerHTML = '';

    const currentYear = new Date().getFullYear();
    for (let i = currentYear - 2; i <= currentYear + 3; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = i;
        if (i === 2025) option.selected = true;
        else if (i === currentYear && !option.selected) option.selected = true;
        yearSelect.appendChild(option);
    }

    for (let i = 1; i <= 12; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = new Date(2000, i - 1, 1).toLocaleDateString('he-IL', { month: 'long' });
        if (i === 7) option.selected = true;
        monthSelect.appendChild(option);
    }

    DOMElements.imageMetadataModal.classList.remove('hidden');

    const confirmBtn = document.getElementById('image-metadata-confirm-btn');
    const cancelBtn = document.getElementById('image-metadata-cancel-btn');

    const newConfirmBtn = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);

    const newCancelBtn = cancelBtn.cloneNode(true);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

    newConfirmBtn.addEventListener('click', () => {
        const selectedYear = yearSelect.value;
        const selectedMonth = monthSelect.value;
        const selectedEmployee = document.getElementById('image-employee-select').value;
        DOMElements.imageMetadataModal.classList.add('hidden');
        processImageWithMetadata(file, selectedMonth, selectedYear, selectedEmployee, inputElement);
    });

    newCancelBtn.addEventListener('click', () => {
        DOMElements.imageMetadataModal.classList.add('hidden');
        if (inputElement) inputElement.value = '';
    });
}

async function processImageWithMetadata(file, month, year, employeeName, inputElement) {
    DOMElements.differencesContainer.classList.remove('hidden');
    DOMElements.differencesContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
    DOMElements.differencesDisplay.innerHTML = ''; // Clear previous results
    setProcessingStatus(true);
    await updateStepper(1);

    try {
        const fileReader = new FileReader();
        fileReader.readAsArrayBuffer(file);
        fileReader.onload = async (e) => {
             try {
                const imageData = await new Promise((resolve, reject) => {
                    const image = new Image();
                    const objectURL = URL.createObjectURL(file);
                    image.src = objectURL;
                    image.onload = () => {
                        URL.revokeObjectURL(objectURL);
                        const canvas = document.createElement('canvas');
                        canvas.width = image.width;
                        canvas.height = image.height;
                        canvas.getContext('2d').drawImage(image, 0, 0);
                        resolve(canvas.toDataURL('image/jpeg', 0.8));
                    };
                    image.onerror = reject;
                });
    
                await updateStepper(2);
                updateStatus('שולח תמונה לניתוח AI...', 'loading', true);
                const extractedShifts = await hilanetParser.callGeminiForShiftExtraction(imageData, month, year, employeeName, 'generic');
                
                // MODIFIED: Added status update for better UI feedback
                updateStatus('ניתוח AI הושלם!', 'success');
                await updateStepper(3);
                updateStatus('הנתונים התקבלו, מבצע השוואה...', 'loading', true);
    
                if (extractedShifts.length === 0) {
                    updateStatus('לא נמצאו משמרות לניתוח בתמונה.', 'info');
                    hideDifferencesContainer();
                    setProcessingStatus(false);
                    return;
                }
    
                currentHilanetShifts = hilanetParser.structureShifts(extractedShifts, month, year, employeeName);
                const googleSheetsShifts = await getAllGoogleSheetsShiftsForEmployee(employeeName);
                currentDifferences = hilanetParser.compareSchedules(googleSheetsShifts, currentHilanetShifts);
    
                displayDifferences(currentDifferences);
                updateStatus('השוואת הסידורים הושלמה!', 'success');
                await updateStepper(4); // Mark all steps as complete
            } catch (error) {
                displayAPIError(error, 'אירעה שגיאה בעיבוד התמונה.');
                hideDifferencesContainer();
            } finally {
                setProcessingStatus(false);
                if (inputElement) inputElement.value = '';
            }
        };
        fileReader.onerror = () => {
             updateStatus('שגיאה בקריאת קובץ התמונה.', 'error');
             hideDifferencesContainer();
             setProcessingStatus(false);
             if (inputElement) inputElement.value = '';
        };
    } catch (error) {
        displayAPIError(error, 'אירעה שגיאה בהכנת התמונה.');
        hideDifferencesContainer();
        setProcessingStatus(false);
    }
}


// --- Initialization ---
function initializeAppLogic() {
    DOMElements = {
        datePicker: document.getElementById('date-picker'),
        scheduleBody: document.getElementById('schedule-body'),
        scheduleCard: document.getElementById('schedule-card'),
        scheduleTitle: document.getElementById('schedule-title'),
        scheduleTable: document.getElementById('schedule-table'),
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
        copyPreviousWeekBtn: document.getElementById('copy-previous-week-btn'),
        createCalendarEventsBtn: document.getElementById('create-calendar-events-btn'),
        deleteCalendarEventsBtn: document.getElementById('delete-calendar-events-btn'),
        refreshDataBtn: document.getElementById('refresh-data-btn'),
        vacationShiftBtn: document.getElementById('vacation-shift-btn'),
        vacationModal: document.getElementById('vacation-modal'),
        vacationEmployeeSelect: document.getElementById('vacation-employee-select'),
        vacationStartDateInput: document.getElementById('vacation-start-date'),
        vacationEndDateInput: document.getElementById('vacation-end-date'),
        vacationConfirmBtn: document.getElementById('vacation-confirm-btn'),
        vacationCancelBtn: document.getElementById('vacation-cancel-btn'),
        uploadHilanetInput: document.getElementById('upload-hilanet-input'),
        uploadHilanetBtn: document.getElementById('upload-hilanet-btn'),
        uploadImageInput: document.getElementById('upload-image-input'),
        uploadImageBtn: document.getElementById('upload-image-btn'),
        differencesContainer: document.getElementById('differences-container'),
        differencesDisplay: document.getElementById('differences-display'),
        closeDifferencesBtn: document.getElementById('close-differences-btn'),
        importSelectedHilanetShiftsBtn: document.getElementById('import-selected-hilanet-shifts-btn'),
        geminiSuggestionBtn: document.getElementById('gemini-suggestion-btn'),
        showChartBtn: document.getElementById('show-chart-btn'),
        chartCard: document.getElementById('chart-card'),
        monthlySummaryChartCard: document.getElementById('monthly-summary-chart-card'),
        monthlySummaryEmployeeSelect: document.getElementById('monthly-summary-employee-select'),
        monthlySummaryMonthSelect: document.getElementById('monthly-summary-month-select'),
        monthSelectorContainer: document.getElementById('month-selector-container'),
        monthlyAnalysisContainer: document.getElementById('monthly-analysis-container'),
        monthlyAnalysisContent: document.getElementById('monthly-analysis-content'),
        exportMonthlySummaryBtn: document.getElementById('export-monthly-summary-btn'),
        analyzeMonthlySummaryBtn: document.getElementById('analyze-monthly-summary-btn'),
        imageMetadataModal: document.getElementById('image-metadata-modal'),
        employeeSelectionModal: document.getElementById('employee-selection-modal'),
        employeeSelectionModalTitle: document.getElementById('employee-selection-modal-title'),
        sendFridaySummaryBtn: document.getElementById('send-friday-summary-btn'),
        fridaySummaryModal: document.getElementById('friday-summary-modal'),
        summaryStartDateInput: document.getElementById('summary-start-date'),
        summaryEndDateInput: document.getElementById('summary-end-date'),
        summaryConfirmBtn: document.getElementById('summary-confirm-btn'),
        summaryCancelBtn: document.getElementById('summary-cancel-btn'),
        // NEW: Email modal elements
        emailSelectionModal: document.getElementById('email-selection-modal'),
        emailOptionsContainer: document.getElementById('email-options-container'),
        otherEmailContainer: document.getElementById('other-email-container'),
        otherEmailInput: document.getElementById('other-email-input'),
        emailSelectionConfirmBtn: document.getElementById('email-selection-confirm-btn'),
        emailSelectionCancelBtn: document.getElementById('email-selection-cancel-btn'),
    };

    function handleDownloadDifferences() {
        if (currentDifferences.length === 0) {
            updateStatus('אין פערים להורדה.', 'info');
            return;
        }
        let csvContent = "data:text/csv;charset=utf-8,\uFEFF"; // BOM for Hebrew
        csvContent += "Type,Date,Day,Shift,Current Schedule,Hilanet Schedule\n";
        currentDifferences.forEach(diff => {
            const formatDetails = (shift) => shift ? `"${shift.employee} (${shift.start.substring(0, 5)}-${shift.end.substring(0, 5)})"` : '""';
            const row = [diff.type, diff.date, diff.dayName, diff.shiftType, formatDetails(diff.googleSheets), formatDetails(diff.hilanet)].join(",");
            csvContent += row + "\n";
        });
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", "schedule_differences.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        updateStatus('מסמך הפערים יוצא בהצלחה.', 'success');
    }

    function loadGoogleApiScripts() {
        const gapiScript = document.createElement('script');
        gapiScript.src = 'https://apis.google.com/js/api.js';
        gapiScript.onload = gapiLoaded;
        document.head.appendChild(gapiScript);
        const gisScript = document.createElement('script');
        gisScript.src = 'https://accounts.google.com/gsi/client';
        gisScript.onload = gisLoaded;
        document.head.appendChild(gisScript);
    }

    // --- Attach all event listeners ---
    DOMElements.datePicker.addEventListener('change', () => renderSchedule(getWeekId(DOMElements.datePicker.value)));
    DOMElements.resetBtn.addEventListener('click', handleReset);
    DOMElements.emailBtn.addEventListener('click', showEmailSelectionModal);
    DOMElements.downloadBtn.addEventListener('click', handleExportToExcel);
    DOMElements.copyPreviousWeekBtn.addEventListener('click', handleCopyPreviousWeek);
    DOMElements.refreshDataBtn.addEventListener('click', fetchData);
    DOMElements.modalSaveBtn.addEventListener('click', handleModalSave);
    DOMElements.modalCloseBtn.addEventListener('click', closeModal);
    DOMElements.vacationShiftBtn.addEventListener('click', showVacationModal);
    DOMElements.vacationConfirmBtn.addEventListener('click', handleVacationShift);
    DOMElements.vacationCancelBtn.addEventListener('click', closeVacationModal);
    DOMElements.showChartBtn.addEventListener('click', handleShowChart);
    DOMElements.geminiSuggestionBtn.addEventListener('click', handleGeminiSuggestShift);
    DOMElements.createCalendarEventsBtn.addEventListener('click', () => showEmployeeSelectionModal(handleCreateCalendarEvents, 'בחר עובדים ליצירת אירועי יומן'));
    DOMElements.deleteCalendarEventsBtn.addEventListener('click', () => showEmployeeSelectionModal(handleDeleteCalendarEvents, 'בחר עובדים למחיקת אירועי יומן'));
    DOMElements.uploadHilanetBtn.addEventListener('click', () => DOMElements.uploadHilanetInput.click());
    DOMElements.uploadHilanetInput.addEventListener('change', (e) => handleUpload(e.target.files[0], true, e.target));
    DOMElements.uploadImageBtn.addEventListener('click', () => DOMElements.uploadImageInput.click());
    DOMElements.uploadImageInput.addEventListener('change', (e) => handleUpload(e.target.files[0], false, e.target));
    DOMElements.closeDifferencesBtn.addEventListener('click', hideDifferencesContainer);
    DOMElements.importSelectedHilanetShiftsBtn.addEventListener('click', handleImportSelectedHilanetShifts);
    DOMElements.sendFridaySummaryBtn.addEventListener('click', showFridaySummaryModal);
    DOMElements.summaryConfirmBtn.addEventListener('click', handleSendFridaySummary);
    DOMElements.summaryCancelBtn.addEventListener('click', closeFridaySummaryModal);
    document.getElementById('download-differences-btn').addEventListener('click', handleDownloadDifferences);

    // --- Populate dropdowns ---
    EMPLOYEES.forEach(emp => {
        if (emp === VACATION_EMPLOYEE_REPLACEMENT) return;
        const option = document.createElement('option');
        option.value = emp;
        option.textContent = emp;
        if (DOMElements.monthlySummaryEmployeeSelect) DOMElements.monthlySummaryEmployeeSelect.appendChild(option.cloneNode(true));
        if (DOMElements.vacationEmployeeSelect) DOMElements.vacationEmployeeSelect.appendChild(option.cloneNode(true));
    });

    // Corrected event listener for employee dropdown to trigger chart and event listener updates
    if (DOMElements.monthlySummaryEmployeeSelect) {
        DOMElements.monthlySummaryEmployeeSelect.addEventListener('change', () => {
            populateMonthSelector();
            updateMonthlySummaryChart();
            setupMonthlyChartEventListeners();
        });
    }

    // --- Initial setup ---
    const today = new Date().toISOString().split('T')[0];
    DOMElements.datePicker.value = getWeekId(today);
    loadGoogleApiScripts();
}

function showFridaySummaryModal() {
    if (gapi.client.getToken() === null) {
        updateStatus('יש להתחבר עם חשבון Google.', 'info');
        return;
    }
    const today = new Date();
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).toISOString().split('T')[0];
    const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0).toISOString().split('T')[0];

    DOMElements.summaryStartDateInput.value = firstDay;
    DOMElements.summaryEndDateInput.value = lastDay;
    DOMElements.fridaySummaryModal.classList.remove('hidden');
}

function closeFridaySummaryModal() {
    DOMElements.fridaySummaryModal.classList.add('hidden');
}

async function handleSendFridaySummary() {
    const startDate = DOMElements.summaryStartDateInput.value;
    const endDate = DOMElements.summaryEndDateInput.value;

    if (!startDate || !endDate) {
        updateStatus('יש לבחור תאריכי התחלה וסיום.', 'info');
        return;
    }

    closeFridaySummaryModal();
    
    const button = DOMElements.sendFridaySummaryBtn;
    setButtonLoading(button, 'שולח...');
    try {
        await sendFridaySummaryEmail(startDate, endDate);
    } catch (error) {
        displayAPIError(error, 'שגיאה בשליחת סיכום ימי שישי.');
    } finally {
        restoreButton(button);
    }
}

export function setupMonthlyChartEventListeners() {
    const monthSelect = DOMElements.monthlySummaryMonthSelect;
    if (monthSelect) {
        const newMonthSelect = monthSelect.cloneNode(true);
        monthSelect.parentNode.replaceChild(newMonthSelect, monthSelect);
        DOMElements.monthlySummaryMonthSelect = newMonthSelect;
        DOMElements.monthlySummaryMonthSelect.addEventListener('change', updateMonthlySummaryChart);
    }

    const exportBtn = DOMElements.exportMonthlySummaryBtn;
    if (exportBtn) {
        const newExportBtn = exportBtn.cloneNode(true);
        exportBtn.parentNode.replaceChild(newExportBtn, exportBtn);
        DOMElements.exportMonthlySummaryBtn = newExportBtn;
        DOMElements.exportMonthlySummaryBtn.addEventListener('click', handleExportMonthlySummary);
    }

    const analyzeBtn = DOMElements.analyzeMonthlySummaryBtn;
    if (analyzeBtn) {
        const newAnalyzeBtn = analyzeBtn.cloneNode(true);
        analyzeBtn.parentNode.replaceChild(newAnalyzeBtn, analyzeBtn);
        DOMElements.analyzeMonthlySummaryBtn = newAnalyzeBtn;
        DOMElements.analyzeMonthlySummaryBtn.addEventListener('click', handleAnalyzeMonth);
    }
}

document.addEventListener('DOMContentLoaded', initializeAppLogic);