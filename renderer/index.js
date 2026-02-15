// [Updated 2026-02-15 CET]
// Fix: Retry logic for /api/list (ESP32 connection reset)
// Fix: Concurrency guard prevents overlapping device requests
// Fix: Diagnostics header labels localized (Base/Storage/Status/Items/Version/Last check)
// Fix: Diagnostics buttons (Run/Refresh/Copy) re-localize on language change
// Keep: downloads with Save dialogs, sort-on-change, theme/density toggles, logo click,
//       file size de-duplication, file mode tag localization.

(function () {
  const el = map([
    'status','base','save','reset','totalText','usedText','usedPct','meterFill','itemsCount','daysCount',
    'refresh','expand','collapse','selectAll','clearSel','chooseFolder','folderBadge','downloadSel','deleteSel',
    'search','sort','list','listSkeleton','progress','progressLabel','progressFill','selectedBadge','opBadge',
    'tabExports','tabDiag','viewExports','viewDiag',
    'diagBaseText','diagStatusText','diagVersionText','diagStorageText','diagItemsText','diagTimeText','diagRefresh','diagCopy',
    'themeToggle','toast','lang','ctx','densityToggle'
  ]);
  function map(ids){ const o={}; ids.forEach(id=> o[id]=document.getElementById(id)); return o; }

  const Store = {
    getBase: ()=> localStorage.getItem('chronos.baseUrl') || '',
    setBase: v => localStorage.setItem('chronos.baseUrl', v || ''),
    getFolder: ()=> localStorage.getItem('chronos.folder') || '',
    setFolder: p => localStorage.setItem('chronos.folder', p || ''),
    getLang: ()=> (localStorage.getItem('chronos.lang') || (navigator.language || 'en')).split('-')[0].toLowerCase(),
    setLang: l => localStorage.setItem('chronos.lang', l || 'en'),
    getTheme: ()=> localStorage.getItem('chronos.theme') || 'light',
    setTheme: t => localStorage.setItem('chronos.theme', t || 'light'),
    getDensity:()=> localStorage.getItem('chronos.density') || 'comfort',
    setDensity:d => localStorage.setItem('chronos.density', d || 'comfort'),
    getPaths: ()=> { try{ return JSON.parse(localStorage.getItem('chronos.apiPaths')||'null'); }catch{ return null; } },
    setPaths: p => localStorage.setItem('chronos.apiPaths', JSON.stringify(p||null)),
  };

  let I18N = {};
  let currentStatusState='off';
  let diagAutoRunDone = false;
  let deviceRequestInFlight = false; // concurrency guard for ESP32 single-threaded server

  // ---------- i18n ----------
  async function loadLocale(lang){
    try{ const r=await window.chronos.readLocale(lang); I18N=(r&&r.ok&&r.data)||{}; }
    catch{ const r=await window.chronos.readLocale('en'); I18N=(r&&r.ok&&r.data)||{}; }
  }
  function t(k, fallback=''){ return (I18N && I18N[k]) ?? fallback ?? k; }

  function setTheme(theme){
    document.documentElement.setAttribute('data-theme', theme);
    Store.setTheme(theme);
    el.themeToggle.innerHTML = theme==='dark' ? '<span class="i i-sun"></span>' : '<span class="i i-moon"></span>';
  }

  function setDensityUI(mode){
    document.body.classList.toggle('density-compact', mode==='compact');
    el.densityToggle.setAttribute('aria-pressed', mode==='compact' ? 'true' : 'false');
  }

  function showToast(msg,ms=1600){ el.toast.textContent=msg; el.toast.classList.remove('hidden'); setTimeout(()=> el.toast.classList.add('hidden'), ms); }

  function setStatus(state, text){
    currentStatusState=state;
    el.status.className='chip status-'+state;
    if(!text){
      text = state==='on'
        ? t('toast.connected','Connected')
        : state==='checking'
          ? t('status.checking','Chronos: Checking…')
          : t('status.off','Chronos: Not available');
    }
    el.status.textContent=text;
  }

  // Formatters recomputed per language
  let nf, weekdayFmt;
  function recomputeFormatters(lang){
    const L = lang || Store.getLang() || 'en';
    nf = new Intl.NumberFormat(L,{maximumFractionDigits:1});
    weekdayFmt = new Intl.DateTimeFormat(L,{weekday:'long'});
  }

  // ---- i18n for diagnostics header (labels at the small KV strip above) ----
  function i18nDiagnosticsHeaderLabels(){
    const pairs = [
      { id: 'diagBaseText',    key: 'diag.base',       fallback: 'Base' },
      { id: 'diagStatusText',  key: 'status.label',    fallback: 'Status' },
      { id: 'diagVersionText', key: 'diag.version',    fallback: 'Version' },
      { id: 'diagStorageText', key: 'storage.title',   fallback: 'Storage' },
      { id: 'diagItemsText',   key: 'storage.items',   fallback: 'Items' },
      { id: 'diagTimeText',    key: 'diag.checked',    fallback: 'Last check' }
    ];
    for (const p of pairs){
      const node = el[p.id];
      if (!node || !node.parentElement) continue;
      const labelSpan = node.parentElement.querySelector('span');
      if (labelSpan) labelSpan.textContent = t(p.key, p.fallback);
    }
  }

  // ---- i18n for diagnostics action buttons (Run/Refresh/Copy) ----
  function i18nDiagnosticsControls(){
    const runBtn = document.getElementById('diagRun');
    if (runBtn) runBtn.innerHTML = `<span class="i i-arrow-sync"></span><span>${t('actions.runDiag','Run diagnostics')}</span>`;
    if (el.diagRefresh) el.diagRefresh.innerHTML = `<span class="i i-arrow-sync"></span><span>${t('actions.refreshDiag','Refresh diagnostics')}</span>`;
    if (el.diagCopy)    el.diagCopy.innerHTML    = `<span class="i i-copy"></span><span>${t('actions.copyDiag','Copy diagnostics')}</span>`;
  }

  // Apply i18n to top-area controls, tabs, placeholders, etc.
  function applyI18nTop(){
    const bt = document.querySelector('.brand-title'); if(bt) bt.textContent = t('app.title', bt.textContent);
    const bs = document.querySelector('.brand-sub');   if(bs) bs.textContent = t('app.subtitle', bs.textContent);

    if(el.tabExports) el.tabExports.textContent = t('tabs.exports','Exports');
    if(el.tabDiag)    el.tabDiag.textContent    = t('tabs.diagnostics','Diagnostics');

    if(el.save)        el.save.textContent        = t('actions.saveCheck','Save & Check');
    if(el.reset)       el.reset.textContent       = t('actions.reset','Reset');
    if(el.refresh)     el.refresh.textContent     = t('actions.refresh','Refresh');
    if(el.expand)      el.expand.textContent      = t('actions.expand','Expand');
    if(el.collapse)    el.collapse.textContent    = t('actions.collapse','Collapse');
    if(el.selectAll)   el.selectAll.textContent   = t('actions.selectAll','Select all');
    if(el.clearSel)    el.clearSel.textContent    = t('actions.clear','Clear');
    if(el.chooseFolder)el.chooseFolder.textContent= t('actions.chooseFolder','Choose folder…');
    if(el.downloadSel) el.downloadSel.textContent = t('actions.downloadSelected','Download selected');
    if(el.deleteSel)   el.deleteSel.textContent   = t('actions.deleteSelected','Delete selected');

    if(el.search) el.search.placeholder = t('search.placeholder','Search…');

    if (el.sort) {
      const opt = (val) => el.sort.querySelector(`option[value="${val}"]`);
      const o1 = opt('date-desc'); if (o1) o1.textContent = t('sort.dateNewest','Date (newest)');
      const o2 = opt('date-asc');  if (o2) o2.textContent = t('sort.dateOldest','Date (oldest)');
      const o3 = opt('name-asc');  if (o3) o3.textContent = t('sort.nameAsc','Name A–Z');
      const o4 = opt('name-desc'); if (o4) o4.textContent = t('sort.nameDesc','Name Z–A');
    }

    document.querySelectorAll('[data-i18n]').forEach(n=>{
      const k=n.getAttribute('data-i18n');
      n.textContent = t(k, n.textContent);
    });

    i18nDiagnosticsHeaderLabels();
    i18nDiagnosticsControls();
    setStatus(currentStatusState);
  }

  function applyI18n(){ applyI18nTop(); renderList(); }

  function bytes(b){ const u=['B','KB','MB','GB','TB']; let i=0,x=Number(b||0); while(x>=1024&&i<u.length-1){x/=1024;i++;} return `${nf.format(x)} ${u[i]}`; }
  function prettyDayLabel(iso){ const [y,m,d]=(iso||'').split('-').map(n=>+n); const dt=new Date(y,(m||1)-1,d||1); return `${weekdayFmt.format(dt)}, ${iso}`; }
  function nowText(){ return new Date().toLocaleString(); }

  // ---------- Data + list rendering ----------
  let rawDays=[], expandState={}, selectedDays=new Set(), selectedFiles=new Set();
  function updateSelectedBadge(){
    const txt=`${t('status.selected','Selected:')} ${selectedFiles.size + selectedDays.size}`;
    el.selectedBadge.textContent=txt;
    if(selectedFiles.size || selectedDays.size) el.selectedBadge.classList.remove('hidden'); else el.selectedBadge.classList.add('hidden');
  }

  async function loadStatus(base){
    deviceRequestInFlight = true;
    try{
      const s=await window.chronos.status(base, Store.getPaths());
      if(!s || !s.ok) throw 0;
      el.totalText.textContent=bytes(s.total); el.usedText.textContent=bytes(s.used);
      const pct=Math.max(0,Math.min(100,Math.round((s.used/Math.max(1,s.total))*100)));
      el.usedPct.textContent=pct+'%'; el.meterFill.style.width=pct+'%';
      if(el.diagBaseText) el.diagBaseText.textContent=base;
      if(el.diagStatusText) el.diagStatusText.textContent=t('toast.connected','Connected');
      if(el.diagStorageText) el.diagStorageText.textContent=`${el.usedText.textContent} / ${el.totalText.textContent} (${el.usedPct.textContent})`;
      if(el.diagTimeText) el.diagTimeText.textContent=nowText();
      setStatus('on');
    } catch{
      el.totalText.textContent='–'; el.usedText.textContent='–'; el.usedPct.textContent='0%'; el.meterFill.style.width='0%';
      setStatus('off');
    } finally {
      deviceRequestInFlight = false;
    }
  }

  async function loadList(base){
    deviceRequestInFlight = true;
    el.listSkeleton.classList.remove('hidden');
    try{
      const data=await window.chronos.list(base, Store.getPaths());
      const dates=Array.isArray(data&&data.dates)?data.dates:[];
      rawDays = dates.map(d=>({date:d.date, files:Array.isArray(d.files)?d.files:[]}));
      el.itemsCount.textContent= rawDays.reduce((a,d)=>a+d.files.length,0);
      el.daysCount.textContent= rawDays.length;
      renderList();
    } finally {
      el.listSkeleton.classList.add('hidden');
      deviceRequestInFlight = false;
    }
  }

  function renderList(){
    const q=(el.search.value||'').trim().toLowerCase();
    const sort=el.sort?.value || 'date-desc';
    const matchFile=f=>{ if(!q) return true;
      const name=(f.name||'').toLowerCase();
      const mode=(f.mode||'').toLowerCase();
      const bytesStr=String(f.bytes??'').toLowerCase();
      return name.includes(q) || mode.includes(q) || bytesStr.includes(q);
    };
    let days = rawDays.map(d=>({date:d.date, files:d.files.filter(matchFile)}));
    if(q) days = days.filter(d=> d.files.length || (d.date||'').toLowerCase().includes(q));

    if(sort==='date-asc') days.sort((a,b)=> a.date.localeCompare(b.date));
    else if(sort==='date-desc') days.sort((a,b)=> b.date.localeCompare(a.date));
    else if(sort==='name-asc') days.forEach(d=> d.files.sort((a,b)=> (a.name||'').localeCompare(b.name||'')));
    else if(sort==='name-desc') days.forEach(d=> d.files.sort((a,b)=> (b.name||'').localeCompare(a.name||'')));

    el.list.textContent='';
    if(!days.length){
      const wrap=document.createElement('div'); wrap.className='card'; wrap.style.cssText='text-align:center;padding:24px';
      const t1=document.createElement('div'); t1.style.fontWeight='700'; t1.style.marginBottom='6px'; t1.textContent=t('list.empty','No data.');
      const t2=document.createElement('div'); t2.className='muted'; t2.textContent='Try Refresh, adjust filters, or check your device URL.';
      wrap.appendChild(t1); wrap.appendChild(t2); el.list.appendChild(wrap); return;
    }

    for(const d of days){
      const day=document.createElement('div'); day.className='day';
      const head=document.createElement('div'); head.className='day-head';
      const left=document.createElement('div'); left.className='day-left';
      const chkDay=document.createElement('input'); chkDay.type='checkbox'; chkDay.checked=selectedDays.has(d.date);
      chkDay.addEventListener('click',e=>e.stopPropagation());
      chkDay.addEventListener('change',()=>{ if(chkDay.checked) selectedDays.add(d.date); else selectedDays.delete(d.date); updateSelectedBadge(); });
      const title=document.createElement('div'); title.className='day-title'; title.textContent=prettyDayLabel(d.date);
      left.appendChild(chkDay); left.appendChild(title);

      const right=document.createElement('div'); right.className='day-actions';

      const zip=document.createElement('button');
      zip.className='btn ghost';
      zip.innerHTML=`<span class="i i-arrow-download"></span><span>ZIP</span>`;
      zip.addEventListener('click', async (e)=>{
        e.preventDefault(); e.stopPropagation();
        try{
          const base = Store.getBase() || (el.base.value||'').trim() || 'http://192.168.4.1';
          const payload = { base, days: [d.date], files: [], folder: Store.getFolder() };
          const r = await window.chronos.downloadSelected(payload);
          showToast(r && r.ok ? t('toast.dlStarted','Downloads started') : t('toast.dlFail','Download failed'));
        }catch(err){ console.error(err); showToast(t('toast.dlFail','Download failed')); }
      });

      const toggle=document.createElement('button'); toggle.className='btn ghost';
      toggle.innerHTML = (expandState[d.date]
        ? `<span class="i i-chevron-up"></span><span>${t('actions.collapse','Collapse')}</span>`
        : `<span class="i i-chevron-down"></span><span>${t('actions.expand','Expand')}</span>`);
      toggle.addEventListener('click',e=>{ e.stopPropagation(); expandState[d.date]=!expandState[d.date]; renderList(); });

      right.appendChild(zip); right.appendChild(toggle);
      head.appendChild(left); head.appendChild(right); day.appendChild(head);

      const info=document.createElement('div'); info.className='day-sub';
      info.textContent=`${d.files.length} ${t('storage.items','Items')}`;
      day.appendChild(info);
      head.addEventListener('click',()=>{ expandState[d.date]=!expandState[d.date]; renderList(); });

      const filesDiv=document.createElement('div'); filesDiv.className='files';
      if(!expandState[d.date]){ filesDiv.classList.add('is-collapsed'); filesDiv.style.maxHeight='0px'; }

      if(expandState[d.date]){
        filesDiv.classList.remove('is-collapsed');
        for(const f of d.files){
          const row=document.createElement('div'); row.className='file';
          const leftF=document.createElement('div'); leftF.className='file-left';
          const name=(f.name||'').split('/').pop();

          const pathExp = `/exp/${d.date}/${name}`;
          const chk=document.createElement('input'); chk.type='checkbox'; chk.checked=selectedFiles.has(pathExp);
          chk.addEventListener('click',e=>e.stopPropagation());
          chk.addEventListener('change',()=>{ if(chk.checked) selectedFiles.add(pathExp); else selectedFiles.delete(pathExp); updateSelectedBadge(); });

          const link=document.createElement('a'); link.className='file-name'; link.textContent=name||'(unnamed)'; link.href = pathExp;
          link.addEventListener('click', async (e)=>{
            e.preventDefault(); e.stopPropagation();
            try{
              const base = Store.getBase() || (el.base.value||'').trim() || 'http://192.168.4.1';
              const payload = { base, days: [], files: [pathExp], folder: Store.getFolder() };
              const r = await window.chronos.downloadSelected(payload);
              showToast(r && r.ok ? t('toast.dlStarted','Downloads started') : t('toast.dlFail','Download failed'));
            }catch(err){ console.error(err); showToast(t('toast.dlFail','Download failed')); }
          });

          const meta=document.createElement('span'); meta.className='file-meta';
          const parts = [];
          if (f.mode) {
            const key = `mode.${String(f.mode).toLowerCase()}`;
            parts.push(t(key, f.mode));
          }
          if (f.size) parts.push(f.size);
          else if (Number.isFinite(f.bytes)) parts.push(bytes(f.bytes));
          meta.textContent = parts.length ? ` ${parts.join(' • ')}` : '';

          leftF.appendChild(chk); leftF.appendChild(link); leftF.appendChild(meta);

          const rightF=document.createElement('div');
          const del=document.createElement('button'); del.className='btn danger';
          del.innerHTML=`<span class="i i-delete"></span><span>${t('actions.delete','Delete')}</span>`;
          del.addEventListener('click', async e=>{
            e.stopPropagation();
            const ok=confirm(t('confirm.deleteFile',`Delete file: ${name}?`).replace('{name}', name));
            if(!ok) return;
            try{
              const r=await window.chronos.rmFile(Store.getBase(), pathExp);
              if(r&&r.ok){ showToast(t('toast.deleted','Deleted')); await loadList(Store.getBase()); }
            }catch(err){ console.error(err); }
          });

          row.addEventListener('contextmenu',ev=> showCtx(ev,{url:link.href,name,fp:pathExp,date:d.date}));
          rightF.appendChild(del);
          row.appendChild(leftF); row.appendChild(rightF);
          filesDiv.appendChild(row);
        }
        requestAnimationFrame(()=>{ filesDiv.style.maxHeight = filesDiv.scrollHeight + 'px'; });
      }

      day.appendChild(filesDiv);
      el.list.appendChild(day);
    }
  }

  function showCtx(ev,{url,name,fp}){ ev.preventDefault(); el.ctx.style.left=ev.clientX+'px'; el.ctx.style.top=ev.clientY+'px';
    el.ctx.classList.remove('hidden'); el.ctx.setAttribute('aria-hidden','false');
    el.ctx.onclick = async e => {
      const act=e.target.getAttribute('data-act'); if(!act) return;
      if(act==='open'){ if(url) await window.chronos.openExternal(url); }
      else if(act==='copy'){ if(url){ try{ await navigator.clipboard.writeText(url); }catch{ window.chronos.copyText(url); } showToast(t('toast.copied','Link copied')); } }
      else if(act==='delete'){ const ok = confirm(t('confirm.deleteFile',`Delete file: ${name}?`).replace('{name}', name)); if(!ok) return; try{ const r=await window.chronos.rmFile(Store.getBase(), fp); if(r&&r.ok){ showToast(t('toast.deleted','Deleted')); await loadList(Store.getBase()); } }catch(e2){ console.error(e2); } }
      hideCtx();
    };
    document.addEventListener('click', hideCtx, { once:true });
  }
  function hideCtx(){ el.ctx.classList.add('hidden'); el.ctx.setAttribute('aria-hidden','true'); el.ctx.onclick=null; }

  // ---------- Tabs (Exports / Diagnostics) ----------
  function activateTab(which){
    const isDiag = (which==='diag');
    el.tabExports?.classList.toggle('active', !isDiag);
    el.tabDiag?.classList.toggle('active', isDiag);
    el.viewExports?.classList.toggle('hidden', isDiag);
    el.viewDiag?.classList.toggle('hidden', !isDiag);

    if (isDiag && !diagAutoRunDone) {
      ensureDiagnosticsActions(); runDiagnostics().catch(console.error);
      diagAutoRunDone = true;
    }
  }
  el.tabExports?.addEventListener('click', ()=> activateTab('exports'));
  el.tabDiag?.addEventListener('click',   ()=> activateTab('diag'));

  // ---------- Theme/Density/Language/Sort ----------
  el.themeToggle?.addEventListener('click', ()=>{
    const next = (Store.getTheme()==='dark') ? 'light' : 'dark'; setTheme(next);
  });

  el.densityToggle?.addEventListener('click', ()=>{
    const next = (Store.getDensity()==='compact') ? 'comfort' : 'compact';
    Store.setDensity(next); setDensityUI(next);
    showToast(next==='compact' ? 'Dense mode' : 'Comfort mode');
  });

  el.lang?.addEventListener('change', async ()=>{
    const lang = (el.lang.value||'en').trim().toLowerCase();
    Store.setLang(lang);
    document.documentElement.setAttribute('lang', lang);
    recomputeFormatters(lang);
    await loadLocale(lang);
    applyI18n();
    const base=Store.getBase() || (el.base.value||'').trim() || 'http://192.168.4.1';
    if (currentStatusState==='on') { await loadStatus(base); }
  });

  el.sort?.addEventListener('change', ()=> { renderList(); });

  // ---------- Diagnostics ----------
  function ensureDiagnosticsActions(){
    const head = document.querySelector('.diag .diag-head .diag-actions');
    if (head && !document.getElementById('diagRun')) {
      const run = document.createElement('button');
      run.id = 'diagRun';
      run.className = 'btn';
      run.innerHTML = `<span class="i i-arrow-sync"></span><span>${t('actions.runDiag','Run diagnostics')}</span>`;
      head.prepend(run);
      run.addEventListener('click', runDiagnostics);
    }
    i18nDiagnosticsControls();

    el.diagRefresh?.addEventListener('click', async ()=>{
      const base=Store.getBase() || 'http://192.168.4.1';
      setStatus('checking');
      try{
        const v=await window.chronos.version(base, Store.getPaths());
        if(v&&v.ok){ setStatus('on'); if(el.diagVersionText) el.diagVersionText.textContent=v.version||''; await loadStatus(base); await loadList(base); }
        else setStatus('off');
      }catch{ setStatus('off'); }
    });
    el.diagCopy?.addEventListener('click', async ()=>{
      const block = document.getElementById('diagResults');
      let text = `${t('diag.base','Base')}: ${Store.getBase()||''}
${t('status.label','Status')}: ${el.status.textContent}
${t('diag.version','Version')}: ${(el.diagVersionText&&el.diagVersionText.textContent)||''}
${t('storage.title','Storage')}: ${(el.diagStorageText&&el.diagStorageText.textContent)||''}
${t('storage.items','Items')}: ${(el.diagItemsText&&el.diagItemsText.textContent)||''}
${t('diag.checked','Checked')}: ${(el.diagTimeText&&el.diagTimeText.textContent)||''}`;
      if (block) {
        const extra = block.getAttribute('data-json');
        if (extra) text += `\n\n${t('diag.summary','Summary')}:\n${extra}`;
      }
      try{ await navigator.clipboard.writeText(text); }catch{ window.chronos.copyText(text); }
      showToast(t('toast.copied','Link copied'));
    });
  }

  async function runDiagnostics(){
    const base = Store.getBase() || (el.base.value||'').trim() || 'http://192.168.4.1';
    const paths = Store.getPaths();
    const time = async (fn) => { const t0=performance.now(); const r=await fn(); const ms=Math.round(performance.now()-t0); return { r, ms }; };

    const results = { base, when: new Date().toISOString(), paths: paths || null, checks: {} };

    try{ const {r, ms} = await time(()=> window.chronos.version(base, paths));
         results.checks.version = { ok: !!(r&&r.ok), value: (r&&r.version)||'', ms };
         if (el.diagVersionText && r && r.ok) el.diagVersionText.textContent = r.version||''; }
    catch(e){ results.checks.version = { ok:false, err:String(e) }; }

    try{ const {r, ms} = await time(()=> window.chronos.status(base, paths));
         const total=(r&&r.total)||0, used=(r&&r.used)||0;
         results.checks.status = { ok: !!(r&&r.ok), total, used, ms }; }
    catch(e){ results.checks.status = { ok:false, err:String(e) }; }

    try{ const {r, ms} = await time(()=> window.chronos.list(base, paths));
         const days = Array.isArray(r&&r.dates) ? r.dates.length : 0;
         const items = Array.isArray(r&&r.dates) ? r.dates.reduce((a,d)=>a+(Array.isArray(d.files)?d.files.length:0),0) : 0;
         results.checks.list = { ok: true, days, items, ms };
         if (el.diagItemsText) el.diagItemsText.textContent = `${items}`; }
    catch(e){ results.checks.list = { ok:false, err:String(e) }; }

    renderDiagnostics(results);
  }

  function renderDiagnostics(res){
    const L = {
      base: t('diag.base','Base'),
      diagnostics: t('tabs.diagnostics','Diagnostics'),
      latencyVer: t('diag.latencyVer','Version latency'),
      latencyStatus: t('diag.latencyStatus','Status latency'),
      latencyList: t('diag.latencyList','List latency'),
      storage: t('storage.title','Storage'),
      items: t('storage.items','Items'),
      days: t('storage.days','days'),
      summary: t('diag.summary','Summary'),
      paths: t('diag.paths','Paths'),
      checked: t('diag.checked','Checked')
    };

    let host = document.getElementById('diagResults');
    if(!host){
      host = document.createElement('div');
      host.id = 'diagResults';
      host.className = 'card';
      document.getElementById('viewDiag')?.appendChild(host);
    }
    host.innerHTML = `
      <div class="kv" style="margin-top:8px">
        <div><span>${L.base}</span><b>${res.base}</b></div>
        <div><span>${L.latencyVer}</span><b>${res.checks.version?.ms ?? '–'} ms</b></div>
        <div><span>${L.latencyStatus}</span><b>${res.checks.status?.ms ?? '–'} ms</b></div>
        <div><span>${L.latencyList}</span><b>${res.checks.list?.ms ?? '–'} ms</b></div>
        <div><span>${L.storage}</span><b>${bytes(res.checks.status?.used||0)} / ${bytes(res.checks.status?.total||0)}</b></div>
        <div><span>${L.items}</span><b>${res.checks.list?.items ?? '–'}</b></div>
        <div><span>${L.days}</span><b>${res.checks.list?.days ?? '–'}</b></div>
        <div><span>${L.summary}</span><b>${new Date(res.when).toLocaleString()}</b></div>
      </div>
      <div style="margin-top:10px" class="muted small">
        ${L.paths}: ${res.paths ? JSON.stringify(res.paths) : 'default /api/*'}
      </div>
    `;
    host.setAttribute('data-json', JSON.stringify(res, null, 2));

    if(el.diagBaseText)    el.diagBaseText.textContent    = res.base || '';
    if(el.diagStatusText)  el.diagStatusText.textContent  = (res.checks.status?.ok ? t('toast.connected','Connected') : t('status.off','Chronos: Not available'));
    if(el.diagStorageText) el.diagStorageText.textContent = `${bytes(res.checks.status?.used||0)} / ${bytes(res.checks.status?.total||0)}`;
    if(el.diagItemsText)   el.diagItemsText.textContent   = `${res.checks.list?.items ?? '–'}`;
    if(el.diagTimeText)    el.diagTimeText.textContent    = nowText();

    i18nDiagnosticsHeaderLabels();
  }

  // ---------- Actions (unchanged flow) ----------
  el.save?.addEventListener('click', async ()=>{
    const base=(el.base.value||'').trim() || 'http://192.168.4.1';
    Store.setBase(base); setStatus('checking');
    try{
      const v=await window.chronos.version(base, Store.getPaths());
      if(v&&v.ok){ setStatus('on'); if(el.diagVersionText) el.diagVersionText.textContent=v.version||''; await loadStatus(base); await loadList(base); showToast(t('toast.connected','Connected')); }
      else throw 0;
    }catch{
      try{
        const d=await window.chronos.discover(base);
        if(d && d.ok){
          const p={ versionPath:d.hits.version?.path||'/api/version', statusPath:d.hits.status?.path||'/api/status', listPath:d.hits.list?.path||'/api/list' };
          Store.setPaths(p);
          const v2=await window.chronos.version(base,p);
          if(v2&&v2.ok){ setStatus('on'); if(el.diagVersionText) el.diagVersionText.textContent=v2.version||''; await loadStatus(base); await loadList(base); showToast(t('toast.connected','Connected')); return; }
        }
      }catch{}
      setStatus('off');
    }
  });

  el.refresh?.addEventListener('click', async ()=>{
    const base=Store.getBase() || (el.base.value||'').trim() || 'http://192.168.4.1';
    setStatus('checking');
    try{
      const v=await window.chronos.version(base, Store.getPaths());
      if(v&&v.ok){ setStatus('on'); if(el.diagVersionText) el.diagVersionText.textContent=v.version||''; await loadStatus(base); await loadList(base); }
      else throw 0;
    }catch{ setStatus('off'); }
  });

  el.expand?.addEventListener('click', ()=>{ rawDays.forEach(d=> expandState[d.date]=true ); renderList(); });
  el.collapse?.addEventListener('click', ()=>{ rawDays.forEach(d=> expandState[d.date]=false); renderList(); });
  el.selectAll?.addEventListener('click', ()=>{ selectedDays = new Set(rawDays.map(d=>d.date)); selectedFiles.clear(); updateSelectedBadge(); renderList(); });
  el.clearSel?.addEventListener('click', ()=>{ selectedDays.clear(); selectedFiles.clear(); updateSelectedBadge(); renderList(); });

  el.chooseFolder?.addEventListener('click', async ()=>{
    const r=await window.chronos.chooseFolder();
    if(r&&r.ok){ el.folderBadge.textContent=r.folder; el.folderBadge.classList.remove('hidden'); Store.setFolder(r.folder); }
  });

  el.downloadSel?.addEventListener('click', async ()=>{
    const base=Store.getBase() || (el.base.value||'').trim() || 'http://192.168.4.1';
    if(!(selectedDays.size || selectedFiles.size)){ showToast(t('toast.nothingSelected','Nothing selected')); return; }
    const payload={ base, days:Array.from(selectedDays), files:Array.from(selectedFiles), folder:Store.getFolder() };
    try{
      const r=await window.chronos.downloadSelected(payload);
      if(r&&r.ok){ showToast(t('toast.dlStarted','Downloads started')); }
    }catch(e){ console.error(e); showToast(t('toast.dlFail','Download failed')); }
  });

    el.deleteSel?.addEventListener('click', async ()=>{
    if(!(selectedDays.size || selectedFiles.size)){ showToast(t('toast.nothingSelected','Nothing selected')); return; }

    const totalCount = selectedDays.size + selectedFiles.size;
    const ok = confirm(t('confirm.deleteSelected', `Delete ${totalCount} selected item(s)?`).replace('{n}', totalCount));
    if(!ok) return;

    const base = Store.getBase() || (el.base.value||'').trim() || 'http://192.168.4.1';
    let deleted = 0;

    // Delete selected days (entire date folders)
    for(const date of selectedDays){
      try{
        const r = await window.chronos.rmDate(base, date);
        if(r && r.ok) deleted++;
      }catch(err){ console.error('rmDate failed:', date, err); }
    }

    // Delete individually selected files
    for(const fp of selectedFiles){
      try{
        const r = await window.chronos.rmFile(base, fp);
        if(r && r.ok) deleted++;
      }catch(err){ console.error('rmFile failed:', fp, err); }
    }

    selectedDays.clear();
    selectedFiles.clear();
    updateSelectedBadge();
    showToast(t('toast.deleted','Deleted') + ` (${deleted}/${totalCount})`);
    await loadList(base);
  });
  
  if (window.chronos?.onDownloadProgress) {
    window.chronos.onDownloadProgress(({id,received,total})=>{
      el.progress.classList.add('is-visible');
      const pct= total>0?Math.round(received/total*100):0;
      el.progressFill.style.width=pct+'%';
      el.progressLabel.textContent = `${t('status.preparing','Preparing…')} (${id}) — ${pct}%`;
    });
  }
  if (window.chronos?.onDownloadStep) {
    window.chronos.onDownloadStep(({done,total,label})=>{
      el.progress.classList.add('is-visible');
      const pct=Math.round(done/Math.max(1,total)*100);
      el.progressFill.style.width=pct+'%';
      el.progressLabel.textContent = `${t('toast.dlStarted','Downloads started')}: ${label} — ${done}/${total}`;
      if(done>=total){
        setTimeout(()=>{
          el.progress.classList.remove('is-visible');
          el.progressFill.style.width='0%';
          el.progressLabel.textContent='';
          showToast(t('toast.dlDone','Downloads completed'));
        },900);
      }
    });
  }

  // ---------- Device Log Viewer ----------
  let logAutoInterval = null;
  let logRawLines = [];
  const LEVEL_ORDER = { D:0, I:1, W:2, E:3, F:4 };

  const logEl = {
    output:       document.getElementById('logOutput'),
    levelFilter:  document.getElementById('logLevelFilter'),
    search:       document.getElementById('logSearch'),
    tailCount:    document.getElementById('logTailCount'),
    fetchBtn:     document.getElementById('logFetch'),
    autoToggle:   document.getElementById('logAutoToggle'),
    copyBtn:      document.getElementById('logCopy'),
    downloadBtn:  document.getElementById('logDownload'),
    clearBtn:     document.getElementById('logClear'),
    lineCount:    document.getElementById('logLineCount'),
    deviceLevel:  document.getElementById('logDeviceLevel'),
  };

  function parseLogLine(line) {
    const m = line.match(/^(.+?)\s+\[([DIWEF])\]\s+\[(.+?)\]\s+(.*)$/);
    if (!m) return { ts:'', level:'?', tag:'', msg: line, raw: line };
    return { ts: m[1], level: m[2], tag: m[3], msg: m[4], raw: line };
  }

  function logLevelClass(lv) {
    switch (lv) {
      case 'D': return 'log-debug';
      case 'I': return 'log-info';
      case 'W': return 'log-warn';
      case 'E': return 'log-error';
      case 'F': return 'log-fatal';
      default:  return '';
    }
  }

  function filterAndRenderLog() {
    const levelThreshold = logEl.levelFilter?.value || 'all';
    const query = (logEl.search?.value || '').trim().toLowerCase();

    const filtered = logRawLines.filter(parsed => {
      if (levelThreshold !== 'all') {
        const minOrd = LEVEL_ORDER[levelThreshold] ?? 0;
        const lineOrd = LEVEL_ORDER[parsed.level] ?? -1;
        if (lineOrd < minOrd) return false;
      }
      if (query && !parsed.raw.toLowerCase().includes(query)) return false;
      return true;
    });

    if (!logEl.output) return;

    const html = filtered.map(p => {
      const cls = logLevelClass(p.level);
      const escaped = p.raw
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      return `<span class="${cls}">${escaped}</span>`;
    }).join('\n');

    logEl.output.innerHTML = html;
    logEl.lineCount.textContent = `${filtered.length} / ${logRawLines.length} ${t('log.lines','lines')}`;
    logEl.output.scrollTop = logEl.output.scrollHeight;
  }

  async function fetchDeviceLog() {
    if (deviceRequestInFlight) return; // skip if list/status is loading
    deviceRequestInFlight = true;

    const base = Store.getBase() || (el.base?.value || '').trim() || 'http://192.168.4.1';
    const tail = parseInt(logEl.tailCount?.value || '200', 10) || 200;

    try {
      const r = await window.chronos.logFetch(base, tail);
      if (r && r.ok && r.text) {
        const lines = r.text.split('\n').filter(l => l.trim());
        logRawLines = lines.map(parseLogLine);
        filterAndRenderLog();
      } else {
        if (logEl.output) logEl.output.textContent = r?.reason || t('log.empty', 'No log data');
        logRawLines = [];
        if (logEl.lineCount) logEl.lineCount.textContent = '0 ' + t('log.lines', 'lines');
      }
    } catch (e) {
      if (logEl.output) logEl.output.textContent = `Error: ${e}`;
    } finally {
      deviceRequestInFlight = false;
    }

    // Fetch device log level (separate, lightweight request)
    try {
      const lv = await window.chronos.logLevel(base);
      if (lv && lv.ok) {
        const names = ['DEBUG','INFO','WARN','ERROR','FATAL'];
        const level = lv.level;
        if (level >= 0 && level < names.length) {
          if (logEl.deviceLevel) logEl.deviceLevel.textContent = `${t('log.deviceLevel','Device level')}: ${names[level]}`;
        } else {
          if (logEl.deviceLevel) logEl.deviceLevel.textContent = `${t('log.deviceLevel','Device level')}: ?`;
        }
      }
    } catch {}
  }

  logEl.fetchBtn?.addEventListener('click', fetchDeviceLog);
  logEl.levelFilter?.addEventListener('change', filterAndRenderLog);
  logEl.search?.addEventListener('input', filterAndRenderLog);

  logEl.autoToggle?.addEventListener('click', () => {
    if (logAutoInterval) {
      clearInterval(logAutoInterval);
      logAutoInterval = null;
      logEl.autoToggle.classList.remove('primary');
      logEl.autoToggle.classList.add('ghost');
      logEl.autoToggle.innerHTML = `<span>${t('log.autoRefresh','Auto-refresh')}</span>`;
    } else {
      fetchDeviceLog();
      logAutoInterval = setInterval(fetchDeviceLog, 3000);
      logEl.autoToggle.classList.remove('ghost');
      logEl.autoToggle.classList.add('primary');
      logEl.autoToggle.innerHTML = `<span>${t('log.autoStop','Stop auto')}</span>`;
    }
  });

  logEl.copyBtn?.addEventListener('click', async () => {
    const text = logRawLines.map(p => p.raw).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      showToast(t('toast.copied', 'Link copied'));
    } catch {
      try {
        window.chronos.copyText(text);
        showToast(t('toast.copied', 'Link copied'));
      } catch (e) {
        console.error('Copy failed:', e);
        showToast('Copy failed');
      }
    }
  });

  logEl.downloadBtn?.addEventListener('click', () => {
    const text = logRawLines.map(p => p.raw).join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chronos_log_${new Date().toISOString().slice(0,19).replace(/[T:]/g,'-')}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  });

  logEl.clearBtn?.addEventListener('click', async () => {
    const ok = confirm(t('log.confirmClear', 'Clear all logs on the device?'));
    if (!ok) return;
    const base = Store.getBase() || 'http://192.168.4.1';
    try {
      const r = await window.chronos.logClear(base);
      if (r && r.ok) {
        showToast(t('log.cleared', 'Log cleared'));
        logRawLines = [];
        filterAndRenderLog();
      }
    } catch (e) { console.error(e); }
  });

  // Auto-fetch log when switching to Diagnostics tab
  const origActivateTab = activateTab;
  activateTab = function(which) {
    origActivateTab(which);
    if (which === 'diag' && logRawLines.length === 0) {
      fetchDeviceLog();
    }
  };

  // ---------- Init ----------
  (async function init(){
    const lang = Store.getLang() || 'en';
    if(el.lang) el.lang.value=lang;
    document.documentElement.setAttribute('lang', lang);

    recomputeFormatters(lang);
    await loadLocale(lang);

    setTheme(Store.getTheme());
    setDensityUI(Store.getDensity());

    const base=Store.getBase() || 'http://192.168.4.1';
    if(el.base) el.base.value=base;

    applyI18n();

    // Default to Exports tab
    activateTab('exports');

    // Logo -> didakta.hr
    const logo = document.querySelector('.brand-logo');
    if (logo && window.chronos?.openExternal) {
      logo.style.cursor = 'pointer';
      logo.addEventListener('click', ()=> window.chronos.openExternal('https://www.didakta.hr'));
    }

    // Initial connect
    setStatus('checking');
    try{
      const v=await window.chronos.version(base, Store.getPaths());
      if(v&&v.ok){
        setStatus('on');
        if(el.diagVersionText) el.diagVersionText.textContent=v.version||'';
        if(el.diagBaseText) el.diagBaseText.textContent=base;
        await loadStatus(base); await loadList(base);
      } else throw 0;
    }catch{ setStatus('off'); }
  })();
})();