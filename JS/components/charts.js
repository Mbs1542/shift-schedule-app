import { DAYS } from "../config.js";
import { updateStatus, DOMElements, allSchedules, displayAPIError, setupMonthlyChartEventListeners } from "../main.js";
import { getWeekId, formatDate, getWeekDates, formatMonthYear, setButtonLoading, restoreButton } from "../utils.js";

let weeklyChart = null;
let monthlySummaryChart = null;

/** Helper function to calculate duration in hours between two time strings (HH:MM:SS) */
function calculateHours(start, end) {
    if (!start || !end) return 0;
    try {
        const startTime = new Date(`1970-01-01T${start}`);
        const endTime = new Date(`1970-01-01T${end}`);
        if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) return 0;
        let diff = (endTime - startTime) / (1000 * 60 * 60);
        if (diff < 0) diff += 24; // Handle overnight shifts if ever needed
        return diff;
    } catch (e) {
        console.error("Error calculating hours", e);
        return 0;
    }
}

/** * [FIXED] Displays charts and ensures the monthly summary opens on the first click.
 */
export async function handleShowChart() {
    if (gapi.client.getToken() === null) {
        updateStatus('יש להתחבר עם חשבון Google כדי לבצע פעולה זו.', 'info', false);
        return;
    }

    const button = DOMElements.showChartBtn;
    setButtonLoading(button);

    try {
        const isHidden = DOMElements.chartCard.classList.contains('hidden');

        if (!isHidden) { 
            DOMElements.chartCard.classList.add('hidden');
            DOMElements.monthlySummaryChartCard.classList.add('hidden');
            DOMElements.monthlySummaryEmployeeSelect.value = '';
            DOMElements.monthlyAnalysisContainer.classList.add('hidden');
            destroyAllCharts();
            updateStatus('', 'info', false);
            return;
        }

        // --- Weekly Chart Logic ---
        DOMElements.chartCard.classList.remove('hidden');
        const weekId = getWeekId(DOMElements.datePicker.value);
        const scheduleDataForWeek = allSchedules[weekId] || {};
        const employeeShiftCounts = {};
        const daysToCheck = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];

        daysToCheck.forEach(day => {
            const dayData = scheduleDataForWeek[day] || {};
            ['morning', 'evening'].forEach(shiftType => {
                if (day === 'שישי' && shiftType === 'evening') return;
                
                const shift = dayData[shiftType];
                if (shift && shift.employee && shift.employee !== 'none') {
                    const emp = shift.employee;
                    if (!employeeShiftCounts[emp]) employeeShiftCounts[emp] = { morning: 0, evening: 0 };
                    employeeShiftCounts[emp][shiftType]++;
                }
            });
        });

        const employees = Object.keys(employeeShiftCounts);
        const weeklyChartCanvas = document.getElementById('shift-chart');

        if (employees.length === 0) {
            updateStatus('אין משמרות משובצות לשבוע זה להצגה בגרף.', 'info', false);
            if (weeklyChart) weeklyChart.destroy();
            weeklyChart = null;
            if(weeklyChartCanvas) weeklyChartCanvas.style.display = 'none';
        } else {
            if(weeklyChartCanvas) weeklyChartCanvas.style.display = 'block';

            const morningData = employees.map(emp => employeeShiftCounts[emp].morning);
            const eveningData = employees.map(emp => employeeShiftCounts[emp].evening);
            
            const isDarkMode = document.documentElement.classList.contains('dark');
            const gridColor = isDarkMode ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
            const textColor = isDarkMode ? '#e5e7eb' : '#374151';

            const chartConfig = {
                type: 'bar',
                data: {
                    labels: employees,
                    datasets: [{
                        label: 'משמרות בוקר',
                        data: morningData,
                        backgroundColor: '#3B82F6'
                    }, {
                        label: 'משמרות ערב',
                        data: eveningData,
                        backgroundColor: '#8B5CF6'
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    scales: {
                        y: { beginAtZero: true, title: { display: true, text: 'מספר משמרות', color: textColor }, ticks: { stepSize: 1, color: textColor }, grid: { color: gridColor } },
                        x: { title: { display: true, text: 'עובדים', color: textColor }, ticks: { color: textColor }, grid: { color: gridColor } }
                    },
                    plugins: {
                        legend: { display: true, position: 'top', labels: { color: textColor } },
                        title: { display: true, text: `התפלגות משמרות לשבוע של ${formatDate(new Date(weekId))}`, color: textColor, font: { size: 16 } }
                    }
                }
            };
            const ctx = weeklyChartCanvas.getContext('2d');
            if (weeklyChart) weeklyChart.destroy();
            weeklyChart = new Chart(ctx, chartConfig);
        }

        // --- Monthly Summary Logic (FIXED FOR IMMEDIATE DISPLAY) ---
        DOMElements.monthlySummaryEmployeeSelect.value = 'מאור'; 
        DOMElements.monthlySummaryChartCard.classList.remove('hidden'); // Ensure card is visible
        DOMElements.monthlyAnalysisContainer.classList.add('hidden'); // Hide old analysis
        
        populateMonthSelector(); // Populate months for default user
        await updateMonthlySummaryChart(); // Draw chart for default selection
        setupMonthlyChartEventListeners();

        setTimeout(() => {
            DOMElements.chartCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);

        updateStatus('גרפים הוצגו בהצלחה!', 'success', false);

    } catch(error) {
        displayAPIError(error, 'שגיאה בהצגת הגרפים.');
        DOMElements.chartCard.classList.add('hidden');
        DOMElements.monthlySummaryChartCard.classList.add('hidden');
    } finally {
        restoreButton(button);
    }
}


/**
 * [FIXED & VERIFIED] Collects and aggregates monthly data for a single employee.
 * This function is the single source of truth for both the monthly chart and the AI analysis,
 * ensuring data consistency by correctly filtering shifts by the provided employee name.
 * @param {string} employeeName - The name of the employee to get data for.
 * @returns {Object} An object containing aggregated monthly data for that employee.
 */
function getMonthlyDataForEmployee(employeeName) {
    const monthlyData = {};

    // Iterate through all weeks in the stored schedules
    for (const weekId in allSchedules) {
        const weekData = allSchedules[weekId];
        const weekDates = getWeekDates(new Date(weekId));

        // Iterate through each day of the week
        weekDates.forEach(dateObj => {
            const dayName = DAYS[dateObj.getDay()];
            const dayData = weekData[dayName] || {};
            const monthYearKey = dateObj.toISOString().substring(0, 7); // YYYY-MM

            // Iterate through morning and evening shifts
            ['morning', 'evening'].forEach(shiftType => {
                const shift = dayData[shiftType];

                // **CRITICAL LOGIC**: Check if the shift exists AND belongs to the specified employee.
                if (shift && shift.employee === employeeName) {
                    
                    // Initialize the data structure for the month if it doesn't exist
                    if (!monthlyData[monthYearKey]) {
                        monthlyData[monthYearKey] = { morning: 0, evening: 0, totalHours: 0, shifts: [] };
                    }
                    
                    const duration = calculateHours(shift.start, shift.end);
                    
                    // Aggregate the data
                    monthlyData[monthYearKey][shiftType] += 1;
                    monthlyData[monthYearKey].totalHours += duration;
                    monthlyData[monthYearKey].shifts.push({
                        date: dateObj.toISOString().split('T')[0],
                        dayName: dayName,
                        shiftType: shiftType,
                        start: shift.start,
                        end: shift.end,
                        duration: duration
                    });
                }
            });
        });
    }
    return monthlyData;
}


/** Populates the month selector dropdown based on the selected employee's data. */
export function populateMonthSelector() {
    const selectedEmployee = DOMElements.monthlySummaryEmployeeSelect.value;
    const monthSelect = DOMElements.monthlySummaryMonthSelect;
    const monthContainer = DOMElements.monthSelectorContainer;

    monthSelect.innerHTML = ''; 
    DOMElements.monthlyAnalysisContainer.classList.add('hidden');
    
    if (!selectedEmployee) {
        monthContainer.classList.add('hidden');
        if (monthlySummaryChart) monthlySummaryChart.destroy();
        return;
    }

    const monthlyData = getMonthlyDataForEmployee(selectedEmployee);
    const sortedMonths = Object.keys(monthlyData).sort().reverse();

    if (sortedMonths.length === 0) {
        monthContainer.classList.add('hidden');
        if (monthlySummaryChart) monthlySummaryChart.destroy();
        DOMElements.monthlySummaryChartCard.classList.add('hidden');
        return;
    }

    sortedMonths.forEach(monthKey => {
        const option = document.createElement('option');
        option.value = monthKey;
        option.textContent = formatMonthYear(monthKey);
        monthSelect.appendChild(option);
    });

    monthContainer.classList.remove('hidden');
}


/** Updates the monthly summary chart for the selected employee and month. */
export async function updateMonthlySummaryChart() {
    const selectedEmployee = DOMElements.monthlySummaryEmployeeSelect.value;
    const selectedMonth = DOMElements.monthlySummaryMonthSelect.value;
    DOMElements.monthlyAnalysisContainer.classList.add('hidden');
    
    if (!selectedEmployee || !selectedMonth) {
        if (monthlySummaryChart) monthlySummaryChart.destroy();
        monthlySummaryChart = null;
        DOMElements.monthlySummaryChartCard.classList.add('hidden');
        return;
    }

    const allMonthlyData = getMonthlyDataForEmployee(selectedEmployee);
    const dataForMonth = allMonthlyData[selectedMonth];

    if (!dataForMonth || dataForMonth.shifts.length === 0) {
        updateStatus(`לא נמצאו נתונים עבור ${selectedEmployee} בחודש ${formatMonthYear(selectedMonth)}.`, 'info');
        if (monthlySummaryChart) monthlySummaryChart.destroy();
        monthlySummaryChart = null;
        // Hide only the chart canvas, not the entire card, so controls remain visible.
        const canvas = document.getElementById('monthly-summary-chart');
        if (canvas) canvas.style.display = 'none'; 
        return;
    } else {
        const canvas = document.getElementById('monthly-summary-chart');
        if (canvas) canvas.style.display = 'block';
    }
    
    const isDarkMode = document.documentElement.classList.contains('dark');
    const textColor = isDarkMode ? '#e5e7eb' : '#374151';

    const totalShifts = dataForMonth.morning + dataForMonth.evening;
    const titleText = `סיכום ל${selectedEmployee} - ${formatMonthYear(selectedMonth)} (סה"כ: ${totalShifts} משמרות, ${dataForMonth.totalHours.toFixed(2)} שעות)`;

    const chartConfig = {
        type: 'doughnut',
        data: {
            labels: ['משמרות בוקר', 'משמרות ערב'],
            datasets: [{
                label: 'כמות משמרות',
                data: [dataForMonth.morning, dataForMonth.evening],
                backgroundColor: ['#3B82F6', '#8B5CF6'],
                borderColor: [isDarkMode ? '#374151' : '#fff'],
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { 
                    position: 'top',
                    labels: { color: textColor }
                },
                title: { 
                    display: true, 
                    text: titleText,
                    color: textColor,
                    font: { size: 16 }
                }
            }
        }
    };

    const ctx = document.getElementById('monthly-summary-chart').getContext('2d');
    if (monthlySummaryChart) monthlySummaryChart.destroy();
    monthlySummaryChart = new Chart(ctx, chartConfig);
    DOMElements.monthlySummaryChartCard.classList.remove('hidden');
}

/** Exports the monthly summary data for the selected employee to a CSV file. */
export function handleExportMonthlySummary() {
    const selectedEmployee = DOMElements.monthlySummaryEmployeeSelect.value;
    const selectedMonth = DOMElements.monthlySummaryMonthSelect.value;

    if (!selectedEmployee || !selectedMonth) {
        updateStatus('יש לבחור עובד וחודש לייצוא.', 'info');
        return;
    }

    const allMonthlyData = getMonthlyDataForEmployee(selectedEmployee);
    const dataToExport = allMonthlyData[selectedMonth];

    if (!dataToExport || dataToExport.shifts.length === 0) {
        updateStatus(`לא נמצאו נתונים לייצוא עבור ${selectedEmployee} בחודש הנבחר.`, 'info');
        return;
    }

    let csvContent = "data:text/csv;charset=utf-8,\uFEFF"; 
    csvContent += "Date,Day,Shift Type,Start Time,End Time,Duration (Hours)\n";

    dataToExport.shifts.forEach(shift => {
        const row = [shift.date, shift.dayName, shift.shiftType, shift.start, shift.end, shift.duration.toFixed(2)];
        csvContent += row.join(",") + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `monthly_summary_${selectedEmployee}_${selectedMonth}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    updateStatus('הנתונים יוצאו בהצלחה.', 'success');
}

/** Analyzes the selected month's data using an AI model. */
export async function handleAnalyzeMonth() {
    const selectedEmployee = DOMElements.monthlySummaryEmployeeSelect.value;
    const selectedMonth = DOMElements.monthlySummaryMonthSelect.value;

    if (!selectedEmployee || !selectedMonth) {
        updateStatus('יש לבחור עובד וחודש לניתוח.', 'info');
        return;
    }

    const allMonthlyData = getMonthlyDataForEmployee(selectedEmployee);
    const dataToAnalyze = allMonthlyData[selectedMonth];

    if (!dataToAnalyze || dataToAnalyze.shifts.length === 0) {
        updateStatus(`לא נמצאו נתונים לניתוח עבור ${selectedEmployee} בחודש הנבחר.`, 'info');
        return;
    }
    
    const button = DOMElements.analyzeMonthlySummaryBtn;
    setButtonLoading(button, 'מנתח...');

    updateStatus('מנתח את החודש עם AI...', 'loading', true);
    DOMElements.monthlyAnalysisContainer.classList.add('hidden');

    try {
        const response = await fetch('/.netlify/functions/analyze-month', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                employee: selectedEmployee,
                month: selectedMonth,
                shifts: dataToAnalyze.shifts 
            })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to get analysis');
        }

        const result = await response.json();
        DOMElements.monthlyAnalysisContent.textContent = result.analysis;
        DOMElements.monthlyAnalysisContainer.classList.remove('hidden');
        updateStatus('ניתוח החודש הושלם.', 'success');

    } catch (error) {
        displayAPIError(error, 'שגיאה בקבלת ניתוח חודשי.');
        DOMElements.monthlyAnalysisContent.textContent = 'לא ניתן היה לקבל ניתוח כרגע.';
        DOMElements.monthlyAnalysisContainer.classList.remove('hidden');
    } finally {
        restoreButton(button);
    }
}


export function destroyAllCharts() {
    if (weeklyChart) {
        weeklyChart.destroy();
        weeklyChart = null;
    }
    if (monthlySummaryChart) {
        monthlySummaryChart.destroy();
        monthlySummaryChart = null;
    }
}