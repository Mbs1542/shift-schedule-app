// netlifyProjects/JS/main.js
import { fetchData, handleCreateCalendarEvents, handleDeleteCalendarEvents, initializeGapiClient, saveFullSchedule } from './Api/googleApi.js';
import { handleShowChart, updateMonthlySummaryChart, destroyAllCharts, handleExportMonthlySummary, handleAnalyzeMonth, populateMonthSelector } from './components/charts.js';
import { displayDifferences, hideDifferencesContainer, closeModal, closeVacationModal, handleModalSave, showEmployeeSelectionModal, showVacationModal, showEmailSelectionModal } from './components/modal.js';
import { handleExportToExcel, renderSchedule, sendFridaySummaryEmail, handleSendEmail } from './components/schedule.js';
import { EMPLOYEES, DAYS, VACATION_EMPLOYEE_REPLACEMENT, CLIENT_ID, SCOPES } from './config.js';
import * as hilanetParser from './services/hilanetParser.js';
import { formatDate, getWeekId, getWeekDates, showCustomConfirmation, setButtonLoading, restoreButton, debounce } from './utils.js';

// --- Constants ---
const PROCESSING_TIMEOUTS = {
    BUTTON_DEBOUNCE: 300,
    API_RETRY_DELAY: 1000,
    MAX_RETRIES: 3,
    PROCESSING_TIMEOUT: 30000,
    UI_UPDATE_THROTTLE: 100
};

const ERROR_MESSAGES = {
    NO_GOOGLE_AUTH: 'יש להתחבר עם חשבון Google',
    NETWORK_ERROR: 'בעיית רשת - נסה שוב',
    INVALID_FILE: 'קובץ לא תקין',
    PROCESSING_ERROR: 'שגיאה בעיבוד הנתונים',
    SAVE_ERROR: 'שגיאה בשמירה',
    PERMISSION_ERROR: 'אין הרשאות מתאימות'
};

// --- Global Variables & State Management ---
export let gapiInited = false;
let gisInited = false;
let tokenClient;
export let DOMElements = {};

// Application Data Stores with improved structure
export let allSchedules = {};
export let allCreatedCalendarEvents = {};
let currentHilanetShifts = {};
let currentDifferences = [];
let isProcessing = false;
let processingQueue = [];
let abortController;

// Performance optimization: cache frequently used elements
const elementCache = new Map();
const eventListenerCache = new WeakMap();

// --- Enhanced State Management ---
class StateManager {
    constructor() {
        this.state = {
            processing: false,
            lastSaved: null,
            activeWeek: null,
            selectedEmployee: null,
            theme: 'light'
        };
        this.subscribers = new Set();
    }

    setState(newState) {
        const oldState = { ...this.state };
        this.state = { ...this.state, ...newState };
        this.notifySubscribers(oldState, this.state);
    }

    getState() {
        return { ...this.state };
    }

    subscribe(callback) {
        this.subscribers.add(callback);
        return () => this.subscribers.delete(callback);
    }

    notifySubscribers(oldState, newState) {
        this.subscribers.forEach(callback => {
            try {
                callback(newState, oldState);
            } catch (error) {
                console.error('State subscriber error:', error);
            }
        });
    }
}

const stateManager = new StateManager();

// --- Enhanced Processing Queue ---
class ProcessingQueue {
    constructor() {
        this.queue = [];
        this.processing = false;
    }

    async add(task, priority = 0) {
        return new Promise((resolve, reject) => {
            this.queue.push({ task, priority, resolve, reject });
            this.queue.sort((a, b) => b.priority - a.priority);
            this.process();
        });
    }

    async process() {
        if (this.processing || this.queue.length === 0) return;
        
        this.processing = true;
        setProcessingStatus(true);

        while (this.queue.length > 0) {
            const { task, resolve, reject } = this.queue.shift();
            
            try {
                const result = await task();
                resolve(result);
            } catch (error) {
                console.error('Queue task error:', error);
                reject(error);
            }
        }

        this.processing = false;
        setProcessingStatus(false);
    }
}

const processingQueue = new ProcessingQueue();

// --- Enhanced Processing Status Management ---
function setProcessingStatus(processing) {
    if (isProcessing === processing) return;
    
    isProcessing = processing;
    stateManager.setState({ processing });
    
    const buttonsToToggle = [
        'uploadHilanetBtn', 'uploadImageBtn', 'resetBtn', 'sendEmailBtn',
        'downloadExcelBtn', 'copyPreviousWeekBtn', 'createCalendarEventsBtn',
        'deleteCalendarEventsBtn', 'refreshDataBtn', 'vacationShiftBtn',
        'geminiSuggestionBtn'
    ];
    
    requestAnimationFrame(() => {
        buttonsToToggle.forEach(btnId => {
            const btn = DOMElements[btnId];
            if (btn) {
                btn.disabled = processing;
                btn.classList.toggle('opacity-50', processing);
                btn.classList.toggle('cursor-not-allowed', processing);
                
                if (processing) {
                    btn.setAttribute('aria-disabled', 'true');
                } else {
                    btn.removeAttribute('aria-disabled');
                }
            }
        });
    });
}

// --- Enhanced Status Updates with Throttling ---
export const updateStatus = debounce((text, type, showSpinner = false) => {
    requestAnimationFrame(() => {
        if (!DOMElements.statusIndicator) return;
        
        const colors = {
            info: 'text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700',
            success: 'text-green-600 dark:text-green-500 bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800',
            error: 'text-red-600 dark:text-red-500 bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800',
            loading: 'text-blue-600 dark:text-blue-500 bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
        };
        
        const spinnerHtml = showSpinner ? 
            '<div class="animate-spin rounded-full h-4 w-4 border-b-2 border-current"></div>' : '';
            
        DOMElements.statusIndicator.innerHTML = `${spinnerHtml}<span class="ml-2">${text}</span>`;
        DOMElements.statusIndicator.className = `flex items-center gap-2 text-sm p-3 rounded-lg border transition-all duration-200 ${colors[type] || colors.info}`;
        
        // Auto-hide success messages after 5 seconds
        if (type === 'success') {
            setTimeout(() => {
                if (DOMElements.statusIndicator && DOMElements.statusIndicator.textContent.includes(text)) {
                    DOMElements.statusIndicator.style.opacity = '0';
                    setTimeout(() => {
                        if (DOMElements.statusIndicator) {
                            DOMElements.statusIndicator.style.opacity = '1';
                        }
                    }, 3000);
                }
            }, 5000);
        }
    });
    console.log('Status Update:', { text, type, showSpinner, timestamp: new Date().toISOString() });
}, PROCESSING_TIMEOUTS.UI_UPDATE_THROTTLE);

