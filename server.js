const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const bcrypt = require('bcrypt');
const pool = require('./db');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const excel = require('exceljs');

const app = express();

app.use(express.json());

app.use(session({
  store: new PgSession({
    pool: pool,                // Используем наш пул соединений с БД
    tableName: 'user_sessions' // Имя таблицы для хранения сессий
  }),
  secret: 'your_very_secret_key', // ЗАМЕНИТЕ ЭТО НА СЛУЧАЙНУЮ СТРОКУ
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 дней - время жизни "запомнить меня"
  }
}));

// Multer — сохраняет файл под именем из req.body
app.use(express.static(path.join(__dirname, 'public')));
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use('/firmwares', express.static(path.join(__dirname, 'firmwares')));
app.use('/dumps', express.static(path.join(__dirname, 'dumps')));

// Multer — сохраняет файл под именем из req.body
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dest = path.join(__dirname, 'images');
    if (!fs.existsSync(dest)) fs.mkdirSync(dest);
    cb(null, dest);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  }
});
const upload = multer({ storage });

['firmwares', 'dumps'].forEach(dir => {
  const fullPath = path.join(__dirname, dir);
  if (!fs.existsSync(fullPath)) fs.mkdirSync(fullPath, { recursive: true });
});

// Генерация имени файла
function generateFilename(controller, type, ext) {
  const timestamp = new Date().toISOString().replace(/[-T:.Z]/g, '');
  return `${controller}_${type}_${timestamp}${ext}`;
}

// Хранилище для прошивок
const firmwareStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'firmwares'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const controller = req.body.controller_name;
    const filename = generateFilename(controller, 'firmware', ext);
    cb(null, filename);
  }
});
const uploadFirmware = multer({ storage: firmwareStorage });

// Хранилище для дампов
const dumpStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'dumps'));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const controller = req.body.controller_name;
    const filename = generateFilename(controller, 'dump', ext);
    cb(null, filename);
  }
});
const uploadDump = multer({ storage: dumpStorage });

async function logAction(userId, action, details) {
  try {
    await pool.query(
      'INSERT INTO audit_logs (user_id, action, details) VALUES ($1, $2, $3)',
      [userId, action, details]
    );
  } catch (err) {
    console.error('Ошибка записи в лог:', err);
  }
}

// Middleware для проверки, авторизован ли пользователь
function isAuthenticated(req, res, next) {
  if (req.session.user) {
    return next();
  }
  res.status(401).json({ error: 'Требуется авторизация' });
}

// Middleware для проверки роли. Принимает массив разрешенных ролей.
function hasRole(roles) {
  return (req, res, next) => {
    if (req.session.user && roles.includes(req.session.user.role)) {
      return next();
    }
    res.status(403).json({ error: 'Доступ запрещен' });
  };
}
const canUpload = hasRole(['Администратор', 'Начальник отдела испытания', 'Отдел испытаний']);

app.post('/api/upload_photo', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  res.json({ photo_path: req.file.filename });
});

