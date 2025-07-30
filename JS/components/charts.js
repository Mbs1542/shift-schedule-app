import { DAYS } from "../config.js";
import { updateStatus, DOMElements, allSchedules, displayAPIError } from "../main.js";
import { getWeekId, formatDate, getWeekDates, formatMonthYear } from "../utils.js";

let weeklyChart = null;
let monthlySummaryChart = null;

/** Helper function to calculate duration in hours between two time strings (HH:MM:SS) */
function calculateHours(start, end) {
    if (!start || !end) return 0;
    try {
        const startTime = new Date(`1970-01-01T${start}`);
        const endTime = new Date(`1970-01-01T${end}`);
        if (isNaN(startTime.getTime()) || isNaN(endTime.getTime())) return 0;
        return (endTime - startTime) / (1000 * 60 * 60);
    } catch (e) {
        console.error("Error calculating hours", e);
        return 0;
    }
}

/** Displays a bar chart showing shift distribution per employee for the current week. */
export async function handleShowChart() {
    if (gapi.client.getToken() === null) {
        updateStatus('יש להתחבר עם חשבון Google כדי לבצע פעולה זו.', 'info', false);
        return;
    }

    const isHidden = DOMElements.chartCard.classList.contains('hidden');

    if (isHidden) {
        DOMElements.chartCard.classList.remove('hidden');
        DOMElements.monthlySummaryEmployeeSelect.value = 'מאור';
        updateMonthlySummaryChart();

        setTimeout(() => {
            DOMElements.chartCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100);

    } else {
        DOMElements.chartCard.classList.add('hidden');
        DOMElements.monthlySummaryChartCard.classList.add('hidden');
        DOMElements.monthlySummaryEmployeeSelect.value = '';
        updateStatus('', 'info', false);
        return;
    }


    const weekId = getWeekId(DOMElements.datePicker.value);
    const scheduleDataForWeek = allSchedules[weekId] || {};
    const employeeShiftCounts = {};

    const daysToCheck = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי'];

    daysToCheck.forEach(day => {
        const dayData = scheduleDataForWeek[day] || {};
        if (dayData.morning && dayData.morning.employee && dayData.morning.employee !== 'none') {
            const emp = dayData.morning.employee;
            if (!employeeShiftCounts[emp]) employeeShiftCounts[emp] = { morning: 0, evening: 0 };
            employeeShiftCounts[emp].morning += 1;
        }
        if (day !== 'שישי' && dayData.evening && dayData.evening.employee && dayData.evening.employee !== 'none') {
            const emp = dayData.evening.employee;
            if (!employeeShiftCounts[emp]) employeeShiftCounts[emp] = { morning: 0, evening: 0 };
            employeeShiftCounts[emp].evening += 1;
        }
    });

    const employees = Object.keys(employeeShiftCounts);
    if (employees.length === 0) {
        updateStatus('אין משמרות משובצות לשבוע זה להצגה בגרף.', 'info', false);
        DOMElements.chartCard.classList.add('hidden');
        return;
    }

    const morningData = employees.map(emp => employeeShiftCounts[emp].morning);
    const eveningData = employees.map(emp => employeeShiftCounts[emp].evening);

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
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'מספר משמרות' },
                    ticks: { stepSize: 1 }
                },
                x: {
                    title: { display: true, text: 'עובדים' }
                }
            },
            plugins: {
                legend: { display: true, position: 'top' },
                title: { display: true, text: `התפלגות משמרות לשבוע של ${formatDate(new Date(weekId))}` }
            }
        }
    };

    const ctx = document.getElementById('shift-chart').getContext('2d');
    if (weeklyChart) weeklyChart.destroy();
    weeklyChart = new Chart(ctx, chartConfig);


    updateStatus('גרף המשמרות הוצג בהצלחה!', 'success', false);
}

