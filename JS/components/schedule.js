import { sendEmailWithGmailApi } from "../Api/googleApi.js";
import { DAYS, DEFAULT_SHIFT_TIMES } from "../config.js";
import { allSchedules, DOMElements, updateStatus } from "../main.js";
import { handleShiftCellClick } from './modal.js';
// *** MODIFIED: Import new helper functions ***
import { getWeekDates, formatDate, getWeekId, setButtonLoading, restoreButton } from "../utils.js";


// --- UI Logic ---
/**
 * Renders the schedule table for a given week ID.
 * @param {string} weekId - The ID of the week to render.
 */

export function renderSchedule(weekId) {
    const scheduleDataForWeek = allSchedules[weekId] || {};
    const weekDates = getWeekDates(new Date(weekId));
    DOMElements.scheduleTitle.textContent = `סידור עבודה לשבוע של ${formatDate(weekDates[0])}`;
    DOMElements.scheduleBody.innerHTML = '';

    weekDates.forEach((date, index) => {
        const dayName = DAYS[index];
        const row = document.createElement('tr');
        row.className = 'border-b border-slate-200 h-16';

        row.innerHTML =
            `<td class="p-3 font-medium border-r border-l border-slate-300">${dayName}</td>` +
            `<td class="p-3 border-r border-l border-slate-300">${formatDate(date, { day: '2-digit', month: '2-digit' })}</td>`;

        if (dayName === 'שבת') {
            row.innerHTML += '<td colspan="2" class="p-3 bg-blue-50 text-blue-700 font-bold border-r border-l border-slate-300 text-center">שבת שלום</td>';
        } else {
            const dayData = scheduleDataForWeek[dayName] || {};
            const morningShift = dayData.morning || { employee: 'none', start: DEFAULT_SHIFT_TIMES.morning.start, end: DEFAULT_SHIFT_TIMES.morning.end };
            const eveningShift = dayData.evening || { employee: 'none', start: DEFAULT_SHIFT_TIMES.evening.start, end: DEFAULT_SHIFT_TIMES.evening.end };
            
            const eveningCellContent = dayName === 'שישי'
                ? '<div class="flex items-center justify-center h-full p-3 bg-blue-50 text-blue-700 font-bold">שבת שלום</div>'
                : createShiftCell(dayName, 'evening', eveningShift.employee, morningShift.employee, eveningShift.start, eveningShift.end);
            
            row.innerHTML +=
                `<td class="p-0 border-r border-l border-slate-300">${createShiftCell(dayName, 'morning', morningShift.employee, eveningShift.employee, morningShift.start, morningShift.end)}</td>` +
                `<td class="p-0 border-r border-l border-slate-300">${eveningCellContent}</td>`;
        }
        DOMElements.scheduleBody.appendChild(row);
    });

    DOMElements.scheduleBody.querySelectorAll('.shift-cell').forEach(cell => {
        cell.addEventListener('click', handleShiftCellClick);
    });
}
/**
 * Creates the HTML content for a single shift cell in the table.
 * @param {string} day - The day of the week.
 * @param {string} shiftType - 'morning' or 'evening'.
 * @param {string} selectedEmployee - The employee assigned to this shift.
 * @param {string} otherShiftEmployee - The employee assigned to the other shift on the same day.
 * @param {string} startTime - The start time of the shift.
 * @param {string} endTime - The end time of the shift.
 * @returns {string} HTML string for the shift cell.
 */

export function createShiftCell(day, shiftType, selectedEmployee, otherShiftEmployee, startTime, endTime) {
    const employeeName = selectedEmployee === 'none' ? '—' : selectedEmployee;
    const timeDisplay = (startTime && endTime && startTime !== 'none' && endTime !== 'none') ? ` (${startTime.substring(0, 5)}-${endTime.substring(0, 5)})` : '';
    return `<div class="shift-cell w-full h-full flex flex-col items-center justify-center p-1" data-day="${day}" data-shift="${shiftType}" data-other-shift-employee="${otherShiftEmployee}" data-start-time="${startTime}" data-end-time="${endTime}"><span>${employeeName}</span><span class="text-xs text-slate-500">${timeDisplay}</span></div>`;
}
/**
 * מטפל בייצוא סידור העבודה השבועי לקובץ Excel.
 * הפונקציה מציגה חיווי טעינה על הכפתור, מכינה את הנתונים,
 * יוצרת קובץ אקסל עם עיצוב מותאם אישית, ומורידה אותו.
 * במקרה של שגיאה, תוצג הודעה מתאימה.
 */