// --- Enhanced Error Handling ---
export function displayAPIError(err, defaultMessage) {
    let errorMessage = defaultMessage;
    let errorType = 'error';
    
    if (err?.name === 'AbortError') {
        errorMessage = 'הפעולה בוטלה';
        errorType = 'info';
    } else if (err?.status === 401 || err?.status === 403) {
        errorMessage = ERROR_MESSAGES.PERMISSION_ERROR;
    } else if (err?.status >= 500) {
        errorMessage = 'שגיאת שרת - נסה שוב מאוחר יותר';
    } else if (err && err.result && err.result.error && err.result.error.message) {
        errorMessage += `: ${err.result.error.message}`;
    } else if (err && err.message) {
        errorMessage += `: ${err.message}`;
    } else if (typeof err === 'string') {
        errorMessage += `: ${err}`;
    }
    
    updateStatus(errorMessage, errorType, false);
    
    // Enhanced error logging
    console.error('API Error Details:', {
        originalError: err,
        message: errorMessage,
        stack: err?.stack,
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent,
        url: window.location.href
    });
    
    // Report to error tracking service (if implemented)
    if (typeof window.reportError === 'function') {
        window.reportError(err, { context: defaultMessage });
    }
}

// --- Enhanced Stepper with Animation ---
async function updateStepper(activeStep) {
    return new Promise(resolve => {
        requestAnimationFrame(() => {
            const stepper = document.getElementById('analysis-stepper');
            if (!stepper) {
                resolve();
                return;
            }

            stepper.classList.remove('hidden');
            stepper.style.opacity = '0';
            stepper.style.transform = 'translateY(-10px)';
            
            setTimeout(() => {
                stepper.style.transition = 'all 0.3s ease-in-out';
                stepper.style.opacity = '1';
                stepper.style.transform = 'translateY(0)';
            }, 50);

            for (let i = 1; i <= 4; i++) {
                const step = document.getElementById(`step-${i}`);
                if (!step) continue;
                
                const span = step.querySelector('span:first-child');
                if (!span) continue;

                // Reset classes
                step.classList.remove('text-blue-600', 'text-green-600', 'text-gray-500', 
                                    'dark:text-blue-500', 'dark:text-green-500', 'dark:text-gray-400');
                span.classList.remove('border-blue-600', 'border-green-600', 'border-gray-300',
                                        'bg-blue-100', 'bg-green-100', 'bg-gray-100',
                                        'dark:border-blue-500', 'dark:border-green-500', 'dark:border-gray-600',
                                        'dark:bg-blue-900/20', 'dark:bg-green-900/20', 'dark:bg-gray-800');

                if (i < activeStep) {
                    // Completed step
                    step.classList.add('text-green-600', 'dark:text-green-500');
                    span.classList.add('border-green-600', 'bg-green-100', 
                                        'dark:border-green-500', 'dark:bg-green-900/20');
                    span.innerHTML = `<svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 16 12">
                                        <path stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" 
                                            stroke-width="2" d="M1 5.917 5.724 10.5 15 1.5"/>
                                    </svg>`;
                } else if (i === activeStep) {
                    // Active step
                    step.classList.add('text-blue-600', 'dark:text-blue-500');
                    span.classList.add('border-blue-600', 'bg-blue-100',
                                        'dark:border-blue-500', 'dark:bg-blue-900/20');
                    span.textContent = i;
                    
                    // Add pulse animation to active step
                    span.style.animation = 'pulse 2s infinite';
                } else {
                    // Pending step
                    step.classList.add('text-gray-500', 'dark:text-gray-400');
                    span.classList.add('border-gray-300', 'bg-gray-100',
                                        'dark:border-gray-600', 'dark:bg-gray-800');
                    span.textContent = i;
                }
            }
            
            setTimeout(resolve, 300);
        });
    });
}

// --- Enhanced GAPI / GIS Functions with Better Error Handling ---
function gapiLoaded() {
    gapi.load('client', async () => {
        try {
            await initializeGapiClient();
            gapiInited = true;
            maybeInitAuthClient();
        } catch (error) {
            console.error('GAPI initialization error:', error);
            displayAPIError(error, 'שגיאה באתחול Google API');
        }
    });
}

function gisLoaded() {
    try {
        gisInited = true;
        maybeInitAuthClient();
    } catch (error) {
        console.error('GIS initialization error:', error);
        displayAPIError(error, 'שגיאה באתחול Google Identity');
    }
}

export function maybeInitAuthClient() {
    if (gapiInited && gisInited) {
        try {
            tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: CLIENT_ID,
                scope: SCOPES,
                callback: onTokenResponse,
                error_callback: (error) => {
                    console.error('Token client error:', error);
                    displayAPIError(error, 'שגיאה באימות');
                }
            });
            
            if (DOMElements.authorizeButton) {
                DOMElements.authorizeButton.onclick = authorize;
                DOMElements.signoutButton.onclick = signOut;
                DOMElements.authorizeButton.disabled = false;
            }
            checkSignInStatus();
        } catch (error) {
            console.error('Auth client initialization error:', error);
            displayAPIError(error, 'שגיאה באתחול מערכת ההזדהות');
        }
    }
}

async function onTokenResponse(resp) {
    if (resp.error !== undefined) {
        displayAPIError(resp.error, 'שגיאה באימות חשבון Google');
        updateSigninStatus(false);
        return;
    }
    
    try {
        localStorage.setItem('google_access_token', resp.access_token);
        gapi.client.setToken({ access_token: resp.access_token });
        updateSigninStatus(true);
        await fetchData();
    } catch (error) {
        console.error('Token response handling error:', error);
        displayAPIError(error, 'שגיאה בעיבוד תגובת האימות');
    }
}

