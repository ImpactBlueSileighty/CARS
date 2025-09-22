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
  secret: 'cars123', // ЗАМЕНИТЕ ЭТО НА СЛУЧАЙНУЮ СТРОКУ
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000 // 30 дней - время жизни "запомнить меня"
  }
}));

// Multer — сохраняет файл под именем из req.body
app.use(express.static(path.join(__dirname, 'public')));


app.post('/api/auth/login', async (req, res) => {
  const { login, password, rememberMe } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE login = $1', [login]);
    if (rows.length === 0) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }
    const user = rows[0];

    const isMatch = await bcrypt.compare(password, user.password_hash);
    console.log(isMatch);
    console.log(user.password_hash);
    if (!isMatch) {
      return res.status(401).json({ error: 'Неверный логин или пароль' });
    }

    req.session.cookie.maxAge = rememberMe ? 30 * 24 * 60 * 60 * 1000 : null;
    req.session.user = { id: user.id, fullName: user.full_name, role: user.role };

    await pool.query('UPDATE users SET last_login_date = NOW() WHERE id = $1', [user.id]);
    res.json(req.session.user);
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// POST /api/auth/logout - Выход пользователя
app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) return res.status(500).json({ error: 'Не удалось выйти' });
    res.clearCookie('connect.sid');
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


// Middleware для проверки, авторизован ли пользователь
const isAuthenticated = (req, res, next) => {
  if (req.session.user) {
    return next();
  }
  // API-запросы (путь начинается с /api/) получают ошибку 401 JSON
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Требуется авторизация' });
  }
  // Все остальные запросы (на страницы) перенаправляются на страницу входа
  res.redirect('/login.html');
};

app.use(isAuthenticated); // Все, что определено НИЖЕ, теперь защищено!
app.use('/images', express.static(path.join(__dirname, 'images')));
app.use('/firmwares', express.static(path.join(__dirname, 'firmwares')));
app.use('/dumps', express.static(path.join(__dirname, 'dumps')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/bpla.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'bpla.html')));
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

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.get('/login.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.post('/api/upload_photo', upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  res.json({ photo_path: req.file.filename });
});

// Получить все борта
app.get('/api/boards', async (req, res) => {
  const { rows } = await pool.query(`
    SELECT b.*, c.name AS controller_name 
    FROM boards b
    LEFT JOIN controller c ON b.controller_id = c.id
    ORDER BY sold_date DESC`);
  res.json(rows);
});

// Получить одну запись
app.get('/api/board/:id', async (req, res) => {
  const { id } = req.params;
  const { rows } = await pool.query('SELECT * FROM boards WHERE id = $1', [id]);
  if (rows.length === 0) return res.status(404).json({ error: 'Not found' });
  res.json(rows[0]);
});