export async function handleExportToExcel() {
    const button = DOMElements.downloadBtn;
    setButtonLoading(button, 'מייצא...'); // הצגת חיווי טעינה

    try {
        // קבלת מזהה השבוע והתאריכים הרלוונטיים
        const weekId = getWeekId(DOMElements.datePicker.value);
        const weekDates = getWeekDates(new Date(weekId));
        const scheduleDataForWeek = allSchedules[weekId] || {};

        // הכנת כותרות הטבלה
        const dataForExcel = [
            ['יום', 'תאריך', 'משמרת בוקר', 'שעת התחלה בוקר', 'שעת סיום בוקר', 'משמרת ערב', 'שעת התחלה ערב', 'שעת סיום ערב']
        ];

        // מעבר על כל יום בשבוע והוספת הנתונים למערך
        weekDates.forEach((date, index) => {
            const dayName = DAYS[index];
            const dayData = scheduleDataForWeek[dayName] || {};

            // ברירות מחדל למקרה שאין נתונים
            let morningEmployee = (dayData.morning && dayData.morning.employee !== 'none') ? dayData.morning.employee : '—';
            let morningStart = (dayData.morning && dayData.morning.start) ? dayData.morning.start.substring(0, 5) : '—';
            let morningEnd = (dayData.morning && dayData.morning.end) ? dayData.morning.end.substring(0, 5) : '—';

            let eveningEmployee = (dayData.evening && dayData.evening.employee !== 'none') ? dayData.evening.employee : '—';
            let eveningStart = (dayData.evening && dayData.evening.start) ? dayData.evening.start.substring(0, 5) : '—';
            let eveningEnd = (dayData.evening && dayData.evening.end) ? dayData.evening.end.substring(0, 5) : '—';

            // טיפול מיוחד בימי שישי ושבת
            if (dayName === 'שישי') {
                eveningEmployee = 'שבת שלום';
                eveningStart = '—';
                eveningEnd = '—';
            }
            if (dayName === 'שבת') {
                morningEmployee = 'שבת שלום';
                morningStart = '—';
                morningEnd = '—';
                eveningEmployee = 'שבת שלום';
                eveningStart = '—';
                eveningEnd = '—';
            }
            
            dataForExcel.push([dayName, formatDate(date), morningEmployee, morningStart, morningEnd, eveningEmployee, eveningStart, eveningEnd]);
        });

        // יצירת גיליון עבודה מתוך המערך
        const worksheet = XLSX.utils.aoa_to_sheet(dataForExcel);

        // הגדרת רוחב העמודות
        worksheet['!cols'] = [
            { wch: 10 }, { wch: 15 }, { wch: 15 }, { wch: 10 },
            { wch: 10 }, { wch: 15 }, { wch: 10 }, { wch: 10 }
        ];

        // יצירת קובץ עבודה חדש והוספת הגיליון
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, `סידור שבוע ${formatDate(weekDates[0], { day: '2-digit', month: '2-digit' })}`);

        // הורדת הקובץ
        XLSX.writeFile(workbook, `סידור_עבודה_${weekId}.xlsx`);
        updateStatus('הסידור יוצא ל-Excel בהצלחה!', 'success', false);

    } catch (error) {
        // הצגת הודעת שגיאה במקרה של כשל
        displayAPIError(error, 'שגיאה בייצוא ל-Excel.');
    } finally {
        // שחזור הכפתור למצבו המקורי בכל מקרה
        restoreButton(button);
    }
}

/**
 * מטפל בשליחת סידור העבודה הנוכחי באמצעות אימייל.
 * הפונקציה בודקת תחילה אם המשתמש מחובר לחשבון Google.
 * לאחר מכן, היא בונה גוף אימייל בפורמט HTML מעוצב המכיל טבלה של הסידור,
 * שולחת את המייל, ומנהלת את מצב כפתור השליחה (טעינה ושחזור).
 */
