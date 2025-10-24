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


    // --- 3. Функции для работы с API ---

    async function loadBplaTypes() {
        try {
            const res = await fetch('/api/bpla');
            const bplaTypes = await res.json();
            const parentIds = new Set(bplaTypes.map(b => b.parent_id).filter(id => id !== null));
            const filteredBplas = bplaTypes.filter(b => !parentIds.has(b.id));
            bplaSelector.innerHTML = '';
            modalBplaSelector.innerHTML = '<option value="">-- Выберите тип --</option>'; // Добавлен плейсхолдер
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
            engines: Array.from(document.querySelectorAll('input[name="engineFilter"]:checked')).map(cb => cb.value)
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
            const res = await fetch('/api/workshop/filter', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(getFilters())
            });
            if (!res.ok) throw new Error('Ошибка сети');
            boardsData = await res.json();
            renderTable(boardsData);
        } catch (error) { console.error('Ошибка загрузки данных (цех):', error); }
    }


    // --- 4. Функции для отрисовки UI ---

    async function updateUiForBplaType() {
        let headersHtml = `<tr><th>Номер</th><th>Поставщик</th><th>ДВС</th>`;
        for (const key in currentConfig.params) { headersHtml += `<th>${currentConfig.params[key]}</th>`; }
        headersHtml += `<th>Действия</th></tr>`;
        tableHead.innerHTML = headersHtml;

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
        if (currentConfig.engines?.length > 0) {
            filterHtml += `<fieldset class="checkbox-fieldset"><legend>Двигатель</legend><div class="checkbox-group">`;
            currentConfig.engines.forEach(engine => { filterHtml += `<label><input type="checkbox" name="engineFilter" value="${engine}" class="live-filter" /> ${engine}</label>`; });
            filterHtml += `</div></fieldset>`;
        }
        filterHtml += `<fieldset class="checkbox-fieldset"><legend>Параметры</legend><div class="checkbox-group params-filter-group">`;
        for (const key in currentConfig.params) { filterHtml += `<label><input type="checkbox" data-param-name="${key}" class="live-filter" /> ${currentConfig.params[key]}</label>`; }
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
            
            const workshopParams = board.workshop_params || {};
            let paramsHtml = `<td>${workshopParams.dvs || 'N/A'}</td>`;
            for (const key in currentConfig.params) {
                const dateValue = workshopParams[key];
                const comment = board.workshop_comments ? board.workshop_comments[key] : null;
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

    // Рендер полей внутри модального окна на основе "чертежа"
    function renderModalParams(config, savedParams = {}) {
        modalParamsFieldset.innerHTML = '<legend>Параметры</legend>';
        let engineHtml = `<div class="param-group"><label>ДВС</label><select id="param_dvs">`;
        (config.engines || []).forEach(engine => {
            engineHtml += `<option value="${engine}" ${savedParams.dvs === engine ? 'selected' : ''}>${engine}</option>`;
        });
        engineHtml += `</select></div>`;
        modalParamsFieldset.insertAdjacentHTML('beforeend', engineHtml);

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
            renderModalParams(currentConfig, board.workshop_params || {});
        } else { // Режим создания
            modalBplaSelector.disabled = false;
            modalBplaSelector.value = '';
            document.getElementById('number').value = '';
            document.getElementById('supplierId').value = '';
            modalParamsFieldset.innerHTML = '<legend>Параметры</legend><p>Сначала выберите тип БПЛА.</p>';
        }
        modal.style.display = 'flex';
    }

    window.editWorkshopBoard = async (id) => {
        editBoardId = id;
        const board = boardsData.find(b => b.id === id);
        if (!board) return alert('Борт не найден');

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
            modal.style.display = 'flex';
        } catch (e) {
            console.error("Не удалось загрузить параметры для редактирования:", e);
        }
    };

    window.deleteWorkshopBoard = async (id) => {
        if (!confirm('Вы уверены, что хотите удалить борт?')) return;
        await fetch(`/api/board/${id}`, { method: 'DELETE' });
        await loadAndRenderTable();
    };
    
    async function onFormSubmit(e) {
        e.preventDefault(); // Предотвращаем стандартное поведение формы

        // Определяем, в каком режиме мы работаем: создание или редактирование
        const isEditing = !!editBoardId;
        
        // Получаем ID БПЛА. Для нового борта - из селектора, для старого - из данных.
        const bplaIdForConfig = isEditing 
            ? boardsData.find(b => b.id === editBoardId).bpla_id 
            : modalBplaSelector.value;

        if (!bplaIdForConfig) {
            alert('Необходимо выбрать тип БПЛА');
            return;
        }

        try {
            // Шаг 1: Получаем АКТУАЛЬНУЮ конфигурацию для этого типа БПЛА.
            // Это "чертёж", по которому мы будем собирать данные с формы.
            const configRes = await fetch(`/api/bpla/${bplaIdForConfig}/workshop-config`);
            if (!configRes.ok) throw new Error('Не удалось загрузить конфигурацию для сборки данных');
            const config = await configRes.json();

            // Шаг 2: Собираем данные с формы согласно "чертежу".
            const workshop_params = {
                // Сначала забираем значение двигателя
                dvs: document.getElementById('param_dvs')?.value || null
            };

            // Теперь проходимся по всем параметрам из конфигурации
            for (const key in config.params) {
                const checkbox = document.getElementById(`check_${key}`);
                const dateInput = document.getElementById(`date_${key}`);
                
                // Записываем дату только если чекбокс отмечен и в поле даты есть значение
                // Иначе - записываем null. Это очистит поле в базе, если галочку сняли.
                workshop_params[key] = (checkbox?.checked && dateInput?.value) ? dateInput.value : null;
            }

            // Шаг 3: Формируем тело запроса
            const body = {
                number: document.getElementById('number').value,
                supplier_id: document.getElementById('supplierId').value || null,
                workshop_params // Собранные выше параметры
            };
            
            // Для новых бортов нужно также передать bpla_id
            if (!isEditing) {
                body.bpla_id = bplaIdForConfig;
            }
            
            // Шаг 4: Определяем URL и метод для отправки
            const url = isEditing ? `/api/workshop/${editBoardId}` : '/api/board';
            const method = isEditing ? 'PUT' : 'POST';

            // Шаг 5: Отправляем запрос
            const saveRes = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });

            if (!saveRes.ok) {
                const errorText = await saveRes.text();
                throw new Error(`Ошибка сохранения на сервере: ${errorText}`);
            }
            
            // Шаг 6: В случае успеха закрываем окно и обновляем таблицу
            modal.style.display = 'none';
            editBoardId = null; // Сбрасываем ID
            await loadAndRenderTable();

        } catch (err) {
            console.error("Ошибка при сохранении:", err);
            alert(`Не удалось сохранить данные. ${err.message}`);
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
            await updateUiForBplaType(); // await здесь важен!
            await loadAndRenderTable();
        } catch (error) { console.error("Не удалось загрузить конфигурацию:", error); }
    }

    // "Живое" обновление галочки в таблице
    tableBody.addEventListener('change', async (e) => {
        if (e.target.classList.contains('table-param-checkbox')) {
            const checkbox = e.target;
            const res = await fetch(`/api/workshop/${checkbox.dataset.boardId}/parameter`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ parameter: checkbox.dataset.paramName, value: checkbox.checked ? new Date().toLocaleDateString('sv-SE') : null })
            });
            if (res.ok) await loadAndRenderTable(); else checkbox.checked = !checkbox.checked;
        }
    });

    tableBody.addEventListener('click', async (e) => {
    const editButton = e.target.closest('.edit-btn');
    if (editButton) {
        openModal(parseInt(editButton.dataset.boardId, 10));
        return; // Выходим, чтобы не обрабатывать другие клики
    }

    const deleteButton = e.target.closest('.delete-btn');
        if (deleteButton) {
            const boardToDelete = boardsData.find(b => b.id == boardId);
            if (!boardToDelete) return;
            if (confirm(`Вы уверены, что хотите удалить борт № ${boardToDelete.number}?`)) {
                try {
                    const res = await fetch(`/api/board/${boardId}`, { method: 'DELETE' });
                    if (!res.ok) throw new Error('Ошибка удаления на сервере');
                    
                    await loadAndRenderTable(); // Обновляем таблицу после успешного удаления
                } catch (error) {
                    console.error('Ошибка при удалении борта:', error);
                    alert('Не удалось удалить борт.');
                }
            }
        }
    });

    function initCommentEditor() {
        // --- Обработчики для всплывающей подсказки (tooltip) ---
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

        // --- Логика модального окна комментариев ---
        let currentCommentData = {};
        
        tableBody.addEventListener('click', e => {
            // Ищем клик именно по кнопке редактирования комментария
            if (e.target.classList.contains('edit-comment-btn')) {
                const button = e.target;
                const boardId = button.dataset.boardId;
                const board = boardsData.find(b => b.id == boardId);
                if (!board) return;

                // Сохраняем контекст для отправки на сервер
                currentCommentData = {
                    boardId: boardId,
                    paramName: button.dataset.paramName
                };

                // Заполняем модальное окно данными
                document.getElementById('commentParamName').textContent = button.dataset.paramLabel;
                
                // ИЗМЕНЕНИЕ: Используем `workshop_comments` для получения текста
                document.getElementById('commentTextarea').value = (board.workshop_comments && board.workshop_comments[button.dataset.paramName]) || '';
                
                // ИЗМЕНЕНИЕ: Используем `workshop_status` для проверки статуса
                document.getElementById('semiFinishedSwitch').checked = (board.workshop_status === 'semifinished');
                
                commentModal.style.display = 'flex';
            }
        });

        const saveOrDeleteComment = async (isDelete = false) => {
            const { boardId, paramName } = currentCommentData;
            if (!boardId || !paramName) return;

            const commentText = isDelete ? '' : document.getElementById('commentTextarea').value;
            const isSemiFinished = document.getElementById('semiFinishedSwitch').checked;

            try {
                const response = await fetch(`/api/workshop/${boardId}/comment`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        // ИЗМЕНЕНИЕ: Указываем правильный отдел
                        department: 'workshop', 
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
                alert(`Не удалось сохранить комментарий. Детали в консоли (F12).`);
            }
        };
        
        // Привязываем события к кнопкам модального окна
        document.getElementById('closeCommentModal').onclick = () => commentModal.style.display = 'none';
        document.getElementById('saveCommentBtn').onclick = () => saveOrDeleteComment(false);
        document.getElementById('deleteCommentBtn').onclick = () => saveOrDeleteComment(true);
    }


    // --- 7. Инициализация страницы ---
    async function init() {
        await Promise.all([loadBplaTypes(), loadSuppliers()]);
        bplaSelector.addEventListener('change', onBplaTypeChange);
        if (bplaSelector.options.length > 0) {
            await onBplaTypeChange();
        }
        
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
        
        const handleCloseModal = () => {
            modal.style.display = 'none';
            editBoardId = null;
        };
        openModalBtn.addEventListener('click', () => openModal(null));
        closeModalBtn.addEventListener('click', handleCloseModal);
        window.addEventListener('click', (event) => {
            if (event.target === modal) handleCloseModal();
        });
        form.addEventListener('submit', onFormSubmit);
        
        initCommentEditor();
    }

    init();
});