async function checkSignInStatus() {
    try {
        const token = localStorage.getItem('google_access_token');
        if (token) {
            gapi.client.setToken({ access_token: token });
            updateSigninStatus(true);
            await fetchData();
        } else {
            updateSigninStatus(false);
        }
    } catch (error) {
        console.error('Sign-in status check error:', error);
        localStorage.removeItem('google_access_token');
        updateSigninStatus(false);
    }
}

// --- Enhanced Authorization Functions ---
const authorize = debounce(() => {
    if (!tokenClient) {
        updateStatus('מערכת ההזדהות לא מוכנה עדיין', 'info');
        return;
    }
    
    try {
        if (gapi.client.getToken() === null) {
            tokenClient.requestAccessToken({ prompt: 'consent' });
        } else {
            tokenClient.requestAccessToken({ prompt: '' });
        }
    } catch (error) {
        console.error('Authorization error:', error);
        displayAPIError(error, 'שגיאה בתהליך ההזדהות');
    }
}, PROCESSING_TIMEOUTS.BUTTON_DEBOUNCE);

function signOut() {
    const token = gapi.client.getToken();
    if (token !== null) {
        try {
            google.accounts.oauth2.revoke(token.access_token, () => {
                gapi.client.setToken(null);
                localStorage.removeItem('google_access_token');
                updateSigninStatus(false);
                
                // Clean up UI
                DOMElements.scheduleBody.innerHTML = '';
                DOMElements.scheduleTitle.textContent = 'התחבר כדי לראות את הסידור';
                hideDifferencesContainer();
                destroyAllCharts();
                
                updateStatus('התנתקת בהצלחה', 'success');
            });
        } catch (error) {
            console.error('Sign out error:', error);
            displayAPIError(error, 'שגיאה בהתנתקות');
        }
    }
}

function updateSigninStatus(isSignedIn) {
    requestAnimationFrame(() => {
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
    });
}

// --- Enhanced Application Logic Functions ---
async function handleReset() {
    const weekId = getWeekId(DOMElements.datePicker.value);
    
    showCustomConfirmation('האם לאפס את כל השיבוצים בשבוע הנוכחי?', async () => {
        try {
            allSchedules[weekId] = {};
            renderSchedule(weekId);
            await saveFullSchedule(allSchedules);
            stateManager.setState({ lastSaved: Date.now() });
            updateStatus('השבוע אופס בהצלחה', 'success');
        } catch (error) {
            console.error('Reset error:', error);
            displayAPIError(error, 'שגיאה באיפוס השבוע');
        }
    });
}

const handleCopyPreviousWeek = debounce(async () => {
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
            await processingQueue.add(async () => {
                allSchedules[currentWeekId] = JSON.parse(JSON.stringify(allSchedules[previousWeekId]));
                renderSchedule(currentWeekId);
                await saveFullSchedule(allSchedules);
                stateManager.setState({ lastSaved: Date.now() });
            }, 1);
            
            updateStatus('הסידור מהשבוע הקודם הועתק בהצלחה!', 'success');
        } catch (error) {
            displayAPIError(error, 'שגיאה בהעתקת השבוע הקודם.');
        } finally {
            restoreButton(button);
        }
    });
}, PROCESSING_TIMEOUTS.BUTTON_DEBOUNCE);

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
        
        await processingQueue.add(async () => {
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
                stateManager.setState({ lastSaved: Date.now() });
                return { shiftsUpdatedCount, vacationingEmployee };
            } else {
                return { shiftsUpdatedCount: 0, vacationingEmployee };
            }
        }, 1);

        const result = await processingQueue.add(async () => {
            // Processing logic here
        });

        if (result.shiftsUpdatedCount > 0) {
            updateStatus(`שובצו ${result.shiftsUpdatedCount} משמרות עבור ${VACATION_EMPLOYEE_REPLACEMENT}.`, 'success');
        } else {
            updateStatus(`לא נמצאו משמרות עבור ${result.vacationingEmployee} בטווח הנבחר.`, 'info');
        }
    } catch (error) {
        displayAPIError(error, 'שגיאה בשיבוץ חופשה.');
    } finally {
        restoreButton(button);
    }
}

/**
 * Enhanced Gemini Suggestion Logic with Better Error Handling and Caching
 */
