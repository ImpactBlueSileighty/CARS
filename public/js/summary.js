document.addEventListener("DOMContentLoaded", () => {
    
    // --- 1. Элементы DOM ---
    const statsTableBody = document.getElementById('statsTableBody');
    const statsTableFoot = document.getElementById('statsTableFoot');
    const trackerTableBody = document.getElementById('trackerTableBody');
    const exportBtn = document.getElementById('exportBtn');
    const numberFilter = document.getElementById('numberFilter');
    const supplierFilter = document.getElementById('supplierFilter');
    const bplaFilter = document.getElementById('bplaFilter');

    // --- 2. Загрузка данных ---

    /**
     * Загружает и отображает главную статистику (поставщики/статусы)
     */
    async function loadStatistics() {
        try {
            const res = await fetch('/api/summary/statistics');
            if (!res.ok) throw new Error('Ошибка сети при загрузке статистики');
            const data = await res.json();
            
            renderStatistics(data);
        } catch (error) {
            console.error("Не удалось загрузить статистику:", error);
            statsTableBody.innerHTML = `<tr><td colspan="5" class="error">Ошибка загрузки статистики</td></tr>`;
        }
    }

    /**
     * Загружает и отображает список бортов в работе (трекер)
     */
    async function loadBoardTracker() {
        const filters = {
            number: numberFilter.value,
            supplier_id: supplierFilter.value || null,
            bpla_id: bplaFilter.value || null
        };

        try {
            const res = await fetch('/api/summary/board-tracker', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(filters)
            });
            if (!res.ok) throw new Error('Ошибка сети при загрузке трекера');
            const data = await res.json();
            
            renderBoardTracker(data);
        } catch (error) {
            console.error("Не удалось загрузить трекер:", error);
            trackerTableBody.innerHTML = `<tr><td colspan="5" class="error">Ошибка загрузки данных</td></tr>`;
        }
    }

    /**
     * Загружает списки для фильтров (Поставщики, БПЛА)
     */
    async function loadFilterOptions() {
        try {
            // Загрузка Поставщиков
            const supRes = await fetch('/api/suppliers');
            const suppliers = await supRes.json();
            suppliers.forEach(s => supplierFilter.add(new Option(s.name, s.id)));

            // Загрузка БПЛА
            const bplaRes = await fetch('/api/bpla');
            const bplaTypes = await bplaRes.json();
            bplaTypes.forEach(b => bplaFilter.add(new Option(b.name, b.id)));

        } catch (error) {
            console.error("Ошибка загрузки опций фильтра:", error);
        }
    }

    // --- 3. Отрисовка (Render) ---

    function renderStatistics(data) {
        statsTableBody.innerHTML = '';
        let total = {
            today_finished: 0,
            total_finished: 0,
            total_in_progress: 0,
            total_semifinished: 0
        };

        data.forEach(row => {
            // Суммируем итоги
            total.today_finished += parseInt(row.today_finished, 10);
            total.total_finished += parseInt(row.total_finished, 10);
            total.total_in_progress += parseInt(row.total_in_progress, 10);
            total.total_semifinished += parseInt(row.total_semifinished, 10);

            // Рендерим строку
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${row.supplier_name}</td>
                <td class="stat-today">${row.today_finished > 0 ? `+${row.today_finished}` : '0'}</td>
                <td class="stat-total">${row.total_finished}</td>
                <td class="stat-progress">${row.total_in_progress}</td>
                <td class="stat-semifinished">${row.total_semifinished}</td>
            `;
            statsTableBody.appendChild(tr);
        });

        // Рендерим ИТОГО (tfoot)
        statsTableFoot.innerHTML = `
            <tr class="summary-total-row">
                <td>ИТОГО</td>
                <td class="stat-today">${total.today_finished > 0 ? `+${total.today_finished}` : '0'}</td>
                <td class="stat-total">${total.total_finished}</td>
                <td class="stat-progress">${total.total_in_progress}</td>
                <td class="stat-semifinished">${total.total_semifinished}</td>
            </tr>
        `;
    }

    function renderBoardTracker(data) {
        trackerTableBody.innerHTML = '';
        if (data.length === 0) {
            trackerTableBody.innerHTML = `<tr><td colspan="5">Все борты в работе завершены!</td></tr>`;
            return;
        }

        const formatDate = (dateStr) => dateStr ? new Date(dateStr).toLocaleDateString('ru-RU') : 'N/A';

        data.forEach(board => {
            const tr = document.createElement('tr');
            // Добавляем класс в зависимости от статуса
            tr.classList.add(board.status === 'semifinished' ? 'is-semifinished' : 'is-in-progress');
            
            tr.innerHTML = `
                <td>${board.number}</td>
                <td>${board.bpla_name || 'N/A'}</td>
                <td>${board.supplier_name || 'N/A'}</td>
                <td>${formatDate(board.creation_date)}</td>
                <td class="location-cell">${board.location}</td>
            `;
            trackerTableBody.appendChild(tr);
        });
    }

    async function exportToExcel() {
        const filters = {
            number: numberFilter.value,
            supplier_id: supplierFilter.value || null,
            bpla_id: bplaFilter.value || null
        };
        
        // Показываем состояние загрузки
        const originalText = exportBtn.innerHTML;
        exportBtn.innerHTML = 'Загрузка...';
        exportBtn.disabled = true;

        try {
            const res = await fetch('/api/summary/export', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(filters)
            });

            if (!res.ok) {
                throw new Error('Ошибка сети при формировании файла');
            }

            const blob = await res.blob();
            
            // Создаем ссылку для скачивания файла
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            // Имя файла будет то, что задал сервер в 'Content-Disposition'
            a.download = `summary_export_${new Date().toLocaleDateString('sv-SE')}.xlsx`;
            
            document.body.appendChild(a);
            a.click();
            
            window.URL.revokeObjectURL(url);
            a.remove();

        } catch (error) {
            console.error('Ошибка при экспорте:', error);
            alert('Не удалось экспортировать данные.');
        } finally {
            // Возвращаем кнопку в исходное состояние
            exportBtn.innerHTML = originalText;
            exportBtn.disabled = false;
        }
    }

    // --- 4. Инициализация и обработчики ---

    // Debounce для фильтра по номеру
    const debounce = (func, delay = 350) => {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), delay);
        };
    };
    
    const debouncedTrackerLoad = debounce(loadBoardTracker);

    function init() {
        // Загружаем всю
        loadStatistics();
        loadBoardTracker();
        loadFilterOptions();

        // Настраиваем слушатели фильтров
        numberFilter.addEventListener('input', debouncedTrackerLoad);
        supplierFilter.addEventListener('change', loadBoardTracker);
        bplaFilter.addEventListener('change', loadBoardTracker);
        exportBtn.addEventListener('click', exportToExcel);
    }

    init();
});