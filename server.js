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

        const { rows } = await pool.query('SELECT * FROM users WHERE login = $1', [login]);
        if (rows.length === 0) {
            return res.status(401).json({ error: 'Неверный логин или пароль' });
        }
        const user = rows[0];
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
    const { bpla_id, number, supplier_id, controller_id, workshop_params, electrical_params, setup_params } = req.body;

    if (!number || number.trim() === '') {
        return res.status(400).json({ error: 'Номер борта является обязательным полем.' });
    }
    
    // 2. Универсальная SQL-команда для вставки
    const result = await pool.query(
      `INSERT INTO boards (bpla_id, number, supplier_id, controller_id, 
       workshop_params, electrical_params, setup_params, creation_date) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) 
       RETURNING *`,
      [bpla_id, number, supplier_id, controller_id || null, workshop_params || null, electrical_params || null, setup_params || null]
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
        const commentColumn = `${department}_comments`;
        
        if (comment && comment.trim() !== '') {
            await client.query(
                `UPDATE boards SET ${commentColumn} = jsonb_set(COALESCE(${commentColumn}, '{}'::jsonb), '{${parameter}}', to_jsonb($1::text), true) WHERE id = $2`,
                [comment, boardId]
            );
        } else {
            await client.query(
                `UPDATE boards SET ${commentColumn} = ${commentColumn} - $1 WHERE id = $2 AND ${commentColumn} ? $1`,
                [parameter, boardId]
            );
        }
        
        const statusColumn = `${department}_status`;
        if (is_semi_finished) {
            await client.query(`UPDATE boards SET ${statusColumn} = 'semifinished' WHERE id = $1`, [boardId]);
        } else {
            // ИСПРАВЛЕНИЕ "ГОНКИ СОСТОЯНИЙ"
            // Сначала ставим 'in_progress', чтобы убрать 'semifinished'.
            await client.query(`UPDATE boards SET ${statusColumn} = 'in_progress' WHERE id = $1`, [boardId]);
            
            // Затем вызываем пересчет. Теперь он будет работать корректно.
            await recalculateBoardStatus(boardId, department, client);
        }

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

app.post('/api/setup/:boardId/comment', async (req, res) => {
    const { boardId } = req.params;
    const { parameter, comment, is_semi_finished } = req.body;
    const department = 'setup'; // Жестко задаем отдел

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const commentColumn = `${department}_comments`;
        
        // Логика сохранения/удаления комментария (она у вас правильная)
        if (comment && comment.trim() !== '') {
            await client.query(
                `UPDATE boards SET ${commentColumn} = jsonb_set(COALESCE(${commentColumn}, '{}'::jsonb), '{${parameter}}', to_jsonb($1::text), true) WHERE id = $2`,
                [comment, boardId]
            );
        } else {
            await client.query(
                `UPDATE boards SET ${commentColumn} = ${commentColumn} - $1 WHERE id = $2 AND ${commentColumn} ? $1`,
                [parameter, boardId]
            );
        }
        
        const statusColumn = `${department}_status`;
        
        // --- ВОТ ИСПРАВЛЕНИЕ ---
        if (is_semi_finished) {
            // Если галочка ПОСТАВЛЕНА - ставим 'semifinished'
            await client.query(`UPDATE boards SET ${statusColumn} = 'semifinished' WHERE id = $1`, [boardId]);
        } else {
            // Если галочка СНЯТА:
            // 1. Сначала принудительно "разблокируем" статус [cite: 111]
            await client.query(`UPDATE boards SET ${statusColumn} = 'in_progress' WHERE id = $1`, [boardId]);
            
            // 2. Теперь пересчитываем (он сможет стать 'finished', если все галочки стоят) [cite: 112]
            await recalculateBoardStatus(boardId, department, client);
        }
        // --- КОНЕЦ ИСПРАВЛЕНИЯ ---

        await client.query('COMMIT');
        res.sendStatus(200);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Ошибка сохранения комментария/статуса (setup):', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    } finally {
        client.release();
    }
});

