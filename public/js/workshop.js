document.addEventListener("DOMContentLoaded", () => {
    // --- 1. Глобальные переменные ---
    let currentBplaId = null;
    let currentConfig = { params: {}, engines: [] };
    let boardsData = [];
    let editBoardId = null;
    let modalConfig = {}; // Конфигурация для модального окна

    // --- 2. Элементы DOM ---
    const bplaSelector = document.getElementById('bplaTypeSelector');
    const tableHead = document.querySelector('#workshopTable thead');
    const tableBody = document.querySelector('#workshopTable tbody');
    const form = document.getElementById('boardForm');
    const modal = document.getElementById('addModal');
    const openModalBtn = document.getElementById('openModalBtn');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const filterForm = document.getElementById('filterForm');
    const tooltip = document.getElementById('commentTooltip');
    const commentModal = document.getElementById('commentModal');
    const modalBplaSelector = document.getElementById('bplaId');
    const modalParamsFieldset = document.getElementById('paramsFieldset');


    const ALL_POSSIBLE_PF_PARAMS = [
        "Неисправность двигателя",
        "Проблема с топливной системой",
        "Повреждение корпуса",
        "Ошибка электроники",
        "Проблема с шасси"
        // Добавьте сюда все нужные вам параметры
    ];
    // --- 3. Функции для работы с API ---

    async function loadBplaTypes() {
        try {
            const res = await fetch('/api/bpla');
            const bplaTypes = await res.json();
            const parentIds = new Set(bplaTypes.map(b => b.parent_id).filter(id => id !== null));
            const filteredBplas = bplaTypes.filter(b => !parentIds.has(b.id));
            
            bplaSelector.innerHTML = '';
            //modalBplaSelector.innerHTML = '<option value="">-- Выберите тип --</option>';

            filteredBplas.forEach(type => {
                const option = new Option(type.name, type.id);
                bplaSelector.add(option.cloneNode(true));
                modalBplaSelector.add(option);
            });
        } catch (e) {
            console.error("Ошибка загрузки типов БПЛА:", e);
        }
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
                suppliers.forEach(s => {
                    const option = new Option(s.name, s.id);
                    select.add(option);
                });
            });
        } catch(e) { console.error("Ошибка загрузки поставщиков"); }
    }

    const getFilters = () => {
        // Собираем выбранные двигатели в массив
        const selectedEngines = Array.from(document.querySelectorAll('input[name="engineFilter"]:checked'))
                                    .map(cb => cb.value);

        const filters = {
            bpla_id: currentBplaId,
            number: document.getElementById('numberFilter')?.value.trim(),
            supplier_id: document.getElementById('supplierFilter')?.value || null,
            engines: selectedEngines, // ✨ НОВОЕ ПОЛЕ: массив с именами двигателей
        };
        
        // Собираем остальные параметры-чекбоксы
        for (const key in currentConfig.params) {
            const checkbox = document.getElementById(`filter_${key}`);
            if (checkbox) filters[key] = checkbox.checked;
        }
        return filters;
    };

    async function loadAndRenderTable() {
        if (!currentBplaId) return;
        try {
            const res = await fetch('/api/workshop/filter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(getFilters())
            });
            if (!res.ok) throw new Error('Ошибка сети');
            boardsData = await res.json();
            renderTable(boardsData);
        } catch (error) {
            console.error('Ошибка загрузки данных (цех):', error);
            const colspan = tableHead.rows[0]?.cells.length || 8;
            tableBody.innerHTML = `<tr><td colspan="${colspan}" style="text-align: center;">Ошибка загрузки</td></tr>`;
        }
    }
    
    async function updateBoardParameter(boardId, parameter, value) {
        try {
            const res = await fetch(`/api/workshop/${boardId}/parameter`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ parameter, value })
            });
            return res.ok;
        } catch (error) {
            console.error('Ошибка обновления (цех):', error);
            return false;
        }
    };

    // --- 4. Функции для отрисовки UI ---

    async function updateUiForBplaType() {
        // --- Шаг 1: Формируем HTML ---
        let headersHtml = `<tr><th>Номер</th><th>Поставщик</th><th>ДВС</th>`;
        for (const key in currentConfig.params) {
            headersHtml += `<th>${currentConfig.params[key]}</th>`;
        }
        headersHtml += `<th>Действия</th></tr>`;
        tableHead.innerHTML = headersHtml;

        // ✨ НАЧАЛО ИЗМЕНЕНИЙ В HTML ✨
        let filterHtml = `
            <div class="primary-filters">
                <label>Номер борта: <input type="text" id="numberFilter" /></label>
                <label>Поставщик: <select id="supplierFilter"><option value="">Все</option></select></label>
            </div>`;

        // Новый блок для фильтрации по двигателям
        if (currentConfig.engines && currentConfig.engines.length > 0) {
            filterHtml += `<fieldset class="checkbox-fieldset">
                <legend>Двигатель</legend>
                <div class="checkbox-group">`;
            currentConfig.engines.forEach(engine => {
                filterHtml += `<label><input type="checkbox" name="engineFilter" value="${engine}" class="live-filter" /> ${engine}</label>`;
            });
            filterHtml += `</div></fieldset>`;
        }

        // Блок для остальных параметров
        filterHtml += `
            <fieldset class="checkbox-fieldset">
                <legend>Параметры</legend>
                <div class="checkbox-group">`;
        for (const key in currentConfig.params) {
            filterHtml += `<label><input type="checkbox" id="filter_${key}" class="live-filter" /> ${currentConfig.params[key]}</label>`;
        }
        filterHtml += `</div></fieldset><div class="filter-actions">
            <button type="button" id="resetFilterBtn">Сбросить</button>
        </div>`;
        // ✨ КОНЕЦ ИЗМЕНЕНИЙ В HTML ✨

        filterForm.innerHTML = filterHtml;
        
        // --- Шаг 2: Настраиваем "живой" поиск ---
        await loadSuppliers();

        const debounce = (func, delay = 400) => {
            let timeout;
            return (...args) => {
                clearTimeout(timeout);
                timeout = setTimeout(() => { func.apply(this, args); }, delay);
            };
        };

        const debouncedFilter = debounce(loadAndRenderTable);

        document.getElementById('numberFilter').addEventListener('input', debouncedFilter);
        document.getElementById('supplierFilter').addEventListener('change', loadAndRenderTable);
        // Теперь этот селектор найдет ВСЕ чекбоксы, включая новые для ДВС
        filterForm.querySelectorAll('.live-filter').forEach(el => {
            el.addEventListener('change', loadAndRenderTable);
        });

        filterForm.querySelector('#resetFilterBtn').onclick = () => {
            filterForm.reset();
            loadAndRenderTable();
        };

        filterForm.onsubmit = (e) => e.preventDefault();
    }


    function renderTable(boards) {
        tableBody.innerHTML = '';
        const colspan = Object.keys(currentConfig.params).length + 4;
        if (!boards.length) {
            tableBody.innerHTML = `<tr><td colspan="${colspan}" style="text-align:center;">Нет данных</td></tr>`;
            return;
        }
        const formatDate = (date) => date ? new Date(date).toLocaleDateString('ru-RU') : '';
        boards.forEach(board => {
        const tr = document.createElement('tr');

        // Добавляем класс, если борт - полуфабрикат
        if (board.semi_finished_params && board.semi_finished_params.length > 0) {
            tr.classList.add('is-semifinished');
        }

        // Формируем список параметров для отображения
        let pfParamsHtml = '';
        if (board.semi_finished_params && board.semi_finished_params.length > 0) {
            pfParamsHtml = '<ul class="pf-params-list">';
            board.semi_finished_params.forEach(p => {
                pfParamsHtml += `<li>- ${p}</li>`;
            });
            pfParamsHtml += '</ul>';
        }
            
            let paramsHtml = `<td>${params.dvs || 'N/A'}</td>`;
            for (const key in currentConfig.params) {
                const dateValue = params[key];
                const hasDate = !!dateValue;
                const comment = board.workshop_comments ? board.workshop_comments[key] : null;
                const hasCommentClass = comment ? 'has-comment' : '';

                paramsHtml += `
                    <td class="parameter-cell ${hasCommentClass}" data-comment="${comment || ''}">
                        ${comment ? '<span class="comment-indicator">💬</span>' : ''}
                        <input type="checkbox" class="table-param-checkbox" 
                               data-board-id="${board.id}" data-param-name="${key}" ${hasDate ? 'checked' : ''}>
                        <div class="param-date-display">${formatDate(dateValue)}</div>
                        <button class="edit-comment-btn" data-board-id="${board.id}" data-param-name="${key}" data-param-label="${currentConfig.params[key]}">✏️</button>
                    </td>`;
            }
            
            tr.innerHTML = `
                <td>${board.number}</td>
                <td>${board.bpla_name || 'N/A'}</td>
                <td>${board.supplier_name || 'N/A'}</td>
                ${paramsHtml}
                
                <td>
                    ${pfParamsHtml}
                    <button class="add-pf-params-btn" data-board-id="${board.id}" title="Задать параметры ПФ">+</button>
                </td>

                <td class="actions-cell">
                    <button onclick="editBoard(${board.id})">✏️</button>
                    <button onclick="deleteBoard(${board.id})">🗑️</button>
                </td>
            `;
            tableBody.appendChild(tr);
        });
    }

    // --- 5. Логика модального окна ---

    // ИЗМЕНЕНИЕ 1: Обновленная функция отрисовки. Поле даты теперь имеет стиль display: none
    function renderModalParams(config, savedParams = {}) {
        while (modalParamsFieldset.children.length > 1) {
            modalParamsFieldset.removeChild(modalParamsFieldset.lastChild);
        }
        if (!config || !config.params) return;
        
        modalConfig = config;

        let engineHtml = `<div class="param-group"><label for="param_dvs">ДВС</label><select id="param_dvs" class="param-input">`;
        (config.engines || []).forEach(engine => {
            const selected = savedParams.dvs === engine ? 'selected' : '';
            engineHtml += `<option value="${engine}" ${selected}>${engine}</option>`;
        });
        engineHtml += `</select></div>`;
        modalParamsFieldset.insertAdjacentHTML('beforeend', engineHtml);

        for (const key in config.params) {
            const dateValue = savedParams[key] || '';
            const isChecked = !!dateValue;

            // Добавляем style="${!isChecked ? 'display: none;' : ''}" к полю даты
            const fieldHtml = `
                <div class="param-group">
                    <label class="param-label">
                        <input type="checkbox" id="check_${key}" class="param-checkbox" data-param-key="${key}" ${isChecked ? 'checked' : ''}>
                        <span class="param-name">${config.params[key]}</span>
                        <input type="date" id="date_${key}" class="param-date-input" value="${dateValue}" style="${!isChecked ? 'display: none;' : ''}">
                    </label>
                </div>`;
            modalParamsFieldset.insertAdjacentHTML('beforeend', fieldHtml);
        }
    }

    function onOpenModal() {
        editBoardId = null;
        modalConfig = {};
        form.reset();
        modalBplaSelector.disabled = false;
        modalBplaSelector.value = '';
        modalParamsFieldset.innerHTML = '<legend>Параметры</legend>';
        modal.style.display = 'flex';
    }

    window.editWorkshopBoard = async (id) => {
        editBoardId = id;
        const board = boardsData.find(b => b.id === id);
        if (!board) return;

        form.reset();
        
        document.getElementById('number').value = board.number || '';
        document.getElementById('supplierId').value = board.supplier_id || '';
        modalBplaSelector.value = board.bpla_id;
        modalBplaSelector.disabled = true;

        try {
            const res = await fetch(`/api/bpla/${board.bpla_id}/workshop-config`);
            if (!res.ok) throw new Error('Config not found');
            const config = await res.json();
            renderModalParams(config, board.workshop_params || {});
        } catch (e) {
            console.error("Не удалось загрузить параметры для редактирования:", e);
            modalParamsFieldset.innerHTML = '<legend>Ошибка</legend><p>Не удалось загрузить параметры для этого борта.</p>';
        }
        
        modal.style.display = 'flex';
    };

    window.deleteWorkshopBoard = async (id) => {
        if (!confirm('Вы уверены, что хотите удалить борт?')) return;
        await fetch(`/api/board/${id}`, { method: 'DELETE' });
        await loadAndRenderTable();
    };
    
    async function onFormSubmit(e) {
        e.preventDefault();
        
        const bplaId = modalBplaSelector.value;
        if (!bplaId) {
            alert('Пожалуйста, выберите тип борта.');
            return;
        }

        const workshop_params = {
            dvs: document.getElementById('param_dvs')?.value || null
        };

        for (const key in modalConfig.params) {
            const checkbox = document.getElementById(`check_${key}`);
            const dateInput = document.getElementById(`date_${key}`);
            if (checkbox && dateInput) {
                workshop_params[key] = (checkbox.checked && dateInput.value) ? dateInput.value : null;
            }
        }
        
        const body = {
            number: document.getElementById('number').value,
            supplier_id: document.getElementById('supplierId').value || null,
            bpla_id: bplaId,
            workshop_params
        };

        const url = editBoardId ? `/api/workshop/${editBoardId}` : '/api/add_board';
        const method = editBoardId ? 'PUT' : 'POST';

        try {
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.error || 'Ошибка сохранения');
            }
            modal.style.display = 'none';
            await loadAndRenderTable();
        } catch (error) {
            alert(`Не удалось сохранить борт: ${error.message}`);
            console.error(error);
        }
    }

    // --- 6. Прочая логика и обработчики ---

    async function onBplaTypeChange() {
        currentBplaId = bplaSelector.value;
        if (!currentBplaId) return;
        try {
            const res = await fetch(`/api/bpla/${currentBplaId}/workshop-config`);
            if (!res.ok) throw new Error('Конфигурация не найдена');
            currentConfig = await res.json();
            updateUiForBplaType();
            await loadAndRenderTable();
        } catch (error) {
            console.error("Не удалось загрузить конфигурацию:", error);
            tableHead.innerHTML = '';
            tableBody.innerHTML = `<tr><td colspan="3" style="text-align:center;">Конфигурация для этого БПЛА не найдена.</td></tr>`;
        }
    }

    tableBody.addEventListener('change', async (e) => {
        if (e.target.classList.contains('table-param-checkbox')) {
            const checkbox = e.target;
            const boardId = checkbox.dataset.boardId;
            const paramName = checkbox.dataset.paramName;
            const valueToSet = checkbox.checked ? new Date().toLocaleDateString('sv-SE') : null;
            
            checkbox.disabled = true;
            const success = await updateBoardParameter(boardId, paramName, valueToSet);
            checkbox.disabled = false;

            if (success) {
                await loadAndRenderTable();
            } else {
                checkbox.checked = !checkbox.checked;
                alert('Не удалось сохранить изменение.');
            }
        }
    });

    function initCommentEditor() {
        tableBody.addEventListener('mouseover', e => {
            const cell = e.target.closest('.parameter-cell');
            if (cell && cell.dataset.comment) {
                tooltip.textContent = cell.dataset.comment;
                tooltip.style.display = 'block';
            }
        });
        tableBody.addEventListener('mousemove', e => {
            tooltip.style.left = `${e.pageX + 15}px`;
            tooltip.style.top = `${e.pageY + 15}px`;
        });
        tableBody.addEventListener('mouseout', () => {
            tooltip.style.display = 'none';
        });

        let currentCommentData = {};
        tableBody.addEventListener('click', e => {
            if (e.target.classList.contains('edit-comment-btn')) {
                const button = e.target;
                currentCommentData = {
                    boardId: button.dataset.boardId,
                    paramName: button.dataset.paramName,
                };
                document.getElementById('commentParamName').textContent = button.dataset.paramLabel;
                document.getElementById('commentTextarea').value = button.closest('.parameter-cell').dataset.comment;
                commentModal.style.display = 'flex';
            }
        });

        const saveComment = async (commentText) => {
            try {
                const res = await fetch(`/api/workshop/${currentCommentData.boardId}/comment`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ parameter: currentCommentData.paramName, comment: commentText })
                });
                if (!res.ok) throw new Error('Ошибка сохранения');
                commentModal.style.display = 'none';
                loadAndRenderTable();
            } catch (error) {
                alert('Не удалось обработать комментарий.');
                console.error(error);
            }
        };

        document.getElementById('closeCommentModal').onclick = () => commentModal.style.display = 'none';
        document.getElementById('saveCommentBtn').onclick = () => saveComment(document.getElementById('commentTextarea').value);
        document.getElementById('deleteCommentBtn').onclick = () => saveComment('');
    }

    // --- 7. Инициализация страницы ---
    async function init() {
        await Promise.all([loadBplaTypes(), loadSuppliers()]);
        
        bplaSelector.addEventListener('change', onBplaTypeChange);
        if (bplaSelector.options.length > 0) {
            bplaSelector.selectedIndex = 0;
            await onBplaTypeChange();
        }

        // УЛУЧШЕННАЯ ЛОГИКА ОБРАБОТКИ ФИЛЬТРОВ
        let filterDebounceTimer;
        filterForm.addEventListener('input', (e) => {
            clearTimeout(filterDebounceTimer);
            filterDebounceTimer = setTimeout(() => {
                loadAndRenderTable();
            }, 400);
        });

        filterForm.addEventListener('click', (e) => {
            if (e.target.id === 'resetFilterBtn') {
                filterForm.reset();
                loadAndRenderTable();
            }
        });
        filterForm.addEventListener('submit', (e) => e.preventDefault());

        // Обработчики модального окна
        modalBplaSelector.addEventListener('change', async (e) => {
            const bplaId = e.target.value;
            if (bplaId) {
                try {
                    const res = await fetch(`/api/bpla/${bplaId}/workshop-config`);
                    const config = await res.json();
                    renderModalParams(config);
                } catch (err) {
                    console.error("Не удалось загрузить параметры в модальном окне:", err);
                    modalParamsFieldset.innerHTML = '<legend>Ошибка</legend><p>Не удалось загрузить параметры.</p>';
                }
            } else {
                modalParamsFieldset.innerHTML = '<legend>Параметры</legend>';
            }
        });
        
        openModalBtn.addEventListener('click', onOpenModal);
        closeModalBtn.addEventListener('click', () => modal.style.display = 'none');
        window.addEventListener('click', (e) => { if (e.target === modal) modal.style.display = 'none'; });
        form.addEventListener('submit', onFormSubmit);
        
        initCommentEditor();
    }

    init();
});