export async function handleSendEmail() {
    // בדיקה אם המשתמש מחובר לחשבון גוגל
    if (gapi.client.getToken() === null) {
        updateStatus('יש להתחבר עם חשבון Google כדי לשלוח מייל.', 'info', false);
        return;
    }

    const button = DOMElements.emailBtn;
    setButtonLoading(button, 'שולח...'); // הצגת אנימציית טעינה בכפתור

    try {
        const recipient = 'maorbens@assuta.co.il'; // נמען קבוע
        const weekId = getWeekId(DOMElements.datePicker.value);
        const subject = `סידור עבודה לשבוע של ${formatDate(new Date(weekId))}`;
        let emailBodyContent = '';

        // בדיקה אם אלמנטי ה-DOM של הסידור קיימים כדי לבנות מהם את המייל
        if (DOMElements.scheduleTable && DOMElements.scheduleTitle) {
            // התחלת בניית גוף המייל בפורמט HTML
            emailBodyContent = `
                <div style="font-family: 'Rubik', sans-serif; direction: rtl; text-align: right; color: #333;">
                    <h2 style="color: #2563eb; font-size: 24px; margin-bottom: 20px;">${DOMElements.scheduleTitle.textContent}</h2>
                    <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                        <thead>
                            <tr style="background-color: #e2e8f0;">
                                <th style="padding: 12px; border: 1px solid #cbd5e1; text-align: right;">יום</th>
                                <th style="padding: 12px; border: 1px solid #cbd5e1; text-align: right;">תאריך</th>
                                <th style="padding: 12px; border: 1px solid #cbd5e1; text-align: right;">משמרת בוקר</th>
                                <th style="padding: 12px; border: 1px solid #cbd5e1; text-align: right;">משמרת ערב</th>
                            </tr>
                        </thead>
                        <tbody>
            `;
            
            const weekDates = getWeekDates(new Date(weekId));
            const scheduleDataForWeek = allSchedules[weekId] || {};

            // מעבר על כל יום בשבוע והוספת שורה לטבלה
            weekDates.forEach((date, index) => {
                const dayName = DAYS[index];
                const dayData = scheduleDataForWeek[dayName] || {};
                
                const morningEmployee = (dayData.morning && dayData.morning.employee !== 'none') ? dayData.morning.employee : '—';
                const eveningEmployee = (dayData.evening && dayData.evening.employee !== 'none') ? dayData.evening.employee : '—';

                const rowStyle = 'background-color: #ffffff;';
                const cellStyle = 'padding: 10px; border: 1px solid #cbd5e1; text-align: right;';
                const specialDayCellStyle = 'padding: 10px; border: 1px solid #cbd5e1; text-align: center; background-color: #eff6ff; color: #1e40af; font-weight: bold;';

                emailBodyContent += `<tr style="${rowStyle}">`;
                emailBodyContent += `<td style="${cellStyle} font-weight: bold;">${dayName}</td>`;
                emailBodyContent += `<td style="${cellStyle}">${formatDate(date, { day: '2-digit', month: '2-digit' })}</td>`;

                // טיפול מיוחד בשבת ושישי
                if (dayName === 'שבת') {
                    emailBodyContent += `<td colspan="2" style="${specialDayCellStyle}">שבת שלום</td>`;
                } else {
                    const eveningCellContent = dayName === 'שישי' ? 'שבת שלום' : eveningEmployee;
                    const eveningCellActualStyle = dayName === 'שישי' ? specialDayCellStyle : cellStyle;
                    
                    emailBodyContent += `<td style="${cellStyle}">${morningEmployee}</td>`;
                    emailBodyContent += `<td style="${eveningCellActualStyle}">${eveningCellContent}</td>`;
                }
                emailBodyContent += `</tr>`;
            });

            // סגירת תגיות ה-HTML
            emailBodyContent += `</tbody></table><p style="margin-top: 20px; font-size: 14px; color: #555;">בברכה,<br>מערכת סידור עבודה</p></div>`;
        } else {
            // הודעת חלופית אם לא ניתן היה לבנות את גוף המייל
            emailBodyContent = `סידור עבודה לשבוע של ${formatDate(new Date(weekId))}. אנא בדוק את הסידור באפליקציה.`;
            updateStatus('שגיאה: לא ניתן היה ליצור את גוף המייל.', 'error', false);
        }
        
        // שליחת המייל באמצעות ה-API
        await sendEmailWithGmailApi(recipient, subject, emailBodyContent);

    } catch(err) {
        // הטיפול בשגיאה מתבצע בתוך פונקציית sendEmailWithGmailApi, אך ניתן להוסיף כאן לוגים
        console.error('שגיאה חיצונית בתהליך שליחת המייל:', err);
    } finally {
        // שחזור הכפתור למצבו המקורי בכל מקרה (הצלחה או כישלון)
        restoreButton(button);
    }
}

export async function sendFridaySummaryEmail(startDate, endDate) {
    const recipient = 'maorbens@assuta.co.il';
    const subject = `סיכום עבודה בימי שישי מתאריך ${formatDate(startDate)} עד ${formatDate(endDate)}`;
    let fridays = [];

    for (const weekId in allSchedules) {
        const weekDates = getWeekDates(new Date(weekId));
        weekDates.forEach(date => {
            const dateString = date.toISOString().split('T')[0];
            if (date.getDay() === 5 && dateString >= startDate && dateString <= endDate) {
                const dayData = allSchedules[weekId]['שישי'];
                const employee = (dayData && dayData.morning && dayData.morning.employee !== 'none') ? dayData.morning.employee : 'לא משובץ';
                fridays.push({ date: formatDate(date), employee });
            }
        });
    }

    if (fridays.length === 0) {
        updateStatus('לא נמצאו ימי שישי מאויישים בטווח התאריכים.', 'info');
        return;
    }

    let emailBodyContent = `
        <div style="font-family: 'Rubik', sans-serif; direction: rtl; text-align: right; color: #333;">
            <h2 style="color: #2563eb; font-size: 24px; margin-bottom: 20px;">${subject}</h2>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px;">
                <thead>
                    <tr style="background-color: #e2e8f0;">
                        <th style="padding: 12px; border: 1px solid #cbd5e1; text-align: right;">תאריך</th>
                        <th style="padding: 12px; border: 1px solid #cbd5e1; text-align: right;">עובד</th>
                    </tr>
                </thead>
                <tbody>
    `;

    fridays.forEach(friday => {
        emailBodyContent += `
            <tr style="background-color: #ffffff;">
                <td style="padding: 10px; border: 1px solid #cbd5e1;">${friday.date}</td>
                <td style="padding: 10px; border: 1px solid #cbd5e1;">${friday.employee}</td>
            </tr>
        `;
    });

    emailBodyContent += `</tbody></table><p style="margin-top: 20px; font-size: 14px; color: #555;">בברכה,<br>מערכת סידור עבודה</p></div>`;

    await sendEmailWithGmailApi(recipient, subject, emailBodyContent);
}