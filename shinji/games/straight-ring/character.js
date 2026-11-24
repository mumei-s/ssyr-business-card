const STORE_KEY = 'hikari-boxing.character.v1';
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_PIXELS = 24 * 1024 * 1024;
const OUTPUT = 320;
const ACCEPT = 'image/png,image/jpeg,image/webp';
const grids = {
  single: [1, 1], wide: [2, 1], tall: [1, 2],
  four: [2, 2], nine: [3, 3], sixteen: [4, 4],
};

export const CHIBI_PROMPT = `添付した自分のキャラクターシートを参考に、ブラウザのちびキャラ・ボクシングゲーム用の選手を1人描いてください。
複数のコマがある場合は、今回指定した1人だけを参考にします。顔立ち・髪型・髪色・瞳・テーマカラーの特徴を残し、他のキャラの特徴と混ぜないでください。描き方は参照の画風を尊重し、頭が大きめの2.5〜3頭身のスポーツマスコットにまとめます。
ボクシング用の丸い厚手のグローブ、スポーツウェア、靴を着用。右向き寄りの斜め正面でポーズを取り、両手と両足を含めた全身を1枚の中に収めてください。上下左右に十分な余白（目安12％）をとり、頭・手足を切らないでください。
正方形の透過PNG、背景は完全に透明にしてください。床、文字、枠、複数コマ、別の人物、流血・負傷の描写は入れません。チャットに画像を1枚表示してください。`;

export function mergeChibiPrompt(direction) {
  const text = String(direction ?? '').slice(0, 700).trim();
  if (!text) return CHIBI_PROMPT;
  return CHIBI_PROMPT + '\n\n追加の指定（画像形式・余白・透明背景の条件は維持）：\n' + text;
}

export function rasterMime(header) {
  if (!header) return '';
  if (header.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => header[i] === v)) {
    return 'image/png';
  }
  if (header.length >= 3 && header[0] === 255 && header[1] === 216 && header[2] === 255) {
    return 'image/jpeg';
  }
  if (header.length >= 12 && [82, 73, 70, 70, 87, 69, 66, 80].every((v, i) => header[i + (i >= 4 ? 4 : 0)] === v)) {
    return 'image/webp';
  }
  return '';
}

function bounded(value, min, max, fallback) {
  const v = Number(value);
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
}

export function cropRect(width, height, settings = {}) {
  if (!(width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height))) {
    throw new RangeError('Invalid source dimensions');
  }
  const [columns, rows] = Object.hasOwn(grids, settings.grid) ? grids[settings.grid] : grids.single;
  const idx = Math.floor(bounded(settings.cell, 0, columns * rows - 1, 0));
  const col = idx % columns;
  const row = Math.floor(idx / columns);
  const left = Math.floor(width * col / columns);
  const top = Math.floor(height * row / rows);
  const w = Math.max(1, Math.floor(width * (col + 1) / columns) - left);
  const h = Math.max(1, Math.floor(height * (row + 1) / rows) - top);
  const scale = bounded(settings.size, 25, 100, 100) / 100;
  const sw = Math.max(1, Math.round(w * scale));
  const sh = Math.max(1, Math.round(h * scale));
  const nx = bounded(settings.x, 0, 100, 50) / 100;
  const ny = bounded(settings.y, 0, 100, 50) / 100;
  return {
    x: left + Math.min(w - sw, Math.max(0, Math.round(w * nx - sw / 2))),
    y: top + Math.min(h - sh, Math.max(0, Math.round(h * ny - sh / 2))),
    width: sw,
    height: sh,
  };
}

export function containRect(width, height, areaWidth, areaHeight, pixels = 0) {
  const scale = Math.min((areaWidth - 2 * pixels) / width, (areaHeight - 2 * pixels) / height);
  const w = width * scale;
  const h = height * scale;
  return { x: (areaWidth - w) / 2, y: (areaHeight - h) / 2, width: w, height: h };
}