// Добавить новую запись с фото
app.post('/api/add_board', async (req, res) => {
  try {
    const {
      bpla_id, number, controller_id, description, photo_path,
      traction_date, angle_date, acceleration_date, osd_date, 
      osd_configured_date, plugs_date, engine_start_date, supplier_id
    } = req.body;

    const sold_date = new Date().toLocaleDateString('sv-SE');

    const result = await pool.query(
      `INSERT INTO boards (
        bpla_id, number, controller_id, description, photo_path, sold_date,
        traction_date, angle_date, acceleration_date, osd_date, osd_configured_date, plugs_date, engine_start_date, supplier_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`, 
      [
        bpla_id, number, controller_id, description, photo_path, sold_date,
        traction_date, angle_date, acceleration_date, osd_date, osd_configured_date, plugs_date, engine_start_date,
        supplier_id
      ]
    );

    const newBoard = result.rows[0];
    const user = req.session.user;
    logAction(user.id, 'CREATE_BOARD', `Добавлен борт №${newBoard.number}`);
    
    res.status(201).json(newBoard);
  } catch (err) {
    console.error('Ошибка при добавлении борта:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Обновить
app.put('/api/board/:id', async (req, res) => {
  const { id } = req.params;
  const {
    bpla_id, number, controller_id, description,
    traction_date, angle_date, acceleration_date, osd_date, osd_configured_date, plugs_date, engine_start_date, supplier_id
  } = req.body;

  try {
    await pool.query(
      `UPDATE boards SET 
        bpla_id = $1, number = $2, controller_id = $3, description = $4,
        traction_date = $5, angle_date = $6, acceleration_date = $7, osd_date = $8, osd_configured_date = $9,
        plugs_date = $10, engine_start_date = $11, supplier_id = $12
       WHERE id = $13`,
      [
        bpla_id, number, controller_id, description, 
        traction_date, angle_date, acceleration_date, osd_date, 
        osd_configured_date, plugs_date, engine_start_date, supplier_id, id
      ]
    );

    const user = req.session.user;
    logAction(user.id, 'UPDATE_BOARD', `Обновлен борт №${number}`);

    res.sendStatus(200);
  } catch (err) {
    console.error('Ошибка при обновлении борта:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});



// Фильтрация с POST-запросом
app.post('/api/boards/filter', async (req, res) => {
  const { 
    number, controller_id, date_from, date_to, bpla_id, engine_start
  } = req.body;

  let query = `
    SELECT b.*, c.name AS controller_name, bp.name AS bpla_name, s.name AS supplier_name
    FROM boards b
    LEFT JOIN controller c ON b.controller_id = c.id
    LEFT JOIN bpla bp ON b.bpla_id = bp.id
    LEFT JOIN suppliers s ON b.supplier_id = s.id
    WHERE TRUE`;
  const params = [];

  if (bpla_id) {
    try {
        const children = await pool.query('SELECT id FROM bpla WHERE parent_id = $1', [bpla_id]);
        const childIds = children.rows.map(r => r.id);
        const allIds = [bpla_id, ...childIds];
        params.push(allIds);
        query += ` AND b.bpla_id = ANY($${params.length}::int[])`;
    } catch (e) {
        console.error("Ошибка при поиске дочерних БПЛА:", e);
    }
  }

  if (number) {
    params.push(`%${number.trim().toLowerCase()}%`);
    query += ` AND LOWER(TRIM(b.number)) ILIKE $${params.length}`;
  }

  if (engine_start) {
    query += ` AND b.engine_start_date IS NOT NULL`;
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
    console.error('Ошибка фильтрации:', err);
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

app.patch('/api/board/:id/parameter', async (req, res) => {
  const { id } = req.params;
  const { parameter, date } = req.body;

  // Белый список колонок, которые можно обновлять через этот маршрут.
  // Это ВАЖНАЯ мера безопасности.
  const allowedParameters = [
    'traction_date', 'angle_date', 'acceleration_date', 'osd_date', 
    'osd_configured_date', 'plugs_date', 'engine_start_date'
  ];

  if (!allowedParameters.includes(parameter)) {
    return res.status(400).json({ error: 'Недопустимый параметр' });
  }

  try {
    // Динамически и безопасно создаем SQL-запрос
    await pool.query(
      `UPDATE boards SET ${parameter} = $1 WHERE id = $2`,
      [date, id]
    );
    // Логируем действие
    const user = req.session.user;
    const { rows } = await pool.query('SELECT number FROM boards WHERE id = $1', [id]);
    const boardNumber = rows.length > 0 ? rows[0].number : 'Неизвестный';
    const actionDetail = date 
        ? `установил дату для '${parameter}' на борту №${boardNumber}`
        : `снял дату для '${parameter}' на борту №${boardNumber}`;

    logAction(user.id, 'UPDATE_PARAMETER', actionDetail);
    
    res.status(200).json({ message: 'Параметр обновлен' });
  } catch (err) {
    console.error('Ошибка частичного обновления:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
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
    const { rows } = await pool.query('SELECT id, name, parent_id FROM bpla ORDER BY parent_id NULLS FIRST, name');
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
  const { bplaId } = req.query; // Get bplaId from the query parameters

  if (!bplaId) {
    return res.status(400).json({ error: 'BPLA ID is required' });
  }

  try {
    // Fetch the current firmware, filtering by both controller and BPLA
    const firmwareRes = await pool.query(
      `SELECT * FROM firmwares 
       WHERE controller_id = $1 AND bpla_id = $2 AND actual = TRUE 
       ORDER BY uploaded_at DESC LIMIT 1`,
      [controllerId, bplaId]
    );

    // Fetch previous firmwares, filtering by both
    const prevFirmRes = await pool.query(
      `SELECT * FROM firmwares 
       WHERE controller_id = $1 AND bpla_id = $2 AND actual = FALSE 
       ORDER BY uploaded_at DESC`,
      [controllerId, bplaId]
    );

    // Fetch the current dump, filtering by both
    const dumpRes = await pool.query(
      `SELECT * FROM dumps 
       WHERE controller_id = $1 AND bpla_id = $2 AND actual = TRUE 
       ORDER BY uploaded_at DESC LIMIT 1`,
      [controllerId, bplaId]
    );

    // Fetch previous dumps, filtering by both
    const prevDumpRes = await pool.query(
      `SELECT * FROM dumps 
       WHERE controller_id = $1 AND bpla_id = $2 AND actual = FALSE 
       ORDER BY uploaded_at DESC`,
      [controllerId, bplaId]
    );

    res.json({
      current_firmware: firmwareRes.rows[0] || null,
      previous_firmwares: prevFirmRes.rows,
      current_dump: dumpRes.rows[0] || null,
      previous_dumps: prevDumpRes.rows
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error fetching configuration' });
  }
});

app.post('/api/firmware/upload', canUpload, uploadFirmware.single('firmware'), async (req, res) => {
  // Ваша логика загрузки прошивки
});

// Получить итоговую статистику
app.get('/api/statistics', async (req, res) => {
  try {
    const query = `
      SELECT
        bp.name,
        COUNT(b.id) AS total_count,
        
        -- Считаем "готовыми" борты, где ВСЕ даты установлены (не NULL)
        COUNT(b.id) FILTER (
          WHERE b.traction_date IS NOT NULL 
            AND b.angle_date IS NOT NULL 
            AND b.acceleration_date IS NOT NULL 
            AND b.osd_date IS NOT NULL 
            AND b.osd_configured_date IS NOT NULL 
            AND b.plugs_date IS NOT NULL 
            AND b.engine_start_date IS NOT NULL
        ) AS finished_count,

        -- Считаем "в работе" борты, где ХОТЯ БЫ ОДНА дата не установлена (NULL)
        COUNT(b.id) FILTER (
          WHERE b.traction_date IS NULL 
            OR b.angle_date IS NULL 
            OR b.acceleration_date IS NULL 
            OR b.osd_date IS NULL 
            OR b.osd_configured_date IS NULL 
            OR b.plugs_date IS NULL 
            OR b.engine_start_date IS NULL
        ) AS semi_finished_count
        
      FROM bpla bp
      LEFT JOIN boards b ON bp.id = b.bpla_id
      GROUP BY bp.name
      ORDER BY bp.name;
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
 
  const { 
    number, traction_date, angle_date, acceleration_date, osd_date, osd_configured_date, plugs_date, 
    controller_id, date_from, date_to, bpla_id 
  } = req.body;

  let query = `
    SELECT 
      b.number,
      bp.name AS bpla_name,
      c.name AS controller_name,
      b.traction_date,
      b.angle_date,
      b.acceleration_date,
      b.osd_date,
      b.osd_configured_date,
      b.plugs_date,
      b.engine_start_date,
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
      { header: 'Дата созд.', key: 'sold_date', width: 15 },
      { header: 'Тяги', key: 'traction_date', width: 15 },
      { header: 'Углы', key: 'angle_date', width: 15 },
      { header: 'Газ', key: 'acceleration_date', width: 15 },
      { header: 'OSD', key: 'osd_date', width: 15 },
      { header: 'Видео OSD', key: 'osd_configured_date', width: 15 },
      { header: 'Свечи', key: 'plugs_date', width: 15 },
      { header: 'Обкатка', key: 'engine_start_date', width: 15 }, // <-- ДОБАВЛЕНА КОЛОНКА
      { header: 'Описание', key: 'description', width: 40 }
    ];

    // 4. Форматируем булевы значения в "Да/Нет" и добавляем строки
    const formatDate = (date) => date ? new Date(date).toLocaleDateString('ru-RU') : 'Нет';
    const dataForExport = rows.map(row => ({
      number: row.number,
      bpla_name: row.bpla_name,
      controller_name: row.controller_name,
      sold_date: formatDate(row.sold_date),
      traction_date: formatDate(row.traction_date),
      angle_date: formatDate(row.angle_date),
      acceleration_date: formatDate(row.acceleration_date),
      osd_date: formatDate(row.osd_date),
      osd_configured_date: formatDate(row.osd_configured_date),
      plugs_date: formatDate(row.plugs_date),
      engine_start_date: formatDate(row.engine_start_date), // <-- ДОБАВЛЕНО ПОЛЕ
      description: row.description
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

app.get('/api/suppliers', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM suppliers ORDER BY name');
    res.json(rows);
  } catch (err) {
    console.error('Ошибка при получении поставщиков:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});



// GET /api/logs - Получение списка логов
app.get('/api/logs', async (req, res) => {
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
