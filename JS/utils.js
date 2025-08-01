// netlifyProjects/JS/utils.js
// Add this line at the top
export const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/**
 * Creates a debounced function that delays invoking the provided function until after 
 * a certain number of milliseconds have passed since the last time it was invoked.
 * @param {Function} func The function to debounce.
 * @param {number} wait The number of milliseconds to delay.
 * @returns {Function} Returns the new debounced function.
 */
export function debounce(func, wait) {
  let timeout;

  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };

    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

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
 * Disables a button and shows a loading spinner inside it.
 * @param {HTMLButtonElement} button - The button element to modify.
 * @param {string} [loadingText='טוען...'] - The text to display next to the spinner.
 */
export function setButtonLoading(button, loadingText = 'טוען...') {
  if (!button) return;
  button.dataset.originalHtml = button.innerHTML;
  button.innerHTML = `
    <svg aria-hidden="true" role="status" class="inline w-4 h-4 me-3 animate-spin" viewBox="0 0 100 101" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M100 50.5908C100 78.2051 77.6142 100.591 50 100.591C22.3858 100.591 0 78.2051 0 50.5908C0 22.9766 22.3858 0.59082 50 0.59082C77.6142 0.59082 100 22.9766 100 50.5908ZM9.08144 50.5908C9.08144 73.1895 27.4013 91.5094 50 91.5094C72.5987 91.5094 90.9186 73.1895 90.9186 50.5908C90.9186 27.9921 72.5987 9.67226 50 9.67226C27.4013 9.67226 9.08144 27.9921 9.08144 50.5908Z" fill="currentColor" fill-opacity="0.2"/>
      <path d="M93.9676 39.0409C96.393 38.4038 97.8624 35.9116 97.0079 33.5539C95.2932 28.8227 92.871 24.3692 89.8167 20.348C85.8452 15.1192 80.8826 10.7238 75.2124 7.41289C69.5422 4.10194 63.2754 1.94025 56.7698 1.05124C51.7666 0.367541 46.6976 0.446843 41.7345 1.27873C39.2613 1.69328 37.813 4.19778 38.4501 6.62326C39.0873 9.04874 41.5694 10.4717 44.0505 10.1071C47.8511 9.54855 51.7191 9.52689 55.5402 10.0491C60.8642 10.7766 65.9928 12.5457 70.6331 15.2552C75.2735 17.9648 79.3347 21.5619 82.5849 25.841C84.9175 28.9121 86.7997 32.2913 88.1811 35.8758C89.083 38.2158 91.5421 39.6781 93.9676 39.0409Z" fill="currentColor"/>
    </svg>
    <span class="ms-2">${loadingText}</span>
  `;
  button.disabled = true;
}

/**
 * Restores a button to its original state after a loading operation.
 * @param {HTMLButtonElement} button - The button element to restore.
 */
export function restoreButton(button) {
  if (!button || typeof button.dataset.originalHtml === 'undefined') return;
  button.innerHTML = button.dataset.originalHtml;
  delete button.dataset.originalHtml;
  button.disabled = false;
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