import { saveFullSchedule } from "../Api/googleApi.js";
import { DEFAULT_SHIFT_TIMES, EMPLOYEES } from "../config.js";
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

    const options = EMPLOYEES.concat(['none']);
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


export async function handleModalSave() {
    const employee = DOMElements.shiftModal.dataset.selectedEmployee || 'none';
    const weekId = getWeekId(DOMElements.datePicker.value);
    const day = DOMElements.shiftModal.dataset.day;
    const shift = DOMElements.shiftModal.dataset.shift;
    const startTime = DOMElements.shiftStartTimeInput.value + ':00';
    const endTime = DOMElements.shiftEndTimeInput.value + ':00';

    if (!allSchedules[weekId]) allSchedules[weekId] = {};
    if (!allSchedules[weekId][day]) allSchedules[weekId][day] = {};
    allSchedules[weekId][day][shift] = {
        employee,
        start: startTime,
        end: endTime
    };

    closeModal();
    renderSchedule(weekId);
    await saveFullSchedule(allSchedules); // <-- שימוש בפונקציה החדשה
}

export function closeModal() {
    DOMElements.shiftModal.classList.add('hidden');
}
/**
 * Displays a modal for selecting employees.
 * @param {Function} actionCallback - Function to call with selected employees.
 * @param {string} modalTitleText - Title for the modal.
 * @param {string[]} [preSelectedEmployees=[]] - Array of employee names to pre-select.
 * @param {boolean} [singleSelection=false] - If true, use radio buttons for single selection.
 * @param {string[]} [allowedEmployees=EMPLOYEES] - Subset of employees to display.
 */
export function showEmployeeSelectionModal(actionCallback, modalTitleText, preSelectedEmployees = [], singleSelection = false, allowedEmployees = EMPLOYEES) {
    if (gapi.client.getToken() === null) {
        updateStatus('יש להתחבר עם חשבון Google כדי לבצע פעולה זו.', 'info', false);
        return;
    }
    DOMElements.employeeSelectionModalTitle.textContent = modalTitleText;
    DOMElements.employeeCheckboxesContainer.innerHTML = '';

    allowedEmployees.forEach(employee => {
        const div = document.createElement('div');
        div.className = 'flex items-center';
        const input = document.createElement('input');
        input.type = singleSelection ? 'radio' : 'checkbox';
        input.name = singleSelection ? 'selectedEmployee' : `employee-${employee}`;
        input.id = `employee-${employee}`;
        input.value = employee;
        input.className = 'h-4 w-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500';
        if (preSelectedEmployees.includes(employee)) input.checked = true;

        const label = document.createElement('label');
        label.htmlFor = `employee-${employee}`;
        label.textContent = employee;
        label.className = 'ml-2 text-slate-700';

        div.appendChild(input);
        div.appendChild(label);
        DOMElements.employeeCheckboxesContainer.appendChild(div);
    });

    const confirmBtn = DOMElements.employeeSelectionConfirmBtn;
    const cancelBtn = DOMElements.employeeSelectionCancelBtn;
    confirmBtn.replaceWith(confirmBtn.cloneNode(true));
    cancelBtn.replaceWith(cancelBtn.cloneNode(true));
    DOMElements.employeeSelectionConfirmBtn = document.getElementById('employee-selection-confirm-btn');
    DOMElements.employeeSelectionCancelBtn = document.getElementById('employee-selection-cancel-btn');

    DOMElements.employeeSelectionConfirmBtn.addEventListener('click', () => {
        let selectedValues;
        if (singleSelection) {
            const selectedRadio = DOMElements.employeeCheckboxesContainer.querySelector('input[type="radio"]:checked');
            selectedValues = selectedRadio ? [selectedRadio.value] : [];
        } else {
            selectedValues = Array.from(DOMElements.employeeCheckboxesContainer.querySelectorAll('input[type="checkbox"]:checked')).map(checkbox => checkbox.value);
        }
        closeEmployeeSelectionModal();
        actionCallback(selectedValues);
    });
    DOMElements.employeeSelectionCancelBtn.addEventListener('click', closeEmployeeSelectionModal);
    DOMElements.employeeSelectionModal.classList.remove('hidden');
}
/** Closes the employee selection modal. */

