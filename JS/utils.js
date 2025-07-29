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