function filenameLabel(filename) {
  return String(filename || '自分のキャラ')
    .replace(/\.[a-z0-9]{1,8}$/i, '')
    .replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim().slice(0, 72) || '自分のキャラ';
}

function bitmap(width = OUTPUT, height = OUTPUT) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function imageFromUrl(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('画像を読み込めませんでした。別の画像をお試しください。'));
    image.src = url;
  });
}

async function loadRaster(file) {
  if (!file?.size || file.size > MAX_BYTES) throw new Error('12 MB 以下の画像を選んでください。');
  const mime = rasterMime(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  if (!mime) throw new Error('PNG・JPEG・WebP の画像を選んでください。');
  const objectUrl = URL.createObjectURL(file.slice(0, file.size, mime));
  try {
    const image = await imageFromUrl(objectUrl);
    const w = image.naturalWidth;
    const h = image.naturalHeight;
    if (!(w >= 16 && h >= 16) || w * h > MAX_PIXELS || Math.max(w, h) > 8192) {
      throw new Error('16ピクセル以上、長辺8,192ピクセル以下の画像を選んでください。大きすぎる画像は縮小してください。');
    }
    // Decode the picture into a bounded local canvas. The source file itself is never persisted.
    const scale = Math.min(1, 2400 / Math.max(w, h));
    const sheet = bitmap(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
    const ctx = sheet.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(image, 0, 0, sheet.width, sheet.height);
    return sheet;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function makeSprite(sheet, crop) {
  const result = bitmap();
  const ctx = result.getContext('2d', { willReadFrequently: true });
  const fit = containRect(crop.width, crop.height, OUTPUT, OUTPUT, 10);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(sheet, crop.x, crop.y, crop.width, crop.height, fit.x, fit.y, fit.width, fit.height);
  const pixels = ctx.getImageData(0, 0, OUTPUT, OUTPUT).data;
  let visible = 0;
  for (let i = 3; i < pixels.length && visible < 64; i += 4) {
    if (pixels[i] >= 20) visible++;
  }
  if (visible < 64) throw new Error('選択範囲がほぼ透明です。キャラクターのあるコマを選んでください。');
  return result;
}

const defaultProfile = () => ({ name: '初期キャラ', sprite: null, source: 'default' });
const initialCrop = () => ({ grid: 'single', cell: 0, size: 100, x: 50, y: 50 });

export function initCharacterLab({ onCharacter = () => {} } = {}) {
  const container = document.getElementById('character-lab');
  if (!container) return { getProfile: defaultProfile, reset() {} };
  container.innerHTML = `
    <section class="ch-lab" aria-label="自分のキャラクター">
      <div class="ch-lab-active">
        <canvas width="80" height="80" data-role="active" hidden aria-hidden="true"></canvas>
        <div><span class="ch-lab-tag">使用中のキャラ</span><strong data-role="current">初期キャラ</strong></div>
        <button type="button" data-role="reset" class="ch-lab-button ch-lab-quiet" hidden>初期キャラに戻す</button>
      </div>
      <p class="ch-lab-privacy">画像はこのブラウザー内だけで処理します。ファイルは自動送信されません。</p>
      <div class="ch-lab-actions">
        <label class="ch-lab-button ch-lab-file">
          シート・写真から切り出す
          <input type="file" accept="${ACCEPT}" data-role="sheet">
        </label>
        <label class="ch-lab-button ch-lab-file ch-lab-accent">
          完成キャラ画像を読み込む
          <input type="file" accept="${ACCEPT}" data-role="import">
        </label>
      </div>
      <section data-role="crop" class="ch-lab-crop" aria-label="画像の切り出し" hidden>
        <p class="ch-lab-tip">完成したキャラがいるコマを選びます。切り出しても自動でちびキャラに描き直すことはありません。</p>
        <canvas data-role="preview" width="480" height="272" aria-label="切り出しのプレビュー"></canvas>
        <label class="ch-lab-field">シートの並び
          <select data-role="grid">
            <option value="single">画像1枚</option>
            <option value="wide">左右2列</option>
            <option value="tall">上下2段</option>
            <option value="four">2 × 2</option>
            <option value="nine">3 × 3</option>
            <option value="sixteen">4 × 4</option>
          </select>
        </label>
        <div data-role="cells" class="ch-lab-cells" role="group" aria-label="切り出すコマ" hidden></div>
        <details class="ch-lab-adjust">
          <summary>切り出す範囲を調整</summary>
          <div class="ch-lab-ranges">
            <label>範囲 <span data-role="size-value">100%</span><input type="range" min="25" max="100" value="100" data-role="size"></label>
            <label>横位置<input type="range" min="0" max="100" value="50" data-role="x"></label>
            <label>縦位置<input type="range" min="0" max="100" value="50" data-role="y"></label>
          </div>
        </details>
        <div class="ch-lab-actions">
          <button class="ch-lab-button ch-lab-accent" data-role="apply" type="button">この範囲で使う</button>
          <button class="ch-lab-button ch-lab-quiet" data-role="cancel" type="button">閉じる</button>
        </div>
      </section>
      <details class="ch-lab-prompt">
        <summary>画像生成でちびキャラを作る</summary>
        <p class="ch-lab-tip">このゲーム内に画像生成機能はありません。使いたい参照画像と下の指示文を、自分で画像生成対応チャットへ送ってください。完成したら上の「完成キャラ画像を読み込む」で戻せます。</p>
        <label class="ch-lab-prompt-field">自分の指示（任意）
          <textarea data-role="direction" rows="3" maxlength="700" placeholder="例：赤いグローブ、星柄のユニフォーム、元のメガネはそのまま"></textarea>
        </label>
        <textarea data-role="prompt" rows="5" readonly aria-label="ちびキャラ画像生成用の指示文"></textarea>
        <div class="ch-lab-actions">
          <button type="button" data-role="copy" class="ch-lab-button">指示文をコピー</button>
          <a class="ch-lab-button ch-lab-quiet" href="https://chatgpt.com/" target="_blank" rel="noopener noreferrer">ChatGPTを開く</a>
        </div>
      </details>
      <p data-role="status" class="ch-lab-status" role="status" aria-live="polite"></p>
    </section>
  `;
  const find = (role) => container.querySelector('[data-role="' + role + '"]');
  const current = find('current');
  const active = find('active');
  const resetButton = find('reset');
  const sheetSelect = find('sheet');
  const finishedSelect = find('import');
  const crop = find('crop');
  const preview = find('preview');
  const grid = find('grid');
  const cells = find('cells');
  const cropSize = find('size');
  const cropX = find('x');
  const cropY = find('y');
  const apply = find('apply');
  const prompt = find('prompt');
  const direction = find('direction');
  const status = find('status');
  function refreshPrompt() { prompt.value = mergeChibiPrompt(direction.value); }
  direction.addEventListener('input', refreshPrompt);
  refreshPrompt();

  let profile = defaultProfile();
  let isLoading = false;
  let sequence = 0;
  let profileRevision = 0;
  let sheet = null;
  let sheetName = '';
  let settings = initialCrop();
  let previewBounds = null;

  function announce(message, error = false) {
    status.textContent = message;
    status.dataset.error = String(error);
  }

  function notify() {
    const { name, sprite } = profile;
    resetButton.hidden = !sprite && !sheet && !isLoading;
    current.textContent = name;
    active.hidden = !sprite;
    const context = active.getContext('2d');
    context.clearRect(0, 0, active.width, active.height);
    if (sprite) context.drawImage(sprite, 0, 0, active.width, active.height);
    onCharacter({ ...profile });
  }

  function updateLoading(value) {
    isLoading = value;
    apply.disabled = value;
    resetButton.hidden = !profile.sprite && !sheet && !value;
  }

  function save(value) {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify({
        name: value.name, source: value.source, png: value.sprite.toDataURL('image/png'),
      }));
      return true;
    } catch {
      return false;
    }
  }

  function activate(name, sprite, kind) {
    profileRevision++;
    profile = { name, sprite, source: kind };
    const kept = save(profile);
    notify();
    announce(kept ? 'このキャラを設定し、この端末に保存しました。' : 'このキャラを設定しました。保存できなかったため、今の画面だけで使えます。');
  }

  function closeCrop() {
    sheet = null;
    sheetName = '';
    settings = initialCrop();
    previewBounds = null;
    crop.hidden = true;
    preview.getContext('2d').clearRect(0, 0, preview.width, preview.height);
    resetButton.hidden = !profile.sprite && !isLoading;
  }

  function reset() {
    sequence++;
    profileRevision++;
    closeCrop();
    updateLoading(false);
    sheetSelect.value = '';
    finishedSelect.value = '';
    let removed = true;
    try { localStorage.removeItem(STORE_KEY); } catch { removed = false; }
    profile = defaultProfile();
    notify();
    announce(removed ? '初期キャラに戻しました。' : 'この画面では初期キャラに戻しました。端末の保存データを削除できませんでした。');
  }

  function renderCrop() {
    if (!sheet) return;
    const ctx = preview.getContext('2d');
    const w = preview.width;
    const h = preview.height;
    ctx.clearRect(0, 0, w, h);
    const fit = containRect(sheet.width, sheet.height, w, h, 6);
    previewBounds = fit;
    ctx.drawImage(sheet, fit.x, fit.y, fit.width, fit.height);
    const selected = cropRect(sheet.width, sheet.height, settings);
    const dx = fit.x + selected.x / sheet.width * fit.width;
    const dy = fit.y + selected.y / sheet.height * fit.height;
    const dw = selected.width / sheet.width * fit.width;
    const dh = selected.height / sheet.height * fit.height;
    ctx.fillStyle = 'rgba(2,6,15,.60)';
    ctx.fillRect(fit.x, fit.y, fit.width, Math.max(0, dy - fit.y));
    ctx.fillRect(fit.x, dy + dh, fit.width, Math.max(0, fit.y + fit.height - dy - dh));
    ctx.fillRect(fit.x, dy, Math.max(0, dx - fit.x), dh);
    ctx.fillRect(dx + dw, dy, Math.max(0, fit.x + fit.width - dx - dw), dh);
    ctx.strokeStyle = '#ffc85e';
    ctx.lineWidth = 2;
    ctx.strokeRect(dx, dy, dw, dh);
    const cellCount = grids[settings.grid][0] * grids[settings.grid][1];
    if (cells.children.length !== (cellCount > 1 ? cellCount : 0)) {
      cells.replaceChildren();
      for (let i = 0; i < (cellCount > 1 ? cellCount : 0); i++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = String(i + 1);
        b.setAttribute('aria-label', 'コマ ' + (i + 1));
        b.addEventListener('click', () => {
          settings.cell = i;
          settings.x = settings.y = 50;
          syncCropInputs();
          renderCrop();
        });
        cells.append(b);
      }
    }
    cells.hidden = cellCount < 2;
    [...cells.children].forEach((b, i) => b.setAttribute('aria-pressed', String(i === settings.cell)));
    find('size-value').textContent = settings.size + '%';
  }

  function syncCropInputs() {
    grid.value = settings.grid;
    cropSize.value = String(settings.size);
    cropX.value = String(settings.x);
    cropY.value = String(settings.y);
  }

  async function openFile(file, kind) {
    if (!file) return;
    const id = ++sequence;
    updateLoading(true);
    announce('画像を確認しています…');
    try {
      const decoded = await loadRaster(file);
      if (id !== sequence) return;
      const name = filenameLabel(file.name);
      if (kind === 'import') {
        const sprite = makeSprite(decoded, cropRect(decoded.width, decoded.height));
        closeCrop();
        activate(name, sprite, 'import');
        return;
      }
      sheet = decoded;
      sheetName = name;
      settings = initialCrop();
      syncCropInputs();
      crop.hidden = false;
      renderCrop();
      announce('画像を読み込みました。使いたい範囲を選んでください。');
    } catch (e) {
      if (id === sequence) announce(e.message || '画像の読み込みに失敗しました。', true);
    } finally {
      if (id === sequence) updateLoading(false);
    }
  }

  for (const [input, kind] of [[sheetSelect, 'crop'], [finishedSelect, 'import']]) {
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      input.value = '';
      void openFile(file, kind);
    });
  }
  grid.addEventListener('change', () => {
    if (!Object.hasOwn(grids, grid.value)) return;
    settings = { ...initialCrop(), grid: grid.value };
    syncCropInputs();
    renderCrop();
  });
  for (const [input, key] of [[cropSize, 'size'], [cropX, 'x'], [cropY, 'y']]) {
    input.addEventListener('input', () => { settings[key] = Number(input.value); renderCrop(); });
  }
  preview.addEventListener('click', (event) => {
    if (!previewBounds || isLoading) return;
    const rr = preview.getBoundingClientRect();
    const px = (event.clientX - rr.left) * preview.width / rr.width;
    const py = (event.clientY - rr.top) * preview.height / rr.height;
    const xx = (px - previewBounds.x) / previewBounds.width;
    const yy = (py - previewBounds.y) / previewBounds.height;
    if (xx < 0 || yy < 0 || xx >= 1 || yy >= 1) return;
    const [cols, rows] = grids[settings.grid];
    const col = Math.floor(xx * cols);
    const row = Math.floor(yy * rows);
    settings.cell = row * cols + col;
    settings.x = Math.round((xx * cols - col) * 100);
    settings.y = Math.round((yy * rows - row) * 100);
    syncCropInputs();
    renderCrop();
  });
  apply.addEventListener('click', () => {
    if (!sheet || isLoading) return;
    try {
      const name = sheetName;
      const sprite = makeSprite(sheet, cropRect(sheet.width, sheet.height, settings));
      closeCrop();
      activate(name, sprite, 'crop');
    } catch (e) {
      announce(e.message || '指定の範囲を使えませんでした。', true);
    }
  });
  find('cancel').addEventListener('click', () => {
    if (isLoading) return;
    closeCrop();
    announce('使用中のキャラは変更していません。');
  });
  resetButton.addEventListener('click', reset);
  find('copy').addEventListener('click', async () => {
    refreshPrompt();
    try {
      await navigator.clipboard.writeText(prompt.value);
      announce('指示文をコピーしました。必要な参照画像と一緒にチャットへ送ってください。');
    } catch {
      prompt.focus();
      prompt.select();
      announce('指示文を選択しました。端末のコピー操作を使ってください。');
    }
  });

  void (async () => {
    const revision = profileRevision;
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw && raw.length < 800_000) {
        const data = JSON.parse(raw);
        if ((data.source === 'crop' || data.source === 'import') && typeof data.name === 'string' &&
          /^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(data.png)) {
          const image = await imageFromUrl(data.png);
          if (revision !== profileRevision) return;
          if (image.naturalWidth === OUTPUT && image.naturalHeight === OUTPUT) {
            const sprite = bitmap();
            sprite.getContext('2d').drawImage(image, 0, 0);
            profile = { name: filenameLabel(data.name), sprite, source: data.source };
          }
        }
      }
    } catch { /* A broken or unavailable local snapshot must not prevent play. */ }
    await Promise.resolve();
    if (revision === profileRevision) notify();
  })();

  return { getProfile: () => ({ ...profile }), reset };
}
