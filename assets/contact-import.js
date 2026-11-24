(() => {
  const script = document.currentScript;
  const name = script?.dataset.contactName;
  const edition = script?.dataset.contactEdition;
  const actions = [...document.querySelectorAll('a[data-add-contact]')];
  if (!actions.length || !name || !['business', 'shinji'].includes(edition)) return;

  const ua = navigator.userAgent;
  const android = /Android/i.test(ua);
  const apple = /iPhone|iPad|iPod|Macintosh/i.test(ua);
  const androidIntent = android && /(?:Chrome|EdgA)\//i.test(ua) && !/Firefox\//i.test(ua);
  const appleVcard = apple && !android;
  if (!androidIntent && !appleVcard) return; // Firefox, desktop, etc.: ordinary HTML link

  const mail = document.querySelector('a[href^="mailto:"]');
  const phone = edition === 'business' ? document.querySelector('a[href^="tel:"]') : null;
  const email = mail?.getAttribute('href').slice(7).split('?')[0];
  if (!email || (edition === 'business' && !phone)) return;
  const extras = { name, email, company: "S's-YR", job_title: '代表' };
  if (phone) extras.phone = phone.getAttribute('href').slice(4);

  const expected = new URL('./contact.html', document.baseURI);
  if (expected.origin !== location.origin) return;
  const recoveryByGroup = new Map();
  for (const link of actions) {
    const fallback = link.href;
    if (fallback !== expected.href) continue; // never cross editions or origins
    if (appleVcard) {
      link.href = new URL('contact.vcf', fallback).href;
      link.type = 'text/vcard';
    } else {
      const fields = Object.entries({...extras, browser_fallback_url: fallback})
        .map(([key, value]) => 'S.' + key + '=' + encodeURIComponent(value));
      link.href = ['intent:#Intent', 'action=android.intent.action.INSERT',
        'type=vnd.android.cursor.dir/contact', ...fields, 'end'].join(';');
    }

    // Outside SHINJI's fixed design surface; elsewhere after the existing button group.
    const group = link.closest('.contact-face')?.closest('.card') || link.parentElement;
    if (!group) continue;
    let showRecovery = recoveryByGroup.get(group);
    if (!showRecovery) {
      const key = 'ssyr-contact-recovery:' + location.pathname + ':' + recoveryByGroup.size;
      const retry = document.createElement('a');
      retry.className = 'contact-retry';
      retry.href = fallback;
      retry.textContent = '電話帳が開かないときの登録方法';
      showRecovery = () => {
        if (!retry.isConnected) group.after(retry);
        try { sessionStorage.setItem(key, '1'); } catch (_) { /* private/blocked storage */ }
      };
      recoveryByGroup.set(group, showRecovery);
      try { if (sessionStorage.getItem(key) === '1') showRecovery(); } catch (_) { /* optional */ }
    }
    // Preserve the genuine user gesture; no timer, no automatic second launch,
    // no assumption that a hidden page means a contact was saved.
    link.addEventListener('click', event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      showRecovery();
    });
  }
})();
