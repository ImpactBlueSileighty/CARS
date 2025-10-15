document.addEventListener('DOMContentLoaded', () => {
    const sidebarPlaceholder = document.getElementById('sidebar-placeholder');
    
    if (sidebarPlaceholder) {
        fetch('/_sidebar.html')
            .then(response => {
                if (!response.ok) throw new Error('Не удалось загрузить сайдбар (_sidebar.html)');
                return response.text();
            })
            .then(html => {
                sidebarPlaceholder.innerHTML = html;
                initializeSidebarLogic();
            })
            .catch(error => {
                console.error("Критическая ошибка:", error);
                if (sidebarPlaceholder) sidebarPlaceholder.innerHTML = '<p style="color: red; padding: 1rem;">Ошибка загрузки сайдбара.</p>';
            });
    }

    function initializeSidebarLogic() {
        const userNameEl = document.getElementById('userName');
        const userRoleEl = document.getElementById('userRole');
        const logoutBtn = document.getElementById('logoutBtn');
        const userAvatarEl = document.getElementById('sidebarAvatar');

        // 1. Подсветка активной ссылки
        // Определяем текущий путь. '/' теперь считаем главной страницей цеха.
        const currentPath = window.location.pathname === '/' ? '/workshop.html' : window.location.pathname;
        // Ищем ссылку, которая ТОЧНО соответствует текущему пути
        const activeLink = document.querySelector(`.sidebar-nav a[href='${currentPath}']`);
        if (activeLink) {
            activeLink.classList.add('active');
            const parentSection = activeLink.closest('.nav-section');
            if (parentSection) {
                parentSection.open = true;
            }
        }

        // 2. Отображение пользователя и кнопка "Выйти"
        fetch('/api/auth/status')
            .then(res => res.json())
            .then(data => {
                if (data.loggedIn) {
                    if(userNameEl) userNameEl.textContent = data.user.fullName;
                    if(userRoleEl) userRoleEl.textContent = data.user.role;
                    if (userAvatarEl && data.user.avatar) {
                        userAvatarEl.src = `/avatars/${data.user.avatar}`;
                    }
                } else {
                    window.location.href = '/login.html'; // Если не залогинен - на страницу входа
                }
            });

        if(logoutBtn) {
            logoutBtn.addEventListener('click', async (e) => {
                e.preventDefault();
                await fetch('/api/auth/logout', { method: 'POST' });
                window.location.href = '/login.html';
            });
        }
        
        // 3. Логика для выбора аватара
         if (userAvatarEl) {
            userAvatarEl.addEventListener('click', (event) => {
                event.stopPropagation();
                showAvatarPicker(userAvatarEl);
            });
        }
    }

    async function showAvatarPicker(targetElement) {
        const pickerContainer = document.getElementById('avatar-picker-container');
        if (!pickerContainer) {
            console.error('Ошибка: контейнер #avatar-picker-container не найден на странице.');
            return;
        }

        if (pickerContainer.innerHTML !== '') {
            pickerContainer.innerHTML = '';
            return;
        }

        try {
            const res = await fetch('/api/avatars');
            if (!res.ok) throw new Error('Не удалось получить список аватарок');
            const avatars = await res.json();

            const panel = document.createElement('div');
            panel.className = 'avatar-picker-panel';
            panel.onclick = (e) => e.stopPropagation();

            avatars.forEach(avatarFile => {
                const option = document.createElement('div');
                option.className = 'avatar-option';
                option.innerHTML = `<img src="/avatars/${avatarFile}" alt="${avatarFile}">`;
                option.onclick = () => selectAvatar(avatarFile);
                panel.appendChild(option);
            });
            
            // --- ИЗМЕНЕНА ЛОГИКА ПОЗИЦИОНИРОВАНИЯ ---
            // 1. Вставляем панель в DOM, но делаем ее невидимой, чтобы измерить высоту
            panel.style.visibility = 'hidden';
            pickerContainer.appendChild(panel);

            // 2. Получаем размеры аватара и самой панели
            const panelHeight = panel.offsetHeight;
            const rect = targetElement.getBoundingClientRect();

            // 3. Вычисляем новую позицию СВЕРХУ от аватара
            panel.style.top = `${window.scrollY + rect.top - panelHeight - 10}px`; // rect.top минус высота панели и отступ
            panel.style.left = `${window.scrollX + rect.left}px`;

            // 4. Теперь, когда панель спозиционирована, делаем ее видимой
            panel.style.visibility = 'visible';
            // --- КОНЕЦ ИЗМЕНЕНИЙ ---
            
            setTimeout(() => {
                document.addEventListener('click', () => {
                    pickerContainer.innerHTML = '';
                }, { once: true });
            }, 0);
        } catch (error) {
            console.error("Не удалось загрузить список аватарок:", error);
        }
    }

    async function selectAvatar(avatarFile) {
        try {
            await fetch('/api/user/avatar', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ avatar: avatarFile })
            });
            document.getElementById('sidebarAvatar').src = `/avatars/${avatarFile}`;
            document.querySelector('.avatar-picker-panel')?.remove();
        } catch (error) {
            alert('Не удалось сменить аватар.');
            console.error(error);
        }
    }
});