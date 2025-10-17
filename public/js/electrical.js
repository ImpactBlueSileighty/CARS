document.addEventListener("DOMContentLoaded", () => {
    // --- 1. Глобальные переменные ---
    let currentBplaId = null;
    let currentConfig = { params: {} };
    let boardsData = [];
    let editBoardId = null;
    let allComponents = {}; // Кэш для всех компонентов

    // --- 2. Элементы DOM ---
    const bplaSelector = document.getElementById('bplaTypeSelector');
    const tableHead = document.querySelector('#electricalTable thead');
    const tableBody = document.querySelector('#electricalTable tbody');
    const form = document.getElementById('boardForm');
    const modal = document.getElementById('addModal');
    const openModalBtn = document.getElementById('openModalBtn');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const filterForm = document.getElementById('filterForm');
    
    const modalBplaSelector = document.getElementById('bplaId');
    const modalParamsFieldset = document.getElementById('paramsFieldset');

    // --- 3. Функции для работы с API ---
    async function loadBplaTypes() {
        try {
            const res = await fetch('/api/bpla');
            const bplaTypes = await res.json();
            const parentIds = new Set(bplaTypes.map(b => b.parent_id).filter(id => id !== null));
            const filteredBplas = bplaTypes.filter(b => !parentIds.has(b.id));
            
            bplaSelector.innerHTML = '';
            modalBplaSelector.innerHTML = '<option value="">-- Выберите тип --</option>';

            filteredBplas.forEach(type => {
                const option = new Option(type.name, type.id);
                bplaSelector.add(option.cloneNode(true));
                modalBplaSelector.add(option);
            });
        } catch (e) { console.error("Ошибка загрузки типов БПЛА:", e); }
    }

    async function loadSuppliers() {
        const supplierSelects = document.querySelectorAll('#supplierId, #supplierFilter');
        try {
            const res = await fetch('/api/suppliers');
            const suppliers = await res.json();
            supplierSelects.forEach(select => {
                const firstOption = select.firstElementChild ? select.firstElementChild.cloneNode(true) : null;
                select.innerHTML = '';
                if (firstOption) select.appendChild(firstOption);
                suppliers.forEach(s => select.add(new Option(s.name, s.id)));
            });
        } catch(e) { console.error("Ошибка загрузки поставщиков"); }
    }

    async function loadAllComponents() {
        try {
            const res = await fetch('/api/electrical/components');
            if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
            allComponents = await res.json();
        } catch (e) {
            console.error("Ошибка загрузки компонентов:", e);
            alert("Не удалось загрузить справочник компонентов. Проверьте консоль сервера.");
        }
    }

    const getFilters = () => {
        const filters = {
            bpla_id: currentBplaId,
            number: document.getElementById('numberFilter')?.value.trim(),
            supplier_id: document.getElementById('supplierFilter')?.value || null,
        };
        for (const key in currentConfig.params) {
            const checkbox = document.getElementById(`filter_${key}`);
            if (checkbox) filters[key] = checkbox.checked;
        }
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
            const colspan = tableHead.rows[0]?.cells.length || 8;
            tableBody.innerHTML = `<tr><td colspan="${colspan}" style="text-align: center;">Ошибка загрузки</td></tr>`;
        }
    }
    
    // --- 4. Функции для отрисовки UI ---
    function updateUiForBplaType() {
        let headersHtml = `<tr><th>Номер</th><th>Поставщик</th>`;
        for (const key in currentConfig.params) {
            headersHtml += `<th>${currentConfig.params[key]}</th>`;
        }
        headersHtml += `<th>Действия</th></tr>`;
        tableHead.innerHTML = headersHtml;

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
        filterHtml += `</div></fieldset></div><div class="filter-actions">
            <button type="button" id="resetFilterBtn">Сбросить</button>
            <button type="submit">Применить</button></div>`;
        filterForm.innerHTML = filterHtml;
        loadSuppliers();
    }

    function renderTable(boards) {
        tableBody.innerHTML = '';
        const colspan = Object.keys(currentConfig.params).length + 3;
        if (!boards.length) {
            tableBody.innerHTML = `<tr><td colspan="${colspan}" style="text-align:center;">Нет данных</td></tr>`;
            return;
        }

        const findModelName = (type, id) => {
            if (!allComponents[type] || !id) return 'N/A';
            const model = allComponents[type].find(m => m.id == id);
            return model ? model.model_name : 'N/A';
        };

        boards.forEach(board => {
            const tr = document.createElement('tr');
            const params = board.electrical_params || {};
            
            let paramsHtml = '';
            for (const key in currentConfig.params) {
                let displayValue = '';
                if (key === 'controller_id') {
                    displayValue = board.controller_name || 'N/A';
                } else if (key === 'seal_number') {
                    displayValue = params[key] || 'N/A';
                } else {
                    const componentMap = {
                        telemetry_id: 'telemetry_modules',
                        bec_id: 'bec_models',
                        gps_id: 'gps_models',
                        video_tx_id: 'video_transmitters',
                        pvd_id: 'pvd_models'
                    };
                    displayValue = findModelName(componentMap[key], params[key]);
                }
                paramsHtml += `<td>${displayValue}</td>`;
            }
            
            tr.innerHTML = `
                <td>${board.number}</td>
                <td>${board.supplier_name || 'N/A'}</td>
                ${paramsHtml}
                <td class="actions-cell">
                    <button onclick="window.editElectricalBoard(${board.id})">✏️</button>
                </td>
            `;
            tableBody.appendChild(tr);
        });
    }

    // --- 5. Логика модального окна ---
    function renderModalParams(config, savedParams = {}) {
        modalParamsFieldset.innerHTML = '<legend>Компоненты</legend>';
        if (!config || !config.params) return;

        // ИЗМЕНЕНИЕ 1: Полная карта компонентов
        const componentMap = {
            controller_id: 'flight_controllers',
            telemetry_id: 'telemetry_modules',
            bec_id: 'bec_models',
            gps_id: 'gps_models',
            video_tx_id: 'video_transmitters',
            pvd_id: 'pvd_models'
        };

        for (const key in config.params) {
            let fieldHtml = '';
            if (key === 'seal_number') {
                 fieldHtml = `
                    <div class="param-group">
                        <label for="param_seal_number">${config.params[key]}</label>
                        <input type="text" id="param_seal_number" value="${savedParams.seal_number || ''}">
                    </div>`;
            } else {
                const componentType = componentMap[key];
                const options = allComponents[componentType] || [];
                let optionsHtml = '<option value="">-- Не выбрано --</option>';
                options.forEach(opt => {
                    const selected = savedParams[key] == opt.id ? 'selected' : '';
                    optionsHtml += `<option value="${opt.id}" ${selected}>${opt.model_name}</option>`;
                });

                fieldHtml = `
                    <div class="param-group">
                        <label for="param_${key}">${config.params[key]}</label>
                        <select id="param_${key}">${optionsHtml}</select>
                    </div>`;
            }
            modalParamsFieldset.insertAdjacentHTML('beforeend', fieldHtml);
        }
    }

    function onOpenModal() {
        editBoardId = null;
        form.reset();
        modalBplaSelector.disabled = false;
        modalBplaSelector.value = '';
        modalParamsFieldset.innerHTML = '<legend>Компоненты</legend>';
        modal.style.display = 'flex';
    }

    window.editElectricalBoard = async (id) => {
        editBoardId = id;
        const board = boardsData.find(b => b.id === id);
        if (!board) return;

        form.reset();
        document.getElementById('number').value = board.number || '';
        document.getElementById('supplierId').value = board.supplier_id || '';
        modalBplaSelector.value = board.bpla_id;
        modalBplaSelector.disabled = true;

        try {
            const res = await fetch(`/api/bpla/${board.bpla_id}/electrical-config`);
            if (!res.ok) throw new Error('Config not found');
            const config = await res.json();
            renderModalParams(config, board.electrical_params || {});
        } catch (e) {
            console.error("Не удалось загрузить параметры для редактирования:", e);
            modalParamsFieldset.innerHTML = '<legend>Ошибка</legend><p>Не удалось загрузить параметры.</p>';
        }
        
        modal.style.display = 'flex';
    };
    
    async function onFormSubmit(e) {
        e.preventDefault();
        const bplaId = modalBplaSelector.value;
        if (!bplaId) {
            alert('Пожалуйста, выберите тип борта.');
            return;
        }

        const res = await fetch(`/api/bpla/${bplaId}/electrical-config`);
        const config = await res.json();
        
        const electrical_params = {};
        for (const key in config.params) {
            const input = document.getElementById(`param_${key}`);
            if (input) {
                electrical_params[key] = input.value || null;
            }
        }
        
        const body = {
            number: document.getElementById('number').value,
            supplier_id: document.getElementById('supplierId').value || null,
            bpla_id: bplaId,
            electrical_params
        };

        if (!editBoardId) {
             try {
                const addRes = await fetch('/api/add_board', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        bpla_id: body.bpla_id,
                        number: body.number,
                        supplier_id: body.supplier_id,
                        workshop_params: {}, 
                        electrical_params: body.electrical_params // Сразу передаем параметры
                    })
                });
                if (!addRes.ok) {
                    const err = await addRes.json();
                    throw new Error(err.error || 'Не удалось создать борт');
                }
                modal.style.display = 'none';
                await loadAndRenderTable();
                return; // Завершаем выполнение, так как борт уже создан и сохранен
             } catch(error) {
                 alert(`Ошибка: ${error.message}`);
                 console.error(error);
                 return;
             }
        }
        
        // Логика для обновления существующего борта
        try {
            const updateRes = await fetch(`/api/electrical/${editBoardId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (!updateRes.ok) throw new Error('Ошибка сохранения');
            
            modal.style.display = 'none';
            await loadAndRenderTable();
        } catch (error) {
            alert(`Не удалось сохранить данные: ${error.message}`);
        }
    }

    // --- 6. Прочая логика и обработчики ---
    async function onBplaTypeChange() {
        currentBplaId = bplaSelector.value;
        if (!currentBplaId) return;
        try {
            const res = await fetch(`/api/bpla/${currentBplaId}/electrical-config`);
            if (!res.ok) throw new Error('Конфигурация не найдена');
            currentConfig = await res.json();
            updateUiForBplaType();
            await loadAndRenderTable();
        } catch (error) {
            console.error("Не удалось загрузить конфигурацию:", error);
            tableHead.innerHTML = '';
            tableBody.innerHTML = `<tr><td colspan="3" style="text-align:center;">Конфигурация не найдена.</td></tr>`;
        }
    }
    
    // --- 7. Инициализация страницы ---
    async function init() {
        await Promise.all([loadBplaTypes(), loadSuppliers(), loadAllComponents()]);
        
        bplaSelector.addEventListener('change', onBplaTypeChange);
        
        if (bplaSelector.options.length > 0) {
            bplaSelector.selectedIndex = 0;
            await onBplaTypeChange();
        }

        modalBplaSelector.addEventListener('change', async (e) => {
            const bplaId = e.target.value;
            if (bplaId) {
                try {
                    const res = await fetch(`/api/bpla/${bplaId}/electrical-config`);
                    const config = await res.json();
                    renderModalParams(config);
                } catch (err) {
                    modalParamsFieldset.innerHTML = '<legend>Ошибка</legend><p>Не удалось загрузить параметры.</p>';
                }
            } else {
                modalParamsFieldset.innerHTML = '<legend>Компоненты</legend>';
            }
        });

        openModalBtn.addEventListener('click', onOpenModal);
        closeModalBtn.addEventListener('click', () => modal.style.display = 'none');
        window.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
        form.addEventListener('submit', onFormSubmit);
        
        filterForm.addEventListener('submit', (e) => {
            e.preventDefault();
            loadAndRenderTable();
        });
        filterForm.addEventListener('click', (e) => {
            if (e.target.id === 'resetFilterBtn') {
                filterForm.reset();
                loadAndRenderTable();
            }
        });
    }

    init();
});