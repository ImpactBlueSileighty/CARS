document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const login = document.getElementById('login').value;
  const password = document.getElementById('password').value;
  const errorMessage = document.getElementById('error-message');
  
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ login, password })
  });

  if (res.ok) {
    window.location.href = '/'; // Перенаправляем на главную после успешного входа
  } else {
    const data = await res.json();
    errorMessage.textContent = data.error || 'Произошла ошибка';
  }
});