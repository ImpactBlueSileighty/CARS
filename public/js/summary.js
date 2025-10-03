// public/js/summary.js

document.addEventListener("DOMContentLoaded", () => {
    
    const summaryDateInput = document.getElementById('summaryDate');
    
    async function updateSummaryStatistics(date) {
        try {
            const res = await fetch(`/api/statistics/summary?date=${date}`);
            if (!res.ok) throw new Error('Ошибка сети');
            
            const summary = await res.json();

            document.getElementById('dailyCount').textContent = summary.finished_on_date;
            document.getElementById('totalFinished').textContent = summary.total_finished;

        } catch (error) {
            console.error("Не удалось загрузить сводку:", error);
            // Можно добавить отображение ошибки в UI
            document.getElementById('dailyCount').textContent = '—';
            document.getElementById('totalFinished').textContent = '—';
        }
    }

    // Инициализация при загрузке страницы
    const today = new Date().toLocaleDateString('sv-SE');
    summaryDateInput.value = today;
    updateSummaryStatistics(today);

    // Обновление при смене даты в календаре
    summaryDateInput.addEventListener('change', () => {
        updateSummaryStatistics(summaryDateInput.value);
    });
});