app.post('/api/workshop/filter', async (req, res) => {
    const { bpla_id, status, number, supplier_id, engines, ...paramFilters } = req.body;
    if (!bpla_id) return res.status(400).json({ error: 'Не указан ID БПЛА' });
    
    try {
        const params = [bpla_id];
        let query = `
            SELECT b.*, s.name as supplier_name,
                   CASE 
                       WHEN b.workshop_status = 'semifinished' THEN 'red'
                       WHEN b.workshop_status = 'finished' THEN 'green'
                       ELSE 'orange'
                   END as status_color
            FROM boards b
            LEFT JOIN suppliers s ON b.supplier_id = s.id
            WHERE b.bpla_id = $1`;
        
            
        if (status) {
            query += ` AND b.workshop_status = $${params.length + 1}`;
            params.push(status);
        }
        if (number && number.trim() !== '') {
            query += ` AND b.number ILIKE $${params.length + 1}`;
            params.push(`%${number.trim()}%`);
        }
        if (supplier_id) {
            query += ` AND b.supplier_id = $${params.length + 1}`;
            params.push(supplier_id);
        }
        if (Array.isArray(engines) && engines.length > 0) {
            // Ищем точное совпадение значения 'dvs' в JSONB
            query += ` AND b.workshop_params->>'dvs' = ANY($${params.length + 1}::text[])`;
            params.push(engines);
        }

        // 2. Фильтр по параметрам (paramFilters)
        for (const key in paramFilters) {
            // Проверяем, что ключ принадлежит объекту и его значение true (галочка стоит)
            if (Object.hasOwnProperty.call(paramFilters, key) && paramFilters[key] === true) {
                // Ищем, где ключ в JSONB существует и не равен null
                // (Аналогично тому, как это сделано в electrical/filter [cite: 170])
                query += ` AND b.workshop_params->>'${key}' IS NOT NULL`;
            }
        }
        
        query += ` ORDER BY CASE 
                      WHEN b.workshop_status = 'in_progress' THEN 1 
                      WHEN b.workshop_status = 'finished' THEN 2 
                      WHEN b.workshop_status = 'semifinished' THEN 3 
                   END, b.creation_date DESC`;
        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (e) { 
        console.error("Ошибка фильтрации (workshop):", e);
        res.status(500).json({error: "Ошибка на сервере"}); 
    }
});



app.put('/api/workshop/:id', async (req, res) => {
    const { id } = req.params;
    const { number, supplier_id, workshop_params } = req.body;
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            'UPDATE boards SET number = $1, supplier_id = $2, workshop_params = $3 WHERE id = $4',
            [number, supplier_id, workshop_params, id]
        );
        
        // Важно: в newData теперь должны быть и params, и dvs.
        // Фронтенд уже кладет dvs внутрь workshop_params, так что этот код корректен.
        const newData = { params: workshop_params };
        await recalculateBoardStatus(id, 'workshop', client, newData);

        await client.query('COMMIT');
        res.sendStatus(200);
    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Ошибка обновления (workshop):", e);
        res.status(500).json({error: "Server error"});
    } finally {
        client.release();
    }
});