/** Helper function to gather all monthly data for an employee */
function getMonthlyDataForEmployee(employeeName) {
    const monthlyData = {};

    for (const weekId in allSchedules) {
        const weekData = allSchedules[weekId];
        const weekDates = getWeekDates(new Date(weekId));

        weekDates.forEach(dateObj => {
            const monthYearKey = dateObj.toISOString().substring(0, 7); // YYYY-MM
            const dayName = DAYS[dateObj.getDay()];
            const dayData = weekData[dayName] || {};

            if (!monthlyData[monthYearKey]) {
                monthlyData[monthYearKey] = { morning: 0, evening: 0, totalHours: 0, shifts: [] };
            }

            ['morning', 'evening'].forEach(shiftType => {
                if (dayData[shiftType] && dayData[shiftType].employee === employeeName) {
                    const shift = dayData[shiftType];
                    const duration = calculateHours(shift.start, shift.end);
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


export function updateMonthlySummaryChart() {
    const selectedEmployee = DOMElements.monthlySummaryEmployeeSelect.value;
    if (!selectedEmployee) {
        if (monthlySummaryChart) monthlySummaryChart.destroy();
        monthlySummaryChart = null;
        DOMElements.monthlySummaryChartCard.classList.add('hidden');
        return;
    }

    const monthlyData = getMonthlyDataForEmployee(selectedEmployee);
    const sortedMonths = Object.keys(monthlyData).sort();

    if (sortedMonths.length === 0) {
        updateStatus(`לא נמצאו נתונים חודשיים עבור ${selectedEmployee}.`, 'info');
        DOMElements.monthlySummaryChartCard.classList.add('hidden');
        if (monthlySummaryChart) monthlySummaryChart.destroy();
        monthlySummaryChart = null;
        return;
    }

    const totalHoursForAllMonths = sortedMonths.reduce((total, month) => total + monthlyData[month].totalHours, 0);
    const formattedLabels = sortedMonths.map(formatMonthYear);
    const monthlyMorningData = sortedMonths.map(month => monthlyData[month].morning);
    const monthlyEveningData = sortedMonths.map(month => monthlyData[month].evening);

    const chartConfig = {
        type: 'bar',
        data: {
            labels: formattedLabels,
            datasets: [{
                label: 'משמרות בוקר',
                data: monthlyMorningData,
                backgroundColor: '#3B82F6'
            }, {
                label: 'משמרות ערב',
                data: monthlyEveningData,
                backgroundColor: '#8B5CF6'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    title: { display: true, text: 'מספר משמרות' },
                    ticks: { stepSize: 1 }
                },
                x: {
                    title: { display: true, text: 'חודש' }
                }
            },
            plugins: {
                legend: { display: true, position: 'top' },
                title: { display: true, text: `סיכום חודשי ל${selectedEmployee} (סה"כ: ${totalHoursForAllMonths.toFixed(2)} שעות)` }
            }
        }
    };

    const ctx = document.getElementById('monthly-summary-chart').getContext('2d');
    if (monthlySummaryChart) monthlySummaryChart.destroy();
    monthlySummaryChart = new Chart(ctx, chartConfig);
    DOMElements.monthlySummaryChartCard.classList.remove('hidden');
}

/** ### חדש: ייצוא סיכום חודשי לקובץ CSV ### */
export function handleExportMonthlySummary() {
    const selectedEmployee = DOMElements.monthlySummaryEmployeeSelect.value;
    if (!selectedEmployee) {
        updateStatus('יש לבחור עובד לייצוא.', 'info');
        return;
    }

    const monthlyData = getMonthlyDataForEmployee(selectedEmployee);
    const sortedMonths = Object.keys(monthlyData).sort();

    if (sortedMonths.length === 0) {
        updateStatus(`לא נמצאו נתונים לייצוא עבור ${selectedEmployee}.`, 'info');
        return;
    }

    let csvContent = "data:text/csv;charset=utf-8,\uFEFF"; // \uFEFF for BOM to support Hebrew in Excel
    csvContent += "Date,Day,Shift Type,Start Time,End Time,Duration (Hours)\n";

    sortedMonths.forEach(monthKey => {
        monthlyData[monthKey].shifts.forEach(shift => {
            const row = [shift.date, shift.dayName, shift.shiftType, shift.start, shift.end, shift.duration.toFixed(2)];
            csvContent += row.join(",") + "\n";
        });
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `monthly_summary_${selectedEmployee}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    updateStatus('הנתונים יוצאו בהצלחה.', 'success');
}

/** ### חדש: קבלת ניתוח חודשי מ-AI ### */
export async function handleAnalyzeMonth() {
    const selectedEmployee = DOMElements.monthlySummaryEmployeeSelect.value;
    if (!selectedEmployee) {
        updateStatus('יש לבחור עובד לניתוח.', 'info');
        return;
    }

    const monthlyData = getMonthlyDataForEmployee(selectedEmployee);
    const sortedMonths = Object.keys(monthlyData).sort();
    
    if (sortedMonths.length === 0) {
        updateStatus(`לא נמצאו נתונים לניתוח עבור ${selectedEmployee}.`, 'info');
        return;
    }
    
    const latestMonthKey = sortedMonths[sortedMonths.length - 1];
    const dataToAnalyze = monthlyData[latestMonthKey];

    updateStatus('מנתח את החודש עם AI...', 'loading', true);
    DOMElements.monthlyAnalysisContainer.classList.add('hidden');

    try {
        const response = await fetch('/.netlify/functions/analyze-month', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
                employee: selectedEmployee,
                month: latestMonthKey,
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
