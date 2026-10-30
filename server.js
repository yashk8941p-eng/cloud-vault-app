const express = require('express');
const multer = require('multer');
const crypto = require('crypto');

const app = express();
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 }
});

const {
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_CHAT_ID,
  GITHUB_TOKEN,
  REPO_OWNER,
  REPO_NAME,
  APP_PASSWORD
} = process.env;

const DB_URL = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents/db.json`;

async function getDatabase() {
  const res = await fetch(DB_URL, {
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json'
    }
  });
  if (res.status === 404) return { sha: null, files: [] };
  if (!res.ok) throw new Error(`GitHub DB Read Error: ${await res.text()}`);
  const data = await res.json();
  const content = Buffer.from(data.content, 'base64').toString('utf8');
  return { sha: data.sha, files: JSON.parse(content) };
}

async function saveDatabase(files, sha) {
  const body = {
    message: `Update db.json (${files.length} files)`,
    content: Buffer.from(JSON.stringify(files, null, 2)).toString('base64')
  };
  if (sha) body.sha = sha;

  const res = await fetch(DB_URL, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`GitHub DB Write Error: ${await res.text()}`);
}

app.get('/', (req, res) => {
  res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Unlimited Cloud Vault</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: system-ui, sans-serif; max-width: 900px; margin: 2rem auto; padding: 0 1rem; background: #090d16; color: #f1f5f9; }
    .card { background: #1e293b; padding: 1.5rem; border-radius: 12px; margin-bottom: 1.5rem; border: 1px solid #334155; }
    input, button { padding: 0.65rem 1rem; border-radius: 8px; border: 1px solid #475569; background: #0f172a; color: white; margin: 0.4rem 0; }
    button { background: #2563eb; border: none; cursor: pointer; font-weight: 600; }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .progress-wrap { background: #0f172a; height: 12px; border-radius: 6px; overflow: hidden; margin-top: 1rem; display: none; }
    .progress-bar { background: #22c55e; height: 100%; width: 0%; transition: width 0.2s; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 1rem; }
    .file-card { background: #0f172a; padding: 1rem; border-radius: 10px; border: 1px solid #334155; display: flex; flex-direction: column; justify-content: space-between; }
    .file-name { font-weight: 600; word-break: break-all; margin-bottom: 0.5rem; font-size: 0.9rem; }
    .meta { color: #94a3b8; font-size: 0.78rem; margin-bottom: 0.8rem; }
    .actions { display: flex; gap: 0.5rem; }
    .btn-link { flex: 1; text-align: center; padding: 0.45rem; border-radius: 6px; text-decoration: none; font-size: 0.82rem; font-weight: 600; }
    .view { background: #1d4ed8; color: white; }
    .dl { background: #334155; color: #e2e8f0; }
  </style>
</head>
<body>
  <h2>⚡ Unlimited Cloud Vault (Vercel)</h2>
  <div class="card">
    <input type="password" id="password" placeholder="Vault Password" required /><br>
    <input type="file" id="fileInput" accept="image/*,video/*,*/*" required /><br>
    <button id="uploadBtn" onclick="uploadFile()">Upload Forever</button>
    <div class="progress-wrap" id="progressWrap">
      <div class="progress-bar" id="progressBar"></div>
    </div>
    <p id="statusText" style="font-size:0.85rem; color:#94a3b8;"></p>
  </div>

  <div class="card">
    <h3>Your Files</h3>
    <div id="fileGrid" class="grid">Loading vault...</div>
  </div>

  <script>
    const CHUNK_SIZE = 19 * 1024 * 1024;

    function formatSize(bytes) {
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
      return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
    }

    async function loadFiles() {
      const res = await fetch('/api/files');
      const files = await res.json();
      const grid = document.getElementById('fileGrid');
      if (!files.length) return grid.innerHTML = '<p style="color:#64748b;">No files uploaded yet.</p>';
      grid.innerHTML = files.map(f => \`
        <div class="file-card">
          <div>
            <div class="file-name">\${f.name}</div>
            <div class="meta">\${formatSize(f.size)} • \${f.chunks.length} chunk(s)<br>\${new Date(f.date).toLocaleDateString()}</div>
          </div>
          <div class="actions">
            <a class="btn-link view" href="/stream/\${f.id}" target="_blank">Open</a>
            <a class="btn-link dl" href="/stream/\${f.id}?dl=1">Download</a>
          </div>
        </div>
      \`).join('');
    }

    async function uploadFile() {
      const password = document.getElementById('password').value;
      const fileInput = document.getElementById('fileInput');
      const file = fileInput.files[0];
      if (!password || !file) return alert('Enter password and select a file');

      const btn = document.getElementById('uploadBtn');
      const status = document.getElementById('statusText');
      const progWrap = document.getElementById('progressWrap');
      const progBar = document.getElementById('progressBar');

      btn.disabled = true;
      progWrap.style.display = 'block';

      try {
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        const uploadedChunkIds = [];

        for (let i = 0; i < totalChunks; i++) {
          status.innerText = \`Uploading part \${i + 1} of \${totalChunks}...\`;
          const chunk = file.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE);
          const formData = new FormData();
          formData.append('password', password);
          formData.append('chunk', chunk, \`\${file.name}.part\${i}\`);

          const res = await fetch('/api/upload-chunk', { method: 'POST', body: formData });
          if (!res.ok) throw new Error(await res.text());
          const data = await res.json();
          uploadedChunkIds.push(data.file_id);

          progBar.style.width = Math.round(((i + 1) / totalChunks) * 90) + '%';
        }

        status.innerText = 'Saving file index to GitHub...';
        const saveRes = await fetch('/api/save-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            password,
            name: file.name,
            size: file.size,
            mimeType: file.type || 'application/octet-stream',
            chunks: uploadedChunkIds
          })
        });

        if (!saveRes.ok) throw new Error(await saveRes.text());
        progBar.style.width = '100%';
        status.innerText = '✅ Upload complete!';
        fileInput.value = '';
        await loadFiles();
      } catch (err) {
        status.innerText = '❌ Error: ' + err.message;
      } finally {
        btn.disabled = false;
      }
    }

    loadFiles();
  </script>
</body>
</html>
  `);
});

