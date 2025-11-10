document.addEventListener("DOMContentLoaded", () => {
    // --- 1. Глобальные переменные ---
    let currentBplaId = null;
    let currentConfig = { params: {} };
    let boardsData = [];
    let editBoardId = null;

    // --- 2. Элементы DOM ---
    const bplaSelector = document.getElementById('bplaTypeSelector');
    const tableHead = document.querySelector('#setupTable thead');
    const tableBody = document.querySelector('#setupTable tbody');
    const form = document.getElementById('boardForm');
    const modal = document.getElementById('addModal');
    const closeModalBtn = document.getElementById('closeModalBtn');
    const filterForm = document.getElementById('filterForm');
    const tooltip = document.getElementById('commentTooltip');
    const commentModal = document.getElementById('commentModal');
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
                select.innerHTML = '<option value="">-- Не выбран --</option>';
                suppliers.forEach(s => select.add(new Option(s.name, s.id)));
            });
        } catch(e) { console.error("Ошибка загрузки поставщиков"); }
    }

    const getFilters = () => {
        const filters = {
            bpla_id: currentBplaId,
            number: document.getElementById('numberFilter')?.value.trim(),
            supplier_id: document.getElementById('supplierFilter')?.value || null,
            status: document.getElementById('statusFilter')?.value || null,
        };
        // Динамически собираем фильтры по параметрам
        for (const key in currentConfig.params) {
            const checkbox = document.getElementById(`filter_${key}`);
            if (checkbox) filters[key] = checkbox.checked;
        }
        return filters;
    };

    async function loadAndRenderTable() {
        if (!currentBplaId) return;
        try {
            // ВЫЗЫВАЕМ НОВЫЙ ЭНДПОИНТ
            const res = await fetch('/api/setup/filter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(getFilters())
            });
            if (!res.ok) throw new Error('Ошибка сети');
            boardsData = await res.json();
            renderTable(boardsData);
        } catch (error) { console.error('Ошибка загрузки данных (настройка):', error); }
    }

    // --- 4. Функции для отрисовки UI ---

    async function updateUiForBplaType() {
        // Рендер заголовков таблицы
        let headersHtml = `<tr><th>Номер</th><th>Поставщик</th>`;
        for (const key in currentConfig.params) {
            headersHtml += `<th>${currentConfig.params[key]}</th>`;
        }
        headersHtml += `<th>Действия</th></tr>`;
        tableHead.innerHTML = headersHtml;

        // Рендер фильтров
        let filterHtml = `<div class="primary-filters">
            <label>Номер борта: <input type="text" id="numberFilter" /></label>
            <label>Поставщик: <select id="supplierFilter"><option value="">Все</option></select></label>
            <label>Статус:
                <select id="statusFilter">
                    <option value="">Все</option>
                    <option value="in_progress">В работе</option>
                    <option value="finished">Готов</option>
                    <option value="semifinished">Полуфабрикат</option>
                </select>
            </label>
        </div>`;
        filterHtml += `<fieldset class="checkbox-fieldset"><legend>Параметры</legend><div class="checkbox-group params-filter-group">`;
        for (const key in currentConfig.params) {
            filterHtml += `<label><input type="checkbox" id="filter_${key}" data-param-name="${key}" class="live-filter" /> ${currentConfig.params[key]}</label>`;
        }
        filterHtml += `</div></fieldset><div class="filter-actions"><button type="button" id="resetFilterBtn">Сбросить</button></div>`;
        filterForm.innerHTML = filterHtml;
        
        await loadSuppliers();
    }

    function renderTable(boards) {
        tableBody.innerHTML = '';
        const formatDate = (date) => date ? new Date(date).toLocaleDateString('ru-RU') : '';
        
        boards.forEach(board => {
            const tr = document.createElement('tr');
            if (board.status_color === 'red') tr.classList.add('is-semifinished');
            else if (board.status_color === 'green') tr.classList.add('is-finished');
            else tr.classList.add('is-in-progress');
            
            // ИСПОЛЬЗУЕМ НОВЫЕ КОЛОНКИ
            const setupParams = board.setup_params || {};
            const setupComments = board.setup_comments || {};
            
            let paramsHtml = '';
            for (const key in currentConfig.params) {
                const dateValue = setupParams[key];
                const comment = setupComments[key];
                paramsHtml += `
                    <td class="parameter-cell ${comment ? 'has-comment' : ''}" data-comment="${comment || ''}">
                        ${comment ? '<span class="comment-indicator">💬</span>' : ''}
                        <input type="checkbox" class="table-param-checkbox" data-board-id="${board.id}" data-param-name="${key}" ${dateValue ? 'checked' : ''}>
                        <div class="param-date-display">${formatDate(dateValue)}</div>
                        <button class="edit-comment-btn" data-board-id="${board.id}" data-param-name="${key}" data-param-label="${currentConfig.params[key]}">✏️</button>
                    </td>`;
            }
            tr.innerHTML = `
                <td>${board.number}</td>
                <td>${board.supplier_name || 'N/A'}</td>
                ${paramsHtml}
                <td class="actions-cell">
                    <button class="edit-btn" data-board-id="${board.id}" title="Редактировать">✏️</button>
                    <button class="delete-btn" data-board-id="${board.id}" title="Удалить">🗑️</button>
                </td>`;
            tableBody.appendChild(tr);
        });
    }

    // --- 5. Логика модального окна ---

    function renderModalParams(config, savedParams = {}) {
        modalParamsFieldset.innerHTML = '<legend>Параметры</legend>';
        
        for (const key in config.params) {
            const dateValue = savedParams[key] ? new Date(savedParams[key]).toLocaleDateString('sv-SE') : '';
            const fieldHtml = `
                <div class="param-group">
                    <label>
                        <input type="checkbox" id="check_${key}" data-date-target="date_${key}" ${dateValue ? 'checked' : ''}>
                        <span>${config.params[key]}</span>
                        <input type="date" id="date_${key}" value="${dateValue}" style="display:${dateValue ? 'inline-block' : 'none'};" class="param-date-input">
                    </label>
                </div>`;
            modalParamsFieldset.insertAdjacentHTML('beforeend', fieldHtml);
        }
        
        modalParamsFieldset.querySelectorAll('input[type="checkbox"][data-date-target]').forEach(checkbox => {
            const dateInput = document.getElementById(checkbox.dataset.dateTarget);
            if (dateInput) {
                checkbox.addEventListener('change', () => {
                    dateInput.style.display = checkbox.checked ? 'inline-block' : 'none';
                    if (checkbox.checked && !dateInput.value) {
                        dateInput.value = new Date().toLocaleDateString('sv-SE');
                    }
                });
            }
        });
    }

    function openModal(boardId = null) {
        form.reset();
        editBoardId = boardId;
        if (editBoardId) { // Режим редактирования
            const board = boardsData.find(b => b.id === editBoardId);
            if (!board) return;
            modalBplaSelector.value = board.bpla_id;
            modalBplaSelector.disabled = true;
            document.getElementById('number').value = board.number;
            document.getElementById('supplierId').value = board.supplier_id || '';
            // ИСПОЛЬЗУЕМ НОВУЮ КОЛОНКУ
            renderModalParams(currentConfig, board.setup_params || {});
        } else { // Режим создания
            modalBplaSelector.disabled = false;
            modalBplaSelector.value = '';
            document.getElementById('number').value = '';
            document.getElementById('supplierId').value = '';
            modalParamsFieldset.innerHTML = '<legend>Параметры</legend><p>Сначала выберите тип БПЛА.</p>';
        }
        modal.style.display = 'flex';
    }

    async function onModalBplaChange() {
        const bplaId = modalBplaSelector.value;
        if (!bplaId) {
            modalParamsFieldset.innerHTML = '<legend>Параметры</legend><p>Сначала выберите тип БПЛА.</p>';
            return;
        }
        try {
            // ЗАПРАШИВАЕМ НОВЫЙ "ЧЕРТЕЖ"
            const res = await fetch(`/api/bpla/${bplaId}/setup-config`);
            if (!res.ok) throw new Error('Config not found');
            const config = await res.json();
            renderModalParams(config, {});
        } catch (e) {
            console.error("Не удалось загрузить параметры для модального окна:", e);
        }
    }

    async function onFormSubmit(e) {
        e.preventDefault();
        const isEditing = !!editBoardId;
        
        const bplaIdForConfig = isEditing 
            ? boardsData.find(b => b.id === editBoardId).bpla_id 
            : modalBplaSelector.value;

        if (!bplaIdForConfig) return alert('Необходимо выбрать тип БПЛА');

        try {
            // 1. Получаем АКТУАЛЬНУЮ конфигурацию
            const configRes = await fetch(`/api/bpla/${bplaIdForConfig}/setup-config`);
            if (!configRes.ok) throw new Error('Не удалось загрузить конфигурацию для сборки данных');
            const config = await configRes.json();

            // 2. Собираем данные с формы в setup_params
            const setup_params = {};
            for (const key in config.params) {
                const checkbox = document.getElementById(`check_${key}`);
                const dateInput = document.getElementById(`date_${key}`);
                setup_params[key] = (checkbox?.checked && dateInput?.value) ? dateInput.value : null;
            }

            // 3. Формируем тело запроса
            const body = {
                number: document.getElementById('number').value,
                supplier_id: document.getElementById('supplierId').value || null,
                setup_params // <-- НОВОЕ ПОЛЕ
            };
            
            if (!isEditing) {
                body.bpla_id = bplaIdForConfig;
            }
            
            // 4. Определяем URL и метод
            // ИСПОЛЬЗУЕМ НОВЫЕ ЭНДПОИНТЫ
            const url = isEditing ? `/api/setup/${editBoardId}` : '/api/add_board';
            const method = isEditing ? 'PUT' : 'POST'; 
            // (POST /api/add_board должен быть доработан, чтобы принимать setup_params)

            // 5. Отправляем
            const saveRes = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!saveRes.ok) {
                const errorText = await saveRes.text();
                throw new Error(`Ошибка сохранения на сервере: ${errorText}`);
            }
            
            // 6. Успех
            modal.style.display = 'none';
            editBoardId = null;
            await loadAndRenderTable();

        } catch (err) {
            console.error("Ошибка при сохранении:", err);
            alert(`Не удалось сохранить данные. ${err.message}`);
        }
    }

    // --- 6. Прочая логика и обработчики ---

    async function onBplaTypeChange() {
        currentBplaId = bplaSelector.value;
        if (!currentBplaId) {
            tableHead.innerHTML = '';
            tableBody.innerHTML = '';
            filterForm.innerHTML = '';
            return;
        };
        try {
            // ЗАПРАШИВАЕМ НОВЫЙ "ЧЕРТЕЖ"
            const res = await fetch(`/api/bpla/${currentBplaId}/setup-config`);
            if (!res.ok) throw new Error('Конфигурация не найдена');
            currentConfig = await res.json();
            await updateUiForBplaType(); // await здесь важен!
            await loadAndRenderTable();
        } catch (error) { console.error("Не удалось загрузить конфигурацию:", error); }
    }

    // "Живое" обновление галочки в таблице
    tableBody.addEventListener('change', async (e) => {
        if (e.target.classList.contains('table-param-checkbox')) {
            const checkbox = e.target;
            // ВЫЗЫВАЕМ НОВЫЙ ЭНДПОИНТ
            const res = await fetch(`/api/setup/${checkbox.dataset.boardId}/parameter`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    parameter: checkbox.dataset.paramName, 
                    value: checkbox.checked ? new Date().toLocaleDateString('sv-SE') : null 
                })
            });
            if (res.ok) await loadAndRenderTable(); else checkbox.checked = !checkbox.checked;
        }
    });

    // Обработка кнопок Редактировать / Удалить
    tableBody.addEventListener('click', async (e) => {
        const editButton = e.target.closest('.edit-btn');
        if (editButton) {
            openModal(parseInt(editButton.dataset.boardId, 10));
            return;
        }

        const deleteButton = e.target.closest('.delete-btn');
        if (deleteButton) {
            const boardId = deleteButton.dataset.boardId;
            const boardToDelete = boardsData.find(b => b.id == boardId);
            if (!boardToDelete) return;
            if (confirm(`Вы уверены, что хотите удалить борт № ${boardToDelete.number}?`)) {
                try {
                    const res = await fetch(`/api/board/${boardId}`, { method: 'DELETE' });
                    if (!res.ok) throw new Error('Ошибка удаления на сервере');
                    await loadAndRenderTable();
                } catch (error) {
                    console.error('Ошибка при удалении борта:', error);
                    alert('Не удалось удалить борт.');
                }
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
                const boardId = button.dataset.boardId;
                const board = boardsData.find(b => b.id == boardId);
                if (!board) return;

                currentCommentData = {
                    boardId: boardId,
                    paramName: button.dataset.paramName
                };

                document.getElementById('commentParamName').textContent = button.dataset.paramLabel;
                // ИСПОЛЬЗУЕМ НОВЫЕ КОЛОНКИ
                document.getElementById('commentTextarea').value = (board.setup_comments && board.setup_comments[button.dataset.paramName]) || '';
                document.getElementById('semiFinishedSwitch').checked = (board.setup_status === 'semifinished');
                commentModal.style.display = 'flex';
            }
        });

        const saveOrDeleteComment = async (isDelete = false) => {
            const { boardId, paramName } = currentCommentData;
            if (!boardId || !paramName) return;

            const commentText = isDelete ? '' : document.getElementById('commentTextarea').value;
            const isSemiFinished = document.getElementById('semiFinishedSwitch').checked;

            try {
                // ВЫЗЫВАЕМ НОВЫЙ ЭНДПОИНТ
                const response = await fetch(`/api/setup/${boardId}/comment`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        department: 'setup', 
                        parameter: paramName,
                        comment: commentText,
                        is_semi_finished: isSemiFinished
                    })
                });

                if (!response.ok) {
                    const errorText = await response.text();
                    throw new Error(`Ошибка на сервере: ${errorText}`);
                }

                commentModal.style.display = 'none';
                await loadAndRenderTable();
            } catch (error) {
                console.error('Ошибка при сохранении комментария:', error);
                alert(`Не удалось сохранить комментарий.`);
            }
        };
        
        document.getElementById('closeCommentModal').onclick = () => commentModal.style.display = 'none';
        document.getElementById('saveCommentBtn').onclick = () => saveOrDeleteComment(false);
        document.getElementById('deleteCommentBtn').onclick = () => saveOrDeleteComment(true);
    }

    // --- 7. Инициализация страницы ---
    async function init() {
        await Promise.all([loadBplaTypes(), loadSuppliers()]);
        
        bplaSelector.addEventListener('change', onBplaTypeChange);
        modalBplaSelector.addEventListener('change', onModalBplaChange);
        
        if (bplaSelector.options.length > 0) {
            bplaSelector.selectedIndex = 0; // Выбираем первый по умолчанию
            await onBplaTypeChange();
        }
        
        const handleCloseModal = () => {
            modal.style.display = 'none';
            editBoardId = null;
        };

        const debounce = (func, delay = 350) => {
            let timeout;
            return (...args) => { clearTimeout(timeout); timeout = setTimeout(() => func.apply(this, args), delay); };
        };
        const debouncedFilter = debounce(loadAndRenderTable);

        filterForm.addEventListener('input', e => {
            if (e.target.matches('#numberFilter')) {
                debouncedFilter();
            }
        });
        filterForm.addEventListener('change', e => {
            if (e.target.matches('#supplierFilter, #statusFilter, .live-filter')) {
                loadAndRenderTable();
            }
        });
        filterForm.addEventListener('click', e => {
            if (e.target.id === 'resetFilterBtn') {
                filterForm.reset();
                loadAndRenderTable();
            }
        });

        closeModalBtn.addEventListener('click', handleCloseModal);
        window.addEventListener('click', (event) => {
            if (event.target === modal) handleCloseModal();
        });
        form.addEventListener('submit', onFormSubmit);
        
        initCommentEditor();
    }

    init();
});