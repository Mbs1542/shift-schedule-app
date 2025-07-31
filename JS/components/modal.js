import { DEFAULT_SHIFT_TIMES, EMPLOYEES, VACATION_EMPLOYEE_REPLACEMENT, DAYS } from "../config.js";
import { saveFullSchedule } from "../Api/googleApi.js";
import { updateStatus, DOMElements, allSchedules } from "../main.js";
import { getWeekId, formatDate } from "../utils.js";
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


export async function handleModalSave() {
    const employee = DOMElements.shiftModal.dataset.selectedEmployee || 'none';
    const weekId = getWeekId(DOMElements.datePicker.value);
    const day = DOMElements.shiftModal.dataset.day;
    const shift = DOMElements.shiftModal.dataset.shift;
    const startTime = DOMElements.shiftStartTimeInput.value;
    const endTime = DOMElements.shiftEndTimeInput.value;

    if (endTime < startTime) {
        updateStatus('שגיאה: שעת הסיום אינה יכולה להיות לפני שעת ההתחלה.', 'error');
        return;
    }

    if (!allSchedules[weekId]) allSchedules[weekId] = {};
    if (!allSchedules[weekId][day]) allSchedules[weekId][day] = {};
    allSchedules[weekId][day][shift] = {
        employee,
        start: startTime + ':00',
        end: endTime + ':00'
    };

    closeModal();
    renderSchedule(weekId);
    await saveFullSchedule(allSchedules);
}

export function closeModal() {
    DOMElements.shiftModal.classList.add('hidden');
}

export function showEmployeeSelectionModal(actionCallback, modalTitleText, preSelectedEmployees = [], singleSelection = false, allowedEmployees = EMPLOYEES) {
    if (gapi.client.getToken() === null) {
        updateStatus('יש להתחבר עם חשבון Google כדי לבצע פעולה זו.', 'info', false);
        return;
    }
    
    if (DOMElements.employeeSelectionModalTitle) {
        DOMElements.employeeSelectionModalTitle.textContent = modalTitleText;
    }

    const container = document.getElementById('employee-checkboxes-container');
    if(container) {
        container.innerHTML = '';

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
            container.appendChild(div);
        });

        const confirmBtn = document.getElementById('employee-selection-confirm-btn');
        const cancelBtn = document.getElementById('employee-selection-cancel-btn');
        
        const newConfirmBtn = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirmBtn, confirmBtn);
        
        const newCancelBtn = cancelBtn.cloneNode(true);
        cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);

        newConfirmBtn.addEventListener('click', () => {
            let selectedValues;
            if (singleSelection) {
                const selectedRadio = container.querySelector('input[type="radio"]:checked');
                selectedValues = selectedRadio ? [selectedRadio.value] : [];
            } else {
                selectedValues = Array.from(container.querySelectorAll('input[type="checkbox"]:checked')).map(checkbox => checkbox.value);
            }
            closeEmployeeSelectionModal();
            actionCallback(selectedValues);
        });
        newCancelBtn.addEventListener('click', closeEmployeeSelectionModal);
    }
    
    if (DOMElements.employeeSelectionModal) {
        DOMElements.employeeSelectionModal.classList.remove('hidden');
    }
}

export function closeEmployeeSelectionModal() {
    if (DOMElements.employeeSelectionModal) {
        DOMElements.employeeSelectionModal.classList.add('hidden');
    }
}

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

export function closeVacationModal() {
    DOMElements.vacationModal.classList.add('hidden');
}

