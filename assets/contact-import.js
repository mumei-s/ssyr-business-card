(() => {
  const { contactName: name, contactQr: qr } = document.currentScript.dataset;
  const links = document.querySelectorAll('a[href$="contact.vcf"]');
  if (!name || !links.length || !window.HTMLDialogElement || !HTMLDialogElement.prototype.showModal) return;

  const ua = navigator.userAgent;
  const appleMobile = /iPhone|iPad|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const mac = /Mac/i.test(navigator.platform);
  const dialog = document.createElement('dialog');
  dialog.id = 'contact-import';
  dialog.setAttribute('aria-labelledby', 'contact-import-title');
  dialog.innerHTML = `
    <h2 id="contact-import-title">電話帳に登録</h2>
    <p class="import-name"></p>
    <p class="import-help"></p>
    <a data-import-file class="import-file" type="text/x-vcard"></a>
    <details class="import-android"><summary>ファイルから登録する</summary>
      <p>Google 連絡帳の「整理」→「ファイルからインポート」で、保存先と受け取ったVCFを選んでください。</p>
      <a data-import-download>VCFファイルを保存</a>
    </details>
    <details class="import-scan"><summary>別のスマホで読み取る</summary>
      <a class="import-scan-card" type="text/x-vcard"><img width="240" height="240" alt="電話帳登録用QRコード"></a>
    </details>
    <form method="dialog"><button type="submit">閉じる</button></form>`;

  const file = dialog.querySelector('[data-import-file]');
  const help = dialog.querySelector('.import-help');
  const fallback = dialog.querySelector('[data-import-download]');
  const scan = dialog.querySelector('.import-scan-card');
  dialog.querySelector('.import-name').textContent = name;

  if (appleMobile) {
    file.textContent = 'iPhone・iPadの連絡先で開く';
    help.textContent = '開いたカードで「新規連絡先を作成」を選び、保存してください。ファイルに保存された場合は、「ファイル」から保存したVCFを開けます。';
  } else if (android) {
    file.textContent = 'Androidの連絡帳で開く';
    help.textContent = '連絡帳が開いたら保存先を選んで登録します。ダウンロードされた場合は、通知の「開く」からVCFを開いてください。';
    fallback.download = name + '.vcf';
  } else {
    file.textContent = mac ? 'Macの連絡先で開く' : '電話帳用ファイルを受け取る';
    if (!mac) file.download = name + '.vcf';
    help.textContent = 'VCFを開き、連絡先アプリで登録してください。アプリのインポート機能からも読み込めます。';
  }
  if (!android) dialog.querySelector('.import-android').remove();
  if (!qr) dialog.querySelector('.import-scan').remove();

  document.body.append(dialog);
  for (const link of links) {
    link.setAttribute('aria-haspopup', 'dialog');
    link.addEventListener('click', event => {
      if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      const previous = link.closest('dialog[open]');
      if (previous) previous.close();
      file.href = link.href;
      if (android) fallback.href = link.href;
      if (qr) {
        scan.href = link.href;
        scan.querySelector('img').src = qr;
      }
      for (const details of dialog.querySelectorAll('details')) details.open = false;
      if (!dialog.open) dialog.showModal();
    });
  }
})();