// Получить все борта
app.get('/api/boards', isAuthenticated, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT b.*, c.name AS controller_name 
    FROM boards b
    LEFT JOIN controller c ON b.controller_id = c.id
    ORDER BY sold_date DESC`);
  res.json(rows);
});

// Получить одну запись
app.get('/api/board/:id', isAuthenticated, async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query('SELECT * FROM boards WHERE id = $1', [id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

// Добавить новую запись с фото
app.post('/api/add_board', isAuthenticated, async (req, res) => {
  try {
    const {
      number, traction, angle, acceleration,
      osd, osd_configured, plugs, description,
      photo_path, controller_id, bpla_id // Добавляем controller_id
    } = req.body;

    const sold_date = new Date().toLocaleDateString('sv-SE');

   const result = await pool.query(
      `INSERT INTO boards (
        number, traction, angle, acceleration, 
        osd, osd_configured, plugs, description, sold_date, photo_path, controller_id, bpla_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *`, 
      [
        number, traction, angle, acceleration,
        osd, osd_configured, plugs, description,
        sold_date, photo_path, controller_id, bpla_id 
      ]
    );

    res.status(201).json(result.rows[0]);
    if (res.statusCode === 201) {
      const newBoard = result.rows[0];
      const user = req.session.user;
      logAction(user.id, 'CREATE_BOARD', `Добавлен борт №${newBoard.number}`);
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при добавлении' });
  }
});

// Обновить
app.put('/api/board/:id', async (req, res) => {
  const { id } = req.params;
  const {
    number, traction, angle, acceleration,
    osd, osd_configured, plugs, description, controller_id, bpla_id
  } = req.body;

  await pool.query(
  `UPDATE boards SET 
    number = $1, traction = $2, angle = $3, acceleration = $4, 
    osd = $5, osd_configured = $6, plugs = $7, description = $8,
    controller_id = $9, bpla_id = $11
    WHERE id = $10`,
  [
    number, traction, angle, acceleration,
    osd, osd_configured, plugs, description,
    controller_id, id, bpla_id
  ]
);

  res.sendStatus(200);
});



// Фильтрация с POST-запросом
app.post('/api/boards/filter', isAuthenticated, async (req, res) => {
  const { 
    number, traction, angle, acceleration, osd, osd_configured, plugs, 
    controller_id, date_from, date_to, 
    bpla_id // 👈 ДОБАВЛЯЕМ bpla_id
  } = req.body;

  let query = `
    SELECT b.*, c.name AS controller_name, bp.name AS bpla_name 
    FROM boards b
    LEFT JOIN controller c ON b.controller_id = c.id
    LEFT JOIN bpla bp ON b.bpla_id = bp.id
    WHERE TRUE`;
  const params = [];

  // ✅ НОВЫЙ БЛОК для фильтрации по типу борта
  if (bpla_id) {
    params.push(bpla_id);
    query += ` AND b.bpla_id = $${params.length}`;
  }

  if (number) {
    const searchValue = `%${number.trim().toLowerCase()}%`;
    params.push(searchValue);
    query += ` AND LOWER(TRIM(b.number)) ILIKE $${params.length}`;
  }


  if (traction) {
    query += ` AND b.traction = TRUE`;
  }

  if (angle) {
    query += ` AND b.angle = TRUE`;
  }

  if (acceleration) {
    query += ` AND b.acceleration = TRUE`;
  }

  if (osd) {
    query += ` AND b.osd = TRUE`;
  }

  if (osd_configured) {
    query += ` AND b.osd_configured = TRUE`;
  }

  if (plugs) {
    query += ` AND b.plugs = TRUE`;
  }
  
  if (controller_id) {
    params.push(controller_id);
    query += ` AND b.controller_id = $${params.length}`;
  }

  if (date_from) {
    params.push(date_from);
    query += ` AND b.sold_date >= $${params.length}`;
  }

  if (date_to) {
    params.push(date_to);
    query += ` AND b.sold_date <= $${params.length}`;
  }

  query += ' ORDER BY b.sold_date DESC';

  try {
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка фильтрации' });
  }
});



app.put('/api/board/:id/photo', upload.single('photo'), async (req, res) => {
  const { id } = req.params;

  try {
    const { rows } = await pool.query('SELECT photo_path FROM boards WHERE id = $1', [id]);
    if (rows.length === 0) return res.status(404).json({ error: 'Board not found' });

    const oldPhoto = rows[0].photo_path;
    if (oldPhoto) {
      const oldPath = path.join(__dirname, 'images', oldPhoto);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }

    if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });

    const ext = path.extname(req.file.originalname);
    const newFileName = `board_${id}${ext}`;
    const newPath = path.join(__dirname, 'images', newFileName);
    fs.renameSync(req.file.path, newPath);

    await pool.query('UPDATE boards SET photo_path = $1 WHERE id = $2', [newFileName, id]);

    res.json({ photo_path: newFileName });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при обновлении фото' });
  }
});

// Получить все пк
app.get('/api/controllers', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM controller ORDER BY name');
  res.json(rows);
});


// Удалить
app.delete('/api/board/:id', async (req, res) => {
  const { id } = req.params;
  const result = await pool.query('DELETE FROM boards WHERE id = $1 RETURNING *', [id]);
  if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ message: 'Deleted', board: result.rows[0] });
  if (result.rows.length > 0) {
        const deletedBoard = result.rows[0];
        const user = req.session.user;
        logAction(user.id, 'DELETE_BOARD', `Удален борт №${deletedBoard.number}`);
  }
});

// /bpla

// Получить все БПЛА
app.get('/api/bpla', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM bpla ORDER BY name');
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении БПЛА' });
  }
});

app.post('/api/boards', async (req, res) => {
  const { bpla_id } = req.body;

  let query = `
    SELECT b.*, c.name AS controller_name 
    FROM boards b
    LEFT JOIN controller c ON b.controller_id = c.id
  `;
  const params = [];

  if (bpla_id) {
    query += ` WHERE b.bpla_id = $1`;
    params.push(bpla_id);
  }

  query += ' ORDER BY sold_date DESC';

  try {
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении бортов' });
  }
});

// Получить контроллеры для БПЛА
app.get('/api/bpla/:bplaId/controllers', async (req, res) => {
  const { bplaId } = req.params;
  try {
    const { rows } = await pool.query(`
      SELECT c.id, c.name, c.dump
      FROM controller c
      JOIN bpla_controller bc ON c.id = bc.controller_id
      WHERE bc.bpla_id = $1
      ORDER BY c.name
    `, [bplaId]);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении контроллеров' });
  }
});

// Получить конфигурацию контроллера
app.get('/api/controller/:controllerId/config', async (req, res) => {
  const { controllerId } = req.params;

  try {
    // Актуальная прошивка
    const firmwareRes = await pool.query(
      `SELECT * FROM firmwares WHERE controller_id = $1 AND actual = TRUE ORDER BY uploaded_at DESC LIMIT 1`,
      [controllerId]
    );

    // Все предыдущие прошивки
    const prevFirmRes = await pool.query(
      `SELECT * FROM firmwares WHERE controller_id = $1 AND actual = FALSE ORDER BY uploaded_at DESC`,
      [controllerId]
    );

    // Актуальный дамп
    const dumpRes = await pool.query(
      `SELECT * FROM dumps WHERE controller_id = $1 AND actual = TRUE ORDER BY uploaded_at DESC LIMIT 1`,
      [controllerId]
    );

    // Все предыдущие дампы
    const prevDumpRes = await pool.query(
      `SELECT * FROM dumps WHERE controller_id = $1 AND actual = FALSE ORDER BY uploaded_at DESC`,
      [controllerId]
    );

    res.json({
      current_firmware: firmwareRes.rows[0] || null,
      previous_firmwares: prevFirmRes.rows,
      current_dump: dumpRes.rows[0] || null,
      previous_dumps: prevDumpRes.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка при получении конфигурации' });
  }
});

app.post('/api/firmware/upload', isAuthenticated, canUpload, uploadFirmware.single('firmware'), async (req, res) => {
  // Ваша логика загрузки прошивки
});

// Получить итоговую статистику
app.get('/api/statistics', async (req, res) => {
  try {
    // Этот SQL-запрос — вся магия. Он группирует борты по типу
    // и считает три разных значения для каждой группы.
    const query = `
      SELECT
        bp.name,
        -- 1. Считаем общее количество бортов для каждого типа
        COUNT(b.id) AS total_count,
        -- 2. Считаем "готовые" борты, где все галочки = TRUE
        COUNT(b.id) FILTER (
          WHERE b.traction AND b.angle AND b.acceleration AND b.osd AND b.osd_configured AND b.plugs
        ) AS finished_count,
        -- 3. Считаем "полуфабрикаты", где ХОТЯ БЫ одна галочка = FALSE
        COUNT(b.id) FILTER (
          WHERE NOT (b.traction AND b.angle AND b.acceleration AND b.osd AND b.osd_configured AND b.plugs)
        ) AS semi_finished_count
      FROM
        bpla bp
      LEFT JOIN
        -- LEFT JOIN важен, чтобы типы, у которых 0 бортов, тоже отображались
        boards b ON bp.id = b.bpla_id
      GROUP BY
        bp.name
      ORDER BY
        bp.name;
    `;
    const { rows } = await pool.query(query);
    res.json(rows);
  } catch (err) {
    console.error('Ошибка при получении статистики:', err);
    res.status(500).json({ error: 'Ошибка на сервере' });
  }
});



// НОВЫЙ МЕТОД: Экспорт бортов в Excel
app.post('/api/boards/export', async (req, res) => {
  // --- Начало: Копируем логику фильтрации из /api/boards/filter ---
  const { 
    number, traction, angle, acceleration, osd, osd_configured, plugs, 
    controller_id, date_from, date_to, bpla_id 
  } = req.body;

  let query = `
    SELECT 
      b.number,
      bp.name AS bpla_name,
      c.name AS controller_name,
      b.traction,
      b.angle,
      b.acceleration,
      b.osd,
      b.osd_configured,
      b.plugs,
      b.description,
      b.sold_date
    FROM boards b
    LEFT JOIN controller c ON b.controller_id = c.id
    LEFT JOIN bpla bp ON b.bpla_id = bp.id
    WHERE TRUE`;
  const params = [];

  if (bpla_id) {
    params.push(bpla_id);
    query += ` AND b.bpla_id = $${params.length}`;
  }
  if (number) {
    params.push(`%${number.trim().toLowerCase()}%`);
    query += ` AND LOWER(TRIM(b.number)) ILIKE $${params.length}`;
  }
  // ... добавьте сюда остальные if-блоки для галочек, контроллера и дат,
  // ... точно так же, как в вашем методе /api/boards/filter

  query += ' ORDER BY b.sold_date DESC';
  // --- Конец: Логика фильтрации ---

  try {
    // 1. Получаем отфильтрованные данные из БД
    const { rows } = await pool.query(query, params);

    // 2. Создаем Excel-книгу и лист
    const workbook = new excel.Workbook();
    const worksheet = workbook.addWorksheet('Борты');

    // 3. Определяем колонки и их заголовки
    worksheet.columns = [
      { header: 'Номер борта', key: 'number', width: 15 },
      { header: 'Тип БПЛА', key: 'bpla_name', width: 15 },
      { header: 'Контроллер', key: 'controller_name', width: 20 },
      { header: 'Дата', key: 'sold_date', width: 15 },
      { header: 'Тяги', key: 'traction', width: 10 },
      { header: 'Углы', key: 'angle', width: 10 },
      { header: 'Газ', key: 'acceleration', width: 10 },
      { header: 'OSD', key: 'osd', width: 10 },
      { header: 'Прошивка OSD', key: 'osd_configured', width: 15 },
      { header: 'Свечи', key: 'plugs', width: 10 },
      { header: 'Описание', key: 'description', width: 40 }
    ];

    // 4. Форматируем булевы значения в "Да/Нет" и добавляем строки
    const dataForExport = rows.map(row => ({
      ...row,
      sold_date: new Date(row.sold_date).toLocaleDateString('ru-RU'),
      traction: row.traction ? 'Да' : 'Нет',
      angle: row.angle ? 'Да' : 'Нет',
      acceleration: row.acceleration ? 'Да' : 'Нет',
      osd: row.osd ? 'Да' : 'Нет',
      osd_configured: row.osd_configured ? 'Да' : 'Нет',
      plugs: row.plugs ? 'Да' : 'Нет'
    }));
    worksheet.addRows(dataForExport);

    // 5. Стилизуем заголовок (делаем его жирным)
    worksheet.getRow(1).font = { bold: true };

    // 6. Устанавливаем заголовки для ответа, чтобы браузер понял, что это файл
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="bpla_export_${new Date().toISOString().split('T')[0]}.xlsx"`
    );

    // 7. Отправляем файл клиенту
    await workbook.xlsx.write(res);
    res.end();

  } catch (err) {
    console.error('Ошибка при экспорте в Excel:', err);
    res.status(500).send('Ошибка при создании файла');
  }
});


