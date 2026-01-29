// [2026-01-29 20:25 CET] Renderer v1.2.11 — UI-only fixes: status pill, ZIP click, hover highlight, file-link open, checkboxes near names
(function () {
  const el = mapIds([
    'status','base','save','reset','totalText','usedText','usedPct','meterFill','itemsCount','daysCount',
    'refresh','expand','collapse','selectAll','clearSel','chooseFolder','folderBadge','downloadSel','deleteSel',
    'search','sort','list','listSkeleton','progress','progressLabel','progressFill','selectedBadge','opBadge',
    'tabExports','tabDiag','viewExports','viewDiag','diagBase','diagRun','diagSummary','diagV','diagS','diagL','diagW',
    'wifiList','themeToggle','toast','lang','ctx'
  ]);
  function mapIds(ids){ const o={}; ids.forEach(id=> o[id]=document.getElementById(id)); return o; }

  // Theme overrides
  try{ const overrides = JSON.parse(localStorage.getItem('chronos.theme.overrides')||'{}'); for(const k in overrides){ document.documentElement.style.setProperty(k, overrides[k]); } }catch{}

  // Store & i18n
  const Store = {
    getBase:()=> localStorage.getItem('chronos.baseUrl')||'',
    setBase:(v)=> localStorage.setItem('chronos.baseUrl',v||''),
    getFolder:()=> localStorage.getItem('chronos.folder')||'',
    setFolder:(p)=> localStorage.setItem('chronos.folder',p||''),
    getLang:()=> localStorage.getItem('chronos.lang') || (navigator.language||'en').split('-')[0].toLowerCase(),
    setLang:(l)=> localStorage.setItem('chronos.lang',l||'en'),
    getTheme:()=> localStorage.getItem('chronos.theme')||'light',
    setTheme:(t)=> localStorage.setItem('chronos.theme',t||'light'),
  };
  let I18N = {}; let LANG = Store.getLang();
  async function loadI18n(lang){
    LANG = lang;
    const url = `./i18n/${lang}.json`;
    let txt='{}'; try{ txt = await fetch(url).then(r=>r.text()); }catch{}
    try{ I18N = JSON.parse(txt);}catch{ I18N = {}; }
    document.querySelectorAll('[data-i18n]').forEach(n=>{
      const key=n.getAttribute('data-i18n'); if(I18N[key]) n.textContent = I18N[key];
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(n=>{
      const key=n.getAttribute('data-i18n-placeholder'); if(I18N[key]) n.setAttribute('placeholder', I18N[key]);
    });
  }
  function t(key, fb){ return (I18N && I18N[key]) || fb || key; }
  function fmtDateISO(iso){ try{ const d = new Date(iso+'T00:00:00'); return new Intl.DateTimeFormat(LANG, { year:'numeric', month:'short', day:'2-digit'}).format(d);}catch{ return iso; } }

  // Theme helpers
  function setTheme(theme){ document.documentElement.setAttribute('data-theme', theme); Store.setTheme(theme); el.themeToggle.textContent = theme==='dark' ? '☀️' : '🌙'; }

  // Status chip (colored pill via CSS classes)
  function setStatus(state, text){
    el.status.classList.remove('status-on','status-checking','status-off');
    el.status.classList.add('status-'+state);
    el.status.textContent = text || (state==='on'? `Chronos: Connected (${Store.getBase()||''})`
                    : state==='checking' ? t('status.checking','Chronos: Checking…')
                    : t('status.off','Chronos: Not available'));
  }
  function showToast(msg, ms=1600){ el.toast.textContent=msg; el.toast.classList.remove('hidden'); setTimeout(()=> el.toast.classList.add('hidden'), ms); }

  // Data & selection
  let rawDays=[]; let expandState={}; let selectedDays=new Set(); let selectedFiles=new Set();
  function fullPath(date, file){ const name=(file.name||'').split('/').pop(); return `/exp/${date}/${name}`; }
  function bytes(b){ const u=['B','KB','MB','GB','TB']; let i=0,x=Number(b||0); while(x>=1024 && i<u.length-1){ x/=1024; i++; } return x.toFixed(1)+' '+u[i]; }
  function updateSelectedBadge(){ const text = `${t('status.selected','Selected:')} ${selectedFiles.size + selectedDays.size}`; el.selectedBadge.textContent = text; if(selectedFiles.size || selectedDays.size) el.selectedBadge.classList.remove('hidden'); else el.selectedBadge.classList.add('hidden'); }

  // Loaders
  async function loadStatus(base){
    try{
      const s=await window.chronos.status(base); if(!s||!s.ok) throw 0;
      el.totalText.textContent = bytes(s.total);
      el.usedText.textContent  = bytes(s.used);
      const pct=Math.max(0,Math.min(100,Math.round((s.used/Math.max(1,s.total))*100)));
      el.usedPct.textContent=pct+'%'; el.meterFill.style.width=pct+'%';
    }catch{ el.totalText.textContent='–'; el.usedText.textContent='–'; el.usedPct.textContent='0%'; el.meterFill.style.width='0%'; }
  }
  async function loadList(base){
    el.listSkeleton.classList.remove('hidden');
    try{
      const data=await window.chronos.list(base);
      const dates=Array.isArray(data&&data.dates)?data.dates:[];
      rawDays=dates.map(d=>({ date:d.date, files:Array.isArray(d.files)?d.files:[] }));
      el.itemsCount.textContent = rawDays.reduce((a,d)=> a+d.files.length,0);
      el.daysCount.textContent  = rawDays.length;
      rawDays.forEach(d=>{ if(!(d.date in expandState)) expandState[d.date]=true; });
      renderList();
    }finally{ el.listSkeleton.classList.add('hidden'); }
  }

  // Render
  function renderList(){
    const q=(el.search.value||'').trim().toLowerCase();
    const sort=el.sort.value||'date-desc';
    let days = rawDays.map(d=> ({ date:d.date, files:d.files.slice() }));
    if(q){
      days.forEach(d=> d.files = d.files.filter(f=> (f.name||'').toLowerCase().includes(q) || (f.mode||'').toLowerCase().includes(q) || String(f.bytes||'').includes(q) ));
      days = days.filter(d=> d.files.length || d.date.toLowerCase().includes(q));
    }
    if(sort==='date-asc') days.sort((a,b)=> a.date.localeCompare(b.date));
    else if(sort==='date-desc') days.sort((a,b)=> b.date.localeCompare(a.date));
    else if(sort==='name-asc') days.forEach(d=> d.files.sort((a,b)=> (a.name||'').localeCompare(b.name||'')));
    else if(sort==='name-desc') days.forEach(d=> d.files.sort((a,b)=> (b.name||'').localeCompare(a.name||'')));

    el.list.textContent='';
    if(!days.length){ el.list.innerHTML = `<div class="day"><div class="day-sub">${t('list.empty','No data.')}</div></div>`; return; }

    for(const d of days){
      const day = div('day');
      const head = div('day-head');

      // Left: checkbox + title, then sub line
      const left = div('day-left');
      const chkDay = document.createElement('input'); chkDay.type='checkbox'; chkDay.checked = selectedDays.has(d.date);
      chkDay.addEventListener('click', (e)=>{ e.stopPropagation(); }); // don't toggle group on checkbox click
      chkDay.addEventListener('change', ()=>{ if(chkDay.checked){ selectedDays.add(d.date); } else { selectedDays.delete(d.date); } updateSelectedBadge(); });

      const dayTitle = div('day-title', `${fmtDateISO(d.date)} (${d.date})`);
      left.appendChild(chkDay); left.appendChild(dayTitle);

      const daySub = div('day-sub', `${d.files.length} ${t('storage.items','Items')}`);

      // Right: ZIP + toggle
      const right = div('day-actions');
      const btnZip = aBtn('btn ghost','ZIP');
      window.chronos.zipUrl(Store.getBase(), d.date).then(u=> btnZip.href=u);
      btnZip.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); const href=btnZip.href; if(href) window.chronos.openExternal(href); });

      const toggle = button('btn ghost', expandState[d.date] ? '▾' : '▸');
      toggle.addEventListener('click',(e)=>{ e.stopPropagation(); expandState[d.date]=!expandState[d.date]; renderList(); });

      right.appendChild(btnZip); right.appendChild(toggle);

      head.appendChild(left); head.appendChild(right); day.appendChild(head);
      day.appendChild(daySub);

      // Clicking the head toggles expand/collapse
      head.addEventListener('click',()=>{ expandState[d.date]=!expandState[d.date]; renderList(); });

      if(expandState[d.date]){
        const filesDiv = div('files');
        for(const f of d.files){
          const row = div('file');

          // Left file area: checkbox + link + meta
          const leftF = div('file-left');
          const fp = fullPath(d.date, f);
          const chkF = document.createElement('input'); chkF.type='checkbox'; chkF.checked = selectedFiles.has(fp);
          chkF.addEventListener('click', (e)=> e.stopPropagation());
          chkF.addEventListener('change', ()=>{ if(chkF.checked) selectedFiles.add(fp); else selectedFiles.delete(fp); updateSelectedBadge(); });

          const name = (f.name||'').split('/').pop();
          const link = aBtn('file-name', name||'(unnamed)');
          window.chronos.dlUrl(Store.getBase(), d.date, name).then(u=> link.href=u);
          link.addEventListener('click', (e)=>{ e.preventDefault(); e.stopPropagation(); const href=link.href; if(href) window.chronos.openExternal(href); });

          const meta = span('file-meta', ` ${(f.mode||'')} • ${(f.size||'')} • ${(f.bytes||0)} bytes`);
          leftF.appendChild(chkF); leftF.appendChild(link); leftF.appendChild(meta);

          // Right file area: actions (Delete)
          const rightF = document.createElement('div');
          const del = button('btn danger', t('actions.delete','Delete'));
          del.addEventListener('click', async(e)=>{ 
            e.stopPropagation();
            if(!confirm(t('confirm.deleteFile','Delete file: {name}?').replace('{name}',name))) return;
            try{ const r=await window.chronos.rmFile(Store.getBase(), fp); if(r&&r.ok){ showToast(t('toast.deleted','Deleted')); await loadList(Store.getBase()); } }catch(err){ console.error(err); }
          });

          // Context menu (Open/Copy/Delete)
          row.addEventListener('contextmenu',(ev)=> showCtx(ev, {url:link.href, name, fp, date:d.date}));

          rightF.appendChild(del);
          row.appendChild(leftF); row.appendChild(rightF);
          filesDiv.appendChild(row);
        }
        day.appendChild(filesDiv);
      }
      el.list.appendChild(day);
    }
  }

  // Helpers
  function div(c,t){ const e=document.createElement('div'); if(c) e.className=c; if(t!=null) e.textContent=t; return e; }
  function button(c,t){ const e=document.createElement('button'); if(c) e.className=c; e.textContent=t; return e; }
  function aBtn(c,t){ const e=document.createElement('a'); if(c) e.className=c; e.textContent=t; e.href='#'; return e; }
  function span(c,t){ const e=document.createElement('span'); if(c) e.className=c; e.textContent=t; return e; }

  // Context menu
  function showCtx(ev, {url, name, fp}){ ev.preventDefault();
    el.ctx.style.left = ev.clientX+'px'; el.ctx.style.top = ev.clientY+'px';
    el.ctx.classList.remove('hidden'); el.ctx.setAttribute('aria-hidden','false');
    el.ctx.onclick = async (e)=>{
      const act = e.target.getAttribute('data-act'); if(!act) return;
      if(act==='open'){ if(url) await window.chronos.openExternal(url); }
      else if(act==='copy'){ if(url){ try{ await navigator.clipboard.writeText(url);}catch{ window.chronos.copyText(url);} showToast(t('toast.copied','Link copied')); } }
      else if(act==='delete'){
        const ok = confirm(t('confirm.deleteFile','Delete file: {name}?').replace('{name}',name)); if(!ok) return;
        try{ const r=await window.chronos.rmFile(Store.getBase(), fp); if(r&&r.ok){ showToast(t('toast.deleted','Deleted')); await loadList(Store.getBase()); } }catch(e2){ console.error(e2); }
      }
      hideCtx();
    };
    document.addEventListener('click', hideCtx, { once:true });
  }
  function hideCtx(){ el.ctx.classList.add('hidden'); el.ctx.setAttribute('aria-hidden','true'); el.ctx.onclick = null; }

  // Actions
  el.save?.addEventListener('click', async()=>{
    const base=(el.base.value||'').trim()||'http://192.168.4.1';
    Store.setBase(base); setStatus('checking');
    try{ const v=await window.chronos.version(base); if(v&&v.ok){ setStatus('on'); await loadStatus(base); await loadList(base); showToast(t('toast.connected','Connected')); } else setStatus('off'); }
    catch{ setStatus('off'); }
  });
  el.refresh?.addEventListener('click', async()=>{
    const base=Store.getBase()||(el.base.value||'').trim()||'http://192.168.4.1';
    setStatus('checking'); try{ const v=await window.chronos.version(base); if(v&&v.ok){ setStatus('on'); await loadStatus(base); await loadList(base); } else setStatus('off'); }catch{ setStatus('off'); }
  });
  el.expand?.addEventListener('click', ()=>{ rawDays.forEach(d=> expandState[d.date]=true); renderList(); });
  el.collapse?.addEventListener('click', ()=>{ rawDays.forEach(d=> expandState[d.date]=false); renderList(); });
  el.selectAll?.addEventListener('click', ()=>{ selectedDays = new Set(rawDays.map(d=>d.date)); selectedFiles.clear(); updateSelectedBadge(); });
  el.clearSel?.addEventListener('click', ()=>{ selectedDays.clear(); selectedFiles.clear(); updateSelectedBadge(); });

  el.chooseFolder?.addEventListener('click', async()=>{ const r=await window.chronos.chooseFolder(); if(r&&r.ok){ el.folderBadge.textContent=r.folder; el.folderBadge.classList.remove('hidden'); Store.setFolder(r.folder); } });
  el.downloadSel?.addEventListener('click', async()=>{
    const base=Store.getBase()||(el.base.value||'').trim()||'http://192.168.4.1';
    if(!(selectedDays.size||selectedFiles.size)){ showToast(t('toast.nothingSelected','Nothing selected')); return; }
    const payload={ base, days:Array.from(selectedDays), files:Array.from(selectedFiles), folder: Store.getFolder() };
    try{ const r=await window.chronos.downloadSelected(payload); if(r&&r.ok){ showToast(t('toast.dlStarted','Downloads started')); } }catch(e){ console.error(e); showToast(t('toast.dlFail','Download failed')); }
  });

  // Search debounce
  let searchTimer=null;
  el.search?.addEventListener('input', ()=>{ clearTimeout(searchTimer); searchTimer=setTimeout(renderList,120); });

  // Tabs & language
  el.tabExports?.addEventListener('click', ()=>{ el.tabExports.classList.add('active'); el.tabDiag.classList.remove('active'); el.tabExports.setAttribute('aria-selected','true'); el.tabDiag.setAttribute('aria-selected','false'); el.viewExports.classList.remove('hidden'); el.viewDiag.classList.add('hidden'); });
  el.tabDiag?.addEventListener('click', ()=>{ el.tabDiag.classList.add('active'); el.tabExports.classList.remove('active'); el.tabDiag.setAttribute('aria-selected','true'); el.tabExports.setAttribute('aria-selected','false'); el.viewDiag.classList.remove('hidden'); el.viewExports.classList.add('hidden'); });
  el.lang?.addEventListener('change', async()=>{ const v=el.lang.value||'en'; Store.setLang(v); await loadI18n(v); renderList(); });
  el.themeToggle?.addEventListener('click', ()=>{ const cur=Store.getTheme(); setTheme(cur==='light'?'dark':'light'); });

  // Progress UI
  window.chronos.onDownloadProgress(({id,received,total})=>{
    el.progress.classList.remove('hidden'); const pct=total>0? Math.round(received/total*100):0;
    el.progressFill.style.width=pct+'%'; el.progressLabel.textContent=`Downloading (${id}) — ${pct}%`;
  });
  window.chronos.onDownloadStep(({done,total,label})=>{
    el.progress.classList.remove('hidden'); const pct=Math.round(done/Math.max(1,total)*100);
    el.progressFill.style.width=pct+'%'; el.progressLabel.textContent=`Saved: ${label} — ${done}/${total}`;
    if(done>=total) setTimeout(()=>{ el.progress.classList.add('hidden'); el.progressFill.style.width='0%'; el.progressLabel.textContent=''; }, 900);
  });

  // Diagnostics
  el.diagRun?.addEventListener('click', async()=>{
    const base=(el.diagBase.value||'').trim()||'http://192.168.4.1';
    el.diagSummary.textContent='Running…'; el.diagV.textContent=''; el.diagS.textContent=''; el.diagL.textContent=''; el.diagW.textContent=''; el.wifiList.textContent='';
    try{
      const v=await window.chronos.version(base);
      const s=await window.chronos.status(base);
      const l=await window.chronos.list(base);
      const w=await window.chronos.scanWifi();
      const okV=!!(v&&v.ok), okS=!!(s&&s.ok), okL=!!(l&&(l.ok||Array.isArray(l?.dates))), okW=!!(w&&w.ok);
      el.diagSummary.textContent = `${okV?'Version: OK':'Version: FAIL'} • ${okS?'Status: OK':'Status: FAIL'} • ${okL?'List: OK':'List: FAIL'} • ${okW?('Wi‑Fi SSIDs: '+((w.networks||[]).length)):'Wi‑Fi: FAIL'}`;
      el.diagV.textContent=JSON.stringify(v,null,2); el.diagS.textContent=JSON.stringify(s,null,2); el.diagL.textContent=JSON.stringify(l,null,2);
      el.diagW.textContent=(w&&w.raw)||'';
      const nets=Array.isArray(w&&w.networks)?w.networks:[]; nets.sort((a,b)=> (b.signalPct||0)-(a.signalPct||0));
      nets.forEach(n=>{ const item=div('wifi-item'); const label=div(null,n.ssid); const bar=div('wifi-bar'); const fill=div('wifi-fill'); fill.style.width = Math.max(0,Math.min(100,n.signalPct||0))+'%'; bar.appendChild(fill); item.appendChild(label); item.appendChild(bar); el.wifiList.appendChild(item); });
    }catch(e){ el.diagSummary.textContent='Diagnostics failed: '+String(e); }
  });

  // Init
  (async function init(){
    setTheme(Store.getTheme());
    const lang=Store.getLang(); if(el.lang) el.lang.value=lang; await loadI18n(lang);
    const base=Store.getBase()||'http://192.168.4.1';
    if(el.base) el.base.value=base; if(el.diagBase) el.diagBase.value=base;
    setStatus('checking');
    try{ const v=await window.chronos.version(base); if(v&&v.ok){ setStatus('on'); await loadStatus(base); await loadList(base); } else setStatus('off'); }catch{ setStatus('off'); }
  })();

})();