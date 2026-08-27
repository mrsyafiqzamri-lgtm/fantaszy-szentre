// Fantaszy Szentre data freshness indicator
(() => {
  const META_URL = './data/meta.json';
  const FRESH_MIN = 90;
  const STALE_MIN = 180;

  const ageText = mins => {
    if (mins == null || !Number.isFinite(mins)) return 'age unknown';
    if (mins < 1) return 'just now';
    if (mins < 60) return `${Math.round(mins)} min ago`;
    const hours = mins / 60;
    if (hours < 24) return `${hours.toFixed(hours < 10 ? 1 : 0)}h ago`;
    return `${(hours / 24).toFixed(1)}d ago`;
  };

  const getInfo = meta => {
    const raw = meta?.updated_at_utc;
    if (!raw) return { level:'unknown', label:'UNKNOWN', ageMin:null, updated:'—', short:'—' };
    const date = new Date(raw);
    if (!Number.isFinite(date.getTime())) return { level:'unknown', label:'UNKNOWN', ageMin:null, updated:'—', short:'—' };
    const ageMin = Math.max(0, (Date.now() - date.getTime()) / 60000);
    const updated = date.toLocaleString(undefined, { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
    const short = date.toLocaleTimeString(undefined, { hour:'2-digit', minute:'2-digit' });
    if (ageMin > STALE_MIN) return { level:'stale', label:'STALE', ageMin, updated, short };
    if (ageMin > FRESH_MIN) return { level:'delayed', label:'DELAYED', ageMin, updated, short };
    return { level:'fresh', label:'FRESH', ageMin, updated, short };
  };

  const paintStatus = info => {
    const pill = document.querySelector('#apiStatus');
    if (!pill) return;
    const dot = pill.querySelector('.dot');
    const label = pill.querySelector('span:last-child');
    pill.className = 'status-pill';
    if (info.level === 'fresh') pill.classList.add('ok');
    if (info.level === 'stale') pill.classList.add('bad');
    if (label) label.textContent = `${info.label} · ${info.short}`;
    if (dot) {
      dot.style.background = info.level === 'delayed' ? '#f5c451' : '';
      dot.style.boxShadow = info.level === 'delayed' ? '0 0 0 5px rgba(245,196,81,.12)' : '';
    }
  };

  const paintNotice = (info, meta) => {
    const overview = document.querySelector('#overview');
    const hero = overview?.querySelector('.hero');
    if (!overview || !hero) return;

    let notice = document.querySelector('#dataFreshnessNotice');
    if (!notice) {
      notice = document.createElement('div');
      notice.id = 'dataFreshnessNotice';
      hero.insertAdjacentElement('afterend', notice);
    }
    notice.className = `notice ${info.level === 'stale' ? 'warn' : ''}`;

    const model = meta?.model_version || 'SZxP';
    notice.textContent = `${info.label} · ${model} data updated ${info.updated} (${ageText(info.ageMin)}). Backend is scheduled hourly at :17. GitHub may start a scheduled run a few minutes late. The ↻ button checks the newest published snapshot.`;
  };

  async function updateFreshness() {
    try {
      const res = await fetch(`${META_URL}?fresh=${Date.now()}`, { cache:'no-store' });
      if (!res.ok) throw new Error(`meta ${res.status}`);
      const meta = await res.json();
      const info = getInfo(meta);
      paintStatus(info);
      paintNotice(info, meta);
    } catch (err) {
      const info = { level:'stale', label:'STALE', ageMin:null, updated:'unavailable', short:'—' };
      paintStatus(info);
      paintNotice(info, { model_version:'SZxP' });
      console.warn('Freshness check failed', err);
    }
  }

  // app.js may render after this file loads, so apply more than once initially.
  setTimeout(updateFreshness, 1200);
  setTimeout(updateFreshness, 4000);
  setInterval(updateFreshness, 5 * 60 * 1000);

  const refresh = document.querySelector('#refreshBtn');
  if (refresh) refresh.addEventListener('click', () => setTimeout(updateFreshness, 1200));

  const pill = document.querySelector('#apiStatus');
  if (pill) {
    const observer = new MutationObserver(() => {
      const text = pill.textContent.trim();
      if (/^(FRESH|DELAYED|STALE|UNKNOWN)/.test(text)) return;
      setTimeout(updateFreshness, 300);
    });
    observer.observe(pill, { childList:true, subtree:true, characterData:true });
  }
})();
