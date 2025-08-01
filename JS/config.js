// Google API Configuration
export const CLIENT_ID = '429395194298-a5v1mp33hsv53m0ksdalvipt9ebtrg81.apps.googleusercontent.com';
export const SCOPES = 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.readonly';
export const SPREADSHEET_ID = '1vgNyxWLWtdbqDk4_FOpQPSlyVZq1zhvxAv-SylYHzsk';
export const SHEET_NAME = 'schedules';
export const SHEET_NAME_LOGS = 'login_logs'; // New constant for the logs sheet

// Employee and Shift Configurations
export const EMPLOYEES = ['מאור', 'מור', 'טכנאי מרכז'];
export const EMPLOYEE_EMAILS = {
    'מאור': 'maorbensimon1542@gmail.com',
    'מור': 'morben@assuta.co.il',
    'טכנאי מרכז': 'tech.email@example.com'
};
export const DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];
export const VACATION_EMPLOYEE_REPLACEMENT = 'טכנאי מרכז';
export const DEFAULT_SHIFT_TIMES = {
    morning: { start: '07:00:00', end: '16:00:00' },
    evening: { start: '13:00:00', end: '22:00:00' }
};