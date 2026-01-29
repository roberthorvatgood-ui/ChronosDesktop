// [2026-01-29 21:15 CET] Design Update — icons, compact toggle, empty state, header-only sticky
(function(){
  const el = map(['status','base','save','reset','totalText','usedText','usedPct','meterFill','itemsCount','daysCount','refresh','expand','collapse','selectAll','clearSel','chooseFolder','folderBadge','downloadSel','deleteSel','search','sort','list','listSkeleton','progress','progressLabel','progressFill','selectedBadge','opBadge','tabExports','tabDiag','viewExports','viewDiag','diagBase','diagRun','diagSummary','diagV','diagS','diagL','diagW','wifiList','themeToggle','toast','lang','ctx','densityToggle']);
  function map(ids){const o={};ids.forEach(id=>o[id]=document.getElementById(id));return o;}

  const Store={getBase:()=>localStorage.getItem('chronos.baseUrl')||'',setBase:v=>localStorage.setItem('chronos.baseUrl',v||''),getFolder:()=>localStorage.getItem('chronos.folder')||'',setFolder:p=>localStorage.setItem('chronos.folder',p||''),getLang:()=>localStorage.getItem('chronos.lang')||(navigator.language||'en').split('-')[0].toLowerCase(),setLang:l=>localStorage.setItem('chronos.lang',l||'en'),getTheme:()=>localStorage.getItem('chronos.theme')||'light',setTheme:t=>localStorage.setItem('chronos.theme',t||'light'),getDensity:()=>localStorage.getItem('chronos.density')||'comfort',setDensity:d=>localStorage.setItem('chronos.density',d||'comfort')};

  function setTheme(theme){document.documentElement.setAttribute('data-theme',theme);Store.setTheme(theme);el.themeToggle.textContent=theme==='dark'?'☀️':'🌙';}
  function setStatus(state,text){el.status.className='chip status-'+state;el.status.textContent=text||(state==='on'?`Chronos: Connected (${Store.getBase()||''})`:state==='checking'?'Chronos: Checking…':'Chronos: Not available');}
  function showToast(msg,ms=1600){el.toast.textContent=msg;el.toast.classList.remove('hidden');setTimeout(()=>el.toast.classList.add('hidden'),ms);}  

  let rawDays=[],expandState={},selectedDays=new Set(),selectedFiles=new Set();
  function fullPath(date,f){const n=(f.name||'').split('/').pop();return `/exp/${date}/${n}`}
  function bytes(b){const u=['B','KB','MB','GB','TB'];let i=0,x=Number(b||0);while(x>=1024&&i<u.length-1){x/=1024;i++;}return x.toFixed(1)+' '+u[i]}
  function updateSelectedBadge(){const txt=`Selected: ${selectedFiles.size+selectedDays.size}`;el.selectedBadge.textContent=txt;if(selectedFiles.size||selectedDays.size)el.selectedBadge.classList.remove('hidden');else el.selectedBadge.classList.add('hidden');}

  async function loadStatus(base){try{const s=await window.chronos.status(base);if(!s||!s.ok) throw 0; el.totalText.textContent=bytes(s.total); el.usedText.textContent=bytes(s.used); const pct=Math.max(0,Math.min(100,Math.round((s.used/Math.max(1,s.total))*100))); el.usedPct.textContent=pct+'%'; el.meterFill.style.width=pct+'%'; }catch{ el.totalText.textContent='–'; el.usedText.textContent='–'; el.usedPct.textContent='0%'; el.meterFill.style.width='0%'; }}
  async function loadList(base){ el.listSkeleton.classList.remove('hidden'); try{const data=await window.chronos.list(base); const dates=Array.isArray(data&&data.dates)?data.dates:[]; rawDays=dates.map(d=>({date:d.date,files:Array.isArray(d.files)?d.files:[]})); el.itemsCount.textContent=rawDays.reduce((a,d)=>a+d.files.length,0); el.daysCount.textContent=rawDays.length; rawDays.forEach(d=>{ if(!(d.date in expandState)) expandState[d.date]=true; }); renderList(); } finally{ el.listSkeleton.classList.add('hidden'); } }

  function renderList(){
    const q=(el.search.value||'').trim().toLowerCase();
    const sort=el.sort.value||'date-desc';
    let days=rawDays.map(d=>({date:d.date,files:d.files.slice()}));
    if(q){days.forEach(d=> d.files=d.files.filter(f=> (f.name||'').toLowerCase().includes(q)||(f.mode||'').toLowerCase().includes(q)||String(f.bytes||'').includes(q))); days=days.filter(d=> d.files.length || d.date.toLowerCase().includes(q));}
    if(sort==='date-asc') days.sort((a,b)=>a.date.localeCompare(b.date));
    else if(sort==='date-desc') days.sort((a,b)=>b.date.localeCompare(a.date));
    else if(sort==='name-asc') days.forEach(d=> d.files.sort((a,b)=>(a.name||'').localeCompare(b.name||'')));
    else if(sort==='name-desc') days.forEach(d=> d.files.sort((a,b)=>(b.name||'').localeCompare(a.name||'')));

    el.list.textContent='';
    if(!days.length){
      el.list.innerHTML = `
        <div class="card" style="text-align:center;padding:24px">
          <div style="font-weight:700;margin-bottom:6px">No data</div>
          <div class="muted">Try Refresh, adjust filters, or check your device URL.</div>
        </div>`; return; }

    for(const d of days){
      const day=document.createElement('div');day.className='day';
      const head=document.createElement('div');head.className='day-head';
      const left=document.createElement('div');left.className='day-left';
      const chkDay=document.createElement('input');chkDay.type='checkbox';chkDay.checked=selectedDays.has(d.date);
      chkDay.addEventListener('click',e=>e.stopPropagation());
      chkDay.addEventListener('change',()=>{ if(chkDay.checked) selectedDays.add(d.date); else selectedDays.delete(d.date); updateSelectedBadge(); });
      const title=document.createElement('div');title.className='day-title';title.textContent=`${d.date}`;
      left.appendChild(chkDay);left.appendChild(title);
      const right=document.createElement('div');right.className='day-actions';
      const zip=document.createElement('a');zip.className='btn ghost';zip.innerHTML='<span class="i i-download"></span><span>ZIP</span>';
      window.chronos.zipUrl(Store.getBase(),d.date).then(u=>zip.href=u);
      zip.addEventListener('click',e=>{e.preventDefault();e.stopPropagation(); if(zip.href) window.chronos.openExternal(zip.href)});
      const toggle=document.createElement('button');toggle.className='btn ghost';toggle.innerHTML=expandState[d.date]?'<span class="i i-collapse"></span><span>Collapse</span>':'<span class="i i-expand"></span><span>Expand</span>';
      toggle.addEventListener('click',e=>{e.stopPropagation(); expandState[d.date]=!expandState[d.date]; renderList();});
      right.appendChild(zip); right.appendChild(toggle);
      head.appendChild(left); head.appendChild(right); day.appendChild(head);
      const info=document.createElement('div');info.className='day-sub';info.textContent=`${d.files.length} Items`; day.appendChild(info);
      head.addEventListener('click',()=>{ expandState[d.date]=!expandState[d.date]; renderList(); });

      const filesDiv=document.createElement('div'); filesDiv.className='files';
      if(!expandState[d.date]){ filesDiv.classList.add('is-collapsed'); filesDiv.style.maxHeight='0px'; }
      if(expandState[d.date]){
        filesDiv.classList.remove('is-collapsed');
        for(const f of d.files){
          const row=document.createElement('div');row.className='file';
          const leftF=document.createElement('div');leftF.className='file-left';
          const fp=fullPath(d.date,f);
          const chk=document.createElement('input');chk.type='checkbox';chk.checked=selectedFiles.has(fp);
          chk.addEventListener('click',e=>e.stopPropagation());
          chk.addEventListener('change',()=>{ if(chk.checked) selectedFiles.add(fp); else selectedFiles.delete(fp); updateSelectedBadge(); });
          const name=(f.name||'').split('/').pop();
          const link=document.createElement('a');link.className='file-name';link.textContent=name||'(unnamed)';
          window.chronos.dlUrl(Store.getBase(),d.date,name).then(u=> link.href=u);
          link.addEventListener('click',e=>{ e.preventDefault(); e.stopPropagation(); if(link.href) window.chronos.openExternal(link.href); });
          const meta=document.createElement('span');meta.className='file-meta';meta.textContent=` ${(f.mode||'')} • ${(f.size||'')} • ${(f.bytes||0)} bytes`;
          leftF.appendChild(chk); leftF.appendChild(link); leftF.appendChild(meta);
          const rightF=document.createElement('div'); const del=document.createElement('button'); del.className='btn danger'; del.innerHTML='<span class="i i-delete"></span><span>Delete</span>';
          del.addEventListener('click', async e=>{ e.stopPropagation(); if(!confirm(`Delete file: ${name}?`)) return; try{ const r=await window.chronos.rmFile(Store.getBase(), fp); if(r&&r.ok){ showToast('Deleted'); await loadList(Store.getBase()); } }catch(err){ console.error(err); } });
          row.addEventListener('contextmenu',ev=> showCtx(ev,{url:link.href,name,fp,date:d.date}));
          rightF.appendChild(del); row.appendChild(leftF); row.appendChild(rightF); filesDiv.appendChild(row);
        }
        requestAnimationFrame(()=>{ filesDiv.style.maxHeight = filesDiv.scrollHeight + 'px'; });
      }
      day.appendChild(filesDiv); el.list.appendChild(day);
    }
  }

  function showCtx(ev,{url,name,fp}){ev.preventDefault(); el.ctx.style.left=ev.clientX+'px'; el.ctx.style.top=ev.clientY+'px'; el.ctx.classList.remove('hidden'); el.ctx.setAttribute('aria-hidden','false'); el.ctx.onclick=async e=>{ const act=e.target.getAttribute('data-act'); if(!act) return; if(act==='open'){ if(url) await window.chronos.openExternal(url); } else if(act==='copy'){ if(url){ try{ await navigator.clipboard.writeText(url);}catch{ window.chronos.copyText(url);} showToast('Link copied'); } } else if(act==='delete'){ const ok=confirm(`Delete file: ${name}?`); if(!ok) return; try{ const r=await window.chronos.rmFile(Store.getBase(), fp); if(r&&r.ok){ showToast('Deleted'); await loadList(Store.getBase()); } }catch(e2){ console.error(e2); } } hideCtx(); }; document.addEventListener('click', hideCtx, { once:true }); }
  function hideCtx(){ el.ctx.classList.add('hidden'); el.ctx.setAttribute('aria-hidden','true'); el.ctx.onclick=null; }

  // Actions
  el.save?.addEventListener('click', async()=>{ const base=(el.base.value||'').trim()||'http://192.168.4.1'; Store.setBase(base); setStatus('checking'); try{ const v=await window.chronos.version(base); if(v&&v.ok){ setStatus('on'); await loadStatus(base); await loadList(base); showToast('Connected'); } else setStatus('off'); }catch{ setStatus('off'); } });
  el.refresh?.addEventListener('click', async()=>{ const base=Store.getBase()||(el.base.value||'').trim()||'http://192.168.4.1'; setStatus('checking'); try{ const v=await window.chronos.version(base); if(v&&v.ok){ setStatus('on'); await loadStatus(base); await loadList(base); } else setStatus('off'); }catch{ setStatus('off'); } });
  el.expand?.addEventListener('click', ()=>{ rawDays.forEach(d=> expandState[d.date]=true); renderList(); });
  el.collapse?.addEventListener('click', ()=>{ rawDays.forEach(d=> expandState[d.date]=false); renderList(); });
  el.selectAll?.addEventListener('click', ()=>{ selectedDays=new Set(rawDays.map(d=>d.date)); selectedFiles.clear(); updateSelectedBadge(); });
  el.clearSel?.addEventListener('click', ()=>{ selectedDays.clear(); selectedFiles.clear(); updateSelectedBadge(); });
  el.chooseFolder?.addEventListener('click', async()=>{ const r=await window.chronos.chooseFolder(); if(r&&r.ok){ el.folderBadge.textContent=r.folder; el.folderBadge.classList.remove('hidden'); Store.setFolder(r.folder); } });
  el.downloadSel?.addEventListener('click', async()=>{ const base=Store.getBase()||(el.base.value||'').trim()||'http://192.168.4.1'; if(!(selectedDays.size||selectedFiles.size)){ showToast('Nothing selected'); return; } const payload={ base, days:Array.from(selectedDays), files:Array.from(selectedFiles), folder: Store.getFolder() }; try{ const r=await window.chronos.downloadSelected(payload); if(r&&r.ok){ showToast('Downloads started'); } }catch(e){ console.error(e); showToast('Download failed'); } });

  // Search debounce
  let searchTimer=null; el.search?.addEventListener('input',()=>{ clearTimeout(searchTimer); searchTimer=setTimeout(renderList,120); });

  // Tabs, language, theme, density
  el.tabExports?.addEventListener('click',()=>{ el.tabExports.classList.add('active'); el.tabDiag.classList.remove('active'); el.viewExports.classList.remove('hidden'); el.viewDiag.classList.add('hidden'); });
  el.tabDiag?.addEventListener('click',()=>{ el.tabDiag.classList.add('active'); el.tabExports.classList.remove('active'); el.viewDiag.classList.remove('hidden'); el.viewExports.classList.add('hidden'); });
  el.lang?.addEventListener('change',()=>{ localStorage.setItem('chronos.lang', el.lang.value||'en'); });
  el.themeToggle?.addEventListener('click',()=>{ const cur=Store.getTheme(); setTheme(cur==='light'?'dark':'light'); });
  el.densityToggle?.addEventListener('click',()=>{ const cur=Store.getDensity(); const next=cur==='compact'?'comfort':'compact'; Store.setDensity(next); document.body.classList.toggle('density-compact', next==='compact'); });

  // Progress fade
  window.chronos.onDownloadProgress(({id,received,total})=>{ el.progress.classList.add('is-visible'); const pct=total>0? Math.round(received/total*100):0; el.progressFill.style.width=pct+'%'; el.progressLabel.textContent=`Downloading (${id}) — ${pct}%`; });
  window.chronos.onDownloadStep(({done,total,label})=>{ el.progress.classList.add('is-visible'); const pct=Math.round(done/Math.max(1,total)*100); el.progressFill.style.width=pct+'%'; el.progressLabel.textContent=`Saved: ${label} — ${done}/${total}`; if(done>=total) setTimeout(()=>{ el.progress.classList.remove('is-visible'); el.progressFill.style.width='0%'; el.progressLabel.textContent=''; }, 900); });

  (async function init(){
    setTheme(Store.getTheme());
    document.body.classList.toggle('density-compact', Store.getDensity()==='compact');
    const base=Store.getBase()||'http://192.168.4.1'; if(el.base) el.base.value=base; if(el.diagBase) el.diagBase.value=base;
    setStatus('checking');
    try{ const v=await window.chronos.version(base); if(v&&v.ok){ setStatus('on'); await loadStatus(base); await loadList(base); } else setStatus('off'); }
    catch{ setStatus('off'); }
  })();
})();
