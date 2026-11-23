(() => {
  const android = /Android/i.test(navigator.userAgent);
  const apple = /iPhone|iPad|iPod|Macintosh/i.test(navigator.userAgent);
  const appleMethod = document.querySelector('[data-apple-contact]');
  if (appleMethod && android) appleMethod.hidden = true;

  const actions = document.querySelectorAll('a[data-add-contact]');
  if (!actions.length) return;
  if (apple && !android) {
    for (const link of actions) {
      link.href = new URL('contact.vcf', link.href);
      link.type = 'text/vcard';
    }
    return;
  }
  if (!android || !/Chrome\//i.test(navigator.userAgent)) return;

  const name = document.currentScript.dataset.contactName;
  const mail = document.querySelector('a[href^="mailto:"]');
  if (!name || !mail) return;
  const phone = document.querySelector('a[href^="tel:"]');
  const extras = {
    name,
    email: mail.getAttribute('href').slice(7).split('?')[0],
    company: "S's-YR",
    job_title: '代表'
  };
  if (phone) extras.phone = phone.getAttribute('href').slice(4);

  const alternative = document.createElement('a');
  alternative.className = 'contact-retry';
  alternative.textContent = '電話帳が開かないときの登録方法';
  for (const link of actions) {
    const fallback = link.href;
    const fields = Object.entries({...extras, browser_fallback_url: fallback})
      .map(([key, value]) => 'S.' + key + '=' + encodeURIComponent(value));
    link.href = ['intent:#Intent', 'action=android.intent.action.INSERT',
      'type=vnd.android.cursor.dir/contact', ...fields, 'end'].join(';');

    // Some embedded browsers silently ignore an external intent and its fallback URL.
    link.addEventListener('click', event => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      alternative.href = fallback;
      link.parentElement.after(alternative);
    });
  }
})();
