// [Updated 2026-01-31 16:05 CET] All downloads use app Save dialog (no browser)
// - File click: unchanged trigger (downloadSelected), now works (timeout fix in main.js).
// - ZIP per day: route through downloadSelected (was openExternal).
(function () {
  const el = map(['status','base','save','reset','totalText','usedText','usedPct','meterFill','itemsCount','daysCount','refresh','expand','collapse','selectAll','clearSel','chooseFolder','folderBadge','downloadSel','deleteSel','search','sort','list','listSkeleton','progress','progressLabel','progressFill','selectedBadge','opBadge','tabExports','tabDiag','viewExports','viewDiag','diagBaseText','diagStatusText','diagVersionText','diagStorageText','diagItemsText','diagTimeText','diagRefresh','diagCopy','themeToggle','toast','lang','ctx','densityToggle']);
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

  let I18N = {}; let currentStatusState='off';
  async function loadLocale(lang){ try{ const r=await window.chronos.readLocale(lang); I18N=(r&&r.ok&&r.data)||{}; } catch{ const r=await window.chronos.readLocale('en'); I18N=(r&&r.ok&&r.data)||{}; } }
  function t(k,f=''){ return (I18N&&I18N[k]) ?? f ?? k; }
  function applyI18n(){ document.querySelectorAll('[data-i18n]').forEach(n=>{ const k=n.getAttribute('data-i18n'); n.textContent=t(k,n.textContent); }); if(el.search) el.search.placeholder=t('search.placeholder','Search…'); setStatus(currentStatusState); renderList(); }
  function setTheme(theme){ document.documentElement.setAttribute('data-theme', theme); Store.setTheme(theme); el.themeToggle.innerHTML = theme==='dark'?'<span class="i i-sun"></span>':'<span class="i i-moon"></span>'; }
  function showToast(msg,ms=1600){ el.toast.textContent=msg; el.toast.classList.remove('hidden'); setTimeout(()=> el.toast.classList.add('hidden'), ms); }
  function setStatus(state,text){ currentStatusState=state; el.status.className='chip status-'+state; if(!text){ text= state==='on'? `${t('toast.connected','Connected')} (${Store.getBase()||''})`
                                         : state==='checking'? t('status.checking','Chronos: Checking…')
                                         : t('status.off','Chronos: Not available'); }
    el.status.textContent=text; }
  const nf=new Intl.NumberFormat(Store.getLang()||'en',{maximumFractionDigits:1});
  function bytes(b){ const u=['B','KB','MB','GB','TB']; let i=0,x=Number(b||0); while(x>=1024&&i<u.length-1){x/=1024;i++;} return `${nf.format(x)} ${u[i]}`; }
  const weekdayFmt=new Intl.DateTimeFormat(Store.getLang()||'en',{weekday:'long'});
  function prettyDayLabel(iso){ const [y,m,d]=(iso||'').split('-').map(n=>+n); const dt=new Date(y,(m||1)-1,d||1); return `${weekdayFmt.format(dt)}, ${iso}`; }
  function nowText(){ return new Date().toLocaleString(); }

  let rawDays=[], expandState={}, selectedDays=new Set(), selectedFiles=new Set();
  function updateSelectedBadge(){ const txt=`${t('status.selected','Selected:')} ${selectedFiles.size + selectedDays.size}`; el.selectedBadge.textContent=txt; if(selectedFiles.size || selectedDays.size) el.selectedBadge.classList.remove('hidden'); else el.selectedBadge.classList.add('hidden'); }

  async function loadStatus(base){
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
    }
  }

  async function loadList(base){
    el.listSkeleton.classList.remove('hidden');
    try{
      const data=await window.chronos.list(base, Store.getPaths());
      const dates=Array.isArray(data&&data.dates)?data.dates:[];
      rawDays = dates.map(d=>({date:d.date, files:Array.isArray(d.files)?d.files:[]}));
      el.itemsCount.textContent= rawDays.reduce((a,d)=>a+d.files.length,0);
      el.daysCount.textContent= rawDays.length;
      renderList();
    } finally { el.listSkeleton.classList.add('hidden'); }
  }

  function renderList(){
    const q=(el.search.value||'').trim().toLowerCase();
    const sort=el.sort.value||'date-desc';
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

      // ZIP per day — now uses app downloader (Save dialog), not the browser
      const zip=document.createElement('button');
      zip.className='btn ghost'; zip.innerHTML='<span class="i i-arrow-download"></span><span>ZIP</span>';
      zip.addEventListener('click', async (e)=>{
        e.preventDefault(); e.stopPropagation();
        try{
          const base = Store.getBase() || (el.base.value||'').trim() || 'http://192.168.4.1';
          const payload = { base, days: [d.date], files: [], folder: Store.getFolder() };
          const r = await window.chronos.downloadSelected(payload);
          if(r && r.ok) showToast('Download started'); else showToast('Download cancelled');
        }catch(err){ console.error(err); showToast('Download failed'); }
      });

      const toggle=document.createElement('button'); toggle.className='btn ghost';
      toggle.innerHTML = (expandState[d.date] ? '<span class="i i-chevron-up"></span><span>Collapse</span>'
                                              : '<span class="i i-chevron-down"></span><span>Expand</span>');
      toggle.addEventListener('click',e=>{ e.stopPropagation(); expandState[d.date]=!expandState[d.date]; renderList(); });

      right.appendChild(zip); right.appendChild(toggle);
      head.appendChild(left); head.appendChild(right); day.appendChild(head);

      const info=document.createElement('div'); info.className='day-sub'; info.textContent=`${d.files.length} Items`;
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

          // selection key uses /exp/<date>/<name> for bulk downloads
          const pathExp = `/exp/${d.date}/${name}`;
          const chk=document.createElement('input'); chk.type='checkbox'; chk.checked=selectedFiles.has(pathExp);
          chk.addEventListener('click',e=>e.stopPropagation());
          chk.addEventListener('change',()=>{ if(chk.checked) selectedFiles.add(pathExp); else selectedFiles.delete(pathExp); updateSelectedBadge(); });

          // File click — in-app downloader (Save dialog)
          const link=document.createElement('a'); link.className='file-name'; link.textContent=name||'(unnamed)';
          link.href = pathExp; // kept for context menu copy; actual download uses IPC
          link.addEventListener('click', async (e)=>{
            e.preventDefault(); e.stopPropagation();
            try{
              const base = Store.getBase() || (el.base.value||'').trim() || 'http://192.168.4.1';
              const payload = { base, days: [], files: [pathExp], folder: Store.getFolder() };
              const r = await window.chronos.downloadSelected(payload);
              if(r && r.ok) showToast('Download started'); else showToast('Download cancelled');
            }catch(err){ console.error(err); showToast('Download failed'); }
          });

          const meta=document.createElement('span'); meta.className='file-meta';
          meta.textContent=` ${(f.mode||'')} • ${(f.size||'')} • ${(f.bytes||0)} bytes`;

          leftF.appendChild(chk); leftF.appendChild(link); leftF.appendChild(meta);

          const rightF=document.createElement('div');
          const del=document.createElement('button'); del.className='btn danger';
          del.innerHTML='<span class="i i-delete"></span><span>Delete</span>';
          del.addEventListener('click', async e=>{
            e.stopPropagation();
            const ok=confirm(`Delete file: ${name}?`); if(!ok) return;
            try{ const r=await window.chronos.rmFile(Store.getBase(), pathExp); if(r&&r.ok){ showToast('Deleted'); await loadList(Store.getBase()); } }catch(err){ console.error(err); }
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
      else if(act==='copy'){ if(url){ try{ await navigator.clipboard.writeText(url); }catch{ window.chronos.copyText(url); } showToast('Link copied'); } }
      else if(act==='delete'){ const ok = confirm(`Delete file: ${name}?`); if(!ok) return; try{ const r=await window.chronos.rmFile(Store.getBase(), fp); if(r&&r.ok){ showToast('Deleted'); await loadList(Store.getBase()); } }catch(e2){ console.error(e2); } }
      hideCtx();
    };
    document.addEventListener('click', hideCtx, { once:true });
  }
  function hideCtx(){ el.ctx.classList.add('hidden'); el.ctx.setAttribute('aria-hidden','true'); el.ctx.onclick=null; }

  // Actions (unchanged)
  el.save?.addEventListener('click', async ()=>{
    const base=(el.base.value||'').trim() || 'http://192.168.4.1';
    Store.setBase(base); setStatus('checking');
    try{
      const v=await window.chronos.version(base, Store.getPaths());
      if(v&&v.ok){ setStatus('on'); if(el.diagVersionText) el.diagVersionText.textContent=v.version||''; await loadStatus(base); await loadList(base); showToast('Connected'); }
      else throw 0;
    }catch{
      try{
        const d=await window.chronos.discover(base);
        if(d && d.ok){
          const p={ versionPath:d.hits.version?.path||'/api/version', statusPath:d.hits.status?.path||'/api/status', listPath:d.hits.list?.path||'/api/list' };
          Store.setPaths(p);
          const v2=await window.chronos.version(base,p);
          if(v2&&v2.ok){ setStatus('on'); if(el.diagVersionText) el.diagVersionText.textContent=v2.version||''; await loadStatus(base); await loadList(base); showToast('Connected'); return; }
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

  // Multi-download -> app Save dialogs (now shown by main.js)
  el.downloadSel?.addEventListener('click', async ()=>{
    const base=Store.getBase() || (el.base.value||'').trim() || 'http://192.168.4.1';
    if(!(selectedDays.size || selectedFiles.size)){ showToast('Nothing selected'); return; }
    const payload={ base, days:Array.from(selectedDays), files:Array.from(selectedFiles), folder:Store.getFolder() };
    try{
      const r=await window.chronos.downloadSelected(payload);
      if(r&&r.ok){ showToast('Downloads started'); }
    }catch(e){ console.error(e); showToast('Download failed'); }
  });

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
    const text=`Base: ${Store.getBase()||''}
Status: ${el.status.textContent}
Version: ${(el.diagVersionText&&el.diagVersionText.textContent)||''}
Storage: ${(el.diagStorageText&&el.diagStorageText.textContent)||''}
Items: ${(el.diagItemsText&&el.diagItemsText.textContent)||''}
Checked: ${(el.diagTimeText&&el.diagTimeText.textContent)||''}`;
    try{ await navigator.clipboard.writeText(text); }catch{ window.chronos.copyText(text); }
    showToast('Link copied');
  });

  if (window.chronos?.onDownloadProgress) {
    window.chronos.onDownloadProgress(({id,received,total})=>{
      el.progress.classList.add('is-visible');
      const pct= total>0?Math.round(received/total*100):0;
      el.progressFill.style.width=pct+'%';
      el.progressLabel.textContent = `Preparing… (${id}) — ${pct}%`;
    });
  }
  if (window.chronos?.onDownloadStep) {
    window.chronos.onDownloadStep(({done,total,label})=>{
      el.progress.classList.add('is-visible');
      const pct=Math.round(done/Math.max(1,total)*100);
      el.progressFill.style.width=pct+'%';
      el.progressLabel.textContent = `Saved: ${label} — ${done}/${total}`;
      if(done>=total){
        setTimeout(()=>{
          el.progress.classList.remove('is-visible');
          el.progressFill.style.width='0%';
          el.progressLabel.textContent='';
          showToast('Downloads completed');
        },900);
      }
    });
  }

  (async function init(){
    setTheme(Store.getTheme());
    document.body.classList.toggle('density-compact', Store.getDensity()==='compact');
    const base=Store.getBase() || 'http://192.168.4.1';
    if(el.base) el.base.value=base;
    if(el.lang) el.lang.value=Store.getLang();
    await loadLocale(Store.getLang()); applyI18n();
    setStatus('checking');
    try{
      const v=await window.chronos.version(base, Store.getPaths());
      if(v&&v.ok){ setStatus('on'); if(el.diagVersionText) el.diagVersionText.textContent=v.version||''; if(el.diagBaseText) el.diagBaseText.textContent=base; await loadStatus(base); await loadList(base); }
      else throw 0;
    }catch{ setStatus('off'); }
  })();
})();
