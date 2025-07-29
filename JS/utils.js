// Add this line at the top
export const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

// --- General Helper Functions ---
/**
 * Formats a Date object into a localized string.
 * @param {Date|string} date - The date to format (can be Date object or ISO string).
 * @param {Object} [options] - Options for toLocaleDateString.
 * @returns {string} Formatted date string.
 */
export function formatDate(date, options) {
    const defaultOptions = { day: '2-digit', month: '2-digit', year: 'numeric' };
    return new Date(date).toLocaleDateString('he-IL', options || defaultOptions);
}

/**
 * Formats a 'YYYY-MM' string into a localized 'Month Year' string.
 * @param {string} monthYearString - The date string in 'YYYY-MM' format.
 * @returns {string} Formatted month and year string (e.g., "יולי 2025").
 */
export function formatMonthYear(monthYearString) {
    const [year, month] = monthYearString.split('-');
    const date = new Date(year, month - 1);
    return date.toLocaleDateString('he-IL', { month: 'long', year: 'numeric' });
}


/**
 * Calculates the week ID (Sunday's date) for a given date string.
 * @param {string} d - Date string in 'YYYY-MM-DD' format.
 * @returns {string} Week ID in 'YYYY-MM-DD' format.
 */
export function getWeekId(d) {
    const [year, month, dayOfMonth] = d.split('-').map(Number);
    const date = new Date(year, month - 1, dayOfMonth);
    let day = date.getDay(); // 0 for Sunday, 1 for Monday, etc.
    date.setDate(date.getDate() - day); // Set date to the Sunday of the current week
    const yearResult = date.getFullYear();
    const monthResult = String(date.getMonth() + 1).padStart(2, '0');
    const dayResult = String(date.getDate()).padStart(2, '0');
    return `${yearResult}-${monthResult}-${dayResult}`;
}
/**
 * Generates an array of Date objects for the 7 days of a week, starting from a given date.
 * @param {Date} startDate - The starting date of the week (should be a Sunday).
 * @returns {Date[]} An array of 7 Date objects.
 */
export function getWeekDates(startDate) {
    const dates = [];
    for (let i = 0; i < 7; i++) {
        const newDate = new Date(startDate);
        newDate.setDate(newDate.getDate() + i);
        dates.push(newDate);
    }
    return dates;
}

/**
 * Creates a raw email message string for the Gmail API.
 * @param {string} to - The recipient's email address.
 * @param {string} subject - The email subject.
 * @param {string} messageBody - The HTML body of the email.
 * @returns {string} The base64-encoded raw email string.
 */
export function createMessage(to, subject, messageBody) {
    const utf8ToBase64 = (str) => {
        try {
            // This properly handles UTF-8 characters in the subject and body
            return btoa(unescape(encodeURIComponent(str)));
        } catch (e) {
            console.error("Error in utf8ToBase64 encoding:", e);
            return "";
        }
    };
    const emailParts = [
        `From: me`,
        `To: ${to}`,
        `Subject: =?utf-8?B?${utf8ToBase64(subject)}?=`,
        'MIME-Version: 1.0',
        'Content-Type: text/html; charset="UTF-8"',
        'Content-Transfer-Encoding: base64',
        '',
        utf8ToBase64(messageBody)
    ];
    const fullEmailString = emailParts.join('\r\n');
    // The replace calls are required for the raw message format for the Gmail API
    return utf8ToBase64(fullEmailString).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
/**
 * Displays a custom confirmation modal dialog.
 * @param {string} message - The message to display in the confirmation box.
 * @param {Function} onConfirm - The callback function to execute if the user confirms.
 */
export function showCustomConfirmation(message, onConfirm) {
    const modal = document.createElement('div');
    // Use fixed positioning and high z-index to ensure it's on top
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

    const confirmBtn = document.getElementById('confirm-yes-btn');
    const cancelBtn = document.getElementById('confirm-no-btn');

    const closeModal = () => {
        modal.remove();
    };

    confirmBtn.addEventListener('click', () => {
        onConfirm();
        closeModal();
    });
    
    cancelBtn.addEventListener('click', closeModal);
    
    // Also close the modal if the user clicks the background overlay
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            closeModal();
        }
    });
}