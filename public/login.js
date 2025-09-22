document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const login = document.getElementById('login').value;
  const password = document.getElementById('password').value;
  const rememberMe = document.getElementById('rememberMe').checked;
  const errorMessage = document.getElementById('error-message');
  
  errorMessage.textContent = ''; // Очищаем ошибку перед новым запросом

  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password, rememberMe })
  });

  if (res.ok) {
    window.location.href = '/'; // Перенаправляем на главную
  } else {
    try {
        const data = await res.json();
        errorMessage.textContent = data.error || 'Произошла неизвестная ошибка';
    } catch {
        errorMessage.textContent = 'Ошибка сервера. Попробуйте снова.';
    }
  }
});