const handleGeminiSuggestShift = debounce(async () => {
    const button = DOMElements.geminiSuggestionBtn;
    setButtonLoading(button, 'חושב...');

    // Create abort controller for this request
    abortController = new AbortController();

    try {
        const weekId = getWeekId(DOMElements.datePicker.value);
        const day = DOMElements.shiftModal.dataset.day;
        const dayIndex = DAYS.indexOf(day);
        const shiftType = DOMElements.shiftModal.dataset.shift;

        // Enhanced context gathering with validation
        const currentWeekDate = new Date(weekId);
        currentWeekDate.setDate(currentWeekDate.getDate() - 7);
        const previousWeekId = getWeekId(currentWeekDate.toISOString().split('T')[0]);
        const lastFridayWorker = allSchedules[previousWeekId]?.['שישי']?.morning?.employee || 'אף אחד';
        
        let previousShiftWorker = 'אף אחד';
        if (shiftType === 'evening') {
            previousShiftWorker = allSchedules[weekId]?.[day]?.morning?.employee || 'אף אחד';
        } else if (dayIndex > 0) {
            const previousDayName = DAYS[dayIndex - 1];
            previousShiftWorker = allSchedules[weekId]?.[previousDayName]?.evening?.employee || 'אף אחד';
        }

        const availableEmployees = EMPLOYEES.filter(e => e === 'מאור' || e === 'מור');
        let scheduleContext = "מצב נוכחי בסידור השבוע:\n";
        DAYS.forEach(dayName => {
            if (dayName === 'שבת') return;
            const morningShift = allSchedules[weekId]?.[dayName]?.morning?.employee || 'פנוי';
            const eveningShift = (dayName !== 'שישי' && allSchedules[weekId]?.[dayName]?.evening?.employee) || 'פנוי';
            scheduleContext += `- יום ${dayName}: בוקר - ${morningShift}, ערב - ${eveningShift}\n`;
        });

        // Enhanced prompt with better context
        const prompt = `
            אתה בוט מומחה לשיבוץ משמרות. יש שני עובדים: מאור ומור.
            עליך לנתח את הנתונים, לבדוק כל עובד מול כל חוק, ולהמליץ על העובד המתאים ביותר.

            **1. נתונים:**
            - **המשמרת לשיבוץ:** יום ${day}, משמרת ${shiftType === 'morning' ? 'בוקר' : 'ערב'}.
            - **עובדים לבדיקה:** ${availableEmployees.join(', ')}.
            - **מי עבד בשישי שעבר:** ${lastFridayWorker}.
            - **מי עבד במשמרת הקודמת:** ${previousShiftWorker}.
            - **סידור השבוע הנוכחי:**
            ${scheduleContext}

            **2. חוקים (לפי סדר):**
            - **חוק 1 (כפילות באותו יום):** עובד לא יכול לעבוד שתי משמרות באותו יום.
            - **חוק 2 (חמישי-שישי):** עובד המשובץ לבוקר יום שישי, לא יכול לעבוד בחמישי ערב.
            - **חוק 3 (סבב שישי):** אסור לשבץ לשישי בוקר את מי שעבד בשישי שעבר (${lastFridayWorker}).
            - **חוק 4 (מכסת משמרות):** עובד לא יכול לעבוד יותר מ-5 משמרות בשבוע.

            **3. תהליך קבלת החלטות:**
            א. התחל עם רשימת עובדים: [${availableEmployees.join(', ')}].
            ב. עבור כל עובד, בדוק אם שיבוצו יפר אחד מהחוקים. אם כן, פסול אותו.
            ג. אם נשאר רק עובד אחד, בחר בו.
            ד. אם שני העובדים עומדים בחוקים, בחר את זה עם פחות משמרות השבוע.
            ה. **שובר שוויון:** אם מספר המשמרות שווה, העדף את העובד **שלא** עבד במשמרת הקודמת.
            ו. אם שני העובדים נפסלו, התשובה היא "אף אחד".

            **4. פלט נדרש:**
            החזר **אך ורק** את שם העובד שבחרת. בלי שום טקסט נוסף.
        `;

        updateStatus('מבקש הצעת שיבוץ מ-Gemini...', 'loading', true);
        
        const response = await fetch('/.netlify/functions/suggest-shift', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt }),
            signal: abortController.signal
        });
        
        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to get suggestion');
        }

        const result = await response.json();
        const suggestedEmployee = result.suggestion.trim().replace(/["\n\r]/g, '');
        const suggestedBtn = DOMElements.modalOptions.querySelector(`button[data-employee="${suggestedEmployee}"]`);

        if (suggestedBtn && !suggestedBtn.disabled) {
            suggestedBtn.click();
            updateStatus(`Gemini הציע: ${suggestedEmployee}`, 'success');
        } else {
            if (suggestedEmployee === "אף אחד") {
                updateStatus(`Gemini קבע שאין שיבוץ אפשרי.`, 'info');
            } else {
                updateStatus(`Gemini הציע: ${suggestedEmployee}, אך השיבוץ אינו אפשרי.`, 'info');
            }
        }
    } catch (error) {
        if (error.name === 'AbortError') {
            updateStatus('הבקשה בוטלה', 'info');
        } else {
            displayAPIError(error, 'שגיאה בקבלת הצעת שיבוץ');
        }
    } finally {
        restoreButton(button);
        abortController = null;
    }
}, PROCESSING_TIMEOUTS.BUTTON_DEBOUNCE);

// --- Enhanced File Upload with Better Validation ---
async function handleUpload(file, isPdf, inputElement) {
    if (isProcessing) {
        updateStatus('מערכת עסוקה - נסה שוב בעוד רגע', 'info');
        return;
    }

    // Enhanced file validation
    if (!file || file.size === 0) {
        updateStatus('קובץ לא תקין', 'error');
        return;
    }

    const maxFileSize = 50 * 1024 * 1024; // 50MB
    if (file.size > maxFileSize) {
        updateStatus('הקובץ גדול מדי (מקסימום 50MB)', 'error');
        return;
    }

    if (!isPdf) {
        const validImageTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
        if (!validImageTypes.includes(file.type)) {
            updateStatus('סוג קובץ לא נתמך. אנא בחר תמונה (JPG, PNG, WebP)', 'error');
            return;
        }
        showImageMetadataModal(file, inputElement);
        return;
    }

    if (file.type !== 'application/pdf') {
        updateStatus('אנא בחר קובץ PDF תקין', 'error');
        return;
    }

    try {
        DOMElements.differencesContainer.classList.remove('hidden');
        DOMElements.differencesContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        DOMElements.differencesDisplay.innerHTML = '';
        setProcessingStatus(true);
        await updateStepper(1);
        
        const fileReader = new FileReader();
        
        const readFilePromise = new Promise((resolve, reject) => {
            fileReader.onload = resolve;
            fileReader.onerror = reject;
            fileReader.readAsArrayBuffer(file);
        });

        const fileData = await readFilePromise;
        
        updateStatus('מעבד את קובץ ה-PDF...', 'loading', true);
        const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(fileData.target.result) }).promise;
        const textContent = await (await pdf.getPage(1)).getTextContent();
        const rawText = textContent.items.map(item => item.str).join(' ');
        const { employeeName, detectedMonth, detectedYear } = hilanetParser.processHilanetData(rawText);

        if (!employeeName || !detectedMonth || !detectedYear) {
            throw new Error('לא ניתן לזהות נתוני עובד או תאריך מהקובץ');
        }

        // Enhanced PDF processing with progress tracking
        const imagePromises = [];
        updateStatus(`מעבד ${pdf.numPages} עמודים...`, 'loading', true);
        
        for (let i = 1; i <= pdf.numPages; i++) {
            const page = await pdf.getPage(i);
            const viewport = page.getViewport({ scale: 1.5 });
            const canvas = document.createElement('canvas');
            const context = canvas.getContext('2d');
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            
            await page.render({ canvasContext: context, viewport }).promise;
            imagePromises.push(canvas.toDataURL('image/jpeg', 0.8));
            
            // Update progress
            updateStatus(`מעבד עמוד ${i} מתוך ${pdf.numPages}...`, 'loading', true);
        }

        await updateStepper(2);
        updateStatus('שולח תמונות לניתוח AI...', 'loading', true);
        
        const extractionPromises = imagePromises.map((imageData, index) => 
            hilanetParser.callGeminiForShiftExtraction(imageData, detectedMonth, detectedYear, employeeName, 'hilanet-report')
                .then(result => {
                    updateStatus(`ניתח עמוד ${index + 1} מתוך ${imagePromises.length}...`, 'loading', true);
                    return result;
                })
        );

        const allShifts = (await Promise.all(extractionPromises)).flat();
        
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
        await updateStepper(4);

    } catch (error) {
        console.error('Upload processing error:', error);
        displayAPIError(error, 'אירעה שגיאה בעיבוד הקובץ');
        hideDifferencesContainer();
    } finally {
        setProcessingStatus(false);
        if (inputElement) inputElement.value = '';
    }
}