export function closeEmployeeSelectionModal() {
    DOMElements.employeeSelectionModal.classList.add('hidden');
}
/** Shows the vacation modal. */
export function showVacationModal() {
    if (gapi.client.getToken() === null) {
        updateStatus('יש להתחבר עם חשבון Google כדי לבצע פעולה זו.', 'info', false);
        return;
    }
    const today = new Date();
    const currentWeekId = getWeekId(today.toISOString().split('T')[0]);
    const sundayOfCurrentWeek = new Date(currentWeekId);
    const saturdayOfCurrentWeek = new Date(sundayOfCurrentWeek);
    saturdayOfCurrentWeek.setDate(saturdayOfCurrentWeek.getDate() + 6);

    DOMElements.vacationStartDateInput.value = sundayOfCurrentWeek.toISOString().split('T')[0];
    DOMElements.vacationEndDateInput.value = saturdayOfCurrentWeek.toISOString().split('T')[0];
    DOMElements.vacationModal.classList.remove('hidden');
}
/** Closes the vacation modal. */
export function closeVacationModal() {
    DOMElements.vacationModal.classList.add('hidden');
}
/**
 * Displays the identified differences in a modal table with checkboxes for selection.
 * @param {Object[]} differences - Array of difference objects.
 */
export function displayDifferences(differences) {
    const displayArea = DOMElements.differencesDisplay;
    const importBtn = DOMElements.importSelectedHilanetShiftsBtn;
    const modalStatus = document.getElementById('differences-modal-status');
    if (modalStatus) modalStatus.innerHTML = ''; // איפוס הסטטוס при פתיחה

    displayArea.innerHTML = '';

    if (differences.length === 0) {
        displayArea.innerHTML = '<p class="text-center text-green-600 font-semibold p-4">🎉 אין פערים! הסידור תואם בין המערכות.</p>';
        if (importBtn) importBtn.disabled = true;
        DOMElements.differencesModal.classList.remove('hidden');
        return;
    }

    if (importBtn) importBtn.disabled = false;

    const table = document.createElement('table');
    table.id = 'differences-table';
    table.className = 'min-w-full text-sm text-center';

    table.innerHTML = `
        <thead class="bg-slate-200">
            <tr>
                <th class="p-2 border border-slate-300"><input type="checkbox" id="select-all-differences" class="h-4 w-4 text-blue-600 rounded" checked></th>
                <th class="p-2 border border-slate-300">סוג שינוי</th>
                <th class="p-2 border border-slate-300">תאריך</th>
                <th class="p-2 border border-slate-300">משמרת</th>
                <th class="p-2 border border-slate-300">במערכת (Sheets)</th>
                <th class="p-2 border border-slate-300">בחילנט</th>
            </tr>
        </thead>
        <tbody></tbody>
    `;

    const tbody = table.querySelector('tbody');
    const typeClasses = { added: 'bg-green-100', removed: 'bg-red-100', changed: 'bg-yellow-100' };

    differences.forEach(diff => {
        const row = tbody.insertRow();
        row.className = `${typeClasses[diff.type] || ''} hover:bg-slate-200`;

        // --- תיקון: הצגת טווח שעות מלא ---
        const formatDetails = (shift) => shift ? `${shift.employee} (${shift.start.substring(0, 5)}-${shift.end.substring(0, 5)})` : '—';
        
        const gsDetails = formatDetails(diff.googleSheets);
        const hlDetails = formatDetails(diff.hilanet);
        const typeHebrew = { 'added': 'קיים בחילנט בלבד', 'removed': 'קיים במערכת בלבד', 'changed': 'שונה' }[diff.type];

        row.innerHTML = `
            <td class="p-2 border border-slate-300"><input type="checkbox" class="difference-checkbox h-4 w-4 text-blue-600 rounded" data-diff-id="${diff.id}" checked></td>
            <td class="p-2 border border-slate-300 font-medium">${typeHebrew}</td>
            <td class="p-2 border border-slate-300">${formatDate(diff.date, { day: '2-digit', month: '2-digit' })} (${diff.dayName})</td>
            <td class="p-2 border border-slate-300">${diff.shiftType === 'morning' ? 'בוקר' : 'ערב'}</td>
            <td class="p-2 border border-slate-300">${gsDetails}</td>
            <td class="p-2 border border-slate-300">${hlDetails}</td>
        `;
    });

    displayArea.appendChild(table);

    document.getElementById('select-all-differences').addEventListener('change', (e) => {
        document.querySelectorAll('.difference-checkbox').forEach(checkbox => checkbox.checked = e.target.checked);
    });

    DOMElements.differencesModal.classList.remove('hidden');
}
/** Closes the differences modal. */
export function closeDifferencesModal() {
    DOMElements.differencesModal.classList.add('hidden');
}