export function displayDifferences(differences) {
    const displayArea = DOMElements.differencesDisplay;
    const container = DOMElements.differencesContainer;
    const statusArea = document.getElementById('differences-modal-status');
    const importBtn = DOMElements.importSelectedHilanetShiftsBtn;
    const downloadBtn = document.getElementById('download-differences-btn');

    if (!displayArea || !container || !statusArea || !importBtn || !downloadBtn) {
        console.error("One or more differences elements are missing from the DOM.");
        return;
    }

    displayArea.innerHTML = '';

    if (differences.length === 0) {
        statusArea.textContent = 'לא נמצאו פערים בין סידור העבודה לקובץ חילנט.';
        displayArea.innerHTML = '<p class="text-center p-4">הכל מעודכן! ✅</p>';
        importBtn.style.display = 'none';
        downloadBtn.style.display = 'none';
    } else {
        statusArea.textContent = `נמצאו ${differences.length} פערים:`;
        importBtn.style.display = 'inline-block';
        downloadBtn.style.display = 'inline-block';

        const table = document.createElement('table');
        table.className = 'w-full border-collapse';
        table.innerHTML = `
            <thead>
                <tr class="bg-slate-100 text-slate-800">
                    <th class="p-2 border border-slate-300 w-10">
                        <div class="flex items-center justify-center">
                            <input type="checkbox" id="select-all-differences" class="h-4 w-4 text-blue-600 rounded">
                        </div>
                    </th>
                    <th class="p-2 border border-slate-300">סוג שינוי</th>
                    <th class="p-2 border border-slate-300">תאריך</th>
                    <th class="p-2 border border-slate-300">משמרת</th>
                    <th class="p-2 border border-slate-300">סידור נוכחי</th>
                    <th class="p-2 border border-slate-300">סידור חילנט</th>
                </tr>
            </thead>
            <tbody></tbody>
        `;

        const tbody = table.querySelector('tbody');
        differences.forEach(diff => {
            const row = tbody.insertRow();
            let rowClass = 'hover:bg-slate-100';
            let typeHebrew = '';

            switch(diff.type) {
                case 'added':
                    rowClass = 'bg-green-100 hover:bg-green-200';
                    typeHebrew = 'קיים בחילנט בלבד';
                    break;
                case 'removed':
                    rowClass = 'bg-red-100 hover:bg-red-200';
                    typeHebrew = 'קיים במערכת בלבד';
                    break;
                case 'changed':
                    rowClass = 'bg-yellow-100 hover:bg-yellow-200';
                    typeHebrew = 'שונה';
                    break;
            }
            row.className = rowClass;

            const formatDetails = (shift) => shift ? `${shift.employee} (${shift.start.substring(0, 5)}-${shift.end.substring(0, 5)})` : '—';
            
            const gsDetails = formatDetails(diff.googleSheets);
            const hlDetails = formatDetails(diff.hilanet);

            const canImport = diff.type === 'added' || diff.type === 'changed';
            const checkboxHTML = canImport 
                ? `<input type="checkbox" class="difference-checkbox h-4 w-4 text-blue-600 rounded" data-diff-id="${diff.id}">`
                : '';

            row.innerHTML = `
                <td class="p-2 border border-slate-300 text-center">${checkboxHTML}</td>
                <td class="p-2 border border-slate-300 font-medium">${typeHebrew}</td>
                <td class="p-2 border border-slate-300">${formatDate(diff.date, { day: '2-digit', month: '2-digit' })} (${diff.dayName})</td>
                <td class="p-2 border border-slate-300">${diff.shiftType === 'morning' ? 'בוקר' : 'ערב'}</td>
                <td class="p-2 border border-slate-300">${gsDetails}</td>
                <td class="p-2 border border-slate-300">${hlDetails}</td>
            `;
        });

        displayArea.appendChild(table);
        
        const selectAllCheckbox = document.getElementById('select-all-differences');
        if (selectAllCheckbox) {
            selectAllCheckbox.addEventListener('change', (e) => {
                const checkboxes = document.querySelectorAll('.difference-checkbox');
                checkboxes.forEach(checkbox => {
                    checkbox.checked = e.target.checked;
                });
            });
        }
    }

    container.classList.remove('hidden');
}

export function hideDifferencesContainer() {
    if (DOMElements.differencesContainer) {
        DOMElements.differencesContainer.classList.add('hidden');
    }
}