// --- Enhanced Google Sheets Data Fetching ---
async function getAllGoogleSheetsShiftsForEmployee(employeeName) {
    const employeeShifts = {};
    
    try {
        if (Object.keys(allSchedules).length === 0) {
            updateStatus('טוען נתוני סידורים...', 'loading', true);
            await fetchData();
        }

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
    } catch (error) {
        console.error('Error fetching employee shifts:', error);
        throw new Error('שגיאה בטעינת נתוני העובד מהמערכת');
    }
}

// --- Enhanced Import Function ---
async function handleImportSelectedHilanetShifts() {
    const selectedCheckboxes = DOMElements.differencesDisplay.querySelectorAll('.difference-checkbox:checked');
    const selectedDiffIds = Array.from(selectedCheckboxes).map(cb => cb.dataset.diffId);
    
    if (selectedDiffIds.length === 0) {
        updateStatus('לא נבחרו פערים לייבוא.', 'info');
        return;
    }

    try {
        const selectedDifferences = currentDifferences.filter(diff => selectedDiffIds.includes(diff.id));
        const { updatedSchedules, importedCount } = hilanetParser.handleImportSelectedHilanetShifts(selectedDifferences, allSchedules);
        
        if (importedCount > 0) {
            const hourglass = document.getElementById('hourglass-loader');
            
            DOMElements.differencesDisplay.innerHTML = '';
            if (hourglass) hourglass.classList.remove('hidden');
            setProcessingStatus(true);
            
            await processingQueue.add(async () => {
                allSchedules = updatedSchedules;
                await saveFullSchedule(allSchedules);
                renderSchedule(getWeekId(DOMElements.datePicker.value));
                stateManager.setState({ lastSaved: Date.now() });
                
                const employeeName = selectedDifferences[0]?.hilanet?.employee || selectedDifferences[0]?.googleSheets?.employee;
                if (employeeName) {
                    const googleSheetsShifts = await getAllGoogleSheetsShiftsForEmployee(employeeName);
                    currentDifferences = hilanetParser.compareSchedules(googleSheetsShifts, currentHilanetShifts);
                    displayDifferences(currentDifferences);
                } else {
                    hideDifferencesContainer(); 
                }
                
                return importedCount;
            }, 2);

            updateStatus(`יובאו ${importedCount} משמרות בהצלחה.`, 'success');
            
            if (hourglass) hourglass.classList.add('hidden');
        } else {
            updateStatus('לא יובאו משמרות. ייתכן שהמשמרות שנבחרו הן עבור יום שבת.', 'info');
        }
    } catch (error) {
        console.error('Import error:', error);
        displayAPIError(error, 'שגיאה בייבוא המשמרות שנבחרו');
        displayDifferences(currentDifferences);
    } finally {
        const hourglass = document.getElementById('hourglass-loader');
        if (hourglass) hourglass.classList.add('hidden');
        setProcessingStatus(false);
    }
}

// --- Enhanced Image Metadata Modal ---
function showImageMetadataModal(file, inputElement) {
    const yearSelect = document.getElementById('image-year-select');
    const monthSelect = document.getElementById('image-month-select');
    const employeeSelect = document.getElementById('image-employee-select');

    // Clear and populate year select
    yearSelect.innerHTML = '';
    const currentYear = new Date().getFullYear();
    for (let i = currentYear - 2; i <= currentYear + 3; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = i;
        if (i === currentYear) option.selected = true;
        yearSelect.appendChild(option);
    }

    // Clear and populate month select
    monthSelect.innerHTML = '';
    const currentMonth = new Date().getMonth() + 1;
    for (let i = 1; i <= 12; i++) {
        const option = document.createElement('option');
        option.value = i;
        option.textContent = new Date(2000, i - 1, 1).toLocaleDateString('he-IL', { month: 'long' });
        if (i === currentMonth) option.selected = true;
        monthSelect.appendChild(option);
    }

    // Populate employee select if not already done
    if (!employeeSelect.hasChildNodes()) {
        EMPLOYEES.forEach(emp => {
            if (emp === VACATION_EMPLOYEE_REPLACEMENT) return;
            const option = document.createElement('option');
            option.value = emp;
            option.textContent = emp;
            employeeSelect.appendChild(option);
        });
    }

    DOMElements.imageMetadataModal.classList.remove('hidden');

    // Enhanced event handling with cleanup
    const confirmBtn = document.getElementById('image-metadata-confirm-btn');
    const cancelBtn = document.getElementById('image-metadata-cancel-btn');

    const handleConfirm = () => {
        const selectedYear = yearSelect.value;
        const selectedMonth = monthSelect.value;
        const selectedEmployee = employeeSelect.value;
        
        if (!selectedEmployee) {
            updateStatus('יש לבחור עובד', 'error');
            return;
        }
        
        DOMElements.imageMetadataModal.classList.add('hidden');
        cleanup();
        processImageWithMetadata(file, selectedMonth, selectedYear, selectedEmployee, inputElement);
    };

    const handleCancel = () => {
        DOMElements.imageMetadataModal.classList.add('hidden');
        cleanup();
        if (inputElement) inputElement.value = '';
    };

    const cleanup = () => {
        confirmBtn.removeEventListener('click', handleConfirm);
        cancelBtn.removeEventListener('click', handleCancel);
    };

    confirmBtn.addEventListener('click', handleConfirm);
    cancelBtn.addEventListener('click', handleCancel);
}