// API для обновления параметра (галочки) в цеху
app.patch('/api/workshop/:id/parameter', async (req, res) => {
    const { id } = req.params;
    const { parameter, value } = req.body;

    if (!parameter) {
        return res.status(400).json({ error: 'Имя параметра не указано' });
    }

    const client = await pool.connect();
    try 
{
        await client.query('BEGIN');

        // Обновляем дату для конкретного параметра в JSONB-поле workshop_params
        await client.query(
            `UPDATE boards 
             SET workshop_params = jsonb_set(
                 COALESCE(workshop_params, '{}'::jsonb), 
                 '{${parameter}}', 
                 -- ИСПРАВЛЕНО: COALESCE гарантирует, что SQL NULL станет JSON null
                 COALESCE(to_jsonb($1::text), 'null'::jsonb),
                 true
             ) 
             WHERE id = $2`,
            [value, id] // 
        );
    // После обновления параметра СРАЗУ ЖЕ ПЕРЕСЧИТЫВАЕМ СТАТУС "ГОТОВ"
        await recalculateBoardStatus(id, 'workshop', client);
    await client.query('COMMIT');
        res.sendStatus(200);

    } catch (err) {
        await client.query('ROLLBACK');
    console.error('Ошибка обновления параметра (workshop):', err);
        res.status(500).json({ error: 'Ошибка сервера' });
} finally {
        client.release();
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

app.patch('/api/setup/:id/parameter', async (req, res) => {
    const { id } = req.params;
    const { parameter, value } = req.body;

    if (!parameter) {
        return res.status(400).json({ error: 'Имя параметра не указано' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            `UPDATE boards 
             SET setup_params = jsonb_set(
                 COALESCE(setup_params, '{}'::jsonb), 
                 '{${parameter}}', 
                 COALESCE(to_jsonb($1::text), 'null'::jsonb),
                 true
             ) 
             WHERE id = $2`,
            [value, id]
        );
        
        await recalculateBoardStatus(id, 'setup', client);
        
        await client.query('COMMIT');
        res.sendStatus(200);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Ошибка обновления параметра (setup):', err);
        res.status(500).json({ error: 'Ошибка сервера' });
    } finally {
        client.release();
    }
});

async function recalculateBoardStatus(boardId, department, client, boardData = null) {
    try {
        // --- Логирование: Начало ---
        console.log(`\n--- RECALCULATE (Board: ${boardId}, Dept: ${department}) ---`);
        // -------------------------

        let board = boardData;
        if (!board) {
            const boardRes = await client.query(
                `SELECT controller_id, ${department}_params AS params FROM boards WHERE id = $1`,
                [boardId]
            );
            if (!boardRes.rows.length) return;
            board = boardRes.rows[0];
        }

        const bplaRes = await client.query(`SELECT bpla_id FROM boards WHERE id = $1`, [boardId]);
        const bplaId = bplaRes.rows[0]?.bpla_id;
        if (!bplaId) return;

        const configRes = await client.query(`SELECT ${department}_config AS config FROM bpla WHERE id = $1`, [bplaId]);
        const config = configRes.rows[0]?.config;
        if (!config?.params) return;

        const requiredParams = Object.keys(config.params);
        const currentParams = board.params || {};
        const allComponentsSet = requiredParams.every(key => 
            currentParams[key] != null && String(currentParams[key]).trim() !== ''
        );
        
        let isReady = allComponentsSet;
        if (department === 'electrical') {
            const controllerIsSet = board.controller_id != null;
            isReady = allComponentsSet && controllerIsSet;
        }

        const newStatus = isReady ? 'finished' : 'in_progress';
        const statusColumn = `${department}_status`;

        // --- Логирование: Результаты ---
        console.log(`Required Keys (from Config):`, requiredParams);
        console.log(`Current Params (from Board):`, currentParams);
        console.log(`Check Result (allComponentsSet):`, allComponentsSet);
        console.log(`Final Decision (isReady):`, isReady);
        console.log(`New Status:`, newStatus);
        console.log(`--- END RECALCULATE ---\n`);
        // -----------------------------

        await client.query(
            `UPDATE boards SET ${statusColumn} = $1 WHERE id = $2 AND ${statusColumn} != 'semifinished'`,
            [newStatus, boardId]
        );

        try {
            // Пере-запрашиваем ВСЕ статусы (т.к. мы только что обновили один из них)
            const statusRes = await client.query(
                `SELECT workshop_status, electrical_status, setup_status 
                 FROM boards WHERE id = $1`,
                [boardId]
            );

            if (statusRes.rows.length > 0) {
                const statuses = statusRes.rows[0];
                
                // Проверяем, что все 3 цеха в статусе 'finished'
                const isBoardFinished = (
                    statuses.workshop_status === 'finished' &&
                    statuses.electrical_status === 'finished' &&
                    statuses.setup_status === 'finished'
                );

                if (isBoardFinished) {
                    // БОРТ ГОТОВ: Устанавливаем finished_date (только если она не была установлена)
                    await client.query(
                        `UPDATE boards SET finished_date = CURRENT_DATE 
                         WHERE id = $1 AND finished_date IS NULL`,
                        [boardId]
                    );
                } else {
                    // БОРТ НЕ ГОТОВ: (т.е. пользователь снял галочку)
                    // Очищаем finished_date, чтобы он не считался готовым
                    await client.query(
                        `UPDATE boards SET finished_date = NULL 
                         WHERE id = $1`,
                        [boardId]
                    );
                }
            }
        } catch (err) {
            console.error(`Ошибка при обновлении final finished_date для борта ${boardId}:`, err);
            // Не прерываем выполнение, т.к. статус отдела уже обновлен
        }
    } catch (err) {
        console.error(`Ошибка пересчета статуса для борта ${boardId} в цеху ${department}:`, err);
    }
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

// НАЙДИТЕ ЭТОТ ОБРАБОТЧИК В server.js И ПОЛНОСТЬЮ ЗАМЕНИТЕ ЕГО

app.post('/api/electrical/filter', async (req, res) => {
    const { bpla_id, status, number, supplier_id, ...componentFilters } = req.body;

    if (!bpla_id) {
        return res.status(400).json({ error: 'Не указан ID БПЛА' });
    }
    
    try {
        const params = [bpla_id];
        let query = `
            SELECT b.*, s.name as supplier_name, c.name as controller_name,
                   CASE 
                       WHEN b.electrical_status = 'semifinished' THEN 'red'
                       WHEN b.electrical_status = 'finished' THEN 'green'
                       ELSE 'orange' -- 'in_progress'
                   END as status_color
            FROM boards b
            LEFT JOIN suppliers s ON b.supplier_id = s.id
            LEFT JOIN controller c ON b.controller_id = c.id
            WHERE b.bpla_id = $1`;
        
        // Динамически добавляем условия в запрос
        if (status) {
            query += ` AND b.electrical_status = $${params.length + 1}`;
            params.push(status);
        }
        if (number && number.trim() !== '') {
            query += ` AND b.number ILIKE $${params.length + 1}`;
            params.push(`%${number.trim()}%`);
        }
        if (supplier_id) {
            query += ` AND b.supplier_id = $${params.length + 1}`;
            params.push(supplier_id);
        }

        // Обрабатываем фильтры по установленным компонентам (чекбоксы)
        for (const key in componentFilters) {
            // Проверяем только "включенные" чекбоксы
            if (componentFilters[key] === true) {
                // `->>` проверяет, что ключ существует и не равен null в JSONB
                query += ` AND b.electrical_params ->> '${key}' IS NOT NULL`;
            }
        }
        
        query += ` ORDER BY 
            CASE 
                WHEN b.electrical_status = 'in_progress' THEN 1
                WHEN b.electrical_status = 'finished' THEN 2
                WHEN b.electrical_status = 'semifinished' THEN 3
            END, 
            b.creation_date DESC`;

        const { rows } = await pool.query(query, params);
        res.json(rows);

    } catch (e) { 
        console.error("Ошибка фильтрации (электромонтаж):", e);
        res.status(500).json({error: "Ошибка на сервере"}); 
    }
});

app.post('/api/setup/filter', async (req, res) => {
    const { bpla_id, status, number, supplier_id, ...paramFilters } = req.body;

    if (!bpla_id) {
        return res.status(400).json({ error: 'Не указан ID БПЛА' });
    }
    
    try {
        const params = [bpla_id];
        let query = `
            SELECT b.*, s.name as supplier_name,
                   CASE 
                       WHEN b.setup_status = 'semifinished' THEN 'red'
                       WHEN b.setup_status = 'finished' THEN 'green'
                       ELSE 'orange' -- 'in_progress'
                   END as status_color
            FROM boards b
            LEFT JOIN suppliers s ON b.supplier_id = s.id
            WHERE b.bpla_id = $1`;
        
        // --- Стандартные фильтры ---
        if (status) {
            query += ` AND b.setup_status = $${params.length + 1}`;
            params.push(status);
        }
        if (number && number.trim() !== '') {
            query += ` AND b.number ILIKE $${params.length + 1}`;
            params.push(`%${number.trim()}%`);
        }
        if (supplier_id) {
            query += ` AND b.supplier_id = $${params.length + 1}`;
            params.push(supplier_id);
        }

        // --- Фильтр по параметрам (paramFilters) ---
        for (const key in paramFilters) {
            if (Object.hasOwnProperty.call(paramFilters, key) && paramFilters[key] === true) {
                query += ` AND b.setup_params->>'${key}' IS NOT NULL`;
            }
        }
        
        query += ` ORDER BY CASE WHEN b.setup_status = 'in_progress' THEN 1 WHEN b.setup_status = 'finished' THEN 2 ELSE 3 END, b.creation_date DESC`;

        const { rows } = await pool.query(query, params);
        res.json(rows);

    } catch (e) { 
        console.error("Ошибка фильтрации (setup):", e);
        res.status(500).json({error: "Ошибка на сервере"}); 
    }
});

app.put('/api/electrical/:id', async (req, res) => {
    const { id } = req.params;
    const { number, supplier_id, controller_id, electrical_params } = req.body;
    
    const client = await pool.connect();
    try {
        await client.query(
            'UPDATE boards SET number = $1, supplier_id = $2, controller_id = $3, electrical_params = $4 WHERE id = $5',
            [number, supplier_id, controller_id, electrical_params, id]
        );
        
        // ИЗМЕНЕНИЕ: Передаем свежие данные напрямую, чтобы избежать "гонки"
        const newData = { params: electrical_params, controller_id: controller_id };
        await recalculateBoardStatus(id, 'electrical', client, newData);

        res.sendStatus(200);
    } catch (e) {
        console.error("Ошибка обновления (электромонтаж):", e);
        res.status(500).json({error: "Server error"});
    } finally {
        client.release();
    }
});

app.put('/api/setup/:id', async (req, res) => {
    const { id } = req.params;
    const { number, supplier_id, setup_params } = req.body;
    
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        await client.query(
            'UPDATE boards SET number = $1, supplier_id = $2, setup_params = $3 WHERE id = $4',
            [number, supplier_id, setup_params, id]
        );
        
        // Передаем свежие данные напрямую
        const newData = { params: setup_params };
        await recalculateBoardStatus(id, 'setup', client, newData);
        
        await client.query('COMMIT');
        res.sendStatus(200);
    } catch (e) {
        await client.query('ROLLBACK');
        console.error("Ошибка обновления (setup):", e);
        res.status(500).json({error: "Server error"});
    } finally {
        client.release();
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

app.get('/api/bpla/:id/setup-config', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query('SELECT setup_config FROM bpla WHERE id = $1', [id]);
        if (result.rows.length === 0 || !result.rows[0].setup_config) {
            return res.status(404).json({ error: 'Конфигурация не найдена' });
        }
        res.json(result.rows[0].setup_config);
    } catch (err) {
        console.error('Ошибка получения конфигурации цеха настройки:', err);
        res.status(500).json({ error: 'Внутренняя ошибка сервера' });
    }
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


// ===================================================
// API ДЛЯ СВОДКИ (SUMMARY)
// ===================================================

/**
 * Эндпоинт для главной статистики.
 * (ИСПРАВЛЕНО: использует новую логику статусов)
 */
app.get('/api/summary/statistics', async (req, res) => {
    try {
        const query = `
            WITH board_data AS (
                SELECT
                    b.supplier_id,
                    
                    -- НОВАЯ ЛОГИКА "ГОТОВ"
                    CASE
                        WHEN b.workshop_status = 'finished' 
                             AND b.electrical_status = 'finished' 
                             AND b.setup_status = 'finished'
                        THEN TRUE ELSE FALSE
                    END as is_fully_finished,
                    
                    -- НОВАЯ ЛОГИКА "ПОЛУФАБРИКАТ"
                    CASE
                        WHEN b.workshop_status = 'semifinished' 
                             OR b.electrical_status = 'semifinished' 
                             OR b.setup_status = 'semifinished'
                        THEN TRUE ELSE FALSE
                    END as is_semifinished,

                    -- (ПРИМЕЧАНИЕ: Мы предполагаем, что у вас есть некая общая
                    -- колонка 'finished_date' для подсчета "Готовых СЕГОДНЯ".
                    -- Если ее нет, счетчик "Сегодня" всегда будет 0.)
                    b.finished_date
                FROM boards b
            )
            SELECT 
                COALESCE(s.name, 'Не указан') as supplier_name,
                
                -- СКОЛЬКО ГОТОВО (Всего)
                COUNT(*) FILTER (
                    WHERE bd.is_fully_finished = TRUE
                ) as total_finished,
                
                -- СКОЛЬКО ГОТОВО (Сегодня)
                COUNT(*) FILTER (
                    WHERE bd.is_fully_finished = TRUE AND bd.finished_date = CURRENT_DATE
                ) as today_finished,
                
                -- СКОЛЬКО В РАБОТЕ (Всего)
                COUNT(*) FILTER (
                    WHERE bd.is_fully_finished = FALSE AND bd.is_semifinished = FALSE
                ) as total_in_progress,
                
                -- СКОЛЬКО ПОЛУФАБРИКАТЫ (Всего)
                COUNT(*) FILTER (
                    WHERE bd.is_semifinished = TRUE
                ) as total_semifinished
                
            FROM board_data bd
            LEFT JOIN suppliers s ON bd.supplier_id = s.id
            GROUP BY s.name
            ORDER BY supplier_name;
        `;
        const { rows } = await pool.query(query);
        res.json(rows);
    } catch (err) {
        console.error('Ошибка получения статистики для сводки:', err);
        res.status(500).json({ error: 'Ошибка на сервере' });
    }
});

app.post('/api/summary/board-tracker', async (req, res) => {
    const { number, supplier_id, bpla_id } = req.body;
    
    let query = `
        SELECT 
            b.id,
            b.number,
            bp.name as bpla_name,
            s.name as supplier_name,
            b.creation_date,
            
            -- ИСПРАВЛЕНА ЛОГИКА ОПРЕДЕЛЕНИЯ МЕСТОПОЛОЖЕНИЯ БОРТА
            CASE
                -- Приоритет №1: Полуфабрикат (ПФ)
                WHEN b.workshop_status = 'semifinished' THEN 'Полуфабрикат (Слесарный цех)'
                WHEN b.electrical_status = 'semifinished' THEN 'Полуфабрикат (Электромонтаж)'
                WHEN b.setup_status = 'semifinished' THEN 'Полуфабрикат (Отдел Настройки)'
                
                -- Приоритет №2: В работе (по порядку)
                WHEN b.workshop_status != 'finished' THEN 'В работе (Слесарный цех)'
                WHEN b.electrical_status != 'finished' THEN 'В работе (Электромонтаж)'
                WHEN b.setup_status != 'finished' THEN 'В работе (Отдел Настройки)'
                
                ELSE 'Ошибка статуса'
            END as location,
            
            -- Статус для цвета (остается)
            CASE
                WHEN b.workshop_status = 'semifinished' 
                     OR b.electrical_status = 'semifinished' 
                     OR b.setup_status = 'semifinished'
                THEN 'semifinished'
                ELSE 'in_progress'
            END as status
            
        FROM boards b
        LEFT JOIN suppliers s ON b.supplier_id = s.id
        LEFT JOIN bpla bp ON b.bpla_id = bp.id

        -- ИСПРАВЛЕНА ЛОГИКА WHERE (ищем все, что НЕ готово)
        WHERE NOT (
            b.workshop_status = 'finished' 
            AND b.electrical_status = 'finished' 
            AND b.setup_status = 'finished'
        )
    `;
    
    const params = [];

    if (number) { 
        params.push(`%${number.trim().toLowerCase()}%`);
        query += ` AND LOWER(TRIM(b.number)) ILIKE $${params.length}`; 
    }
    if (supplier_id) { 
        params.push(supplier_id);
        query += ` AND b.supplier_id = $${params.length}`; 
    }
    if (bpla_id) { 
        params.push(bpla_id);
        query += ` AND b.bpla_id = $${params.length}`;
    }
    
    query += ' ORDER BY b.creation_date ASC';

    try {
        const { rows } = await pool.query(query, params);
        res.json(rows);
    } catch (err) {
        console.error('Ошибка фильтрации трекера бортов:', err);
        res.status(500).json({ error: 'Ошибка фильтрации' });
    }
});

app.post('/api/summary/export', async (req, res) => {
    // Получаем те же фильтры, что и для трекера
    const { number, supplier_id, bpla_id } = req.body;
    
    try {
        const workbook = new excel.Workbook();
        workbook.creator = 'CARS App';
        workbook.created = new Date();

        // --- Лист 1: Статистика ---
        const statsSheet = workbook.addWorksheet('Статистика');
        
        // Запрос 1: Получаем данные для статистики (такой же, как в GET /api/summary/statistics)
        const statsQuery = `
            WITH board_data AS (
                SELECT
                    b.supplier_id,
                    CASE
                        WHEN b.workshop_status = 'finished' AND b.electrical_status = 'finished' AND b.setup_status = 'finished'
                        THEN TRUE ELSE FALSE
                    END as is_fully_finished,
                    CASE
                        WHEN b.workshop_status = 'semifinished' OR b.electrical_status = 'semifinished' OR b.setup_status = 'semifinished'
                        THEN TRUE ELSE FALSE
                    END as is_semifinished,
                    b.finished_date
                FROM boards b
            )
            SELECT 
                COALESCE(s.name, 'Не указан') as supplier_name,
                COUNT(*) FILTER (WHERE bd.is_fully_finished = TRUE AND bd.finished_date = CURRENT_DATE) as today_finished,
                COUNT(*) FILTER (WHERE bd.is_fully_finished = TRUE) as total_finished,
                COUNT(*) FILTER (WHERE bd.is_fully_finished = FALSE AND bd.is_semifinished = FALSE) as total_in_progress,
                COUNT(*) FILTER (WHERE bd.is_semifinished = TRUE) as total_semifinished
            FROM board_data bd
            LEFT JOIN suppliers s ON bd.supplier_id = s.id
            GROUP BY s.name
            ORDER BY supplier_name;
        `;
        const statsRes = await pool.query(statsQuery);
        
        // Заголовки таблицы статистики
        statsSheet.columns = [
            { header: 'Поставщик', key: 'supplier_name', width: 25 },
            { header: 'Готово (Сегодня)', key: 'today_finished', width: 20 },
            { header: 'Готово (Всего)', key: 'total_finished', width: 20 },
            { header: 'В работе', key: 'total_in_progress', width: 15 },
            { header: 'Полуфабрикаты (ПФ)', key: 'total_semifinished', width: 20 }
        ];

        // Добавляем данные
        statsRes.rows.forEach(row => statsSheet.addRow(row));

        // Считаем и добавляем ИТОГО
        const totals = statsRes.rows.reduce((acc, row) => {
            acc.today_finished += parseInt(row.today_finished, 10);
            acc.total_finished += parseInt(row.total_finished, 10);
            acc.total_in_progress += parseInt(row.total_in_progress, 10);
            acc.total_semifinished += parseInt(row.total_semifinished, 10);
            return acc;
        }, { today_finished: 0, total_finished: 0, total_in_progress: 0, total_semifinished: 0 });

        statsSheet.addRow({}); // Пустая строка
        const totalRow = statsSheet.addRow({
            supplier_name: 'ИТОГО',
            today_finished: totals.today_finished,
            total_finished: totals.total_finished,
            total_in_progress: totals.total_in_progress,
            total_semifinished: totals.total_semifinished
        });
        
        // --- Лист 2: Трекер бортов ---
        const trackerSheet = workbook.addWorksheet('Трекер бортов (в работе)');
        
        // Запрос 2: Получаем данные для трекера (такой же, как в POST /api/summary/board-tracker)
        let trackerQuery = `
            SELECT 
                b.number,
                bp.name as bpla_name,
                s.name as supplier_name,
                b.creation_date,
                CASE
                    WHEN b.workshop_status = 'semifinished' THEN 'Полуфабрикат (Слесарный цех)'
                    WHEN b.electrical_status = 'semifinished' THEN 'Полуфабрикат (Электромонтаж)'
                    WHEN b.setup_status = 'semifinished' THEN 'Полуфабрикат (Отдел Настройки)'
                    WHEN b.workshop_status != 'finished' THEN 'В работе (Слесарный цех)'
                    WHEN b.electrical_status != 'finished' THEN 'В работе (Электромонтаж)'
                    WHEN b.setup_status != 'finished' THEN 'В работе (Отдел Настройки)'
                    ELSE 'Ошибка статуса'
                END as location,
                CASE
                    WHEN b.workshop_status = 'semifinished' OR b.electrical_status = 'semifinished' OR b.setup_status = 'semifinished'
                    THEN 'semifinished'
                    ELSE 'in_progress'
                END as status
            FROM boards b
            LEFT JOIN suppliers s ON b.supplier_id = s.id
            LEFT JOIN bpla bp ON b.bpla_id = bp.id
            WHERE NOT (b.workshop_status = 'finished' AND b.electrical_status = 'finished' AND b.setup_status = 'finished')
        `;
        
        const params = [];
        if (number) { 
            params.push(`%${number.trim().toLowerCase()}%`);
            trackerQuery += ` AND LOWER(TRIM(b.number)) ILIKE $${params.length}`; 
        }
        if (supplier_id) { 
            params.push(supplier_id);
            trackerQuery += ` AND b.supplier_id = $${params.length}`; 
        }
        if (bpla_id) { 
            params.push(bpla_id);
            trackerQuery += ` AND b.bpla_id = $${params.length}`;
        }
        trackerQuery += ' ORDER BY b.creation_date ASC';

        const trackerRes = await pool.query(trackerQuery, params);
        
        // Заголовки таблицы трекера
        trackerSheet.columns = [
            { header: 'Номер', key: 'number', width: 15 },
            { header: 'Тип БПЛА', key: 'bpla_name', width: 25 },
            { header: 'Поставщик', key: 'supplier_name', width: 25 },
            { header: 'Дата поступления', key: 'creation_date', width: 20 },
            { header: 'Текущее местоположение', key: 'location', width: 35 }
        ];

        // Добавляем данные и красим строки
        trackerRes.rows.forEach(row => {
            const addedRow = trackerSheet.addRow(row);
            // Форматируем дату
            addedRow.getCell('creation_date').value = new Date(row.creation_date).toLocaleDateString('ru-RU');
            
            // Красим строку в зависимости от статуса
            if (row.status === 'semifinished') {
                addedRow.fill = { type: 'pattern', pattern:'solid', fgColor:{argb:'FFFFE0E0'} }; // Светло-красный
            } else {
                addedRow.fill = { type: 'pattern', pattern:'solid', fgColor:{argb:'FFFEF5E7'} }; // Светло-оранжевый
            }
        });

        // --- Стилизация и отправка ---
        [statsSheet, trackerSheet].forEach(sheet => {
            // Стилизация заголовка
            sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
            sheet.getRow(1).fill = { type: 'pattern', pattern:'solid', fgColor:{argb:'FF2C3E50'} };
            sheet.getRow(1).alignment = { vertical: 'middle', horizontal: 'center' };
            sheet.views = [{state: 'frozen', ySplit: 1}]; // Закрепить заголовок
        });

        // Стилизация ИТОГО
        totalRow.font = { bold: true, size: 13 };
        totalRow.fill = { type: 'pattern', pattern:'solid', fgColor:{argb:'FFF7F9FA'} };

        // Отправка файла клиенту
        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename="summary_export_${new Date().toLocaleDateString('sv-SE')}.xlsx"`);
        await workbook.xlsx.write(res);
        res.end();

    } catch (err) {
        console.error('Ошибка при экспорте сводки в Excel:', err);
        res.status(500).json({ error: 'Ошибка сервера при создании Excel-файла' });
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