app.get('/api/files', async (req, res) => {
  try {
    const db = await getDatabase();
    res.json(db.files.reverse());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/upload-chunk', upload.single('chunk'), async (req, res) => {
  try {
    if (req.body.password !== APP_PASSWORD) return res.status(403).send('Invalid password');
    if (!req.file) return res.status(400).send('Missing chunk');

    const formData = new FormData();
    formData.append('chat_id', TELEGRAM_CHAT_ID);
    const blob = new Blob([req.file.buffer], { type: 'application/octet-stream' });
    formData.append('document', blob, req.file.originalname);

    const tgRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendDocument`, {
      method: 'POST',
      body: formData
    });

    const tgData = await tgRes.json();
    if (!tgData.ok) return res.status(500).send(`Telegram Error: ${tgData.description}`);

    res.json({ file_id: tgData.result.document.file_id });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.post('/api/save-file', async (req, res) => {
  try {
    const { password, name, size, mimeType, chunks } = req.body;
    if (password !== APP_PASSWORD) return res.status(403).send('Invalid password');

    const db = await getDatabase();
    const newEntry = {
      id: crypto.randomUUID(),
      name,
      size,
      mimeType,
      chunks,
      date: new Date().toISOString()
    };

    db.files.push(newEntry);
    await saveDatabase(db.files, db.sha);
    res.json({ success: true, file: newEntry });
  } catch (err) {
    res.status(500).send(err.message);
  }
});

app.get('/stream/:id', async (req, res) => {
  try {
    const db = await getDatabase();
    const file = db.files.find(f => f.id === req.params.id);
    if (!file) return res.status(404).send('File not found');

    const disposition = req.query.dl ? 'attachment' : 'inline';
    res.setHeader('Content-Type', file.mimeType || 'application/octet-stream');
    res.setHeader('Content-Length', file.size);
    res.setHeader('Content-Disposition', `${disposition}; filename="${encodeURIComponent(file.name)}"`);

    for (const fileId of file.chunks) {
      const infoRes = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getFile?file_id=${fileId}`);
      const infoData = await infoRes.json();
      if (!infoData.ok) throw new Error('Could not locate chunk on Telegram');

      const fileUrl = `https://api.telegram.org/file/bot${TELEGRAM_BOT_TOKEN}/${infoData.result.file_path}`;
      const chunkRes = await fetch(fileUrl);
      const arrayBuffer = await chunkRes.arrayBuffer();
      res.write(Buffer.from(arrayBuffer));
    }

    res.end();
  } catch (err) {
    if (!res.headersSent) res.status(500).send(err.message);
    else res.end();
  }
});

module.exports = app;
