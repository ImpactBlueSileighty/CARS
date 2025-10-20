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
    req.session.user = { id: user.id, fullName: user.full_name, role: user.role, avatar: user.avatar };

    await pool.query('UPDATE users SET last_login_date = NOW() WHERE id = $1', [user.id]);
    res.json(req.session.user);
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

app.put('/api/user/avatar', async (req, res) => {
    if (!req.session.user) {
        return res.status(401).json({ error: 'Требуется авторизация' });
    }
    const { avatar } = req.body;
    const userId = req.session.user.id;

    if (!avatar) {
        return res.status(400).json({ error: 'Недопустимый аватар' });
    }

    // Проверяем, что такой файл действительно существует на сервере
    const avatarPath = path.join(__dirname, 'public', 'avatars', avatar);
    if (!fs.existsSync(avatarPath)) {
        return res.status(400).json({ error: 'Выбранный аватар не существует' });
    }

    try {
        await pool.query('UPDATE users SET avatar = $1 WHERE id = $2', [avatar, userId]);
        req.session.user.avatar = avatar;
        res.json({ success: true, avatar: avatar });
    } catch (err) {
        console.error('Ошибка обновления аватара:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/avatars', (req, res) => {
    const avatarsPath = path.join(__dirname, 'public', 'avatars');
    fs.readdir(avatarsPath, (err, files) => {
        if (err) {
            console.error("Не удалось прочитать папку с аватарами:", err);
            return res.status(500).json({ error: 'Ошибка сервера' });
        }
        // Отправляем только файлы изображений
        const imageFiles = files.filter(file => /\.(png|jpg|jpeg|svg|gif)$/i.test(file));
        res.json(imageFiles);
    });
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

app.use('/images', express.static(path.join(__dirname, 'images')));
app.use(isAuthenticated); // Все, что определено НИЖЕ, теперь защищено!

app.use('/firmwares', express.static(path.join(__dirname, 'firmwares')));
app.use('/dumps', express.static(path.join(__dirname, 'dumps')));

app.get('/', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'workshop.html'));
});
app.get('/bpla.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'bpla.html')));
app.get('/setup.html', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'setup.html'));
});
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
    ORDER BY finished_date DESC`);
  res.json(rows);
});

// Получить одну запись
app.get('/api/board/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { rows } = await pool.query('SELECT * FROM boards WHERE id = $1', [id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Борт не найден' });
    }
    
    res.json(rows[0]);

  } catch (err) {
    console.error(`Ошибка при получении борта ID ${id}:`, err);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// Добавить новую запись с фото
app.post('/api/add_board', async (req, res) => {
  try {
    // 1. Принимаем все возможные параметры
    const { bpla_id, number, supplier_id, controller_id, workshop_params, electrical_params } = req.body;

    if (!number || number.trim() === '') {
        return res.status(400).json({ error: 'Номер борта является обязательным полем.' });
    }
    
    // 2. Универсальная SQL-команда для вставки
    const result = await pool.query(
      `INSERT INTO boards (bpla_id, number, supplier_id, controller_id, workshop_params, electrical_params, creation_date) 
       VALUES ($1, $2, $3, $4, $5, $6, NOW()) 
       RETURNING *`,
      // Если какой-то параметр не пришел, он вставится как NULL
      [bpla_id, number, supplier_id, controller_id || null, workshop_params || null, electrical_params || null]
    );

    const newBoard = result.rows[0];
    const user = req.session.user;
    if (user) {
        logAction(user.id, 'CREATE_BOARD', `Добавлен борт №${newBoard.number}`);
    }
    
    res.status(201).json(newBoard);
  } catch (err) {
    console.error('Ошибка при добавлении борта:', err);
    res.status(500).json({ error: 'Ошибка сервера при сохранении борта.' });
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
      number, controller_id, date_from, date_to, bpla_id,
      traction, angle, acceleration, osd, osd_configured, plugs, engine_start,
      status 
  } = req.body;

  const finishedCondition = `(
      b.traction_date IS NOT NULL AND b.angle_date IS NOT NULL AND 
      b.acceleration_date IS NOT NULL AND b.osd_date IS NOT NULL AND 
      b.osd_configured_date IS NOT NULL AND b.plugs_date IS NOT NULL AND 
      b.engine_start_date IS NOT NULL
  )`;

  let query = `
      SELECT b.*, c.name AS controller_name, bp.name AS bpla_name, s.name AS supplier_name
      FROM boards b
      LEFT JOIN controller c ON b.controller_id = c.id
      LEFT JOIN bpla bp ON b.bpla_id = bp.id
      LEFT JOIN suppliers s ON b.supplier_id = s.id
      WHERE TRUE`;
  const params = []

  // Основные фильтры (поиск, контроллер, даты, тип БПЛА)
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
  if (controller_id) {
    params.push(controller_id);
    query += ` AND b.controller_id = $${params.length}`;
  }
  if (date_from) {
    params.push(date_from);
    query += ` AND b.finished_date >= $${params.length}`;
  }
  if (date_to) {
    params.push(date_to);
    query += ` AND b.finished_date <= $${params.length}`;
  }

  // 3. Логика фильтрации по статусу и параметрам
  // Фильтр по общему статусу ("Готовые" / "В работе") имеет приоритет
  if (status === 'finished') {
      query += ` AND ${finishedCondition}`;
  } else if (status === 'in_progress') {
      query += ` AND NOT ${finishedCondition}`;
  } else {
      if (traction) query += ` AND b.traction_date IS NOT NULL`;
      if (angle) query += ` AND b.angle_date IS NOT NULL`;
      if (acceleration) query += ` AND b.acceleration_date IS NOT NULL`;
      if (osd) query += ` AND b.osd_date IS NOT NULL`;
      if (osd_configured) query += ` AND b.osd_configured_date IS NOT NULL`;
      if (plugs) query += ` AND b.plugs_date IS NOT NULL`;
      if (engine_start) query += ` AND b.engine_start_date IS NOT NULL`;
  }

  query += " ORDER BY string_to_array(b.number, '.')::int[] ASC";

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

app.patch('/api/board/:id/parameter', isAuthenticated, async (req, res) => {
    const { id } = req.params;
    const { parameter, date } = req.body;

    // --- ВАЖНО: Белый список параметров ---
    // Чтобы предотвратить SQL-инъекции, мы разрешаем обновлять только
    // заранее определенные столбцы. Это критически важно для безопасности.
    const allowedParameters = [
        'traction_date', 'angle_date', 'acceleration_date', 'osd_date', 
        'osd_configured_date', 'plugs_date', 'engine_start_date'
    ];

    if (!allowedParameters.includes(parameter)) {
        return res.status(400).json({ error: 'Недопустимый параметр для обновления' });
    }

    try {
        // Динамически строим запрос, используя белый список для имени столбца.
        // Значения ($1, $2) передаются безопасно через параметры.
        const query = `UPDATE boards SET ${parameter} = $1 WHERE id = $2 RETURNING *`;
        
        const { rows } = await pool.query(query, [date, id]);

        if (rows.length > 0) {
            res.json(rows[0]);
        } else {
            res.status(404).json({ error: 'Борт не найден' });
        }
    } catch (err) {
        console.error(`Ошибка при обновлении параметра '${parameter}' для борта ${id}:`, err);
        res.status(500).json({ error: 'Ошибка на сервере при обновлении параметра' });
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

  query += ' ORDER BY finished_date DESC';

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
      b.finished_date
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

  query += ' ORDER BY b.finished_date DESC';
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
      { header: 'Дата созд.', key: 'finished_date', width: 15 },
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
      finished_date: formatDate(row.finished_date),
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

app.get('/summary.html', isAuthenticated, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'summary.html'));
});

// --- ОБНОВЛЕННЫЙ МАРШРУТ ДЛЯ СТАТИСТИКИ ---
app.get('/api/summary/statistics', async (req, res) => {
    try {
        const query = `
            WITH board_statuses AS (
                SELECT
                    b.bpla_id,
                    b.finished_date,
                    b.is_fully_finished,
                    CASE
                        WHEN b.is_fully_finished = TRUE THEN 'green'
                        WHEN (
                            /*
                             * Логика "красного" статуса, исправленная под вашу структуру БД.
                             * Мы проверяем отдельный столбец для двигателя и заглядываем
                             * внутрь JSONB-поля 'workshop_params' для остальных параметров.
                             */
                            (b.workshop_comments->>'engine_installation' IS NOT NULL AND b.engine_installation_date IS NULL) OR
                            (b.workshop_comments->>'catapult_hooks' IS NOT NULL AND b.workshop_params->>'catapult_hooks' IS NULL) OR
                            (b.workshop_comments->>'fuel_system' IS NOT NULL AND b.workshop_params->>'fuel_system' IS NULL) OR
                            (b.workshop_comments->>'rods' IS NOT NULL AND b.workshop_params->>'rods' IS NULL) OR
                            (b.workshop_comments->>'lead_weight' IS NOT NULL AND b.workshop_params->>'lead_weight' IS NULL)
                        ) THEN 'red'
                        ELSE 'orange'
                    END as status_color
                FROM boards b
            )
            SELECT 
                bp.name as bpla_name,
                COUNT(bs.bpla_id) FILTER (WHERE bs.status_color = 'green') as green,
                COUNT(bs.bpla_id) FILTER (WHERE bs.status_color = 'green' AND bs.finished_date = CURRENT_DATE) as green_today,
                COUNT(bs.bpla_id) FILTER (WHERE bs.status_color = 'red') as red,
                COUNT(bs.bpla_id) FILTER (WHERE bs.status_color = 'orange') as orange
            FROM board_statuses bs
            LEFT JOIN bpla bp ON bs.bpla_id = bp.id
            GROUP BY bp.name
            ORDER BY bp.name;
        `;
        const { rows } = await pool.query(query);
        res.json(rows);
    } catch (err) {
        console.error('Ошибка при получении статистики для сводки:', err);
        res.status(500).json({ error: 'Ошибка на сервере' });
    }
});



// --- ФИНАЛЬНЫЙ ИСПРАВЛЕННЫЙ МАРШРУТ ДЛЯ ФИЛЬТРАЦИИ ---
app.post('/api/summary/filter', async (req, res) => {
    const { number, supplier_id, bpla_id, status } = req.body;

    let query = `
        WITH board_statuses AS (
            SELECT
                b.*, 
                s.name as supplier_name, 
                bp.name as bpla_name,
                CASE
                    WHEN b.is_fully_finished = TRUE THEN 'green'
                    WHEN (
                        (b.workshop_comments->>'engine_installation' IS NOT NULL AND b.engine_installation_date IS NULL) OR
                        (b.workshop_comments->>'catapult_hooks' IS NOT NULL AND b.workshop_params->>'catapult_hooks' IS NULL) OR
                        (b.workshop_comments->>'fuel_system' IS NOT NULL AND b.workshop_params->>'fuel_system' IS NULL) OR
                        (b.workshop_comments->>'rods' IS NOT NULL AND b.workshop_params->>'rods' IS NULL) OR
                        (b.workshop_comments->>'lead_weight' IS NOT NULL AND b.workshop_params->>'lead_weight' IS NULL)
                    ) THEN 'red'
                    ELSE 'orange'
                END as status_color
            FROM boards b
            LEFT JOIN suppliers s ON b.supplier_id = s.id
            LEFT JOIN bpla bp ON b.bpla_id = bp.id
        )
        SELECT 
            *,
            (engine_installation_date IS NOT NULL AND 
             workshop_params->>'catapult_hooks' IS NOT NULL AND 
             workshop_params->>'fuel_system' IS NOT NULL AND 
             workshop_params->>'rods' IS NOT NULL AND 
             workshop_params->>'lead_weight' IS NOT NULL) as workshop_complete,
            (traction_date IS NOT NULL AND angle_date IS NOT NULL AND acceleration_date IS NOT NULL AND osd_date IS NOT NULL AND osd_configured_date IS NOT NULL AND plugs_date IS NOT NULL AND engine_start_date IS NOT NULL) as setup_complete
        FROM board_statuses
        WHERE TRUE
    `;
    
    const params = [];

    if (number) { 
        params.push(`%${number.trim().toLowerCase()}%`); 
        query += ` AND LOWER(TRIM(number)) ILIKE $${params.length}`; 
    }
    if (supplier_id) { 
        params.push(supplier_id); 
        query += ` AND supplier_id = $${params.length}`; 
    }
    if (bpla_id) { 
        params.push(bpla_id); 
        // ИСПРАВЛЕНО: Убрали некорректный псевдоним 'b.'
        query += ` AND bpla_id = $${params.length}`; 
    }

    if (status) {
        if (status === 'finished') { query += ` AND status_color = 'green'`; } 
        else if (status === 'overdue') { query += ` AND status_color = 'red'`; } 
        else if (status === 'today') { query += ` AND status_color = 'orange' AND creation_date = CURRENT_DATE`; }
    }
    
    query += ' ORDER BY is_fully_finished ASC, id DESC';

    try {
        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        // Эта ошибка теперь не должна появляться
        console.error('Ошибка фильтрации для сводки:', err);
        res.status(500).json({ error: 'Ошибка фильтрации' });
    }
});


app.post('/api/workshop/:id/comment', async (req, res) => {
    const { id } = req.params;
    const { parameter, comment } = req.body;

    try {
        if (comment && comment.trim() !== '') {
            // Если комментарий не пустой - добавляем или обновляем его
            await pool.query(
                `UPDATE boards 
                 SET workshop_comments = jsonb_set(COALESCE(workshop_comments, '{}'::jsonb), $1, $2)
                 WHERE id = $3`,
                [`{${parameter}}`, `"${comment}"`, id]
            );
            logAction(req.session.user.id, 'ADD_WORKSHOP_COMMENT', `Добавлен/изменен комментарий к борту ID ${id}`);
        } else {
            // Если комментарий пустой - удаляем ключ из JSON
            await pool.query(
                `UPDATE boards 
                 SET workshop_comments = workshop_comments - $1
                 WHERE id = $2`,
                [parameter, id]
            );
            await pool.query(
                `UPDATE boards
                 SET workshop_comments = NULL
                 WHERE id = $1 AND workshop_comments = '{}'::jsonb`,
                [id]
            );
            logAction(req.session.user.id, 'DELETE_WORKSHOP_COMMENT', `Удален комментарий с борта ID ${id}`);
        }
        res.sendStatus(200);
    } catch (err) {
        console.error('Ошибка сохранения/удаления комментария (цех):', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});


app.put('/api/workshop/:id', async (req, res) => {
    const { id } = req.params;
    const { number, supplier_id, workshop_params } = req.body;
    try {
        await pool.query(
            'UPDATE boards SET number = $1, supplier_id = $2, workshop_params = $3 WHERE id = $4',
            [number, supplier_id, workshop_params, id]
        );
        res.sendStatus(200);
    } catch (e) {
        res.status(500).json({error: "Server error"});
    }
});


// Фильтрация для страницы "Слесарный цех"
app.post('/api/workshop/filter', async (req, res) => {
    // 1. Явно извлекаем 'engines', чтобы он не попал в ...paramsFilters
    const { bpla_id, number, supplier_id, engines, ...paramsFilters } = req.body; 
    
    let query = `
        SELECT b.id, b.number, b.bpla_id, b.supplier_id, b.workshop_params, b.workshop_comments, s.name as supplier_name, bp.name as bpla_name
        FROM boards b
        LEFT JOIN suppliers s ON b.supplier_id = s.id
        LEFT JOIN bpla bp ON b.bpla_id = bp.id
        WHERE b.bpla_id = $1`;
    const params = [bpla_id];

    if (number) {
        params.push(`%${number.trim().toLowerCase()}%`);
        query += ` AND LOWER(TRIM(b.number)) ILIKE $${params.length}`;
    }
    if (supplier_id) {
        params.push(supplier_id);
        query += ` AND b.supplier_id = $${params.length}`;
    }

    // ✨=============== НАЧАЛО ИЗМЕНЕНИЙ ===============✨
    // 2. Добавляем новый блок для фильтрации по двигателям
    if (engines && engines.length > 0) {
        params.push(engines);
        // Используем синтаксис ->>'dvs' для извлечения текстового значения ключа 'dvs' из JSONB-поля
        // и оператор = ANY($N::text[]) для безопасной проверки вхождения в массив в PostgreSQL
        query += ` AND b.workshop_params->>'dvs' = ANY($${params.length}::text[])`;
    }
    // ✨================ КОНЕЦ ИЗМЕНЕНИЙ ================✨

    // Динамически добавляем фильтры по остальным параметрам (чекбоксы)
    for (const key in paramsFilters) {
        if (paramsFilters[key] === true) {
            // Проверяем, что ключ существует и его значение не null
            query += ` AND b.workshop_params ->> '${key}' IS NOT NULL`;
        }
    }

    query += ` ORDER BY ((string_to_array(b.number, '.'))[array_length(string_to_array(b.number, '.'), 1)])::integer ASC`;

    try {
        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (e) {
        console.error("Ошибка фильтрации (цех):", e);
        res.status(500).json({error: "Server error"});
    }
});

// Обновление одного параметра (галочки) для таблицы "Слесарный цех"
app.patch('/api/workshop/:id/parameter', async (req, res) => {
    const { id } = req.params;
    const { parameter, value } = req.body; // Принимаем 'value', а не 'date'

    // Проверка, что параметр вообще передан
    if (!parameter) {
        return res.status(400).json({ error: 'Имя параметра не указано' });
    }

    try {
        // Используем функцию jsonb_set для атомарного обновления ключа в JSON-объекте.
        // COALESCE гарантирует, что если workshop_params равен NULL, он будет обработан как пустой JSON '{}'
        const query = `
            UPDATE boards
            SET workshop_params = jsonb_set(COALESCE(workshop_params, '{}'::jsonb), $1, $2)
            WHERE id = $3
        `;

        // '{parameter}' - это путь в JSON, а JSON.stringify(value) - это значение, которое мы вставляем.
        await pool.query(query, [`{${parameter}}`, JSON.stringify(value), id]);

        logAction(req.session.user.id, 'UPDATE_WORKSHOP_PARAM', `Обновлен параметр цеха '${parameter}' для борта ID ${id}`);
        res.status(200).json({ message: 'Параметр обновлен' });
    } catch (err) {
        console.error('Ошибка частичного обновления (цех):', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

const workshopConfigs = {
    '2': { 
        params: { 'chassis': 'Шасси', 'tail_booms': 'Хвостовые балки', 'fuel_system': 'Топливная система', 'foam_gluing': 'Вклейка пены' },
        engines: ['DLE55RA', 'DLE55', 'DLE60']
    },
    '3': { 
        params: { 'tail_boom_assembly': 'Сборка хвост. балки', 'catapult_hooks': 'Зацепы катапульты', 'fuel_system': 'Топливная система', 'rods': 'Тяги' },
        engines: ['NGH38']
    },
    '4': { 
        params: { 'lead_weight': 'Свинцовый груз', 'catapult_hooks': 'Зацепы катапульты', 'fuel_system': 'Топливная система', 'rods': 'Тяги'},
        engines: ['DLE 120', 'Stinger'] // Предполагаем те же двигатели, что у Дельта Турбо. Измените, если нужно.
    },
    '6': { 
        params: { 'lead_weight': 'Свинцовый груз', 'catapult_hooks': 'Зацепы катапульты', 'fuel_system': 'Топливная система', 'rods': 'Тяги'},
        engines: ['DLE 120', 'Stinger']
    },
    '5': {
        params: { 'catapult_hooks': 'Зацепы катапульты', 'fuel_system': 'Топливная система', 'rods': 'Тяги', 'fairing': 'Обтекатель', 'parachute_compartment': 'Отсек под парашют', 'parachute_slings': 'Стропы парашюта'},
        engines: ['Турбина Swiwin Turbojet']
    }
    // Добавьте сюда конфигурации для Дельта М и Дельта ТМ по их ID
};

const electricalConfigs = {
    '2': { params: ['telemetry_id', 'bec_id', 'gps_id', 'video_tx_id', 'pvd_id', 'seal_number'] },
    '3': { params: ['telemetry_id', 'bec_id', 'gps_id', 'video_tx_id', 'pvd_id'] },
    '4': { params: ['telemetry_id', 'bec_id', 'gps_id', 'video_tx_id'] },
    '5': { params: ['telemetry_id', 'bec_id', 'gps_id', 'video_tx_id'] },
    '6': { params: ['telemetry_id', 'bec_id', 'gps_id', 'video_tx_id'] }
};

const electricalParamLabels = {
    'telemetry_id': 'Модуль телеметрии', 'bec_id': 'BEC', 'gps_id': 'GPS модуль',
    'video_tx_id': 'Видеопередатчик', 'pvd_id': 'ПВД', 'seal_number': 'Номер пломбы'
};

app.get('/api/bpla/:id/electrical-config', (req, res) => {
    const bplaId = req.params.id;
    const paramKeys = electricalConfigs[bplaId]?.params;
    if (paramKeys) {
        const params = paramKeys.reduce((obj, key) => {
            obj[key] = electricalParamLabels[key] || key;
            return obj;
        }, {});
        res.json({ params });
    } else {
        res.status(404).json({ error: 'Конфигурация не найдена' });
    }
});

app.get('/api/bpla/:bplaId/compatible-controllers', async (req, res) => {
    const { bplaId } = req.params;
    try {
        const { rows } = await pool.query(`
            SELECT c.id, c.name FROM controller c
            JOIN bpla_controller bc ON c.id = bc.controller_id
            WHERE bc.bpla_id = $1 ORDER BY c.name
        `, [bplaId]);
        res.json(rows);
    } catch (e) {
        console.error("Ошибка получения совместимых контроллеров:", e);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.get('/api/electrical/components/:bplaId', async (req, res) => {
    const { bplaId } = req.params;
    const createQuery = (componentTable, compatTable, componentFk, componentPk = 'id') => {
        const sql = `
            SELECT t1.${componentPk}, t1.model_name FROM public.${componentTable} t1
            JOIN public.${compatTable} t2 ON t1.${componentPk} = t2.${componentFk}
            WHERE t2.bpla_id = $1 ORDER BY t1.model_name`;
        return pool.query(sql, [bplaId]);
    };
    try {
        const [telemetries, becs, gps, video_txs, pvds] = await Promise.all([
            createQuery('telemetry_modules', 'bpla_telemetry_compatibility', 'telemetry_module_id'),
            createQuery('bec_modules', 'bpla_bec_compatibility', 'bec_module_id'),
            createQuery('gps_modules', 'bpla_gps_compatibility', 'gps_module_id'),
            createQuery('video_transmitters', 'bpla_video_tx_compatibility', 'video_transmitter_id'),
            createQuery('pvd_modules', 'bpla_pvd_compatibility', 'pvd_module_id')
        ]);
        res.json({
            telemetry_modules: telemetries.rows,
            bec_models: becs.rows,
            gps_models: gps.rows,
            video_transmitters: video_txs.rows,
            pvd_models: pvds.rows
        });
    } catch (e) {
        console.error("Ошибка загрузки компонентов электромонтажа из БД:", e);
        res.status(500).json({ error: "Ошибка на сервере" });
    }
});

// Фильтрация для таблицы электромонтажа
app.post('/api/electrical/filter', async (req, res) => {
    const { bpla_id, number, supplier_id, ...paramsFilters } = req.body;
    
    let query = `
        SELECT b.id, b.number, b.bpla_id, b.supplier_id, b.controller_id, b.electrical_params, s.name as supplier_name, c.name as controller_name
        FROM boards b
        LEFT JOIN suppliers s ON b.supplier_id = s.id
        LEFT JOIN controller c ON b.controller_id = c.id
        WHERE b.bpla_id = $1`;
        
    const params = [bpla_id];

    if (number) {
        params.push(`%${number.trim().toLowerCase()}%`);
        query += ` AND LOWER(TRIM(b.number)) ILIKE $${params.length}`;
    }
    if (supplier_id) {
        params.push(supplier_id);
        query += ` AND b.supplier_id = $${params.length}`;
    }

    // ИЗМЕНЕНИЕ: Добавляем проверку не только на NULL, но и на пустую строку
    for (const key in paramsFilters) {
        if (paramsFilters[key] === true) {
            // Эта проверка теперь отсеет и отсутствующие ключи, и ключи с null, и ключи с ""
            query += ` AND b.electrical_params->>'${key}' IS NOT NULL AND b.electrical_params->>'${key}' != ''`;
        }
    }
    
    query += ' ORDER BY b.id DESC';

    try {
        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (e) {
        console.error("Ошибка фильтрации (электромонтаж):", e);
        res.status(500).json({error: "Server error"});
    }
});

app.put('/api/electrical/:id', async (req, res) => {
    const { id } = req.params;
    const { number, supplier_id, controller_id, electrical_params } = req.body;
    try {
        await pool.query(
            'UPDATE boards SET number = $1, supplier_id = $2, controller_id = $3, electrical_params = $4 WHERE id = $5',
            [number, supplier_id, controller_id, electrical_params, id]
        );
        res.sendStatus(200);
    } catch (e) {
        console.error("Ошибка обновления (электромонтаж):", e);
        res.status(500).json({error: "Server error"});
    }
});


app.get('/api/bpla/:id/workshop-config', (req, res) => {
    const config = workshopConfigs[req.params.id];
    if (config) {
        res.json(config);
    } else {
        res.status(404).json({ error: 'Конфигурация для этого типа БПЛА не найдена' });
    }
});


app.patch('/api/board/:id/semifinished', async (req, res) => {
  const { id } = req.params;
  const { params } = req.body; // Ожидаем массив строк, например ["Неисправность 1", "Проблема с питанием"]

  // Простая валидация
  if (!Array.isArray(params)) {
    return res.status(400).json({ error: 'Параметры должны быть массивом.' });
  }

  try {
    // Если массив пустой, записываем NULL, иначе - сам массив в JSON
    const paramsToSave = params.length > 0 ? JSON.stringify(params) : null;
    
    await pool.query(
      'UPDATE boards SET semi_finished_params = $1 WHERE id = $2',
      [paramsToSave, id]
    );

    const user = req.session.user;
    logAction(user.id, 'UPDATE_SEMI_FINISHED', `Обновлены параметры ПФ для борта ID ${id}`);
    
    res.status(200).json({ message: 'Параметры ПФ обновлены' });
  } catch (err) {
    console.error('Ошибка обновления параметров ПФ:', err);
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

app.get('/api/bpla/:bplaId/compatible-controllers', async (req, res) => {
    const { bplaId } = req.params;
    try {
        const { rows } = await pool.query(`
            SELECT c.id, c.name FROM controller c
            JOIN bpla_controller bc ON c.id = bc.controller_id
            WHERE bc.bpla_id = $1
            ORDER BY c.name
        `, [bplaId]);
        res.json(rows);
    } catch (e) {
        console.error("Ошибка получения совместимых контроллеров:", e);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});



async function checkAndUpdateFullReadiness(boardId, userId) { // Теперь принимаем userId
    const allParams = [
        'traction_date', 'angle_date', 'acceleration_date', 'osd_date', 'osd_configured_date', 'plugs_date', 'engine_start_date',
        'engine_installation_date', 'catapult_hooks_date', 'fuel_system_date', 'workshop_rods_date', 'lead_weight_date'
    ];
    try {
        const { rows } = await pool.query('SELECT * FROM boards WHERE id = $1', [boardId]);
        if (rows.length === 0) return;
        const board = rows[0];
        const isNowFullyFinished = allParams.every(param => board[param] !== null);
        if (board.is_fully_finished !== isNowFullyFinished) {
            if (isNowFullyFinished) {
                await pool.query(
                    'UPDATE boards SET is_fully_finished = TRUE, finished_date = NOW() WHERE id = $1',
                    [boardId]
                );
                if (userId) logAction(userId, 'FINISH_BOARD', `Борт №${board.number} помечен как готовый`);
            } else {
                await pool.query(
                    'UPDATE boards SET is_fully_finished = FALSE, finished_date = NULL WHERE id = $1',
                    [boardId]
                );
            }
        }
    } catch (error) {
        console.error(`Ошибка при обновлении статуса готовности борта ${boardId}:`, error);
    }
}
// Запуск
app.listen(3000, () => console.log('API running on http://localhost:3000'));
