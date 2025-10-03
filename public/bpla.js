document.addEventListener('DOMContentLoaded', () => {

  const bplaNameSelect = document.getElementById('bplaName');
  const controllerTypeSelect = document.getElementById('controllerType');
  const resultDiv = document.getElementById('result');
  const currentFilesDiv = document.getElementById('currentFiles');
  const previousVersionsDiv = document.getElementById('previousVersions');

  // Загрузка списка БПЛА при старте
  async function loadBPLA() {
    try {
      const res = await fetch('/api/bpla');
      const bplas = await res.json();

      // --- НОВАЯ ЛОГИКА ФИЛЬТРАЦИИ ---
      // 1. Находим ID всех БПЛА, которые являются родителями для других.
      const parentIds = new Set(
        bplas
          .map(b => b.parent_id)
          .filter(id => id !== null) // Убираем null значения
      );

      // 2. Из общего списка убираем те, чьи ID находятся в списке родителей.
      const filteredBplas = bplas.filter(b => !parentIds.has(b.id));
      // ---------------------------------

      bplaNameSelect.innerHTML = '<option value="">Выберите БПЛА</option>';
      
      // Используем отфильтрованный список для создания опций
      filteredBplas.forEach(b => {
        const option = document.createElement('option');
        option.value = b.id;
        option.textContent = b.name;
        bplaNameSelect.appendChild(option);
      });

    } catch (err) {
      console.error('Ошибка загрузки списка БПЛА:', err);
      bplaNameSelect.innerHTML = '<option value="">Ошибка загрузки</option>';
    }
  }
  // Загрузка контроллеров для выбранного БПЛА
  bplaNameSelect.addEventListener('change', async () => {
    const bplaId = bplaNameSelect.value;
    controllerTypeSelect.innerHTML = '<option value="">Загрузка...</option>';

    if (!bplaId) return;

    try {
      const res = await fetch(`/api/bpla/${bplaId}/controllers`);
      const controllers = await res.json();
      controllerTypeSelect.innerHTML = '<option value="">Выберите контроллер</option>';
      controllers.forEach(c => {
        const option = document.createElement('option');
        option.value = c.id;
        option.textContent = `${c.name} (${c.dump})`;
        controllerTypeSelect.appendChild(option);
      });
    } catch (err) {
      console.error(err);
      controllerTypeSelect.innerHTML = '<option value="">Ошибка</option>';
    }
  });

  // Загрузка конфигурации при выборе контроллера
  controllerTypeSelect.addEventListener('change', loadConfig);

  async function loadConfig() {
    const controllerId = controllerTypeSelect.value;
    const bplaId = bplaNameSelect.value; // Get the selected BPLA ID

    if (!controllerId || !bplaId) { // Ensure both are selected
      resultDiv.style.display = 'none';
      return;
    }

    try {
      // Add bplaId as a query parameter to the URL
      const res = await fetch(`/api/controller/${controllerId}/config?bplaId=${bplaId}`);
      const data = await res.json();

      // The rest of your function remains the same...
      if (!data.current_firmware && !data.current_dump) {
        currentFilesDiv.innerHTML = `<p>Для этой комбинации БПЛА и контроллера нет актуальных файлов.</p>`;
        document.getElementById('versionsDetails').style.display = 'none';
        resultDiv.style.display = 'block';
        return;
    }

      // Показать актуальные файлы
      currentFilesDiv.innerHTML = `
        <div class="file-item">
          <span><strong>Прошивка:</strong> ${data.current_firmware.file_path}</span>
          <a href="/firmwares/${data.current_firmware.file_path}" download>💾 Скачать</a>
        </div>
        <div class="file-item">
          <span><strong>Дамп:</strong> ${data.current_dump.file_path}</span>
          <a href="/dumps/${data.current_dump.file_path}" download>💾 Скачать</a>
        </div>
      `;

      // Показать предыдущие версии
      if (data.previous_firmwares.length > 0 || data.previous_dumps.length > 0) {
        previousVersionsDiv.innerHTML = '';
        data.previous_firmwares.forEach(f => {
          const div = document.createElement('div');
          div.className = 'version-item';
          div.innerHTML = `
            ${new Date(f.uploaded_at).toLocaleString('ru-RU')} —
            <strong>Прошивка:</strong> ${f.file_path} —
            <a href="/firmwares/${f.file_path}" download>Скачать</a>
          `;
          previousVersionsDiv.appendChild(div);
        });
        data.previous_dumps.forEach(d => {
          const div = document.createElement('div');
          div.className = 'version-item';
          div.innerHTML = `
            ${new Date(d.uploaded_at).toLocaleString('ru-RU')} —
            <strong>Дамп:</strong> ${d.file_path} —
            <a href="/dumps/${d.file_path}" download>Скачать</a>
          `;
          previousVersionsDiv.appendChild(div);
        });
        document.getElementById('versionsDetails').style.display = 'block';
      } else {
        document.getElementById('versionsDetails').style.display = 'none';
      }

      resultDiv.style.display = 'block';
    } catch (err) {
      console.error(err);
      alert('Ошибка загрузки конфигурации');
    }
  }

  // Загрузка при старте
  loadBPLA();
});