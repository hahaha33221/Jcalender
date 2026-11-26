// 녹음 파일 수신 API 서버
// 실행: API_TOKEN=비밀토큰 node server.js
const express = require('express');
const multer = require('multer');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0'; // VPS에서는 127.0.0.1 (Nginx 뒤)
const API_TOKEN = process.env.API_TOKEN;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const FILE_DIR = path.join(DATA_DIR, 'files');
const MAX_SIZE = 200 * 1024 * 1024; // 200MB
const ALLOWED_EXT = /\.(m4a|mp4|m4b|mp3|amr|awb|wav|3gp|3ga|ogg|oga|opus|aac|flac|webm|wma|txt)$/i; // txt: 휴대폰이 만든 받아 적은 글 (회의록에 그대로 씀)
const VERSION = '1.3.0';                 // /api/health 로 확인 (VPS 업데이트가 됐는지)

/** 확장자가 없거나 낯선 파일: 앞부분을 보고 형식을 알아낸다 (없으면 null) */
function sniffExt(file) {
  const fd = fs.openSync(file, 'r');
  const b = Buffer.alloc(4096);
  const n = fs.readSync(fd, b, 0, 4096, 0);
  fs.closeSync(fd);
  const h = b.subarray(0, n), s = (i, j) => h.subarray(i, j).toString('latin1');
  if (n >= 12 && s(4, 8) === 'ftyp') return /^3g/.test(s(8, 11)) ? '.3gp' : '.m4a';
  if (s(0, 3) === 'ID3' || (h[0] === 0xff && (h[1] & 0xe0) === 0xe0 && (h[1] & 0x06) !== 0)) return '.mp3';
  if (h[0] === 0xff && (h[1] & 0xf6) === 0xf0) return '.aac';
  if (s(0, 5) === '#!AMR') return '.amr';
  if (s(0, 4) === 'RIFF' && s(8, 12) === 'WAVE') return '.wav';
  if (s(0, 4) === 'OggS') return '.ogg';
  if (s(0, 4) === 'fLaC') return '.flac';
  if (h.readUInt32BE?.(0) === 0x1a45dfa3) return '.webm';
  if (n && !h.includes(0)) {                                  // 글자만 있으면 TXT (UTF-8 · EUC-KR · UTF-16 BOM)
    return '.txt';
  }
  if (n >= 2 && ((h[0] === 0xff && h[1] === 0xfe) || (h[0] === 0xfe && h[1] === 0xff))) return '.txt';
  return null;
}
const TXT_MAX = 5 * 1024 * 1024;

if (!API_TOKEN) {
  console.error('API_TOKEN 환경변수를 설정하세요.');
  process.exit(1);
}
fs.mkdirSync(FILE_DIR, { recursive: true });

