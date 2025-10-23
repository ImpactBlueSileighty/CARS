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
    store: new PgSession({ pool: pool, tableName: 'user_sessions' }),
    secret: 'cars123',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 30 * 24 * 60 * 60 * 1000 }
}));

// Multer — сохраняет файл под именем из req.body
app.use(express.static(path.join(__dirname, 'public')));


app.post('/api/auth/login', async (req, res) => {
    const { login, password, rememberMe } = req.body;
    try {
        // ИСПРАВЛЕНО: использует 'login'
        const { rows } = await pool.query('SELECT * FROM users WHERE login = $1', [login]);
        if (rows.length === 0) {
            return res.status(401).json({ error: 'Неверный логин или пароль' });
        }
        const user = rows[0];

        // ИСПРАВЛЕНО: использует 'password_hash'
        const isMatch = await bcrypt.compare(password, user.password_hash);
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


const isAuthenticated = (req, res, next) => {
    if (req.session.user) return next();
    if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Требуется авторизация' });
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
// API для БПЛА
app.get('/api/bpla', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT id, name, parent_id FROM bpla ORDER BY name');
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


// API для поставщиков
app.get('/api/suppliers', async (req, res) => {
    try {
        const { rows } = await pool.query('SELECT * FROM suppliers ORDER BY name');
        res.json(rows);
    } catch (err) {
        console.error('Ошибка получения поставщиков:', err);
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


// API для обновления комментария и статуса ПФ
app.post('/api/workshop/:boardId/comment', async (req, res) => {
    const { boardId } = req.params;
    const { parameter, comment, is_semi_finished, department } = req.body;
    if (!department || !['workshop', 'electrical', 'setup'].includes(department)) {
        return res.status(400).json({ error: 'Не указан корректный отдел' });
    }
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        // --- КЛЮЧЕВОЕ ИСПРАВЛЕНИЕ №1: Добавлен флаг `true` для создания полей ---
        await client.query(
            `UPDATE boards SET department_statuses = jsonb_set(COALESCE(department_statuses, '{}'::jsonb), '{${department}, is_semi_finished}', to_jsonb($1::boolean), true) WHERE id = $2`,
            [!!is_semi_finished, boardId]
        );
        const commentColumn = `${department}_comments`;
        await client.query(
            `UPDATE boards SET ${commentColumn} = jsonb_set(COALESCE(${commentColumn}, '{}'::jsonb), '{${parameter}}', to_jsonb($1::text), true) WHERE id = $2`,
            [comment, boardId]
        );
        await client.query('COMMIT');
        res.sendStatus(200);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Ошибка сохранения комментария/статуса:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    } finally {
        client.release();
    }
});

app.patch('/api/board/:id/set-semifinished', async (req, res) => {
    const { id } = req.params;
    const { department, is_semi_finished } = req.body;
    const statusColumn = `${department}_status`;
    const newStatus = is_semi_finished ? 'semifinished' : 'in_progress';

    try {
        await pool.query(`UPDATE boards SET ${statusColumn} = $1 WHERE id = $2`, [newStatus, id]);
        // Если мы снимаем флаг "Полуфабрикат", нужно пересчитать статус "Готов"
        if (!is_semi_finished) {
            await recalculateBoardStatus(id, department);
        }
        res.sendStatus(200);
    } catch (err) {
        console.error('Ошибка обновления статуса полуфабриката:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});


app.post('/api/workshop/filter', async (req, res) => {
    const { bpla_id, status } = req.body;
    if (!bpla_id) return res.status(400).json({ error: 'Не указан ID БПЛА' });
    try {
        let query = `
            SELECT b.*, s.name as supplier_name, bp.name as bpla_name,
                   CASE 
                       WHEN b.workshop_status = 'semifinished' THEN 'red'
                       WHEN b.workshop_status = 'finished' THEN 'green'
                       ELSE 'orange'
                   END as status_color
            FROM boards b
            LEFT JOIN suppliers s ON b.supplier_id = s.id
            LEFT JOIN bpla bp ON b.bpla_id = bp.id
            WHERE b.bpla_id = $1`;
        const params = [bpla_id];

        if (status) {
            query += ` AND b.workshop_status = $${params.length + 1}`;
            params.push(status);
        }
        
        query += ` ORDER BY CASE WHEN b.workshop_status = 'in_progress' THEN 0 WHEN b.workshop_status = 'finished' THEN 1 ELSE 2 END, b.creation_date DESC`;
        
        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (e) {
        res.status(500).json({error: "Ошибка на сервере"});
    }
});

// API для обновления параметра (галочки) в цеху
app.patch('/api/workshop/:id/parameter', async (req, res) => {
    const { id } = req.params;
    const { parameter, value } = req.body;
    try {
        await pool.query(
            `UPDATE boards SET workshop_params = jsonb_set(COALESCE(workshop_params, '{}'::jsonb), '{${parameter}}', to_jsonb($1::text), true) WHERE id = $2`,
            [value, id]
        );
        // После обновления параметра, ПЕРЕСЧИТЫВАЕМ СТАТУС "ГОТОВ"
        await recalculateBoardStatus(id, 'workshop');
        res.sendStatus(200);
    } catch (err) {
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

app.patch('/api/electrical/:id/parameter', async (req, res) => {
    const { id } = req.params;
    const { parameter, value } = req.body; // Ожидаем, например, { parameter: 'telemetry_id', value: '5' }

    if (!parameter) {
        return res.status(400).json({ error: 'Имя параметра не указано' });
    }

    try {
        // Обновляем значение компонента в JSONB-поле electrical_params
        await pool.query(
            `UPDATE boards 
             SET electrical_params = jsonb_set(
                COALESCE(electrical_params, '{}'::jsonb), 
                '{${parameter}}', 
                to_jsonb($1::text), 
                true
             ) 
             WHERE id = $2`,
            [value, id]
        );
        
        // После обновления параметра, ПЕРЕСЧИТЫВАЕМ СТАТУС "ГОТОВ"
        await recalculateBoardStatus(id, 'electrical');
        
        res.sendStatus(200);
    } catch (err) {
        console.error('Ошибка обновления параметра (электромонтаж):', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});

async function recalculateBoardStatus(boardId, department) {
    const boardRes = await pool.query(`SELECT bpla_id, ${department}_params FROM boards WHERE id = $1`, [boardId]);
    if (!boardRes.rows.length) return;

    const board = boardRes.rows[0];
    const configColumn = department === 'workshop' ? 'workshop_config' : 'electrical_config';
    const configRes = await pool.query(`SELECT ${configColumn} FROM bpla WHERE id = $1`, [board.bpla_id]);
    const config = configRes.rows[0]?.[configColumn];

    if (!config?.params) return;

    const paramKeys = Object.keys(config.params);
    const paramsData = board[`${department}_params`];
    const isFinished = paramKeys.every(key => paramsData?.[key] != null && paramsData?.[key] !== '');
    const newStatus = isFinished ? 'finished' : 'in_progress';
    
    const statusColumn = `${department}_status`;
    // Обновляем статус, только если он не "Полуфабрикат"
    await pool.query(
        `UPDATE boards SET ${statusColumn} = $1 WHERE id = $2 AND ${statusColumn} != 'semifinished'`,
        [newStatus, boardId]
    );
}

const electricalConfigs = {
    '2': { params: ['telemetry_id', 'bec_id', 'gps_id', 'video_tx_id', 'pvd_id', 'seal_number'] },
    '1': { params: ['telemetry_id', 'bec_id', 'gps_id', 'video_tx_id', 'pvd_id'] },
    '4': { params: ['telemetry_id', 'bec_id', 'gps_id', 'video_tx_id'] },
    '5': { params: ['telemetry_id', 'bec_id', 'gps_id', 'video_tx_id'] }
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
    try {
        const [telemetries, becs, gps, video_txs, pvds] = await Promise.all([
            pool.query('SELECT id, model_name FROM telemetry_modules ORDER BY model_name'),
            pool.query('SELECT id, model_name FROM bec_modules ORDER BY model_name'),
            pool.query('SELECT id, model_name FROM gps_modules ORDER BY model_name'),
            pool.query('SELECT id, model_name FROM video_transmitters ORDER BY model_name'),
            pool.query('SELECT id, model_name FROM pvd_modules ORDER BY model_name')
        ]);
        res.json({
            telemetry_modules: telemetries.rows,
            bec_models: becs.rows,
            gps_models: gps.rows,
            video_transmitters: video_txs.rows,
            pvd_models: pvds.rows
        });
    } catch (e) {
        console.error("Ошибка загрузки компонентов:", e);
        res.status(500).json({ error: "Ошибка на сервере" });
    }
});

// Фильтрация для таблицы электромонтажа
// server.js

// ИСПРАВЛЕННЫЙ ФИЛЬТР ДЛЯ ЭЛЕКТРОЦЕХА
app.post('/api/electrical/filter', async (req, res) => {
    const { bpla_id, status, number, supplier_id, ...paramsFilters } = req.body;
    if (!bpla_id) return res.status(400).json({ error: 'Не указан ID БПЛА' });

    try {
        const configRes = await pool.query('SELECT electrical_config FROM bpla WHERE id = $1', [bpla_id]);
        const paramKeys = Object.keys(configRes.rows[0]?.electrical_config?.params || {});

        // Условие "Готовности" для электроцеха (проверяет electrical_params)
        const isFinishedCondition = paramKeys.length > 0 
            ? paramKeys.map(key => `(b.electrical_params->>'${key}' IS NOT NULL AND b.electrical_params->>'${key}' != '')`).join(' AND ') 
            : 'FALSE';

        let query = `
            SELECT 
                b.*, 
                s.name as supplier_name, 
                c.name as controller_name,
                CASE 
                    WHEN b.electrical_status = 'semifinished' THEN 'red'
                    WHEN b.electrical_status = 'finished' THEN 'green'
                    ELSE 'orange' 
                END as status_color
            FROM boards b
            LEFT JOIN suppliers s ON b.supplier_id = s.id
            LEFT JOIN controller c ON b.controller_id = c.id
            WHERE b.bpla_id = $1`;
        
        const params = [bpla_id];

        // Применяем фильтры
        if (number) { params.push(`%${number.trim().toLowerCase()}%`); query += ` AND LOWER(TRIM(b.number)) ILIKE $${params.length}`; }
        if (supplier_id) { params.push(supplier_id); query += ` AND b.supplier_id = $${params.length}`; }

        if (status) {
            if (status === 'in_progress') query += ` AND b.electrical_status = 'in_progress'`;
            if (status === 'finished') query += ` AND b.electrical_status = 'finished'`;
            if (status === 'semifinished') query += ` AND b.electrical_status = 'semifinished'`;
        }
        
        query += ` ORDER BY CASE WHEN b.electrical_status = 'in_progress' THEN 0 WHEN b.electrical_status = 'finished' THEN 1 ELSE 2 END, b.creation_date DESC`;
        
        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (e) {
        console.error("Ошибка фильтрации (электромонтаж):", e);
        res.status(500).json({error: "Ошибка на сервере"});
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


app.get('/api/bpla/:id/workshop-config', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('SELECT workshop_config FROM bpla WHERE id = $1', [id]);
        if (result.rows.length === 0 || !result.rows[0].workshop_config) {
            return res.status(404).json({ error: 'Конфигурация не найдена' });
        }
        res.json(result.rows[0].workshop_config);
    } catch (err) {
        console.error('Ошибка получения конфигурации цеха:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
});

app.get('/api/bpla/:id/electrical-config', async (req, res) => {
    const { id } = req.params;
    const { rows } = await pool.query('SELECT electrical_config FROM bpla WHERE id = $1', [id]);
    if (rows.length === 0 || !rows[0].electrical_config) {
        return res.status(404).json({ error: 'Конфигурация не найдена' });
    }
    res.json(rows[0].electrical_config);
});

app.patch('/api/board/:id/status', async (req, res) => {
    const { id } = req.params;
    // В теле запроса ожидаем: { "department": "workshop", "is_finished": true }
    const { department, is_finished } = req.body;

    // Белый список колонок для безопасности
    const allowedDepartments = {
        workshop: 'is_workshop_finished',
        electrical: 'is_electrical_finished',
        setup: 'is_setup_finished'
    };

    const columnName = allowedDepartments[department];
    if (!columnName) {
        return res.status(400).json({ error: 'Недопустимый отдел' });
    }

    try {
        await pool.query(`UPDATE boards SET ${columnName} = $1 WHERE id = $2`, [!!is_finished, id]);
        // logAction(req.session.user.id, 'SET_STATUS', `Установлен статус '${columnName}=${is_finished}' для борта ID ${id}`);
        res.sendStatus(200);
    } catch (err) {
        console.error('Ошибка обновления статуса:', err);
        res.status(500).json({ error: 'Ошибка сервера' });
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

// Запуск
app.listen(3000, () => console.log('API running on http://localhost:3000'));
