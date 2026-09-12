(() => {
  'use strict';

  const VERSION = '20260912-owner-boot-1';

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = resolve;
      s.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.body.appendChild(s);
    });
  }

  function addVisibleAuditBadge() {
    const tick = setInterval(() => {
      const hub = document.getElementById('fsTeamHub');
      const picker = document.getElementById('fs30TeamPicker');
      if (!hub || !picker) return;

      const name = picker.options?.[picker.selectedIndex]?.textContent || '';
      const norm = name.toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
      const fallback = {
        'joaoassic park':113200,
        'kk old boys fc':114940,
        'permas jaya fc':119375,
        'toastin adarabioyo':139195,
        'enzopreneur':131073,
        'colwill of fortune':132558,
        'palmerlaysia boleh':128817,
        'roger and out':137607
      };
      const pickerId = Number(picker.value);
      const entryId = pickerId >= 10000 ? pickerId : fallback[norm];
      const canon = window.__FS_CANONICAL_SQUADS__?.[entryId];

      let note = hub.querySelector('.fs-fh-source-note');
      if (!canon?.reverted) {
        note?.remove();
        return;
      }

      if (!note) {
        note = document.createElement('div');
        note.className = 'fs-fh-source-note';
        picker.insertAdjacentElement('afterend', note);
      }

      note.innerHTML =
        `<b>Free Hit reversion verified</b>` +
        `<span>GW${canon.freeHitGw} temporary squad ignored · ` +
        `permanent GW${canon.sourceGw} squad is feeding this page.</span>`;
    }, 500);

    setTimeout(() => clearInterval(tick), 120000);
  }

  async function boot() {
    try {
      if (window.FSFreeHitGuard?.preflightAll) {
        await window.FSFreeHitGuard.preflightAll();
      }
    } catch (e) {
      console.error('[FS squad preflight]', e);
    }

    // Crucial: Owner UI is initialised ONLY AFTER squad preflight.
    await loadScript(`owner-ui-30.js?v=20260912-owner30-fhgate1`);
    await loadScript(`match-30.js?v=20260909-match30-1`);
    addVisibleAuditBadge();

    window.__FS_OWNER_BOOT__ = {
      version:VERSION,
      ready:true,
      at:new Date().toISOString()
    };
  }

  boot().catch(err => {
    console.error('[FS owner boot]', err);
    // Fail-safe: still load the owner page, but expose failure.
    loadScript(`owner-ui-30.js?v=20260912-owner30-fallback1`).catch(()=>{});
    window.__FS_OWNER_BOOT__ = {version:VERSION, ready:false, error:String(err)};
  });
})();
