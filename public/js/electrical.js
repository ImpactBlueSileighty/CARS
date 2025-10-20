document.addEventListener("DOMContentLoaded", () => {
    // --- 1. Глобальные переменные ---
    let currentBplaId = null;
    let currentConfig = { params: {} };
    let boardsData = [];
    let editBoardId = null;
    let allComponents = {};

    // --- 2. Элементы DOM ---
    const bplaSelector = document.getElementById('bplaTypeSelector');
    const tableHead = document.querySelector('#electricalTable thead');
    const tableBody = document.querySelector('#electricalTable tbody');
    const form = document.getElementById('boardForm');
    const modal = document.getElementById('addModal');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const filterForm = document.getElementById('filterForm');
    const modalBplaSelector = document.getElementById('bplaId');
    const modalParamsFieldset = document.getElementById('paramsFieldset');
    const modalPcContainer = document.getElementById('modalPcContainer');

    // --- 3. Функции для работы с API ---

    async function loadBplaTypes() {
        try {
            const res = await fetch('/api/bpla');
            const data = await res.json();
            const parentIds = new Set(data.map(b => b.parent_id).filter(id => id));
            const filtered = data.filter(b => !parentIds.has(b.id));
            bplaSelector.innerHTML = '';
            filtered.forEach(type => {
                bplaSelector.add(new Option(type.name, type.id));
            });
        } catch (e) { console.error("Ошибка загрузки типов БПЛА:", e); }
    }

    async function loadSuppliers() {
        try {
            const res = await fetch('/api/suppliers');
            const suppliers = await res.json();
            document.querySelectorAll('#supplierId, #supplierFilter').forEach(select => {
                const first = select.firstElementChild?.cloneNode(true) || new Option('Все', '');
                select.innerHTML = '';
                select.appendChild(first);
                suppliers.forEach(s => select.add(new Option(s.name, s.id)));
            });
        } catch(e) { console.error("Ошибка загрузки поставщиков:", e); }
    }
    
    const getFilters = () => {
        const filters = {
            bpla_id: currentBplaId,
            number: document.getElementById('numberFilter')?.value.trim(),
            supplier_id: document.getElementById('supplierFilter')?.value || null,
        };
        // Собираем состояния чекбоксов
        filterForm.querySelectorAll('.checkbox-group input[type="checkbox"]').forEach(checkbox => {
            const key = checkbox.id.replace('filter_', '');
            filters[key] = checkbox.checked;
        });
        return filters;
    };

    async function loadAndRenderTable() {
        if (!currentBplaId) return;
        try {
            const res = await fetch('/api/electrical/filter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(getFilters())
            });
            if (!res.ok) throw new Error('Ошибка сети');
            boardsData = await res.json();
            renderTable(boardsData);
        } catch (error) {
            console.error('Ошибка загрузки данных (электромонтаж):', error);
            tableBody.innerHTML = `<tr><td colspan="10" style="text-align: center;">Ошибка загрузки</td></tr>`;
        }
    }
    
    // --- 4. Функции отрисовки UI ---

    function updateUiForBplaType() {
        // 1. Отрисовка заголовков таблицы
        let headersHtml = `<tr><th>Номер</th><th>Поставщик</th><th>ПК</th>`;
        for (const key in currentConfig.params) {
            headersHtml += `<th>${currentConfig.params[key]}</th>`;
        }
        headersHtml += `<th>Действия</th></tr>`;
        tableHead.innerHTML = headersHtml;

        // 2. Отрисовка блока фильтров
        let filterHtml = `
            <div class="filter-controls">
                <div class="primary-filters">
                    <label>Номер борта: <input type="text" id="numberFilter" /></label>
                    <label>Поставщик: <select id="supplierFilter"><option value="">Все</option></select></label>
                </div>
                <fieldset class="checkbox-fieldset">
                    <legend>Установленные компоненты</legend>
                    <div class="checkbox-group">`;
        
        for (const key in currentConfig.params) {
             if (key !== 'seal_number') {
                filterHtml += `<label><input type="checkbox" id="filter_${key}" /> ${currentConfig.params[key]}</label>`;
             }
        }
        
        filterHtml += `
                    </div>
                </fieldset>
            </div>
            <div class="filter-actions">
                <button type="button" id="resetFilterBtn">Сбросить</button>
            </div>`;
            
        filterForm.innerHTML = filterHtml;
        loadSuppliers();
    }

    function renderTable(boards) {
        tableBody.innerHTML = '';
        const colspan = (currentConfig.params ? Object.keys(currentConfig.params).length : 0) + 4;
        if (!boards.length) {
            tableBody.innerHTML = `<tr><td colspan="${colspan}" style="text-align:center;">Нет данных</td></tr>`;
            return;
        }
        boards.forEach(board => {
            const tr = document.createElement('tr');
            const params = board.electrical_params || {};
            let paramsHtml = `<td>${board.controller_name || 'N/A'}</td>`;
            for (const key in currentConfig.params) {
                 const displayValue = key === 'seal_number' ? (params[key] || 'N/A') : findModelName(key, params[key]);
                paramsHtml += `<td>${displayValue}</td>`;
            }
            tr.innerHTML = `<td>${board.number}</td><td>${board.supplier_name || 'N/A'}</td>${paramsHtml}<td class="actions-cell"><button onclick="window.editElectricalBoard(${board.id})">✏️</button></td>`;
            tableBody.appendChild(tr);
        });
    }
    
    const findModelName = (paramKey, modelId) => {
        if (!modelId) return 'N/A';
        const componentMap = {
            telemetry_id: 'telemetry_modules', bec_id: 'bec_models', gps_id: 'gps_models',
            video_tx_id: 'video_transmitters', pvd_id: 'pvd_models'
        };
        const componentType = componentMap[paramKey];
        const model = allComponents[componentType]?.find(m => m.id == modelId);
        return model ? model.model_name : 'N/A';
    };

    // --- 5. Логика модального окна ---

    // ВОТ ЭТА ФУНКЦИЯ, КОТОРУЮ НЕ УДАЛОСЬ НАЙТИ
    async function renderPcDropdown(bplaId, selectedControllerId = null) {
        modalPcContainer.innerHTML = '<p>Загрузка ПК...</p>';
        try {
            const res = await fetch(`/api/bpla/${bplaId}/compatible-controllers`);
            if (!res.ok) throw new Error('Не удалось загрузить список ПК');
            const controllers = await res.json();
            let opts = '<option value="">-- Выберите ПК --</option>' + controllers.map(c => `<option value="${c.id}" ${selectedControllerId == c.id ? 'selected' : ''}>${c.name}</option>`).join('');
            
            // Генерируем элементы, которые станут ячейками грида
            modalPcContainer.innerHTML = `
                <label for="param_controller_id">Полетный контроллер (ПК):</label>
                <select id="param_controller_id" required>${opts}</select>
            `;
            // Оборачиваем содержимое в div.form-grid
            modalPcContainer.className = 'form-grid';

        } catch (e) {
            console.error(e);
            modalPcContainer.innerHTML = '<p style="color: red;">Ошибка загрузки ПК</p>';
        }
    }

    // ИЗМЕНЕНИЕ 2: Эта функция теперь тоже генерирует только label и input/select
    function renderModalParams(config, components, savedParams = {}) {
        // Очищаем, но сохраняем legend
        modalParamsFieldset.innerHTML = '<legend>Компоненты</legend>';
        if (!config || !config.params) return;

        // Создаем контейнер с классом form-grid внутри fieldset
        const gridContainer = document.createElement('div');
        gridContainer.className = 'form-grid';
        
        const componentMap = {
            telemetry_id: 'telemetry_modules', bec_id: 'bec_models', gps_id: 'gps_models',
            video_tx_id: 'video_transmitters', pvd_id: 'pvd_models'
        };

        for (const key in config.params) {
            let labelHtml = `<label for="param_${key}">${config.params[key]}</label>`;
            let inputHtml = '';

            if (key === 'seal_number') {
                inputHtml = `<input type="text" id="param_seal_number" value="${savedParams.seal_number || ''}">`;
            } else {
                const componentType = componentMap[key];
                const options = components[componentType] || [];
                let opts = '<option value="">-- Не выбрано --</option>' + options.map(opt => `<option value="${opt.id}" ${savedParams[key] == opt.id ? 'selected' : ''}>${opt.model_name}</option>`).join('');
                inputHtml = `<select id="param_${key}">${opts}</select>`;
            }
            gridContainer.innerHTML += labelHtml + inputHtml;
        }
        modalParamsFieldset.appendChild(gridContainer);
    }

    // А ВОТ ФУНКЦИЯ, КОТОРАЯ ЕЕ ВЫЗЫВАЕТ
    window.editElectricalBoard = async (id) => {
        editBoardId = id;
        const board = boardsData.find(b => b.id === id);
        if (!board) return alert('Ошибка: борт не найден.');

        form.reset();
        document.getElementById('number').value = board.number || '';
        document.getElementById('supplierId').value = board.supplier_id || '';
        
        // Тип БПЛА в модалке не нужен, так как мы его не меняем
        const bplaTypeDisplay = document.getElementById('bplaTypeDisplay');
        if(bplaTypeDisplay) bplaTypeDisplay.textContent = bplaSelector.options[bplaSelector.selectedIndex].text;


        modal.style.display = 'flex';

        try {
            const [configRes, componentsRes] = await Promise.all([
                fetch(`/api/bpla/${board.bpla_id}/electrical-config`),
                fetch(`/api/electrical/components/${board.bpla_id}`),
                renderPcDropdown(board.bpla_id, board.controller_id) // <--- ВЫЗОВ ФУНКЦИИ
            ]);

            const config = await configRes.json();
            const components = await componentsRes.json();
            renderModalParams(config, components, board.electrical_params || {});
        } catch (e) {
            console.error("Ошибка загрузки данных для редактирования:", e);
            modalParamsFieldset.innerHTML = '<legend>Ошибка</legend><p>Не удалось загрузить параметры.</p>';
        }
    };

    // electrical.js

    async function onFormSubmit(e) {
        e.preventDefault();
        if (!editBoardId) return;

        const board = boardsData.find(b => b.id === editBoardId);
        if (!board) return;

        const bplaId = board.bpla_id;

        const res = await fetch(`/api/bpla/${bplaId}/electrical-config`);
        const config = await res.json();
        
        const electrical_params = {};
        for (const key in config.params) {
            const input = document.getElementById(`param_${key}`);
            if (input) {
                // ИЗМЕНЕНИЕ: Сохраняем null, если значение пустое, а не пустую строку
                electrical_params[key] = input.value ? input.value : null;
            }
        }
        
        const body = {
            number: document.getElementById('number').value,
            supplier_id: document.getElementById('supplierId').value || null,
            controller_id: document.getElementById('param_controller_id').value,
            electrical_params
        };
        
        try {
            const updateRes = await fetch(`/api/electrical/${editBoardId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (!updateRes.ok) throw new Error('Ошибка сохранения на сервере');
            modal.style.display = 'none';
            await loadAndRenderTable();
        } catch (error) {
            alert(`Не удалось сохранить данные: ${error.message}`);
        }
    }

    // --- 7. Инициализация ---
    async function init() {
        await Promise.all([loadBplaTypes(), loadSuppliers()]);
        
        bplaSelector.addEventListener('change', onBplaTypeChange);
        if (bplaSelector.options.length > 0) {
            bplaSelector.selectedIndex = 0;
            await onBplaTypeChange();
        }

        closeModalBtn.addEventListener('click', () => modal.style.display = 'none');
        window.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
        form.addEventListener('submit', onFormSubmit);
        
        filterForm.addEventListener('input', (e) => {
            // Чтобы не вызывать фильтрацию на каждый символ, добавим небольшую задержку (debounce)
            // Это стандартная практика для высоконагруженных интерфейсов
            clearTimeout(filterForm.debounceTimer);
            filterForm.debounceTimer = setTimeout(() => {
                loadAndRenderTable();
            }, 300); // задержка в 300 мс
        });

        // Обработка кнопки "Сбросить" через делегирование
        filterForm.addEventListener('click', (e) => {
            if (e.target.id === 'resetFilterBtn') {
                filterForm.reset();
                loadAndRenderTable();
            }
        });
    }

    async function onBplaTypeChange() {
        currentBplaId = bplaSelector.value;
        if (!currentBplaId) return;
        try {
            const res = await fetch(`/api/bpla/${currentBplaId}/electrical-config`);
            if (!res.ok) throw new Error('Конфигурация не найдена');
            currentConfig = await res.json();
            updateUiForBplaType();
            // Загружаем компоненты один раз при смене типа БПЛА
            await loadAllComponentsForCurrentBpla();
            await loadAndRenderTable();
        } catch (error) {
            console.error("Не удалось загрузить конфигурацию:", error);
            tableHead.innerHTML = '';
            tableBody.innerHTML = `<tr><td colspan="3">Конфигурация не найдена.</td></tr>`;
        }
    }

    // Новая вспомогательная функция
    async function loadAllComponentsForCurrentBpla() {
        if (!currentBplaId) return;
        try {
            const res = await fetch(`/api/electrical/components/${currentBplaId}`);
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            allComponents = await res.json();
        } catch (e) {
            console.error("Ошибка загрузки компонентов:", e);
        }
    }

    init();
});