// ---------- DB ----------
const db = new Database(path.join(DATA_DIR, 'recordings.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS recordings (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    device        TEXT NOT NULL,
    original_name TEXT NOT NULL,
    stored_name   TEXT NOT NULL,
    size          INTEGER NOT NULL,
    sha256        TEXT NOT NULL UNIQUE,
    mime          TEXT,
    recorded_at   TEXT,
    uploaded_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_device ON recordings(device);
`);
const q = {
  findByHash: db.prepare('SELECT * FROM recordings WHERE sha256 = ?'),
  findById: db.prepare('SELECT * FROM recordings WHERE id = ?'),
  insert: db.prepare(`INSERT INTO recordings
    (device, original_name, stored_name, size, sha256, mime, recorded_at)
    VALUES (@device, @original_name, @stored_name, @size, @sha256, @mime, @recorded_at)`),
  remove: db.prepare('DELETE FROM recordings WHERE id = ?'),
};

// ---------- 업로드 설정 ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: FILE_DIR,
    filename: (req, file, cb) => cb(null, `${Date.now()}_${crypto.randomBytes(6).toString('hex')}.tmp`),
  }),
  limits: { fileSize: MAX_SIZE },
  fileFilter: (req, file, cb) => {
    // multer는 한글 파일명을 latin1로 읽으므로 UTF-8로 복원
    file.originalname = Buffer.from(file.originalname, 'latin1').toString('utf8');
    cb(null, true);                                              // 형식은 저장 전에 확인 (확장자 · 내용)
  },
});

function sha256File(p) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(p).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
  });
}

function toJson(r) {
  return {
    id: r.id,
    device: r.device,
    filename: r.original_name,
    size: r.size,
    sha256: r.sha256,
    recorded_at: r.recorded_at,
    uploaded_at: r.uploaded_at,
    download_url: `/api/recordings/${r.id}/file`,
  };
}

// ---------- 앱 ----------
const app = express();

app.get('/api/health', (req, res) => res.json({ ok: true, version: VERSION, accepts: 'm4a mp4 mp3 amr wav 3gp ogg opus aac flac webm txt (확장자 없으면 내용으로 판단)' }));

// 올리기 실패 기록 (최근 30건): 휴대폰 알림이 400 · 401 · 415 일 때 사이트 상태 줄에서 이유를 본다 (GET /api/recent-errors, 토큰 필요)
const recentErrors = [];
app.use('/api/recordings', (req, res, next) => {
  if (req.method !== 'POST') return next();
  const json = res.json.bind(res);
  res.json = (body) => {
    if (res.statusCode >= 400) {
      const e = {
        at: new Date().toISOString(), status: res.statusCode, error: String(body?.error || ''),
        filename: String(req.query.filename ?? '(없음)').slice(0, 200), device: String(req.query.device || '').slice(0, 50),
        contentLength: req.get('Content-Length') || '(없음)', contentType: req.get('Content-Type') || '(없음)',
      };
      recentErrors.unshift(e); recentErrors.length = Math.min(recentErrors.length, 30);
      console.warn(`[업로드 실패] ${e.status} ${e.error} · filename=${e.filename} · 길이=${e.contentLength} · 형식=${e.contentType} · device=${e.device}`);
    }
    return json(body);
  };
  next();
});

// 인증: Authorization: Bearer <API_TOKEN>
app.use('/api', (req, res, next) => {
  const auth = req.get('Authorization') || '';
  const given = Buffer.from(auth.replace(/^Bearer\s+/i, ''));
  const expected = Buffer.from(API_TOKEN);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return res.status(401).json({ error: auth ? 'unauthorized: 토큰이 맞지 않습니다 (Authorization: Bearer 토큰)' : 'unauthorized: Authorization 헤더가 없습니다' });
  }
  next();
});

// 업로드된 임시 파일을 중복 확인 후 저장하고 DB에 기록
async function saveRecording({ tmpPath, originalName, size, mime, device, recordedAt }, res) {
  device = String(device || 'unknown').replace(/[^\w-]/g, '').slice(0, 50) || 'unknown';
  if (!ALLOWED_EXT.test(originalName)) {                        // 확장자가 없거나 낯섦 → 내용으로 판단
    const ext = sniffExt(tmpPath);
    if (!ext) {
      fs.rmSync(tmpPath, { force: true });
      console.warn(`[415] 받지 않은 파일: ${originalName} (${size}바이트, ${mime || '-'})`);
      return res.status(415).json({ error: `녹음 · TXT 파일이 아닙니다: "${originalName}" (받는 형식: m4a · mp4 · mp3 · amr · wav · 3gp · ogg · aac · txt)` });
    }
    originalName = `${originalName.replace(/\.$/, '')}${ext}`;
  }
  if (/\.txt$/i.test(originalName) && size > TXT_MAX) {
    fs.rmSync(tmpPath, { force: true });
    return res.status(413).json({ error: 'TXT 는 5MB 까지 받습니다' });
  }
  const hash = await sha256File(tmpPath);

  // 같은 파일이 이미 있으면 새로 저장하지 않고 기존 정보 반환
  const dup = q.findByHash.get(hash);
  if (dup) {
    fs.unlinkSync(tmpPath);
    return res.status(200).json({ duplicate: true, recording: toJson(dup) });
  }

  const ext = path.extname(originalName).toLowerCase();
  const storedName = path.basename(tmpPath, '.tmp') + ext;
  fs.renameSync(tmpPath, path.join(FILE_DIR, storedName));

  // recorded_at: 유닉스 초 → ISO 문자열
  let recorded = null;
  if (/^\d+$/.test(String(recordedAt || ''))) {
    recorded = new Date(Number(recordedAt) * 1000).toISOString();
  }

  const info = q.insert.run({
    device,
    original_name: path.basename(originalName),
    stored_name: storedName,
    size,
    sha256: hash,
    mime: mime || null,
    recorded_at: recorded,
  });
  res.status(201).json({ duplicate: false, recording: toJson(q.findById.get(info.lastInsertRowid)) });
}

// 1-a) 업로드 (multipart/form-data: curl, 웹 폼, Termux 등)
app.post('/api/recordings', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'file 필드가 없습니다' });
    await saveRecording({
      tmpPath: req.file.path,
      originalName: req.file.originalname,
      size: req.file.size,
      mime: req.file.mimetype,
      device: req.body.device,
      recordedAt: req.body.recorded_at,
    }, res);
  } catch (e) {
    if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    next(e);
  }
});

// 1-b) 업로드 (본문에 파일 그대로: MacroDroid 등)
//   POST /api/recordings/raw?device=phone01&filename=통화녹음.m4a&recorded_at=1764000000
app.post('/api/recordings/raw', (req, res, next) => {
  // 파일 이름: filename (또는 name · file_name · X-Filename 헤더). 없거나 MacroDroid 변수가 안 풀렸으면 받은 시각으로 짓고 형식은 내용으로 판단
  let given = String(req.query.filename ?? req.query.name ?? req.query.file_name ?? '');
  if (!given && req.get('X-Filename')) { try { given = decodeURIComponent(req.get('X-Filename')); } catch { given = req.get('X-Filename'); } }
  if (/^\{.*\}$|^\[.*\]$/.test(given.trim())) given = '';      // {file_name} 같은 글자가 그대로 온 경우
  const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().replace(/\D/g, '').slice(2, 14);   // 한국 시각 YYMMDDhhmmss
  const originalName = path.basename(given.replace(/\\/g, '/')).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim().slice(0, 200) || `phone_${stamp.slice(0, 6)}_${stamp.slice(6)}`;

  const tmpPath = path.join(FILE_DIR, `${Date.now()}_${crypto.randomBytes(6).toString('hex')}.tmp`);
  const out = fs.createWriteStream(tmpPath);
  let size = 0;
  let aborted = false;

  const fail = (status, msg) => {
    if (aborted) return;
    aborted = true;
    out.destroy();
    fs.rmSync(tmpPath, { force: true });
    res.status(status).json({ error: msg });
  };

  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_SIZE) { fail(413, '파일이 너무 큽니다'); req.destroy(); }
  });
  req.on('error', () => fail(400, '업로드 중 연결이 끊겼습니다'));
  req.pipe(out);

  out.on('finish', async () => {
    if (aborted) return;
    if (size === 0) return fail(400, '본문이 비어 있습니다: 파일 내용이 오지 않았습니다 (MacroDroid 콘텐츠 본문의 파일 경로 확인)');
    try {
      await saveRecording({
        tmpPath, originalName, size,
        mime: req.get('Content-Type'),
        device: req.query.device,
        recordedAt: req.query.recorded_at,
      }, res);
    } catch (e) {
      fs.rmSync(tmpPath, { force: true });
      next(e);
    }
  });
});

// 최근 올리기 실패 (사이트 진단용)
app.get('/api/recent-errors', (req, res) => res.json({ items: recentErrors }));

// 2) 목록: ?device=phone01&from=2026-11-01&to=2026-11-30&limit=50&offset=0
app.get('/api/recordings', (req, res) => {
  const where = [];
  const params = {};
  if (req.query.device) { where.push('device = @device'); params.device = req.query.device; }
  if (req.query.from) { where.push('uploaded_at >= @from'); params.from = req.query.from; }
  if (req.query.to) { where.push("uploaded_at < date(@to, '+1 day')"); params.to = req.query.to; }
  const w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  const limit = Math.min(Number(req.query.limit) || 50, 500);
  const offset = Number(req.query.offset) || 0;
  const total = db.prepare(`SELECT COUNT(*) AS n FROM recordings ${w}`).get(params).n;
  const rows = db.prepare(`SELECT * FROM recordings ${w} ORDER BY id DESC LIMIT ${limit} OFFSET ${offset}`).all(params);
  res.json({ total, limit, offset, items: rows.map(toJson) });
});

// 3) 단건 정보
app.get('/api/recordings/:id', (req, res) => {
  const r = q.findById.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  res.json(toJson(r));
});

// 4) 파일 다운로드/재생
app.get('/api/recordings/:id/file', (req, res) => {
  const r = q.findById.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(r.original_name)}`);
  res.sendFile(path.join(FILE_DIR, r.stored_name));
});

// 5) 삭제
app.delete('/api/recordings/:id', (req, res) => {
  const r = q.findById.get(req.params.id);
  if (!r) return res.status(404).json({ error: 'not found' });
  fs.rmSync(path.join(FILE_DIR, r.stored_name), { force: true });
  q.remove.run(r.id);
  res.json({ deleted: true, id: r.id });
});

// 에러 처리
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: '파일이 너무 큽니다' });
  res.status(err.status || 500).json({ error: err.message || 'server error' });
});

app.listen(PORT, HOST, () => console.log(`recording-api listening on ${HOST}:${PORT}`));