app.post('/api/auth/login', async (req, res) => {
  const { login, password } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE login = $1', [login]);
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }
    const user = rows[0];

    const isMatch = await bcrypt.compare(password, user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    // Сохраняем пользователя в сессию
    req.session.user = {
      id: user.id,
      fullName: user.full_name,
      role: user.role
    };
    
    // Обновляем дату последнего входа
    await pool.query('UPDATE users SET last_login_date = NOW() WHERE id = $1', [user.id]);

    res.json({ id: user.id, fullName: user.full_name, role: user.role });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// POST /api/auth/logout - Выход пользователя
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      return res.status(500).json({ error: 'Не удалось выйти' });
    }
    res.clearCookie('connect.sid'); // connect.sid - имя cookie по умолчанию
    res.json({ message: 'Вы успешно вышли' });
  });
});

// GET /api/auth/status - Проверка текущей сессии
app.get('/api/auth/status', (req, res) => {
  if (req.session.user) {
    res.json({ loggedIn: true, user: req.session.user });
  } else {
    res.json({ loggedIn: false });
  }
});

// GET /api/logs - Получение списка логов
app.get('/api/logs', isAuthenticated, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT l.action, l.details, l.created_at, u.full_name
      FROM audit_logs l
      JOIN users u ON l.user_id = u.id
      ORDER BY l.created_at DESC
      LIMIT 100; -- Ограничим вывод последними 100 записями
    `);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Ошибка получения логов' });
  }
});



// Запуск
app.listen(3000, () => console.log('API running on http://localhost:3000'));
