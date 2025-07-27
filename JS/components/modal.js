
// יש להוסיף את המשתנה VACATION_EMPLOYEE_REPLACEMENT לייבוא מהקונפיגורציה
import { DEFAULT_SHIFT_TIMES, EMPLOYEES, VACATION_EMPLOYEE_REPLACEMENT } from "../config.js";import { saveFullSchedule } from "../Api/googleApi.js";
import { updateStatus, DOMElements, allSchedules } from "../main.js";
import { formatDate, getWeekId } from "../utils.js";
import { renderSchedule } from "./schedule.js";


/**
 * Handles click events on shift cells, opening the shift selection modal.
 * @param {Event} e - The click event.
 */

export function handleShiftCellClick(e) {
    if (gapi.client.getToken() === null) {
        updateStatus('יש להתחבר עם חשבון Google כדי לערוך.', 'info', false);
        return;
    }
    const target = e.currentTarget;
    const day = target.dataset.day;
    const shift = target.dataset.shift;
    const otherShiftEmployee = target.dataset.otherShiftEmployee;

    const currentWeekId = getWeekId(DOMElements.datePicker.value);
    const currentEmployee = allSchedules[currentWeekId]?.[day]?.[shift]?.employee || 'none';
    const currentStartTime = allSchedules[currentWeekId]?.[day]?.[shift]?.start || DEFAULT_SHIFT_TIMES[shift].start;
    const currentEndTime = allSchedules[currentWeekId]?.[day]?.[shift]?.end || DEFAULT_SHIFT_TIMES[shift].end;

    DOMElements.modalTitle.textContent = `שיבוץ למשמרת ${shift === 'morning' ? 'בוקר' : 'ערב'}, יום ${day}`;
    DOMElements.modalOptions.innerHTML = '';

    DOMElements.shiftStartTimeInput.value = currentStartTime.substring(0, 5);
    DOMElements.shiftEndTimeInput.value = currentEndTime.substring(0, 5);

    DOMElements.shiftModal.dataset.day = day;
    DOMElements.shiftModal.dataset.shift = shift;

    // **שיפור**: סינון העובד המחליף מאפשרויות הבחירה הידניות
    const availableEmployees = EMPLOYEES.filter(emp => emp !== VACATION_EMPLOYEE_REPLACEMENT);
    const options = availableEmployees.concat(['none']);

    options.forEach(emp => {
        const button = document.createElement('button');
        button.dataset.employee = emp;
        button.textContent = emp === 'none' ? 'ללא שיבוץ' : emp;
        button.className = 'w-full p-3 text-center rounded-lg font-semibold';

        if (emp === currentEmployee) {
            button.classList.add('bg-blue-200', 'text-blue-800');
        }

        if (emp === otherShiftEmployee && otherShiftEmployee !== 'none' && emp !== currentEmployee) {
            button.disabled = true;
            button.classList.add('bg-slate-100', 'text-slate-400', 'cursor-not-allowed');
        } else {
            button.classList.add('bg-slate-50', 'hover:bg-blue-100');
        }

        button.addEventListener('click', (btnEvent) => {
            DOMElements.modalOptions.querySelectorAll('button').forEach(b => {
                if (b !== btnEvent.target && !b.disabled) {
                    b.classList.remove('bg-blue-200', 'text-blue-800');
                    b.classList.add('bg-slate-50', 'hover:bg-blue-100');
                }
            });
            if (!btnEvent.target.disabled) {
                btnEvent.target.classList.remove('bg-slate-50', 'hover:bg-blue-100');
                btnEvent.target.classList.add('bg-blue-200', 'text-blue-800');
            }
            DOMElements.shiftModal.dataset.selectedEmployee = btnEvent.target.dataset.employee;
        });
        DOMElements.modalOptions.appendChild(button);
    });

    const currentEmployeeBtn = DOMElements.modalOptions.querySelector(`button[data-employee="${currentEmployee}"]`);
    if (currentEmployeeBtn && !currentEmployeeBtn.disabled) {
        currentEmployeeBtn.click();
    } else {
        DOMElements.shiftModal.dataset.selectedEmployee = currentEmployee;
    }

    DOMElements.shiftModal.classList.remove('hidden');
}