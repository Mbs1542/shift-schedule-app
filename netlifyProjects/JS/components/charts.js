import { DAYS } from "../config.js";
import { updateStatus, DOMElements, allSchedules, getWeeklyShiftChartInstance, setWeeklyShiftChartInstance, getMonthlySummaryChartInstance, setMonthlySummaryChartInstance } from "../main.js";
import { getWeekId, formatDate, getWeekDates, formatMonthYear } from "../utils.js";

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

    // Toggle visibility of the chart section
    const isHidden = DOMElements.chartCard.classList.contains('hidden');

    if (isHidden) {
        // Show weekly chart
        DOMElements.chartCard.classList.remove('hidden');
        // Set default employee for the monthly chart and trigger the update
        DOMElements.monthlySummaryEmployeeSelect.value = 'מאור';
        updateMonthlySummaryChart(); // This will also show the monthly chart card

        // ---  THIS IS THE NEW CODE FOR SMOOTH SCROLLING ---
        // Scroll to the chart card after it's made visible
        setTimeout(() => {
            DOMElements.chartCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 100); // A small delay ensures the element is rendered before scrolling

    } else {
        // Hide both charts
        DOMElements.chartCard.classList.add('hidden');
        DOMElements.monthlySummaryChartCard.classList.add('hidden');
        // Reset the dropdown when hiding
        DOMElements.monthlySummaryEmployeeSelect.value = '';
        updateStatus('', 'info', false); // Clear status
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
            if (!employeeShiftCounts[emp]) employeeShiftCounts[emp] = {
                morning: 0,
                evening: 0
            };
            employeeShiftCounts[emp].morning += 1;
        }
        if (day !== 'שישי' && dayData.evening && dayData.evening.employee && dayData.evening.employee !== 'none') {
            const emp = dayData.evening.employee;
            if (!employeeShiftCounts[emp]) employeeShiftCounts[emp] = {
                morning: 0,
                evening: 0
            };
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
                    title: {
                        display: true,
                        text: 'מספר משמרות'
                    },
                    ticks: {
                        stepSize: 1
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'עובדים'
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                },
                title: {
                    display: true,
                    text: `התפלגות משמרות לשבוע של ${formatDate(new Date(weekId))}`
                }
            }
        }
    };

    const ctx = document.getElementById('shift-chart').getContext('2d');
    if (getWeeklyShiftChartInstance()) getWeeklyShiftChartInstance().destroy(); // Destroy previous instance
    const newWeeklyChart = new Chart(ctx, chartConfig);
    setWeeklyShiftChartInstance(newWeeklyChart);


    updateStatus('גרף המשמרות הוצג בהצלחה!', 'success', false);
}

export function updateMonthlySummaryChart() {
    const selectedEmployee = DOMElements.monthlySummaryEmployeeSelect.value;
    if (!selectedEmployee) {
        if (getMonthlySummaryChartInstance()) getMonthlySummaryChartInstance().destroy();
        setMonthlySummaryChartInstance(null);
        DOMElements.monthlySummaryChartCard.classList.add('hidden');
        return;
    }

    const monthlyData = {}; // { 'YYYY-MM': { morning: X, evening: Y, totalHours: Z } }


    // Populate monthlyData from allSchedules
    for (const weekId in allSchedules) {
        if (allSchedules.hasOwnProperty(weekId)) {
            const weekData = allSchedules[weekId];
            const weekDates = getWeekDates(new Date(weekId));

            weekDates.forEach(dateObj => {
                const monthYearKey = dateObj.toISOString().substring(0, 7); // YYYY-MM
                const dayName = DAYS[dateObj.getDay()];
                const dayData = weekData[dayName] || {};

                if (!monthlyData[monthYearKey]) {
                    monthlyData[monthYearKey] = {
                        morning: 0,
                        evening: 0,
                        totalHours: 0
                    };
                }

                if (dayData.morning && dayData.morning.employee === selectedEmployee) {
                    monthlyData[monthYearKey].morning += 1;
                    monthlyData[monthYearKey].totalHours += calculateHours(dayData.morning.start, dayData.morning.end);
                }
                if (dayName !== 'שישי' && dayData.evening && dayData.evening.employee === selectedEmployee) {
                    monthlyData[monthYearKey].evening += 1;
                    monthlyData[monthYearKey].totalHours += calculateHours(dayData.evening.start, dayData.evening.end);
                }
            });
        }
    }

    const sortedMonths = Object.keys(monthlyData).sort();

    if (sortedMonths.length === 0) {
        updateStatus(`לא נמצאו נתונים חודשיים עבור ${selectedEmployee}.`, 'info');
        DOMElements.monthlySummaryChartCard.classList.add('hidden');
        if (getMonthlySummaryChartInstance()) getMonthlySummaryChartInstance().destroy();
        setMonthlySummaryChartInstance(null);
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
                    title: {
                        display: true,
                        text: 'מספר משמרות'
                    },
                    ticks: {
                        stepSize: 1
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'חודש'
                    }
                }
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                },
                title: {
                    display: true,
                    text: `סיכום חודשי ל${selectedEmployee} (סה"כ: ${totalHoursForAllMonths.toFixed(2)} שעות)`
                }
            }
        }
    };

    const ctx = document.getElementById('monthly-summary-chart').getContext('2d');
    if (getMonthlySummaryChartInstance()) getMonthlySummaryChartInstance().destroy();
    const newMonthlyChart = new Chart(ctx, chartConfig);
    setMonthlySummaryChartInstance(newMonthlyChart);
    DOMElements.monthlySummaryChartCard.classList.remove('hidden');
}