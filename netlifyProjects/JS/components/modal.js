import { saveData } from "../Api/googleApi.js";
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
}/** Handles saving the selected shift details from the modal. */
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
    await saveData(weekId, allSchedules[weekId]);
}
/** Closes the shift selection modal. */

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
    displayArea.innerHTML = '';

    if (differences.length === 0) {
        displayArea.innerHTML = '<p class="text-center text-green-600 font-semibold">🎉 אין פערים! הסידור של מאור תואם בין Google Sheets לחילנט.</p>';
        DOMElements.importSelectedHilanetShiftsBtn.disabled = true;
    } else {
        let html = `
                    <p class="text-center text-slate-700 mb-4">בחר את המשמרות שברצונך לייבא:</p>
                    <table id="differences-table" class="min-w-full divide-y divide-gray-200">
                        <thead>
                            <tr>
                                <th><input type="checkbox" id="select-all-differences" class="h-4 w-4 text-blue-600 rounded"></th>
                                <th>סוג שינוי</th>
                                <th>תאריך</th>
                                <th>יום</th>
                                <th>משמרת</th>
                                <th>סידור Google Sheets</th>
                                <th>סידור חילנט</th>
                            </tr>
                        </thead>
                        <tbody>
                `;
        differences.forEach(diff => {
            const dateFormatted = formatDate(diff.date, {
                day: '2-digit',
                month: '2-digit'
            });
            const shiftTypeHebrew = diff.shiftType === 'morning' ? 'בוקר' : 'ערב';
            let gsDetails = '—';
            let hlDetails = '—';
            let rowClass = '';

            if (diff.type === 'added') {
                hlDetails = `${diff.hilanet.employee} (${diff.hilanet.start.substring(0, 5)}-${diff.hilanet.end.substring(0, 5)})`;
                rowClass = 'diff-added';
            } else if (diff.type === 'removed') {
                gsDetails = `${diff.googleSheets.employee} (${diff.googleSheets.start.substring(0, 5)}-${diff.googleSheets.end.substring(0, 5)})`;
                rowClass = 'diff-removed';
            } else if (diff.type === 'changed') {
                gsDetails = `${diff.googleSheets.employee} (${diff.googleSheets.start.substring(0, 5)}-${diff.googleSheets.end.substring(0, 5)})`;
                hlDetails = `${diff.hilanet.employee} (${diff.hilanet.start.substring(0, 5)}-${diff.hilanet.end.substring(0, 5)})`;
                rowClass = 'diff-changed';
            }
            const typeHebrew = {
                'added': 'נוסף בחילנט',
                'removed': 'חסר בחילנט',
                'changed': 'שונה'
            }[diff.type];
            html += `
                        <tr class="${rowClass}">
                            <td><input type="checkbox" class="difference-checkbox h-4 w-4 text-blue-600 rounded" data-diff-id="${diff.id}"></td>
                            <td>${typeHebrew}</td>
                            <td>${dateFormatted}</td>
                            <td>${diff.dayName}</td>
                            <td>${shiftTypeHebrew}</td>
                            <td>${gsDetails}</td>
                            <td>${hlDetails}</td>
                        </tr>
                    `;
        });
        html += '</tbody></table>';
        displayArea.innerHTML = html;
        DOMElements.importSelectedHilanetShiftsBtn.disabled = false;

        // Add event listener for "select all" checkbox
        const selectAllCheckbox = document.getElementById('select-all-differences');
        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', (e) => {
                document.querySelectorAll('.difference-checkbox').forEach(checkbox => {
                    checkbox.checked = e.target.checked;
                });
            });
        }
    }
    DOMElements.differencesModal.classList.remove('hidden');
}
/** Closes the differences modal. */
export function closeDifferencesModal() {
    DOMElements.differencesModal.classList.add('hidden');
}