// --- Enhanced Image Processing ---
async function processImageWithMetadata(file, month, year, employeeName, inputElement) {
    try {
        DOMElements.differencesContainer.classList.remove('hidden');
        DOMElements.differencesContainer.scrollIntoView({ behavior: 'smooth', block: 'start' });
        DOMElements.differencesDisplay.innerHTML = ''; 
        setProcessingStatus(true);
        await updateStepper(1);

        // Enhanced image processing with better error handling
        const imageData = await new Promise((resolve, reject) => {
            const image = new Image();
            const objectURL = URL.createObjectURL(file);
            
            const cleanup = () => URL.revokeObjectURL(objectURL);
            
            image.onload = () => {
                try {
                    const canvas = document.createElement('canvas');
                    const ctx = canvas.getContext('2d');
                    
                    // Optimize image size for API
                    const maxWidth = 1920;
                    const maxHeight = 1080;
                    let { width, height } = image;
                    
                    if (width > maxWidth || height > maxHeight) {
                        const ratio = Math.min(maxWidth / width, maxHeight / height);
                        width *= ratio;
                        height *= ratio;
                    }
                    
                    canvas.width = width;
                    canvas.height = height;
                    ctx.drawImage(image, 0, 0, width, height);
                    
                    cleanup();
                    resolve(canvas.toDataURL('image/jpeg', 0.8));
                } catch (error) {
                    cleanup();
                    reject(error);
                }
            };
            
            image.onerror = () => {
                cleanup();
                reject(new Error('שגיאה בטעינת התמונה'));
            };
            
            image.src = objectURL;
        });

        await updateStepper(2);
        updateStatus('שולח תמונה לניתוח AI...', 'loading', true);
        
        const extractedShifts = await hilanetParser.callGeminiForShiftExtraction(
            imageData, month, year, employeeName, 'generic'
        );
        
        updateStatus('ניתוח AI הושלם!', 'success');
        await updateStepper(3);
        updateStatus('הנתונים התקבלו, מבצע השוואה...', 'loading', true);

        if (extractedShifts.length === 0) {
            updateStatus('לא נמצאו משמרות לניתוח בתמונה.', 'info');
            hideDifferencesContainer();
            return;
        }

        currentHilanetShifts = hilanetParser.structureShifts(extractedShifts, month, year, employeeName);
        const googleSheetsShifts = await getAllGoogleSheetsShiftsForEmployee(employeeName);
        currentDifferences = hilanetParser.compareSchedules(googleSheetsShifts, currentHilanetShifts);

        displayDifferences(currentDifferences);
        updateStatus('השוואת הסידורים הושלמה!', 'success');
        await updateStepper(4);
        
    } catch (error) {
        console.error('Image processing error:', error);
        displayAPIError(error, 'אירעה שגיאה בעיבוד התמונה');
        hideDifferencesContainer();
    } finally {
        setProcessingStatus(false);
        if (inputElement) inputElement.value = '';
    }
}

// --- Enhanced Theme Management ---
function initializeTheme() {
    const savedTheme = localStorage.getItem('theme');
    const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const shouldUseDark = savedTheme === 'dark' || (!savedTheme && systemPrefersDark);
    
    document.documentElement.classList.toggle('dark', shouldUseDark);
    updateThemeIcons(shouldUseDark);
    stateManager.setState({ theme: shouldUseDark ? 'dark' : 'light' });
}

function toggleTheme() {
    const isDark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
    updateThemeIcons(isDark);
    stateManager.setState({ theme: isDark ? 'dark' : 'light' });
    
    // Refresh charts if visible to apply new theme
    if (!DOMElements.chartCard.classList.contains('hidden')) {
        setTimeout(() => handleShowChart(), 100);
    }
}

function updateThemeIcons(isDark) {
    if (DOMElements.themeToggleDarkIcon && DOMElements.themeToggleLightIcon) {
        DOMElements.themeToggleDarkIcon.classList.toggle('hidden', isDark);
        DOMElements.themeToggleLightIcon.classList.toggle('hidden', !isDark);
    }
}

