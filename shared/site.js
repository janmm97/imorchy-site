// Orchy final site behaviour · Miles · 2026-11-25
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = matchMedia('(hover:hover) and (pointer:fine)').matches;
  const IO = 'IntersectionObserver' in window;
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const setPause = (btn, paused, noun = 'animation') => { btn.setAttribute('aria-pressed', String(paused)); btn.setAttribute('aria-label', (paused ? 'Play ' : 'Pause ') + noun); };

  // reveal on scroll
  const rv = $$('.rv');
  if (reduce || !IO) rv.forEach(e => e.classList.add('in'));
  else { const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' }); rv.forEach(e => io.observe(e)); }

  // videos: play only while visible, pause control, poster under reduced motion
  const held = new WeakSet();
  const vids = $$('.stage video');
  vids.forEach(v => {
    v.muted = true;
    const btn = v.closest('.stage').querySelector('.pause');
    if (reduce) { held.add(v); v.pause(); btn && setPause(btn, true); }
    btn?.addEventListener('click', () => {
      const p = btn.getAttribute('aria-pressed') !== 'true';
      setPause(btn, p, btn.dataset.noun);
      if (p) { held.add(v); v.pause(); } else { held.delete(v); v.play().catch(() => {}); }
    });
  });
  if (IO) { const vo = new IntersectionObserver(es => es.forEach(e => { const v = e.target; if (e.isIntersecting && !held.has(v)) v.play().catch(() => {}); else v.pause(); }), { threshold: .25 }); vids.forEach(v => vo.observe(v)); }

  // CSS motion scenes: pause button + pause while offscreen
  $$('.stage .scene').forEach(sc => {
    const btn = sc.closest('.stage').querySelector('.pause');
    let user = reduce;
    if (reduce) { sc.classList.add('off'); btn && setPause(btn, true); }
    btn?.addEventListener('click', () => { user = btn.getAttribute('aria-pressed') !== 'true'; setPause(btn, user); sc.classList.toggle('off', user); });
    if (IO) new IntersectionObserver(es => es.forEach(e => sc.classList.toggle('off', user || !e.isIntersecting))).observe(sc);
  });

  // film: sound toggle (only where Stella's audio film exists)
  $$('[data-sound]').forEach(b => {
    const v = b.closest('.stage').querySelector('video');
    b.addEventListener('click', () => {
      v.muted = !v.muted; b.setAttribute('aria-pressed', String(!v.muted));
      b.querySelector('span').textContent = v.muted ? 'Sound on' : 'Sound off';
      if (!v.muted) { held.delete(v); v.play().catch(() => {}); const p = b.closest('.stage').querySelector('.pause'); p && setPause(p, false, 'film'); }
    });
  });

  // logo marquee pause
  $$('[data-mq]').forEach(b => {
    const mq = document.getElementById(b.dataset.mq);
    if (reduce) { mq.classList.add('paused'); setPause(b, true, 'logo scroll'); }
    b.addEventListener('click', () => { const p = !mq.classList.contains('paused'); mq.classList.toggle('paused', p); setPause(b, p, 'logo scroll'); });
  });

  // spotlight + subtle tilt on cards (fine pointer, motion allowed)
  if (fine && !reduce) {
    $$('.bx,.spot').forEach(el => {
      el.addEventListener('pointermove', e => {
        const r = el.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
        el.style.setProperty('--mx', x + 'px'); el.style.setProperty('--my', y + 'px');
        if (el.classList.contains('bx')) el.style.transform = `perspective(900px) rotateX(${(.5 - y / r.height) * 3}deg) rotateY(${(x / r.width - .5) * 3}deg)`;
      });
      el.addEventListener('pointerleave', () => { el.style.transform = ''; });
    });
  }

  // interactive approvals gate
  $$('[data-gate]').forEach(g => {
    const log = g.querySelector('.gx-log'), st = g.querySelector('.gx-state'), draft = g.querySelector('.gx-draft p');
    const drafts = JSON.parse(g.dataset.gate); let i = 0;
    const add = (cls, k, v) => { const li = document.createElement('li'); li.className = cls + ' new'; li.innerHTML = `<span>${k}</span><b>${v}</b>`; log.prepend(li); while (log.children.length > 4) log.lastChild.remove(); };
    g.querySelectorAll('.gx-btns button').forEach(b => b.addEventListener('click', () => {
      const ok = b.classList.contains('ok'), d = drafts[i % drafts.length];
      add(ok ? 'done' : 'no', d.k, ok ? 'SENT · YOU APPROVED' : 'DENIED · NOTHING WENT OUT');
      st.textContent = ok ? 'Approved. It went out, and the log shows who said yes.' : 'Denied. Nothing went out. The draft stays for you to edit.';
      i++; const n = drafts[i % drafts.length];
      setTimeout(() => { draft.textContent = n.t; g.querySelector('.gx-draft small').textContent = n.a; add('wait', n.k, 'WAITING FOR YOU'); }, 500);
    }));
  });

  // tabs (roving, arrow keys)
  $$('[role=tablist]').forEach(tl => {
    const tabs = $$('[role=tab]', tl);
    const sel = t => { tabs.forEach(x => { const on = x === t; x.setAttribute('aria-selected', on); x.tabIndex = on ? 0 : -1; document.getElementById(x.getAttribute('aria-controls')).hidden = !on; }); };
    tabs.forEach((t, i) => { t.addEventListener('click', () => sel(t)); t.addEventListener('keydown', e => { const k = { ArrowRight: 1, ArrowLeft: -1 }[e.key]; if (!k) return; e.preventDefault(); const n = tabs[(i + k + tabs.length) % tabs.length]; sel(n); n.focus(); }); });
  });

  // pricing: monthly / yearly
  const bill = $$('.bill button');
  bill.forEach(b => b.addEventListener('click', () => {
    const y = b.dataset.b === 'y';
    bill.forEach(x => x.setAttribute('aria-pressed', String(x === b)));
    $$('.plan').forEach(p => {
      const has = p.dataset.y; const show = y && has;
      p.querySelector('.amt').textContent = show ? p.dataset.y : p.dataset.m;
      p.querySelector('.unit').textContent = show ? '/yr' : '/mo';
      p.querySelector('.per').textContent = y ? (has ? '2 months free' : 'Monthly only') : (has ? 'or $' + p.dataset.y.slice(1) + ' a year' : 'Monthly only');
    });
  }));

  // credits meter
  $$('.meter').forEach(m => {
    const r = m.querySelector('input'), out = m.querySelector('output'), msg = m.querySelector('.m-msg'), bar = m.querySelector('.bar');
    const upd = () => {
      const v = +r.value; bar.style.setProperty('--v', v + '%'); out.textContent = v + '% used';
      const s = v >= 100 ? 'stop' : v >= 80 ? 'warn' : 'ok'; m.dataset.s = s;
      msg.textContent = s === 'stop' ? 'Paused. AI work stops until next month or you upgrade. Nothing is charged extra.' : s === 'warn' ? 'Heads-up sent at 80%. Your agents keep working.' : 'All good. Your agents are working.';
    };
    r.addEventListener('input', upd); upd();
  });

  // apps filter
  $$('[data-filter]').forEach(inp => {
    const items = $$('#' + inp.dataset.filter + ' li'), out = document.getElementById(inp.dataset.filter + '-n');
    inp.addEventListener('input', () => {
      const q = inp.value.trim().toLowerCase(); let n = 0;
      items.forEach(li => { const hit = !q || li.dataset.n.includes(q); li.hidden = !hit; n += hit; });
      out.textContent = n ? `${n} shown` : 'Not listed here. 1,100+ apps connect through One.';
    });
  });
})();
