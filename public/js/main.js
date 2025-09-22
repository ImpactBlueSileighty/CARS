// Этот скрипт будет выполняться на каждой защищенной странице
document.addEventListener('DOMContentLoaded', () => {
    // Эта функция будет вызвана только если пользователь уже авторизован
    // так как неавторизованных пользователей сервер не пустит на страницу.
    fetch('/api/auth/status')
        .then(res => res.json())
        .then(data => {
            if (!data.loggedIn) {
                window.location.href = '/login.html';
                return;
            }
            if (data.loggedIn) {
                const userNameEl = document.getElementById('userName');
                const userRoleEl = document.getElementById('userRole');
                const logoutBtn = document.getElementById('logoutBtn');

                if(userNameEl) userNameEl.textContent = data.user.fullName;
                if(userRoleEl) userRoleEl.textContent = data.user.role;
                if(logoutBtn) {
                    logoutBtn.addEventListener('click', async (e) => {
                        e.preventDefault();
                        await fetch('/api/auth/logout', { method: 'POST' });
                        window.location.href = '/login.html';
                    });
                }
            }
        });
});
