const bcrypt = require('bcrypt');

// ❗️ Впишите сюда пароль, который хотите захешировать
const plainPassword = 'kachalin2025';

// "Сложность" хэширования. 10 — стандартное и надёжное значение.
const saltRounds = 10;

// Асинхронная функция для генерации хэша
async function generateHash() {
  try {
    console.log(`Исходный пароль: ${plainPassword}`);
    
    const hash = await bcrypt.hash(plainPassword, saltRounds);
    
    console.log('✅ Успешно! Вот ваш захешированный пароль:');
    console.log(hash);
    
  } catch (error) {
    console.error('Произошла ошибка при хэшировании:', error);
  }
}

generateHash();