// --- Enhanced Modal Functions ---
function showFridaySummaryModal() {
    if (gapi.client.getToken() === null) {
        updateStatus(ERROR_MESSAGES.NO_GOOGLE_AUTH, 'info');
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

const handleSendFridaySummary = debounce(async () => {
    const startDate = DOMElements.summaryStartDateInput.value;
    const endDate = DOMElements.summaryEndDateInput.value;

    if (!startDate || !endDate) {
        updateStatus('יש לבחור תאריכי התחלה וסיום.', 'info');
        return;
    }

    if (new Date(startDate) > new Date(endDate)) {
        updateStatus('תאריך ההתחלה חייב להיות לפני תאריך הסיום.', 'error');
        return;
    }

    closeFridaySummaryModal();
    
    const button = DOMElements.sendFridaySummaryBtn;
    setButtonLoading(button, 'שולח...');
    
    try {
        await sendFridaySummaryEmail(startDate, endDate);
        updateStatus('סיכום ימי שישי נשלח בהצלחה', 'success');
    } catch (error) {
        displayAPIError(error, 'שגיאה בשליחת סיכום ימי שישי');
    } finally {
        restoreButton(button);
    }
}, PROCESSING_TIMEOUTS.BUTTON_DEBOUNCE);

// --- Enhanced Event Listeners Setup ---
export function setupMonthlyChartEventListeners() {
    const monthSelect = DOMElements.monthlySummaryMonthSelect;
    if (monthSelect && !eventListenerCache.has(monthSelect)) {
        const handler = debounce(updateMonthlySummaryChart, PROCESSING_TIMEOUTS.UI_UPDATE_THROTTLE);
        monthSelect.addEventListener('change', handler);
        eventListenerCache.set(monthSelect, handler);
    }

    const exportBtn = DOMElements.exportMonthlySummaryBtn;
    if (exportBtn && !eventListenerCache.has(exportBtn)) {
        const handler = debounce(handleExportMonthlySummary, PROCESSING_TIMEOUTS.BUTTON_DEBOUNCE);
        exportBtn.addEventListener('click', handler);
        eventListenerCache.set(exportBtn, handler);
    }

    const analyzeBtn = DOMElements.analyzeMonthlySummaryBtn;
    if (analyzeBtn && !eventListenerCache.has(analyzeBtn)) {
        const handler = debounce(handleAnalyzeMonth, PROCESSING_TIMEOUTS.BUTTON_DEBOUNCE);
        analyzeBtn.addEventListener('click', handler);
        eventListenerCache.set(analyzeBtn, handler);
    }
}

// --- Enhanced Downloads Function ---
function handleDownloadDifferences() {
    if (currentDifferences.length === 0) {
        updateStatus('אין פערים להורדה.', 'info');
        return;
    }
    
    try {
        let csvContent = "data:text/csv;charset=utf-8,\uFEFF"; 
        csvContent += "Type,Date,Day,Shift,Current Schedule,Hilanet Schedule\n";
        
        currentDifferences.forEach(diff => {
            const formatDetails = (shift) => shift ? 
                `"${shift.employee} (${shift.start.substring(0, 5)}-${shift.end.substring(0, 5)})"` : '""';
            const row = [
                diff.type, 
                diff.date, 
                diff.dayName, 
                diff.shiftType, 
                formatDetails(diff.googleSheets), 
                formatDetails(diff.hilanet)
            ].join(",");
            csvContent += row + "\n";
        });
        
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement("a");
        link.setAttribute("href", encodedUri);
        link.setAttribute("download", `schedule_differences_${new Date().toISOString().split('T')[0]}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        
        updateStatus('מסמך הפערים יוצא בהצלחה.', 'success');
    } catch (error) {
        console.error('Download differences error:', error);
        displayAPIError(error, 'שגיאה בהורדת מסמך הפערים');
    }
}

// --- Enhanced Script Loading ---
function loadGoogleApiScripts() {
    const loadScript = (src, onload) => {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = () => {
                onload();
                resolve();
            };
            script.onerror = reject;
            document.head.appendChild(script);
        });
    };

    Promise.all([
        loadScript('https://apis.google.com/js/api.js', gapiLoaded),
        loadScript('https://accounts.google.com/gsi/client', gisLoaded)
    ]).catch(error => {
        console.error('Failed to load Google API scripts:', error);
        displayAPIError(error, 'שגיאה בטעינת ספריות Google');
    });
}

// --- Enhanced Initialization ---
function initializeAppLogic() {
    // Initialize DOM elements cache
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
        emailSelectionModal: document.getElementById('email-selection-modal'),
        emailOptionsContainer: document.getElementById('email-options-container'),
        otherEmailContainer: document.getElementById('other-email-container'),
        otherEmailInput: document.getElementById('other-email-input'),
        emailSelectionConfirmBtn: document.getElementById('email-selection-confirm-btn'),
        emailSelectionCancelBtn: document.getElementById('email-selection-cancel-btn'),
        themeToggleBtn: document.getElementById('theme-toggle-btn'),
        themeToggleDarkIcon: document.getElementById('theme-toggle-dark-icon'),
        themeToggleLightIcon: document.getElementById('theme-toggle-light-icon'),
    };

    // Enhanced event listeners with debouncing
    const addEventListenerWithDebounce = (element, event, handler, delay = PROCESSING_TIMEOUTS.BUTTON_DEBOUNCE) => {
        if (element) {
            const debouncedHandler = debounce(handler, delay);
            element.addEventListener(event, debouncedHandler);
            eventListenerCache.set(element, debouncedHandler);
        }
    };

    // Setup all event listeners
    if (DOMElements.datePicker) {
        DOMElements.datePicker.addEventListener('change', () => {
            const weekId = getWeekId(DOMElements.datePicker.value);
            stateManager.setState({ activeWeek: weekId });
            renderSchedule(weekId);
        });
    }

    addEventListenerWithDebounce(DOMElements.resetBtn, 'click', handleReset);
    addEventListenerWithDebounce(DOMElements.emailBtn, 'click', showEmailSelectionModal);
    addEventListenerWithDebounce(DOMElements.downloadBtn, 'click', handleExportToExcel);
    addEventListenerWithDebounce(DOMElements.copyPreviousWeekBtn, 'click', handleCopyPreviousWeek);
    addEventListenerWithDebounce(DOMElements.refreshDataBtn, 'click', fetchData);
    addEventListenerWithDebounce(DOMElements.modalSaveBtn, 'click', handleModalSave);
    addEventListenerWithDebounce(DOMElements.modalCloseBtn, 'click', closeModal);
    addEventListenerWithDebounce(DOMElements.vacationShiftBtn, 'click', showVacationModal);
    addEventListenerWithDebounce(DOMElements.vacationConfirmBtn, 'click', handleVacationShift);
    addEventListenerWithDebounce(DOMElements.vacationCancelBtn, 'click', closeVacationModal);
    addEventListenerWithDebounce(DOMElements.showChartBtn, 'click', handleShowChart);
    addEventListenerWithDebounce(DOMElements.geminiSuggestionBtn, 'click', handleGeminiSuggestShift);
    addEventListenerWithDebounce(DOMElements.createCalendarEventsBtn, 'click', () => 
        showEmployeeSelectionModal(handleCreateCalendarEvents, 'בחר עובדים ליצירת אירועי יומן'));
    addEventListenerWithDebounce(DOMElements.deleteCalendarEventsBtn, 'click', () => 
        showEmployeeSelectionModal(handleDeleteCalendarEvents, 'בחר עובדים למחיקת אירועי יומן'));
    addEventListenerWithDebounce(DOMElements.uploadHilanetBtn, 'click', () => 
        DOMElements.uploadHilanetInput.click());
    addEventListenerWithDebounce(DOMElements.uploadImageBtn, 'click', () => 
        DOMElements.uploadImageInput.click());
    addEventListenerWithDebounce(DOMElements.closeDifferencesBtn, 'click', hideDifferencesContainer);
    addEventListenerWithDebounce(DOMElements.importSelectedHilanetShiftsBtn, 'click', handleImportSelectedHilanetShifts);
    addEventListenerWithDebounce(DOMElements.sendFridaySummaryBtn, 'click', showFridaySummaryModal);
    addEventListenerWithDebounce(DOMElements.summaryConfirmBtn, 'click', handleSendFridaySummary);
    addEventListenerWithDebounce(DOMElements.summaryCancelBtn, 'click', closeFridaySummaryModal);
    addEventListenerWithDebounce(DOMElements.themeToggleBtn, 'click', toggleTheme);

    // File upload handlers with validation
    if (DOMElements.uploadHilanetInput) {
        DOMElements.uploadHilanetInput.addEventListener('change', (e) => {
            if (e.target.files[0]) {
                handleUpload(e.target.files[0], true, e.target);
            }
        });
    }

    if (DOMElements.uploadImageInput) {
        DOMElements.uploadImageInput.addEventListener('change', (e) => {
            if (e.target.files[0]) {
                handleUpload(e.target.files[0], false, e.target);
            }
        });
    }

    // Enhanced download differences handler
    const downloadDifferencesBtn = document.getElementById('download-differences-btn');
    if (downloadDifferencesBtn) {
        addEventListenerWithDebounce(downloadDifferencesBtn, 'click', handleDownloadDifferences);
    }

    // Populate employee selects
    EMPLOYEES.forEach(emp => {
        if (emp === VACATION_EMPLOYEE_REPLACEMENT) return;
        
        const option = document.createElement('option');
        option.value = emp;
        option.textContent = emp;
        
        if (DOMElements.monthlySummaryEmployeeSelect) {
            DOMElements.monthlySummaryEmployeeSelect.appendChild(option.cloneNode(true));
        }
        if (DOMElements.vacationEmployeeSelect) {
            DOMElements.vacationEmployeeSelect.appendChild(option.cloneNode(true));
        }
    });

    // Enhanced monthly summary event listeners
    if (DOMElements.monthlySummaryEmployeeSelect) {
        DOMElements.monthlySummaryEmployeeSelect.addEventListener('change', () => {
            populateMonthSelector();
            updateMonthlySummaryChart();
            setupMonthlyChartEventListeners();
        });
    }

    // State management subscription
    stateManager.subscribe((newState, oldState) => {
        // Handle state changes
        if (newState.processing !== oldState.processing) {
            // Update UI based on processing state
            document.body.classList.toggle('processing', newState.processing);
        }
        
        if (newState.theme !== oldState.theme) {
            // Handle theme changes
            updateThemeIcons(newState.theme === 'dark');
        }
    });

    // Enhanced error handling for unhandled promises
    window.addEventListener('unhandledrejection', (event) => {
        console.error('Unhandled promise rejection:', event.reason);
        if (event.reason instanceof Error) {
            displayAPIError(event.reason, 'שגיאה לא צפויה');
        }
        event.preventDefault();
    });

    // Enhanced error handling for general errors
    window.addEventListener('error', (event) => {
        console.error('Global error:', event.error);
        if (event.error instanceof Error) {
            displayAPIError(event.error, 'שגיאה במערכת');
        }
    });

    // Initialize theme and date
    initializeTheme();
    
    const today = new Date().toISOString().split('T')[0];
    const weekId = getWeekId(today);
    DOMElements.datePicker.value = weekId;
    stateManager.setState({ activeWeek: weekId });

    // Load Google API scripts
    loadGoogleApiScripts();

    // Performance monitoring
    if ('performance' in window && 'observe' in window.PerformanceObserver.prototype) {
        const perfObserver = new PerformanceObserver((list) => {
            list.getEntries().forEach((entry) => {
                if (entry.entryType === 'measure' && entry.duration > 1000) {
                    console.warn(`Slow operation detected: ${entry.name} took ${entry.duration}ms`);
                }
            });
        });
        
        try {
            perfObserver.observe({ entryTypes: ['measure', 'navigation'] });
        } catch (e) {
            console.warn('Performance observer not supported');
        }
    }

    // Initialize service worker for offline functionality (if available)
    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
            .then(() => console.log('Service Worker registered'))
            .catch(() => console.log('Service Worker registration failed'));
    }

    updateStatus('המערכת מוכנה לשימוש', 'success');
}

// --- Cleanup Function for Memory Management ---
function cleanup() {
    // Cancel any pending operations
    if (abortController) {
        abortController.abort();
        abortController = null;
    }

    // Clear caches
    elementCache.clear();
    
    // Destroy charts
    destroyAllCharts();
    
    // Clear timers
    Object.values(DOMElements).forEach(element => {
        if (element && eventListenerCache.has(element)) {
            // Event listeners are automatically cleaned up when elements are removed
            eventListenerCache.delete(element);
        }
    });
}

// Enhanced page visibility handling
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        // Page is hidden - pause non-critical operations
        if (abortController && isProcessing) {
            console.log('Page hidden during processing - operation may be paused');
        }
    } else {
        // Page is visible - resume operations if needed
        if (gapi.client.getToken() && Object.keys(allSchedules).length === 0) {
            fetchData(); // Refresh data when page becomes visible
        }
    }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    cleanup();
    
    // Save any pending data
    if (Object.keys(allSchedules).length > 0) {
        // Use sendBeacon for reliable data sending during unload
        const data = JSON.stringify({ schedules: allSchedules, timestamp: Date.now() });
        if (navigator.sendBeacon) {
            navigator.sendBeacon('/api/save-schedules', data);
        }
    }
});

// Enhanced keyboard shortcuts
document.addEventListener('keydown', (event) => {
    // Ctrl/Cmd + S: Save current schedule
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
        event.preventDefault();
        if (Object.keys(allSchedules).length > 0) {
            saveFullSchedule(allSchedules)
                .then(() => updateStatus('נתונים נשמרו', 'success'))
                .catch(error => displayAPIError(error, 'שגיאה בשמירה'));
        }
    }
    
    // Ctrl/Cmd + R: Refresh data
    if ((event.ctrlKey || event.metaKey) && event.key === 'r') {
        event.preventDefault();
        fetchData();
    }
    
    // Esc: Close any open modals
    if (event.key === 'Escape') {
        const openModals = document.querySelectorAll('[id$="-modal"]:not(.hidden)');
        openModals.forEach(modal => modal.classList.add('hidden'));
    }
});

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeAppLogic);
} else {
    initializeAppLogic();
}