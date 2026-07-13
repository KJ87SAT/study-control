(function(){
  "use strict";

  var PALETTE = ['#FFB454','#5EEAD4','#A78BFA','#FF8FA3','#7CFFB2','#7DD3FC','#FDBA74','#F472B6'];
  var STORE_KEY = 'studyControlState_v2';
  var OLD_STORE_KEY = 'studyControlState_v1';

  function uid(){ return Date.now().toString(36) + Math.random().toString(36).slice(2,8); }
  function todayStr(){ return isoDate(new Date()); }
  function isoDate(d){
    var y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
    return y+'-'+m+'-'+day;
  }
  function addDays(d, n){ var r=new Date(d); r.setDate(r.getDate()+n); return r; }
  function fmtDate(dstr){
    var d = new Date(dstr+'T00:00:00');
    return (d.getMonth()+1)+'/'+d.getDate()+'('+['日','月','火','水','木','金','土'][d.getDay()]+')';
  }
  function escapeHtml(str){
    var div = document.createElement('div');
    div.textContent = str==null?'':str;
    return div.innerHTML;
  }

  function defaultState(){
    return {
      subjects: [],
      workbooks: [],
      workLogs: [], // {id, workbookId, date, plannedPages, startPage, endPage, status:'pending'|'done'|'partial'|'skipped', actualPages, note}
      sessions: [], // {id, subjectId, date, minutes}
      xp: 0,
      streak: {current:0, longest:0, lastDate:null},
      settings: {dailyGoalMinutes: null, sound:true, dailyGoalSetDate: null},
      selectedSubjectId: null
    };
  }

  function loadState(){
    try{
      var raw = localStorage.getItem(STORE_KEY);
      if(!raw){
        // migrate from v1 if present
        var oldRaw = localStorage.getItem(OLD_STORE_KEY);
        if(oldRaw){
          try{
            var old = JSON.parse(oldRaw);
            if(old && old.subjects && old.subjects.length){
              old.workbooks = old.workbooks || [];
              old.workLogs = old.workLogs || [];
              old.settings = old.settings || {dailyGoalMinutes:null, sound:true, dailyGoalSetDate:null};
              if(old.settings.sound===undefined) old.settings.sound = true;
              if(old.settings.dailyGoalSetDate===undefined) old.settings.dailyGoalSetDate = null;
              return old;
            }
          }catch(e2){}
        }
        return defaultState();
      }
      var parsed = JSON.parse(raw);
      if(!parsed.subjects || !parsed.subjects.length) return defaultState();
      if(!parsed.workbooks) parsed.workbooks = [];
      if(!parsed.workLogs) parsed.workLogs = [];
      if(!parsed.settings) parsed.settings = {dailyGoalMinutes:null, sound:true, dailyGoalSetDate:null};
      if(parsed.settings.sound===undefined) parsed.settings.sound = true;
      if(parsed.settings.dailyGoalSetDate===undefined) parsed.settings.dailyGoalSetDate = null;
      return parsed;
    }catch(e){ return defaultState(); }
  }
  function saveState(){ localStorage.setItem(STORE_KEY, JSON.stringify(state)); }

  var state = loadState();
  if(!state.selectedSubjectId || !state.subjects.find(function(s){return s.id===state.selectedSubjectId;})){
    state.selectedSubjectId = state.subjects[0] ? state.subjects[0].id : null;
  }

  // ---------- XP / Level ----------
  function levelFromXp(xp){
    var lvl = 1, need = 100, total = 0;
    while(xp >= total + need){
      total += need;
      lvl++;
      need = Math.round(need * 1.25);
    }
    return {level:lvl, into: xp-total, need: need, floor: total};
  }
  function addXp(amount){ state.xp += amount; }

  // ---------- Data helpers ----------
  function getSubject(id){ return state.subjects.find(function(s){return s.id===id;}); }
  function getWorkbook(id){ return state.workbooks.find(function(w){return w.id===id;}); }

  function minutesForDate(dateStr){
    return state.sessions.filter(function(s){return s.date===dateStr;})
      .reduce(function(a,s){return a+s.minutes;},0);
  }
  function minutesForSubjectDate(subjectId, dateStr){
    return state.sessions.filter(function(s){return s.date===dateStr && s.subjectId===subjectId;})
      .reduce(function(a,s){return a+s.minutes;},0);
  }
  function weekMinutesForSubject(subjectId){
    var t=0;
    for(var i=0;i<7;i++){ t += minutesForSubjectDate(subjectId, isoDate(addDays(new Date(),-i))); }
    return t;
  }
  function totalMinutesForSubject(subjectId){
    return state.sessions.filter(function(s){return s.subjectId===subjectId;})
      .reduce(function(a,s){return a+s.minutes;},0);
  }
  function totalMinutesAll(){
    return state.sessions.reduce(function(a,s){return a+s.minutes;},0);
  }
  function weekMinutes(){
    var t=0;
    for(var i=0;i<7;i++){ t += minutesForDate(isoDate(addDays(new Date(),-i))); }
    return t;
  }
  function pagesForDate(dateStr){
    return state.workLogs.filter(function(l){return l.date===dateStr && l.actualPages>0;})
      .reduce(function(a,l){return a+l.actualPages;},0);
  }
  function totalPagesAll(){
    return state.workLogs.reduce(function(a,l){return a + (l.actualPages||0);},0);
  }
  function todayLogFor(wbId){
    return state.workLogs.find(function(l){return l.workbookId===wbId && l.date===todayStr();});
  }
  function lastIncompleteLog(wbId){
    var logs = state.workLogs.filter(function(l){
      return l.workbookId===wbId && l.date!==todayStr() && (l.status==='partial'||l.status==='skipped');
    }).sort(function(a,b){return a.date<b.date?1:-1;});
    return logs[0];
  }
  function recentPace(wbId){
    var logs = state.workLogs.filter(function(l){
      return l.workbookId===wbId && (l.status==='done'||l.status==='partial') && l.actualPages>0;
    }).sort(function(a,b){return a.date<b.date?1:-1;}).slice(0,10);
    if(!logs.length) return 0;
    var sum = logs.reduce(function(a,l){return a+l.actualPages;},0);
    return sum / logs.length;
  }

  // ---------- Streak (combines study minutes + workbook pages) ----------
  function recomputeStreak(){
    var days = {};
    state.sessions.forEach(function(s){ days[s.date] = (days[s.date]||0) + s.minutes; });
    state.workLogs.forEach(function(l){
      if(l.actualPages>0) days[l.date] = (days[l.date]||0) + l.actualPages;
    });
    var cur = 0;
    var cursor = new Date();
    while(true){
      var key = isoDate(cursor);
      if(days[key] && days[key] > 0){
        cur++;
        cursor = addDays(cursor, -1);
      } else {
        if(key === todayStr()){
          cursor = addDays(cursor, -1);
          continue;
        }
        break;
      }
    }
    state.streak.current = cur;
    if(cur > (state.streak.longest||0)) state.streak.longest = cur;
  }

  // ---------- Element refs ----------
  var els = {
    dateLine: document.getElementById('dateLine'),
    clockTime: document.getElementById('clockTime'),
    streakNum: document.getElementById('streakNum'),
    subjectList: document.getElementById('subjectList'),
    subjectCount: document.getElementById('subjectCount'),
    lvNum: document.getElementById('lvNum'),
    xpTotal: document.getElementById('xpTotal'),
    xpBarFill: document.getElementById('xpBarFill'),
    gaugeArc: document.getElementById('gaugeArc'),
    gaugeCenterPct: document.getElementById('gaugeCenterPct'),
    gaugeCenterSub: document.getElementById('gaugeCenterSub'),
    todayMinNum: document.getElementById('todayMinNum'),
    weekMinNum: document.getElementById('weekMinNum'),
    totalMinNum: document.getElementById('totalMinNum'),
    timerSubjectSelect: document.getElementById('timerSubjectSelect'),
    timerDisplay: document.getElementById('timerDisplay'),
    timerTotalVal: document.getElementById('timerTotalVal'),
    timerGoalVal: document.getElementById('timerGoalVal'),
    weekBars: document.getElementById('weekBars'),
    taskSubjectName: document.getElementById('taskSubjectName'),
    taskList: document.getElementById('taskList'),
    heatmapGrid: document.getElementById('heatmapGrid'),
    missionList: document.getElementById('missionList'),
    workbookGrid: document.getElementById('workbookGrid'),
    subjectMgmtList: document.getElementById('subjectMgmtList'),
    wbBadge: document.getElementById('wbBadge'),
    statCurStreak: document.getElementById('statCurStreak'),
    statLongStreak: document.getElementById('statLongStreak'),
    statTotalPages: document.getElementById('statTotalPages'),
    fullLogList: document.getElementById('fullLogList'),
    subjBreakdownList: document.getElementById('subjBreakdownList'),
  };

  // ---------- Tabs ----------
  document.getElementById('tabNav').addEventListener('click', function(e){
    var btn = e.target.closest('.tab-btn');
    if(!btn) return;
    switchTab(btn.dataset.tab);
  });
  function switchTab(name){
    document.querySelectorAll('.tab-btn').forEach(function(b){ b.classList.toggle('active', b.dataset.tab===name); });
    document.querySelectorAll('.tab-pane').forEach(function(p){ p.classList.toggle('active', p.id === 'pane-'+name); });
  }

  // ---------- Render: top stats / clock / streak ----------
  function renderTopStats(){
    var lv = levelFromXp(state.xp);
    els.lvNum.textContent = 'Lv.' + lv.level;
    els.xpTotal.textContent = state.xp;
    els.xpBarFill.style.width = Math.min(100, Math.round((lv.into/lv.need)*100)) + '%';
    els.dateLine.textContent = new Date().toLocaleDateString('ja-JP', {year:'numeric',month:'short',day:'numeric',weekday:'short'});
  }
  function renderClock(){
    els.clockTime.textContent = new Date().toLocaleTimeString('ja-JP', {hour12:false});
    checkDateRollover();
  }
  function renderStreak(){
    recomputeStreak();
    els.streakNum.textContent = state.streak.current;
    els.statCurStreak.textContent = state.streak.current + '日';
    els.statLongStreak.textContent = (state.streak.longest||0) + '日';
    els.statTotalPages.textContent = totalPagesAll() + 'p';
  }

  // ---------- Render: sidebar subject list ----------
  function renderSubjectList(){
    els.subjectList.innerHTML = '';
    els.subjectCount.textContent = state.subjects.length;
    var today = todayStr();
    if(!state.subjects.length){
      els.subjectList.innerHTML = '<div class="task-empty">まだ科目がありません</div>';
    }
    state.subjects.forEach(function(sub){
      var row = document.createElement('div');
      row.className = 'subject-row' + (sub.id===state.selectedSubjectId ? ' active':'');
      row.dataset.id = sub.id;
      var mins = minutesForSubjectDate(sub.id, today);
      var pct = Math.min(100, Math.round((mins/Math.max(1,sub.goalMinutes))*100));
      row.innerHTML =
        '<div class="subject-dot" style="background:'+sub.color+';color:'+sub.color+'"></div>'+
        '<div class="subject-info">'+
          '<div class="subject-name"><span class="sn-text">'+escapeHtml(sub.name)+'</span><span class="sn-mins">'+mins+'/'+sub.goalMinutes+'分</span></div>'+
          '<div class="subject-bar"><i style="width:'+pct+'%;background:'+sub.color+'"></i></div>'+
        '</div>';
      els.subjectList.appendChild(row);
    });
  }

  // ---------- Render: per-subject time breakdown (stats tab) ----------
  var subjBreakdownRange = 'today'; // 'today' | 'week' | 'all'
  document.getElementById('subjBreakdownRange').addEventListener('click', function(e){
    var btn = e.target.closest('.seg-btn');
    if(!btn) return;
    subjBreakdownRange = btn.dataset.range;
    document.querySelectorAll('#subjBreakdownRange .seg-btn').forEach(function(b){
      b.classList.toggle('active', b===btn);
    });
    renderSubjectBreakdown();
  });
  function renderSubjectBreakdown(){
    if(!state.subjects.length){
      els.subjBreakdownList.innerHTML = '<div class="subj-bd-empty">まだ科目がありません</div>';
      return;
    }
    var today = todayStr();
    var rows = state.subjects.map(function(sub){
      var mins;
      if(subjBreakdownRange==='today') mins = minutesForSubjectDate(sub.id, today);
      else if(subjBreakdownRange==='week') mins = weekMinutesForSubject(sub.id);
      else mins = totalMinutesForSubject(sub.id);
      return {sub: sub, mins: mins};
    }).sort(function(a,b){ return b.mins - a.mins; });
    var maxMins = Math.max.apply(null, rows.map(function(r){return r.mins;}).concat([1]));
    if(!rows.some(function(r){return r.mins>0;})){
      els.subjBreakdownList.innerHTML = '<div class="subj-bd-empty">この期間の学習記録はまだありません</div>';
      return;
    }
    els.subjBreakdownList.innerHTML = rows.map(function(r){
      var pct = Math.round((r.mins / maxMins) * 100);
      var h = Math.floor(r.mins/60), m = r.mins%60;
      var timeLabel = r.mins>0 ? (h>0 ? (h+'時間'+m+'分') : (m+'分')) : '0分';
      return '<div class="subj-bd-row">'+
        '<div class="subject-dot" style="background:'+r.sub.color+';color:'+r.sub.color+'"></div>'+
        '<div class="subj-bd-info">'+
          '<div class="subj-bd-top">'+
            '<span class="subj-bd-name">'+escapeHtml(r.sub.name)+'</span>'+
            '<span class="subj-bd-mins"><b>'+timeLabel+'</b></span>'+
          '</div>'+
          '<div class="subj-bd-bar"><i style="width:'+pct+'%;background:'+r.sub.color+'"></i></div>'+
        '</div>'+
      '</div>';
    }).join('');
  }

  // ---------- Render: subject management tab ----------
  function renderSubjectMgmt(){
    if(!state.subjects.length){
      els.subjectMgmtList.innerHTML = '<div class="empty-state">科目がまだ登録されていません。「+ 追加」から作成してください。</div>';
      return;
    }
    els.subjectMgmtList.innerHTML = '';
    var today = todayStr();
    state.subjects.forEach(function(sub){
      var mins = minutesForSubjectDate(sub.id, today);
      var openTasks = sub.tasks.filter(function(t){return !t.done;}).length;
      var row = document.createElement('div');
      row.className = 'subj-mgmt-row' + (sub.id===state.selectedSubjectId ? ' active':'');
      row.innerHTML =
        '<div class="subject-dot" style="background:'+sub.color+';color:'+sub.color+'"></div>'+
        '<div class="subj-mgmt-info">'+
          '<div class="subj-mgmt-name">'+escapeHtml(sub.name)+'</div>'+
          '<div class="subj-mgmt-meta">本日 '+mins+' / '+sub.goalMinutes+' 分　・　未完了タスク '+openTasks+' 件</div>'+
        '</div>'+
        '<div class="subj-mgmt-actions">'+
          '<button class="icon-btn" data-select="'+sub.id+'" title="選択">選択</button>'+
          '<button class="icon-btn" data-edit="'+sub.id+'" title="編集">✎</button>'+
          '<button class="icon-btn danger" data-del="'+sub.id+'" title="削除">×</button>'+
        '</div>';
      els.subjectMgmtList.appendChild(row);
    });
  }
  els.subjectMgmtList.addEventListener('click', function(e){
    var sel = e.target.closest('[data-select]');
    if(sel){
      state.selectedSubjectId = sel.dataset.select;
      saveState(); renderAll();
      return;
    }
    var edit = e.target.closest('[data-edit]');
    if(edit){ openSubjectModal(edit.dataset.edit); return; }
    var del = e.target.closest('[data-del]');
    if(del){
      var id = del.dataset.del;
      var sub = getSubject(id);
      if(confirm('科目「'+(sub?sub.name:'')+'」を削除しますか？記録済みのログは残ります。')){
        state.subjects = state.subjects.filter(function(s){return s.id!==id;});
        state.workbooks.forEach(function(w){ if(w.subjectId===id) w.subjectId = null; });
        if(state.selectedSubjectId === id){
          state.selectedSubjectId = state.subjects[0] ? state.subjects[0].id : null;
        }
        saveState(); renderAll();
        showToast('科目を削除しました');
      }
    }
  });

  function renderTimerSubjectSelect(){
    els.timerSubjectSelect.innerHTML = '';
    state.subjects.forEach(function(sub){
      var opt = document.createElement('option');
      opt.value = sub.id;
      opt.textContent = sub.name;
      els.timerSubjectSelect.appendChild(opt);
    });
    if(state.subjects.find(function(s){return s.id===state.selectedSubjectId;})){
      els.timerSubjectSelect.value = state.selectedSubjectId;
    }
  }

  function renderGauge(){
    var goal = state.settings.dailyGoalMinutes;
    var today = minutesForDate(todayStr());
    if(!goal){
      els.gaugeArc.setAttribute('stroke-dasharray', (2*Math.PI*78).toFixed(1));
      els.gaugeArc.style.transition = 'stroke-dashoffset .6s ease';
      els.gaugeArc.setAttribute('stroke-dashoffset', (2*Math.PI*78).toFixed(1));
      els.gaugeCenterPct.textContent = '--%';
      els.gaugeCenterSub.textContent = '目標未設定';
    } else {
      var pct = Math.max(0, Math.min(100, Math.round((today/goal)*100)));
      var circumference = 2 * Math.PI * 78;
      var offset = circumference - (pct/100)*circumference;
      els.gaugeArc.setAttribute('stroke-dasharray', circumference.toFixed(1));
      els.gaugeArc.style.transition = 'stroke-dashoffset .6s ease';
      els.gaugeArc.setAttribute('stroke-dashoffset', offset.toFixed(1));
      els.gaugeCenterPct.textContent = pct + '%';
      els.gaugeCenterSub.textContent = today + ' / ' + goal + ' 分';
    }
    els.todayMinNum.textContent = today + '分';
    els.weekMinNum.textContent = weekMinutes() + '分';
    els.totalMinNum.textContent = totalMinutesAll() + '分';
  }

  function renderWeekBars(){
    els.weekBars.innerHTML = '';
    var days = [];
    for(var i=6;i>=0;i--) days.push(addDays(new Date(), -i));
    var maxVal = 1;
    days.forEach(function(d){ maxVal = Math.max(maxVal, minutesForDate(isoDate(d))); });
    days.forEach(function(d){
      var dateStr = isoDate(d);
      var isToday = dateStr === todayStr();
      var col = document.createElement('div');
      col.className = 'week-col' + (isToday ? ' today':'');
      var stack = document.createElement('div');
      stack.className = 'stack';
      var h = Math.max(2, Math.round((minutesForDate(dateStr)/Math.max(maxVal, state.settings.dailyGoalMinutes || maxVal))*100));
      stack.style.height = h + '%';
      state.subjects.forEach(function(sub){
        var m = minutesForSubjectDate(sub.id, dateStr);
        if(m<=0) return;
        var dayTotal = minutesForDate(dateStr) || 1;
        var seg = document.createElement('div');
        seg.style.background = sub.color;
        seg.style.height = Math.round((m/dayTotal)*100) + '%';
        stack.appendChild(seg);
      });
      var total = minutesForDate(dateStr);
      col.innerHTML = '<div class="wmin">'+(total>0?total:'')+'</div>';
      col.insertBefore(stack, col.firstChild);
      var lbl = document.createElement('div');
      lbl.className = 'wlabel';
      lbl.textContent = ['日','月','火','水','木','金','土'][d.getDay()];
      col.appendChild(lbl);
      els.weekBars.appendChild(col);
    });
  }

  // ---------- Render: trend chart (stats tab) ----------
  var trendRangeDays = 14;
  var trendRangeSegEl = document.getElementById('trendRangeSeg');
  if(trendRangeSegEl){
    trendRangeSegEl.addEventListener('click', function(e){
      var btn = e.target.closest('.seg-btn');
      if(!btn) return;
      trendRangeDays = parseInt(btn.dataset.trendrange, 10) || 14;
      trendRangeSegEl.querySelectorAll('.seg-btn').forEach(function(b){ b.classList.toggle('active', b===btn); });
      renderTrendChart();
    });
  }
  function renderTrendChart(){
    var host = document.getElementById('trendChartHost');
    if(!host) return;
    var n = trendRangeDays;
    var days = [];
    for(var i=n-1;i>=0;i--) days.push(addDays(new Date(), -i));
    var vals = days.map(function(d){ return minutesForDate(isoDate(d)); });
    var goal = state.settings.dailyGoalMinutes || 0;
    if(!vals.some(function(v){ return v>0; })){
      host.innerHTML = '<div class="trend-empty">この期間の学習記録はまだありません</div>';
      return;
    }
    var maxVal = Math.max(goal, vals.reduce(function(a,b){return Math.max(a,b);}, 1));
    var W = 640, H = 190, padL = 6, padR = 6, padT = 14, padB = 22;
    var plotW = W - padL - padR, plotH = H - padT - padB;
    var stepX = n>1 ? plotW/(n-1) : 0;
    function xAt(i){ return padL + stepX*i; }
    function yAt(v){ return padT + plotH - (Math.min(v,maxVal)/maxVal)*plotH; }
    var linePts = vals.map(function(v,i){ return xAt(i).toFixed(1)+','+yAt(v).toFixed(1); }).join(' ');
    var areaPts = linePts + ' ' + xAt(n-1).toFixed(1)+','+(padT+plotH) + ' ' + xAt(0).toFixed(1)+','+(padT+plotH);
    var goalY = yAt(goal).toFixed(1);
    // Sparse x-axis labels so it stays readable at 30 days too.
    var labelEvery = n<=14 ? 2 : 5;
    var labels = days.map(function(d,i){
      if(i!==0 && i!==n-1 && i%labelEvery!==0) return '';
      var isToday = i===n-1;
      return '<text x="'+xAt(i).toFixed(1)+'" y="'+(H-6)+'" text-anchor="middle" font-family="JetBrains Mono, monospace" font-size="9" fill="'+(isToday?'#FFB454':'#59657A')+'">'+(d.getMonth()+1)+'/'+d.getDate()+'</text>';
    }).join('');
    var dots = vals.map(function(v,i){
      if(v<=0) return '';
      return '<circle cx="'+xAt(i).toFixed(1)+'" cy="'+yAt(v).toFixed(1)+'" r="2.6" fill="#5EEAD4"><title>'+isoDate(days[i])+': '+v+'分</title></circle>';
    }).join('');
    var svg =
      '<svg class="trend-svg" viewBox="0 0 '+W+' '+H+'" xmlns="http://www.w3.org/2000/svg">'+
        '<defs><linearGradient id="trendFill" x1="0" y1="0" x2="0" y2="1">'+
          '<stop offset="0%" stop-color="#5EEAD4" stop-opacity="0.32"/>'+
          '<stop offset="100%" stop-color="#5EEAD4" stop-opacity="0"/>'+
        '</linearGradient></defs>'+
        '<line x1="'+padL+'" y1="'+goalY+'" x2="'+(W-padR)+'" y2="'+goalY+'" stroke="#FFB454" stroke-width="1" stroke-dasharray="4 4" opacity="0.55"/>'+
        '<polygon points="'+areaPts+'" fill="url(#trendFill)"/>'+
        '<polyline points="'+linePts+'" fill="none" stroke="#5EEAD4" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>'+
        dots +
        labels +
      '</svg>';
    var avg = Math.round(vals.reduce(function(a,b){return a+b;},0) / n);
    var legend =
      '<div class="trend-legend">'+
        '<span><i style="background:#5EEAD4"></i>1日の学習時間</span>'+
        '<span><i style="background:#FFB454;height:2px;border-radius:0;"></i>目標 '+goal+'分</span>'+
        '<span>期間平均 <b style="color:var(--text)">'+avg+'分/日</b></span>'+
      '</div>';
    host.innerHTML = svg + legend;
  }

  function renderTasks(){
    var sub = getSubject(state.selectedSubjectId);
    if(!sub){
      els.taskSubjectName.textContent = '-';
      els.taskList.innerHTML = '<div class="task-empty">科目を選択してください</div>';
      return;
    }
    els.taskSubjectName.textContent = sub.name;
    els.taskList.innerHTML = '';
    if(!sub.tasks.length){
      els.taskList.innerHTML = '<div class="task-empty">タスクはまだありません</div>';
      return;
    }
    sub.tasks.forEach(function(t){
      var row = document.createElement('div');
      row.className = 'task-row';
      row.innerHTML =
        '<div class="task-check '+(t.done?'done':'')+'" data-task="'+t.id+'"></div>'+
        '<div class="task-text '+(t.done?'done':'')+'">'+escapeHtml(t.text)+'</div>'+
        '<div class="task-mins">'+(t.minutes||25)+'分</div>'+
        (t.done ? '' : '<button class="start-btn" data-taskstart="'+t.id+'"'+(timerRunning?' disabled':'')+'>▶ 開始</button>')+
        '<button class="task-del" data-taskdel="'+t.id+'">×</button>';
      els.taskList.appendChild(row);
    });
  }

  function renderHeatmap(){
    els.heatmapGrid.innerHTML = '';
    var weeks = 12;
    var totalDays = weeks*7;
    var start = addDays(new Date(), -(totalDays-1));
    while(start.getDay() !== 0){ start = addDays(start, -1); }
    var days = [];
    for(var i=0;i<weeks*7+7;i++){ days.push(addDays(start, i)); }
    var maxMin = 1;
    days.forEach(function(d){ maxMin = Math.max(maxMin, minutesForDate(isoDate(d))); });
    days.forEach(function(d){
      var dateStr = isoDate(d);
      var m = minutesForDate(dateStr);
      var cell = document.createElement('div');
      cell.className = 'hm-cell';
      cell.title = dateStr + ' : ' + m + '分';
      if(d > new Date()){
        cell.style.background = 'transparent';
      } else {
        var ratio = m / maxMin;
        cell.style.background = colorForRatio(ratio, m);
      }
      els.heatmapGrid.appendChild(cell);
    });
  }
  function colorForRatio(ratio, mins){
    if(mins<=0) return '#1B2130';
    if(ratio < 0.25) return '#5C4423';
    if(ratio < 0.5) return '#8A6A3C';
    if(ratio < 0.75) return '#FFB454';
    return '#5EEAD4';
  }

  // ---------- Mission Queue (dashboard) ----------
  // NOTE: previously this only looked at the currently-selected subject's tasks,
  // so tasks belonging to other subjects silently never appeared here.
  // Now it aggregates across ALL subjects, and lets you act on items in-place.
  var missionExpanded = false;
  function renderMissionPanel(){
    var rowList = [];
    var hasAny = false;

    // 1) Workbook items: plan not set yet, or result not reported yet
    state.workbooks.forEach(function(wb){
      if(wb.currentPage >= wb.totalPages) return;
      var log = todayLogFor(wb.id);
      var remaining = wb.totalPages - wb.currentPage;
      var subj = wb.subjectId ? getSubject(wb.subjectId) : null;
      var tagHtml = subj ? '<span class="mission-tag" style="background:'+subj.color+'22;color:'+subj.color+'">'+escapeHtml(subj.name)+'</span>' : '';
      if(!log){
        var pace = recentPace(wb.id);
        var carry = lastIncompleteLog(wb.id);
        var carryPages = carry ? Math.max(0, carry.plannedPages - carry.actualPages) : 0;
        var suggestion = Math.max(1, Math.min(remaining, (Math.round(pace)||5) + carryPages));
        hasAny = true;
        rowList.push(
          '<div class="mission-row">'+
            '<div class="mission-icon">📘</div>'+
            '<div class="mission-text">「'+escapeHtml(wb.name)+'」の今日の計画が未設定です'+tagHtml+'</div>'+
            '<div class="mission-actions">'+
              '<button class="primary" data-mq-quickplan="'+wb.id+'" data-amount="'+suggestion+'">今日 '+suggestion+'p で開始</button>'+
              '<button data-mq-goto="workbook">詳細を設定</button>'+
            '</div>'+
          '</div>');
      } else if(log.status==='pending'){
        hasAny = true;
        var wbStartMins = suggestMinutesForSubject(subj ? subj.id : null);
        rowList.push(
          '<div class="mission-row">'+
            '<div class="mission-icon">⏳</div>'+
            '<div class="mission-text">「'+escapeHtml(wb.name)+'」結果が未入力です（予定 '+log.plannedPages+' ページ）'+tagHtml+'</div>'+
            '<div class="mission-actions">'+
              '<button class="start-btn" data-mqstart-wb="'+wb.id+'|'+log.id+'"'+(timerRunning?' disabled':'')+'>▶ 開始（'+wbStartMins+'分）</button>'+
              '<button class="primary" data-mq-quickdone="'+log.id+'">✅ 予定通り</button>'+
              '<button data-mq-openresult="'+log.id+'">一部/できなかった</button>'+
            '</div>'+
          '</div>');
      }
    });

    // 2) Task items: aggregated across ALL subjects, not just the selected one
    state.subjects.forEach(function(sub){
      sub.tasks.filter(function(t){return !t.done;}).forEach(function(t){
        hasAny = true;
        rowList.push(
          '<div class="mission-row">'+
            '<div class="task-check" data-mq-task="'+sub.id+'|'+t.id+'"></div>'+
            '<div class="mission-text">'+escapeHtml(t.text)+' <span class="mission-tag" style="background:'+sub.color+'22;color:'+sub.color+'">'+escapeHtml(sub.name)+'</span></div>'+
            '<div class="mission-actions">'+
              '<span class="task-mins">'+(t.minutes||25)+'分</span>'+
              '<button class="start-btn" data-mqstart-task="'+sub.id+'|'+t.id+'"'+(timerRunning?' disabled':'')+'>▶ 開始</button>'+
            '</div>'+
          '</div>');
      });
    });

    var COMPACT_LIMIT = 4;
    if(!hasAny){
      missionExpanded = false;
      els.missionList.innerHTML = '<div class="mission-empty">本日のミッションはすべて完了しています 🎉 お疲れ様でした！</div>';
    } else if(rowList.length <= COMPACT_LIMIT || missionExpanded){
      els.missionList.innerHTML = rowList.join('') +
        (rowList.length > COMPACT_LIMIT ? '<button type="button" class="mission-more-btn" id="missionCollapseBtn">▲ コンパクト表示に戻す</button>' : '');
    } else {
      els.missionList.innerHTML = rowList.slice(0, COMPACT_LIMIT).join('') +
        '<button type="button" class="mission-more-btn" id="missionMoreBtn">▼ 他 '+(rowList.length-COMPACT_LIMIT)+' 件をすべて表示</button>';
    }

    // populate the quick-add subject selector
    var quickSel = document.getElementById('missionQuickSubject');
    if(quickSel){
      var prevVal = quickSel.value;
      quickSel.innerHTML = '';
      state.subjects.forEach(function(s){
        var opt = document.createElement('option');
        opt.value = s.id; opt.textContent = s.name;
        quickSel.appendChild(opt);
      });
      if(state.subjects.find(function(s){return s.id===prevVal;})){
        quickSel.value = prevVal;
      } else if(state.subjects.find(function(s){return s.id===state.selectedSubjectId;})){
        quickSel.value = state.selectedSubjectId;
      }
    }
  }
  els.missionList.addEventListener('click', function(e){
    if(e.target.closest('#missionMoreBtn')){ missionExpanded = true; renderMissionPanel(); return; }
    if(e.target.closest('#missionCollapseBtn')){ missionExpanded = false; renderMissionPanel(); return; }
    var taskChk = e.target.closest('[data-mq-task]');
    if(taskChk){
      var parts = taskChk.dataset.mqTask.split('|');
      var sub = getSubject(parts[0]);
      if(sub){
        var t = sub.tasks.find(function(t){return t.id===parts[1];});
        if(t){
          t.done = !t.done;
          saveState();
          renderTasks(); renderSubjectMgmt(); renderMissionPanel();
        }
      }
      return;
    }
    var gotoBtn = e.target.closest('[data-mq-goto]');
    if(gotoBtn){ switchTab(gotoBtn.dataset.mqGoto); return; }
    var quickPlanBtn = e.target.closest('[data-mq-quickplan]');
    if(quickPlanBtn){
      confirmTodayPlan(quickPlanBtn.dataset.mqQuickplan, parseInt(quickPlanBtn.dataset.amount,10)||1);
      return;
    }
    var quickDoneBtn = e.target.closest('[data-mq-quickdone]');
    if(quickDoneBtn){
      quickCompleteLog(quickDoneBtn.dataset.mqQuickdone);
      return;
    }
    var openResultBtn = e.target.closest('[data-mq-openresult]');
    if(openResultBtn){
      openResultModal(openResultBtn.dataset.mqOpenresult);
      return;
    }
    var startTaskBtn = e.target.closest('[data-mqstart-task]');
    if(startTaskBtn){
      var parts3 = startTaskBtn.dataset.mqstartTask.split('|');
      var sub3 = getSubject(parts3[0]);
      var t3 = sub3 && sub3.tasks.find(function(x){return x.id===parts3[1];});
      if(sub3 && t3) startFocusSession(sub3.id, t3.minutes||25, {type:'task', subjectId:sub3.id, taskId:t3.id});
      return;
    }
    var startWbBtn = e.target.closest('[data-mqstart-wb]');
    if(startWbBtn){
      var parts4 = startWbBtn.dataset.mqstartWb.split('|');
      var wb4 = getWorkbook(parts4[0]);
      var log4 = state.workLogs.find(function(l){return l.id===parts4[1];});
      if(wb4 && log4){
        var subjId4 = wb4.subjectId || state.selectedSubjectId;
        startFocusSession(subjId4, suggestMinutesForSubject(subjId4), {type:'worklog', logId:log4.id});
      }
      return;
    }
  });

  // ---------- Mission Queue: quick task add ----------
  // Duration is auto-estimated from the subject's recent sessions (same
  // logic used everywhere else in the app) rather than asking again here —
  // for a precise, chosen duration, add the task from the 科目とタスク tab.
  function missionQuickAdd(){
    var sel = document.getElementById('missionQuickSubject');
    var input = document.getElementById('missionQuickInput');
    if(!sel || !sel.value){ showToast('先に科目を追加してください'); return; }
    var sub = getSubject(sel.value);
    var text = input.value.trim();
    if(!sub || !text) return;
    sub.tasks.push({id: uid(), text: text, done:false, minutes: suggestMinutesForSubject(sub.id)});
    input.value = '';
    saveState();
    renderTasks(); renderSubjectMgmt(); renderMissionPanel();
    showToast('「'+text+'」を追加しました');
  }
  document.getElementById('missionQuickAddBtn').addEventListener('click', missionQuickAdd);
  document.getElementById('missionQuickInput').addEventListener('keydown', function(e){
    if(e.key==='Enter') missionQuickAdd();
  });

  // ---------- Workbook badge (pending count) ----------
  function renderWbBadge(){
    var count = 0;
    state.workbooks.forEach(function(wb){
      if(wb.currentPage >= wb.totalPages) return;
      var log = todayLogFor(wb.id);
      if(!log || log.status==='pending') count++;
    });
    if(count>0){
      els.wbBadge.style.display = 'inline-block';
      els.wbBadge.textContent = count;
    } else {
      els.wbBadge.style.display = 'none';
    }
  }

  // ---------- Workbook cards ----------
  var openHistoryIds = {};
  function renderWorkbooks(){
    els.workbookGrid.innerHTML = '';
    if(!state.workbooks.length){
      els.workbookGrid.innerHTML = '<div class="wb-empty-state">まだワークが登録されていません。<br>「+ ワークを登録」から問題集や参考書を追加しましょう。</div>';
      return;
    }
    state.workbooks.forEach(function(wb){
      var pct = Math.min(100, Math.round((wb.currentPage/Math.max(1,wb.totalPages))*100));
      var remaining = Math.max(0, wb.totalPages - wb.currentPage);
      var pace = recentPace(wb.id);
      var etaText = '記録なし';
      if(pace>0 && remaining>0){
        var daysLeft = Math.ceil(remaining/pace);
        etaText = 'あと約 '+daysLeft+' 日（'+fmtDate(isoDate(addDays(new Date(), daysLeft)))+'頃）';
      } else if(remaining<=0){
        etaText = '完了しました！';
      }
      var subj = wb.subjectId ? getSubject(wb.subjectId) : null;
      var log = todayLogFor(wb.id);
      var carry = lastIncompleteLog(wb.id);
      var carryPages = carry ? Math.max(0, carry.plannedPages - carry.actualPages) : 0;

      var card = document.createElement('div');
      card.className = 'wb-card';
      card.dataset.id = wb.id;

      var html = '';
      html += '<div class="wb-card-head">';
      html += '<div><div class="wb-name">'+escapeHtml(wb.name)+'</div>';
      if(subj){
        html += '<div class="wb-subject-tag" style="background:'+subj.color+'22;color:'+subj.color+'">'+escapeHtml(subj.name)+'</div>';
      } else {
        html += '<div class="wb-subject-tag" style="background:var(--panel-hi);color:var(--text-faint);">科目なし</div>';
      }
      html += '</div>';
      html += '<div class="wb-card-actions">'+
                '<button class="icon-btn" data-editwb="'+wb.id+'" title="編集">✎</button>'+
                '<button class="icon-btn danger" data-delwb="'+wb.id+'" title="削除">×</button>'+
              '</div>';
      html += '</div>';

      html += '<div class="wb-progress-row">'+
                '<div class="wb-progress-bar"><i style="width:'+pct+'%;background:'+wb.color+'"></i></div>'+
                '<div class="wb-progress-text">'+wb.currentPage+' / '+wb.totalPages+'p ('+pct+'%)</div>'+
              '</div>';

      html += '<div class="wb-stats-row">'+
                '<div class="wb-stat"><b>'+remaining+'p</b><span>残りページ</span></div>'+
                '<div class="wb-stat"><b>'+(pace>0?pace.toFixed(1):'-')+'</b><span>平均ページ/日</span></div>'+
                '<div class="wb-stat" style="flex:1;"><b style="font-size:11px;">'+etaText+'</b><span>完了予測</span></div>'+
              '</div>';

      // Today box
      if(remaining<=0){
        html += '<div class="wb-today-box reported"><div class="wb-today-label">🏁 完走</div>このワークは最後まで終わりました。お疲れ様でした！</div>';
      } else if(!log){
        var suggestion = Math.max(1, Math.min(remaining, Math.round(pace)||5) + carryPages);
        html += '<div class="wb-today-box pending">';
        html += '<div class="wb-today-label">今日の計画　<span class="status-pill pending">未設定</span></div>';
        html += '<div class="wb-plan-row">';
        html += '<div class="stepper"><button type="button" data-step="-1">−</button><input type="number" min="1" max="'+remaining+'" value="'+suggestion+'" data-plan-input="'+wb.id+'"><button type="button" data-step="1">+</button></div>';
        html += '<span style="font-size:12px;color:var(--text-dim);">ページ</span>';
        html += '<button class="panel-action primary" data-setplan="'+wb.id+'">計画を設定</button>';
        html += '</div>';
        html += '<div class="chip-row">';
        html += '<button type="button" class="chip" data-planchip="'+wb.id+'" data-amount="5">+5</button>';
        html += '<button type="button" class="chip" data-planchip="'+wb.id+'" data-amount="10">+10</button>';
        html += '<button type="button" class="chip" data-planchip="'+wb.id+'" data-amount="all">残り全部</button>';
        html += '</div>';
        if(carryPages>0){
          html += '<div class="wb-hint">前回 '+carryPages+' ページ分の繰り越しを含めた提案です</div>';
        }
        html += '</div>';
      } else if(log.status==='pending'){
        html += '<div class="wb-today-box pending">';
        html += '<div class="wb-today-label">今日の目標　<span class="status-pill pending">未報告</span></div>';
        html += '<div class="wb-plan-target">p.'+log.startPage+' 〜 p.'+log.endPage+'　（<b>'+log.plannedPages+'ページ</b>）</div>';
        html += '<div class="wb-plan-row">';
        html += '<button class="panel-action primary" data-quickdone="'+log.id+'">✅ 予定通り完了</button>';
        html += '<button class="panel-action" data-openresult="'+log.id+'">一部/できなかった</button>';
        html += '<button class="panel-action" data-editplan="'+wb.id+'">計画を変更</button>';
        html += '</div></div>';
      } else {
        var pillClass = log.status;
        var pillText = log.status==='done' ? '完了' : (log.status==='partial' ? '一部達成' : 'できなかった');
        html += '<div class="wb-today-box reported">';
        html += '<div class="wb-today-label">今日の結果　<span class="status-pill '+pillClass+'">'+pillText+'</span></div>';
        html += '<div class="wb-result-line"><span>予定 '+log.plannedPages+'p → 実績 <b>'+log.actualPages+'p</b></span>'+
                  '<button class="panel-action" data-openresult="'+log.id+'">再入力</button></div>';
        if(log.note){ html += '<div class="wb-note">"'+escapeHtml(log.note)+'"</div>'; }
        html += '</div>';
      }

      // History
      var wbLogs = state.workLogs.filter(function(l){return l.workbookId===wb.id;})
        .sort(function(a,b){return a.date<b.date?1:-1;}).slice(0,10);
      html += '<button class="wb-history-toggle" data-history-toggle="'+wb.id+'">'+(openHistoryIds[wb.id]?'▲ 履歴を閉じる':'▼ 履歴を見る ('+wbLogs.length+')')+'</button>';
      html += '<div class="wb-history'+(openHistoryIds[wb.id]?' open':'')+'" id="wbhist-'+wb.id+'">';
      if(!wbLogs.length){
        html += '<div class="wb-history-row"><span>まだ記録がありません</span></div>';
      } else {
        wbLogs.forEach(function(l){
          var st = l.status==='done'?'完了':(l.status==='partial'?'一部':(l.status==='skipped'?'不可':'未報告'));
          html += '<div class="wb-history-row"><span>'+fmtDate(l.date)+'</span><span>予定'+l.plannedPages+'p / 実績'+l.actualPages+'p</span><span>'+st+'</span></div>';
        });
      }
      html += '</div>';

      card.innerHTML = html;
      els.workbookGrid.appendChild(card);
    });
  }

  els.workbookGrid.addEventListener('click', function(e){
    var editBtn = e.target.closest('[data-editwb]');
    if(editBtn){ openWorkbookModal(editBtn.dataset.editwb); return; }
    var delBtn = e.target.closest('[data-delwb]');
    if(delBtn){
      var wb = getWorkbook(delBtn.dataset.delwb);
      if(confirm('ワーク「'+(wb?wb.name:'')+'」を削除しますか？関連する記録も削除されます。')){
        state.workLogs = state.workLogs.filter(function(l){return l.workbookId!==delBtn.dataset.delwb;});
        state.workbooks = state.workbooks.filter(function(w){return w.id!==delBtn.dataset.delwb;});
        saveState(); renderAll();
        showToast('ワークを削除しました');
      }
      return;
    }
    var setPlanBtn = e.target.closest('[data-setplan]');
    if(setPlanBtn){
      var wbId = setPlanBtn.dataset.setplan;
      var input = els.workbookGrid.querySelector('[data-plan-input="'+wbId+'"]');
      var pages = Math.max(1, parseInt(input.value,10) || 1);
      confirmTodayPlan(wbId, pages);
      return;
    }
    var editPlanBtn = e.target.closest('[data-editplan]');
    if(editPlanBtn){
      openPlanModal(editPlanBtn.dataset.editplan);
      return;
    }
    var openResultBtn = e.target.closest('[data-openresult]');
    if(openResultBtn){
      openResultModal(openResultBtn.dataset.openresult);
      return;
    }
    var quickDoneBtn = e.target.closest('[data-quickdone]');
    if(quickDoneBtn){
      quickCompleteLog(quickDoneBtn.dataset.quickdone);
      return;
    }
    var planChipBtn = e.target.closest('[data-planchip]');
    if(planChipBtn){
      var chipWbId = planChipBtn.dataset.planchip;
      var chipWb = getWorkbook(chipWbId);
      var chipInput = els.workbookGrid.querySelector('[data-plan-input="'+chipWbId+'"]');
      if(chipWb && chipInput){
        var remainingForChip = chipWb.totalPages - chipWb.currentPage;
        var amount = planChipBtn.dataset.amount;
        if(amount==='all'){
          chipInput.value = remainingForChip;
        } else {
          chipInput.value = Math.max(1, Math.min(remainingForChip, (parseInt(chipInput.value,10)||0) + parseInt(amount,10)));
        }
      }
      return;
    }
    var histToggle = e.target.closest('[data-history-toggle]');
    if(histToggle){
      var id = histToggle.dataset.historyToggle;
      openHistoryIds[id] = !openHistoryIds[id];
      renderWorkbooks();
      return;
    }
  });
  els.workbookGrid.addEventListener('keydown', function(e){
    if(e.key==='Enter' && e.target.matches('[data-plan-input]')){
      e.preventDefault();
      var wbId2 = e.target.dataset.planInput;
      var btn2 = els.workbookGrid.querySelector('[data-setplan="'+wbId2+'"]');
      if(btn2) btn2.click();
    }
  });

  // ---------- Quick minutes modal (used by "予定通り" one-click completion) ----------
  var minutesModal = document.getElementById('minutesModal');
  var minutesModalConfirmCb = null;
  function openMinutesModal(opts){
    minutesModalConfirmCb = opts.onConfirm || null;
    document.getElementById('minutesModalInfo').textContent = opts.infoText || '';
    document.getElementById('minutesModalInput').value = opts.defaultMinutes!=null ? opts.defaultMinutes : 25;
    minutesModal.classList.add('open');
    setTimeout(function(){
      var inp = document.getElementById('minutesModalInput');
      inp.focus(); inp.select();
    }, 0);
  }
  document.getElementById('minutesChipRow').addEventListener('click', function(e){
    var chip = e.target.closest('[data-minutes-amount]');
    if(!chip) return;
    document.getElementById('minutesModalInput').value = chip.dataset.minutesAmount;
  });
  document.getElementById('minutesCancelBtn').addEventListener('click', function(){
    minutesModal.classList.remove('open');
    minutesModalConfirmCb = null;
  });
  minutesModal.addEventListener('click', function(e){
    if(e.target===minutesModal){ minutesModal.classList.remove('open'); minutesModalConfirmCb = null; }
  });
  document.getElementById('minutesSaveBtn').addEventListener('click', function(){
    var v = Math.max(0, parseInt(document.getElementById('minutesModalInput').value,10) || 0);
    var cb = minutesModalConfirmCb;
    minutesModal.classList.remove('open');
    minutesModalConfirmCb = null;
    if(cb) cb(v);
  });

  function quickCompleteLog(logId){
    var log = state.workLogs.find(function(l){return l.id===logId;});
    if(!log) return;
    var wb = getWorkbook(log.workbookId);
    var subjId = wb && wb.subjectId ? wb.subjectId : state.selectedSubjectId;
    openMinutesModal({
      infoText: (wb?wb.name:'') + ' を予定通り完了として記録します。今回かかった時間も記録しましょう。',
      defaultMinutes: suggestMinutesForSubject(subjId),
      onConfirm: function(minutes){
        var freshLog = state.workLogs.find(function(l){return l.id===logId;});
        if(!freshLog) return;
        var freshWb = getWorkbook(freshLog.workbookId);
        var prevActual = freshLog.actualPages || 0;
        freshLog.status = 'done';
        freshLog.actualPages = freshLog.plannedPages;
        if(freshWb){
          freshWb.currentPage = Math.max(0, Math.min(freshWb.totalPages, freshWb.currentPage - prevActual + freshLog.plannedPages));
        }
        var freshSubjId = freshWb && freshWb.subjectId ? freshWb.subjectId : state.selectedSubjectId;
        setLogMinutes(freshLog, minutes, freshSubjId);
        var pageXp = freshLog.plannedPages*3 + 15;
        var timeXp = minutes*2;
        grantLogXp(freshLog, pageXp + timeXp);
        saveState(); renderAll();
        var timeMsg = minutes>0 ? ('・'+minutes+'分') : '';
        showToast((freshWb?freshWb.name:'')+' を予定通り完了'+timeMsg+' / +'+(pageXp+timeXp)+' XP');
      }
    });
  }

  function confirmTodayPlan(wbId, pages){
    var wb = getWorkbook(wbId);
    if(!wb) return;
    var remaining = wb.totalPages - wb.currentPage;
    pages = Math.max(1, Math.min(pages, Math.max(1,remaining)));
    var log = {
      id: uid(), workbookId: wbId, date: todayStr(),
      plannedPages: pages, startPage: wb.currentPage+1, endPage: wb.currentPage+pages,
      status: 'pending', actualPages: 0, note: '', sessionId: null, xpGranted: 0
    };
    state.workLogs.push(log);
    saveState(); renderAll();
    showToast('今日の計画: p.'+log.startPage+'〜p.'+log.endPage+' を設定しました');
  }

  // ---------- Plan modal (edit today's plan) ----------
  var planModal = document.getElementById('planModal');
  var planTargetWbId = null;
  function openPlanModal(wbId){
    var wb = getWorkbook(wbId);
    if(!wb) return;
    planTargetWbId = wbId;
    var remaining = wb.totalPages - wb.currentPage;
    document.getElementById('planWbLabel').textContent = wb.name;
    document.getElementById('planRemainingHint').textContent = '残り '+remaining+' ページ（現在 p.'+wb.currentPage+'）';
    var log = todayLogFor(wbId);
    document.getElementById('planPagesInput').value = log ? log.plannedPages : Math.max(1, Math.min(remaining, 5));
    document.getElementById('planPagesInput').max = remaining;
    var carry = lastIncompleteLog(wbId);
    var carryPages = carry ? Math.max(0, carry.plannedPages - carry.actualPages) : 0;
    document.getElementById('planCarryHint').textContent = carryPages>0 ? ('前回 '+carryPages+' ページ分が未消化です') : '';
    planModal.classList.add('open');
    var planInputEl = document.getElementById('planPagesInput');
    planInputEl.focus();
    planInputEl.select();
  }
  document.getElementById('planChipRow').addEventListener('click', function(e){
    var chip = e.target.closest('[data-planmodal-amount]');
    if(!chip) return;
    var wb = getWorkbook(planTargetWbId);
    if(!wb) return;
    var remaining = wb.totalPages - wb.currentPage;
    var input = document.getElementById('planPagesInput');
    var amount = chip.dataset.planmodalAmount;
    if(amount==='all'){
      input.value = remaining;
    } else {
      input.value = Math.max(1, Math.min(remaining, (parseInt(input.value,10)||0) + parseInt(amount,10)));
    }
  });
  document.getElementById('planCancelBtn').addEventListener('click', function(){ planModal.classList.remove('open'); });
  planModal.addEventListener('click', function(e){ if(e.target===planModal) planModal.classList.remove('open'); });
  document.getElementById('planSaveBtn').addEventListener('click', function(){
    var wb = getWorkbook(planTargetWbId);
    if(!wb) return;
    var pages = Math.max(1, parseInt(document.getElementById('planPagesInput').value,10) || 1);
    var remaining = wb.totalPages - wb.currentPage;
    pages = Math.min(pages, Math.max(1,remaining));
    var log = todayLogFor(planTargetWbId);
    if(log){
      log.plannedPages = pages;
      log.startPage = wb.currentPage+1;
      log.endPage = wb.currentPage+pages;
    } else {
      state.workLogs.push({
        id: uid(), workbookId: planTargetWbId, date: todayStr(),
        plannedPages: pages, startPage: wb.currentPage+1, endPage: wb.currentPage+pages,
        status:'pending', actualPages:0, note:'', sessionId: null, xpGranted: 0
      });
    }
    saveState();
    planModal.classList.remove('open');
    renderAll();
    showToast('計画を更新しました');
  });

  // ---------- Result modal ----------
  var resultModal = document.getElementById('resultModal');
  var resultTargetLogId = null;
  var resultSelectedStatus = null;

  // Ensures exactly one session entry represents a work-log's recorded time.
  // Re-saving the same log (e.g. via "再入力") updates/removes that single
  // session instead of creating duplicates, so Today/Week/Total minutes,
  // streaks, and charts never double-count.
  function setLogMinutes(log, minutes, subjectId){
    if(log.sessionId){
      var existing = state.sessions.find(function(s){return s.id===log.sessionId;});
      if(existing){
        if(minutes>0 && subjectId){
          existing.minutes = minutes;
          existing.subjectId = subjectId;
          existing.date = log.date;
        } else {
          state.sessions = state.sessions.filter(function(s){return s.id!==log.sessionId;});
          log.sessionId = null;
        }
        return;
      }
    }
    if(minutes>0 && subjectId){
      var sess = {id: uid(), subjectId: subjectId, date: log.date, minutes: minutes};
      state.sessions.push(sess);
      log.sessionId = sess.id;
    }
  }
  // Grants exactly the XP delta for this log versus what was already granted for it,
  // so editing/re-reporting a result never inflates XP.
  function grantLogXp(log, newTotalXp){
    var prev = log.xpGranted || 0;
    var delta = newTotalXp - prev;
    if(delta !== 0) addXp(delta);
    log.xpGranted = newTotalXp;
  }
  function suggestMinutesForSubject(subjectId){
    if(subjectId){
      var subSessions = state.sessions.filter(function(s){return s.subjectId===subjectId;}).slice(-10);
      if(subSessions.length){
        var avg = subSessions.reduce(function(a,s){return a+s.minutes;},0)/subSessions.length;
        return Math.max(5, Math.round(avg/5)*5);
      }
      var sub = getSubject(subjectId);
      if(sub && sub.goalMinutes) return sub.goalMinutes;
    }
    return 25;
  }
  function openResultModal(logId){
    var log = state.workLogs.find(function(l){return l.id===logId;});
    if(!log) return;
    var wb = getWorkbook(log.workbookId);
    resultTargetLogId = logId;
    resultSelectedStatus = log.status==='pending' ? null : log.status;
    document.getElementById('resultPlanInfo').textContent =
      (wb?wb.name:'') + '　今日の予定: p.'+log.startPage+'〜p.'+log.endPage+'（'+log.plannedPages+'ページ）';
    document.getElementById('resultActualInput').value = log.actualPages || log.plannedPages;
    document.getElementById('resultActualInput').max = log.plannedPages * 2;
    var existingSession = log.sessionId ? state.sessions.find(function(s){return s.id===log.sessionId;}) : null;
    var subjIdForSuggest = wb && wb.subjectId ? wb.subjectId : state.selectedSubjectId;
    var defaultMinutes = existingSession ? existingSession.minutes : (log.status==='pending' ? suggestMinutesForSubject(subjIdForSuggest) : 0);
    document.getElementById('resultMinutesInput').value = defaultMinutes;
    document.getElementById('resultNoteInput').value = log.note || '';
    refreshResultStatusUI();
    resultModal.classList.add('open');
    setTimeout(function(){
      var target = resultModal.querySelector('.status-choice.sel') || resultModal.querySelector('.status-choice');
      if(target) target.focus();
    }, 0);
  }
  function refreshResultStatusUI(){
    document.querySelectorAll('#resultStatusRow .status-choice').forEach(function(btn){
      btn.classList.toggle('sel', btn.dataset.status===resultSelectedStatus);
      btn.classList.toggle(btn.dataset.status, btn.dataset.status===resultSelectedStatus);
    });
    document.getElementById('resultActualField').style.display = resultSelectedStatus==='partial' ? 'block' : 'none';
    document.getElementById('resultMinutesField').style.display = resultSelectedStatus ? 'block' : 'none';
  }
  document.getElementById('resultStatusRow').addEventListener('click', function(e){
    var btn = e.target.closest('.status-choice');
    if(!btn) return;
    resultSelectedStatus = btn.dataset.status;
    refreshResultStatusUI();
  });
  document.getElementById('resultCancelBtn').addEventListener('click', function(){ resultModal.classList.remove('open'); });
  resultModal.addEventListener('click', function(e){ if(e.target===resultModal) resultModal.classList.remove('open'); });
  document.getElementById('resultSaveBtn').addEventListener('click', function(){
    if(!resultSelectedStatus){ showToast('進み具合を選択してください'); return; }
    var log = state.workLogs.find(function(l){return l.id===resultTargetLogId;});
    if(!log) return;
    var wb = getWorkbook(log.workbookId);
    var note = document.getElementById('resultNoteInput').value.trim();
    var prevActual = log.actualPages || 0;
    var actual;
    if(resultSelectedStatus==='done'){
      actual = log.plannedPages;
    } else if(resultSelectedStatus==='skipped'){
      actual = 0;
    } else {
      actual = Math.max(0, parseInt(document.getElementById('resultActualInput').value,10) || 0);
    }
    log.status = resultSelectedStatus;
    log.actualPages = actual;
    log.note = note;
    if(wb){
      wb.currentPage = Math.max(0, Math.min(wb.totalPages, wb.currentPage - prevActual + actual));
    }
    var minutes = Math.max(0, parseInt(document.getElementById('resultMinutesInput').value,10) || 0);
    var subjIdForLog = wb && wb.subjectId ? wb.subjectId : state.selectedSubjectId;
    setLogMinutes(log, minutes, subjIdForLog);
    var pageXp = actual*3 + (resultSelectedStatus==='done' ? 15 : 0);
    var timeXp = minutes*2;
    grantLogXp(log, pageXp + timeXp);
    saveState();
    resultModal.classList.remove('open');
    renderAll();
    var timeMsg = minutes>0 ? ('・'+minutes+'分') : '';
    if(resultSelectedStatus==='skipped'){
      showToast('記録しました'+timeMsg+'。無理せず次に繋げましょう');
    } else {
      showToast((wb?wb.name:'')+' を'+actual+'ページ'+timeMsg+' 記録 / +'+(pageXp+timeXp)+' XP');
    }
  });

  // ---------- Workbook add/edit modal ----------
  var workbookModal = document.getElementById('workbookModal');
  var wbColorRow = document.getElementById('wbColorRow');
  var wbSelectedColor = PALETTE[0];
  var editingWorkbookId = null;
  PALETTE.forEach(function(c){
    var sw = document.createElement('div');
    sw.className = 'color-swatch';
    sw.style.background = c;
    sw.dataset.color = c;
    wbColorRow.appendChild(sw);
  });
  function refreshWbSwatches(){
    Array.prototype.forEach.call(wbColorRow.children, function(sw){
      sw.classList.toggle('sel', sw.dataset.color === wbSelectedColor);
    });
  }
  wbColorRow.addEventListener('click', function(e){
    var sw = e.target.closest('.color-swatch');
    if(!sw) return;
    wbSelectedColor = sw.dataset.color;
    refreshWbSwatches();
  });
  function populateWbSubjectSelect(selectedId){
    var sel = document.getElementById('wbSubjectSelect');
    sel.innerHTML = '<option value="">科目なし</option>';
    state.subjects.forEach(function(s){
      var opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = s.name;
      sel.appendChild(opt);
    });
    sel.value = selectedId || '';
  }
  function openWorkbookModal(wbId){
    editingWorkbookId = wbId || null;
    var wb = wbId ? getWorkbook(wbId) : null;
    document.getElementById('workbookModalTitle').textContent = wb ? 'ワークを編集' : 'ワークを登録';
    document.getElementById('wbNameInput').value = wb ? wb.name : '';
    document.getElementById('wbTotalPagesInput').value = wb ? wb.totalPages : 100;
    document.getElementById('wbCurrentPageInput').value = wb ? wb.currentPage : 0;
    populateWbSubjectSelect(wb ? wb.subjectId : (state.selectedSubjectId||''));
    wbSelectedColor = wb ? wb.color : PALETTE[state.workbooks.length % PALETTE.length];
    refreshWbSwatches();
    workbookModal.classList.add('open');
    document.getElementById('wbNameInput').focus();
  }
  document.getElementById('addWorkbookBtn').addEventListener('click', function(){ openWorkbookModal(null); });
  document.getElementById('wbCancelBtn').addEventListener('click', function(){ workbookModal.classList.remove('open'); });
  workbookModal.addEventListener('click', function(e){ if(e.target===workbookModal) workbookModal.classList.remove('open'); });
  document.getElementById('wbSaveBtn').addEventListener('click', function(){
    var name = document.getElementById('wbNameInput').value.trim();
    if(!name){ showToast('ワーク名を入力してください'); return; }
    var totalPages = Math.max(1, parseInt(document.getElementById('wbTotalPagesInput').value,10) || 100);
    var currentPage = Math.max(0, Math.min(totalPages, parseInt(document.getElementById('wbCurrentPageInput').value,10) || 0));
    var subjectId = document.getElementById('wbSubjectSelect').value || null;
    if(editingWorkbookId){
      var wb = getWorkbook(editingWorkbookId);
      wb.name = name; wb.totalPages = totalPages; wb.currentPage = currentPage;
      wb.subjectId = subjectId; wb.color = wbSelectedColor;
      showToast('ワーク「'+name+'」を更新しました');
    } else {
      state.workbooks.push({id: uid(), name:name, subjectId:subjectId, color:wbSelectedColor, totalPages:totalPages, currentPage:currentPage, createdAt: todayStr()});
      showToast('ワーク「'+name+'」を登録しました');
    }
    saveState();
    workbookModal.classList.remove('open');
    renderAll();
  });

  // ---------- Subject add/edit modal ----------
  var subjectModal = document.getElementById('subjectModal');
  var colorRow = document.getElementById('colorRow');
  var selectedColor = PALETTE[0];
  var editingSubjectId = null;
  PALETTE.forEach(function(c){
    var sw = document.createElement('div');
    sw.className = 'color-swatch';
    sw.style.background = c;
    sw.dataset.color = c;
    colorRow.appendChild(sw);
  });
  function refreshColorSwatches(){
    Array.prototype.forEach.call(colorRow.children, function(sw){
      sw.classList.toggle('sel', sw.dataset.color === selectedColor);
    });
  }
  colorRow.addEventListener('click', function(e){
    var sw = e.target.closest('.color-swatch');
    if(!sw) return;
    selectedColor = sw.dataset.color;
    refreshColorSwatches();
  });
  function openSubjectModal(subId){
    editingSubjectId = subId || null;
    var sub = subId ? getSubject(subId) : null;
    document.getElementById('subjectModalTitle').textContent = sub ? '科目を編集' : '科目を追加';
    document.getElementById('subjectNameInput').value = sub ? sub.name : '';
    document.getElementById('subjectGoalInput').value = sub ? sub.goalMinutes : 30;
    selectedColor = sub ? sub.color : PALETTE[state.subjects.length % PALETTE.length];
    refreshColorSwatches();
    subjectModal.classList.add('open');
    document.getElementById('subjectNameInput').focus();
  }
  function bindAddSubjectBtn(id){
    var el = document.getElementById(id);
    if(el) el.addEventListener('click', function(){ openSubjectModal(null); });
  }
  bindAddSubjectBtn('addSubjectBtn');
  bindAddSubjectBtn('addSubjectBtn2');
  document.getElementById('subjectCancelBtn').addEventListener('click', function(){ subjectModal.classList.remove('open'); });
  subjectModal.addEventListener('click', function(e){ if(e.target===subjectModal) subjectModal.classList.remove('open'); });
  document.getElementById('subjectSaveBtn').addEventListener('click', function(){
    var name = document.getElementById('subjectNameInput').value.trim();
    var goal = parseInt(document.getElementById('subjectGoalInput').value, 10) || 30;
    if(!name){ showToast('科目名を入力してください'); return; }
    if(editingSubjectId){
      var sub = getSubject(editingSubjectId);
      sub.name = name; sub.goalMinutes = goal; sub.color = selectedColor;
      showToast('科目「'+name+'」を更新しました');
    } else {
      var newSub = {id: uid(), name: name, color: selectedColor, goalMinutes: goal, tasks:[]};
      state.subjects.push(newSub);
      state.selectedSubjectId = newSub.id;
      showToast('科目「'+name+'」を追加しました');
    }
    saveState();
    subjectModal.classList.remove('open');
    renderAll();
  });

  // ---------- Daily goal modal ----------
  // The single, canonical place to set "today's total study-time goal" —
  // used both for the automatic once-a-day prompt and for manually changing
  // it later, so there's exactly one screen for this setting, not two.
  var dailyStartModal = document.getElementById('dailyStartModal');
  function openDailyGoalModal(isAuto){
    document.getElementById('dailyStartInput').value = state.settings.dailyGoalMinutes || '';
    document.getElementById('dailyStartTitle').textContent = isAuto ? '今日は何分勉強しますか？' : '1日の目標時間を変更';
    document.getElementById('dailyStartHint').textContent = isAuto
      ? '今日の学習目標を設定しましょう。日付が変わると（24:00以降）自動でリセットされ、また設定できます。'
      : '今日の残り時間の目標を設定します。';
    document.getElementById('dailyStartSkipBtn').textContent = isAuto ? 'あとで設定' : 'キャンセル';
    document.getElementById('dailyStartSaveBtn').textContent = isAuto ? 'この目標で始める' : '保存';
    dailyStartModal.classList.add('open');
  }
  document.getElementById('dailyGoalBtn').addEventListener('click', function(){
    openDailyGoalModal(false);
  });
  function maybeShowDailyStartPrompt(){
    if(state.settings.dailyGoalSetDate === todayStr()) return;
    openDailyGoalModal(true);
  }
  document.getElementById('dailyStartSkipBtn').addEventListener('click', function(){
    // "あとで設定"/"キャンセル": close for now. When opened automatically the
    // goal date isn't stamped, so it will prompt again on the next load/day.
    dailyStartModal.classList.remove('open');
  });
  dailyStartModal.addEventListener('click', function(e){ if(e.target===dailyStartModal) dailyStartModal.classList.remove('open'); });
  dailyStartModal.querySelectorAll('[data-dailystart-amount]').forEach(function(chip){
    chip.addEventListener('click', function(){
      document.getElementById('dailyStartInput').value = chip.dataset.dailystartAmount;
    });
  });
  document.getElementById('dailyStartSaveBtn').addEventListener('click', function(){
    var raw = document.getElementById('dailyStartInput').value;
    var v = parseInt(raw, 10);
    if(!v || v <= 0){
      showToast('目標時間を分で入力してください');
      return;
    }
    state.settings.dailyGoalMinutes = v;
    state.settings.dailyGoalSetDate = todayStr();
    saveState();
    dailyStartModal.classList.remove('open');
    renderAll();
    showToast('今日の目標を'+v+'分に設定しました。頑張りましょう！');
  });

  // ---------- Sound toggle ----------
  document.getElementById('soundToggleBtn').addEventListener('click', function(){
    state.settings.sound = !state.settings.sound;
    document.getElementById('soundState').textContent = state.settings.sound ? 'ON' : 'OFF';
    saveState();
    showToast('通知音を'+(state.settings.sound?'ONにしました':'OFFにしました'));
  });
  document.getElementById('soundState').textContent = state.settings.sound ? 'ON' : 'OFF';

  // ---------- Export / Import ----------
  document.getElementById('exportBtn').addEventListener('click', function(){
    try{
      var blob = new Blob([JSON.stringify(state, null, 2)], {type:'application/json'});
      var url = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = url;
      a.download = 'study_control_backup_'+todayStr()+'.json';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('バックアップを書き出しました');
    }catch(e){ showToast('書き出しに失敗しました'); }
  });
  document.getElementById('importBtn').addEventListener('click', function(){
    document.getElementById('importFileInput').click();
  });
  document.getElementById('importFileInput').addEventListener('change', function(e){
    var file = e.target.files[0];
    if(!file) return;
    var reader = new FileReader();
    reader.onload = function(ev){
      try{
        var parsed = JSON.parse(ev.target.result);
        if(!parsed.subjects){ showToast('バックアップファイルの形式が正しくありません'); return; }
        if(confirm('現在のデータを読み込んだバックアップで上書きします。よろしいですか？')){
          parsed.workbooks = parsed.workbooks || [];
          parsed.workLogs = parsed.workLogs || [];
          parsed.settings = parsed.settings || {dailyGoalMinutes:null, sound:true};
          state = parsed;
          if(!state.selectedSubjectId || !getSubject(state.selectedSubjectId)){
            state.selectedSubjectId = state.subjects[0] ? state.subjects[0].id : null;
          }
          saveState();
          renderAll();
          showToast('バックアップを読み込みました');
        }
      }catch(err){ showToast('読み込みに失敗しました: ファイルを確認してください'); }
      e.target.value = '';
    };
    reader.readAsText(file);
  });

  // ---------- Reset ----------
  document.getElementById('resetBtn').addEventListener('click', function(){
    if(confirm('全てのデータを削除して初期状態に戻しますか？この操作は取り消せません。')){
      localStorage.removeItem(STORE_KEY);
      state = defaultState();
      state.selectedSubjectId = state.subjects[0].id;
      saveState();
      renderAll();
      showToast('データをリセットしました');
    }
  });

  // ---------- Stepper (+/-) global handler ----------
  document.addEventListener('click', function(e){
    var stepBtn = e.target.closest('.stepper [data-step]');
    if(!stepBtn) return;
    var wrap = stepBtn.closest('.stepper');
    var input = wrap ? wrap.querySelector('input') : null;
    if(!input) return;
    var delta = parseInt(stepBtn.dataset.step, 10) || 0;
    var min = (input.min!==''&&input.min!=null) ? parseInt(input.min,10) : -Infinity;
    var max = (input.max!==''&&input.max!=null) ? parseInt(input.max,10) : Infinity;
    var val = (parseInt(input.value,10)||0) + delta;
    val = Math.max(min, Math.min(max, val));
    input.value = val;
  });

  // ---------- Keyboard shortcuts: 1-4 switch tabs, Enter saves modal, Esc closes modal ----------
  document.addEventListener('keydown', function(e){
    var openModal = document.querySelector('.modal-overlay.open');
    if(openModal){
      if(e.key==='Escape'){ openModal.classList.remove('open'); return; }
      if(e.key==='Enter' && e.target.tagName!=='TEXTAREA'){
        e.preventDefault();
        var saveBtn = openModal.querySelector('.save');
        if(saveBtn) saveBtn.click();
      }
      return;
    }
    var tag = (e.target.tagName||'').toUpperCase();
    if(tag==='INPUT' || tag==='TEXTAREA' || tag==='SELECT') return;
    if(e.key==='1') switchTab('dashboard');
    else if(e.key==='2') switchTab('workbook');
    else if(e.key==='3') switchTab('subjects');
    else if(e.key==='4') switchTab('stats');
  });

  // ---------- Toast ----------
  var toastEl = document.getElementById('toast');
  var toastTimer = null;
  function showToast(msg){
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){ toastEl.classList.remove('show'); }, 2600);
  }

  // ---------- Sidebar subject select interaction ----------
  els.subjectList.addEventListener('click', function(e){
    var row = e.target.closest('.subject-row');
    if(row){
      state.selectedSubjectId = row.dataset.id;
      saveState();
      renderSubjectList(); renderSubjectMgmt(); renderTimerSubjectSelect(); renderTasks(); renderMissionPanel();
    }
  });

  // ---------- Tasks ----------
  els.taskList.addEventListener('click', function(e){
    var sub = getSubject(state.selectedSubjectId);
    if(!sub) return;
    var chk = e.target.closest('[data-task]');
    if(chk){
      var t = sub.tasks.find(function(t){return t.id===chk.dataset.task;});
      if(t){ t.done = !t.done; saveState(); renderTasks(); renderSubjectMgmt(); renderMissionPanel(); }
      return;
    }
    var del = e.target.closest('[data-taskdel]');
    if(del){
      sub.tasks = sub.tasks.filter(function(t){return t.id!==del.dataset.taskdel;});
      saveState(); renderTasks(); renderSubjectMgmt(); renderMissionPanel();
      return;
    }
    var startBtn = e.target.closest('[data-taskstart]');
    if(startBtn){
      var t = sub.tasks.find(function(x){return x.id===startBtn.dataset.taskstart;});
      if(t) startFocusSession(sub.id, t.minutes||25, {type:'task', subjectId:sub.id, taskId:t.id});
      return;
    }
  });
  // ---- Task duration picker (kept in sync with the "所要時間" chip row) ----
  var taskAddMinutes = 25;
  document.querySelectorAll('#taskMinsChipRow [data-taskmin]').forEach(function(chip){
    chip.addEventListener('click', function(){
      document.querySelectorAll('#taskMinsChipRow [data-taskmin]').forEach(function(c){c.classList.remove('active');});
      chip.classList.add('active');
      taskAddMinutes = parseInt(chip.dataset.taskmin,10) || 25;
    });
  });
  function addTask(){
    var sub = getSubject(state.selectedSubjectId);
    if(!sub){ showToast('先に科目を追加してください'); return; }
    var input = document.getElementById('taskInput');
    var text = input.value.trim();
    if(!text) return;
    sub.tasks.push({id: uid(), text: text, done:false, minutes: taskAddMinutes});
    input.value = '';
    saveState(); renderTasks(); renderSubjectMgmt(); renderMissionPanel();
  }
  document.getElementById('taskAddBtn').addEventListener('click', addTask);
  document.getElementById('taskInput').addEventListener('keydown', function(e){
    if(e.key==='Enter') addTask();
  });

  // ---------- Full history log (stats tab) ----------
  function renderFullLog(){
    var logs = state.workLogs.filter(function(l){return l.status!=='pending';})
      .sort(function(a,b){return a.date<b.date?1:-1;}).slice(0,30);
    if(!logs.length){
      els.fullLogList.innerHTML = '<div class="empty-state">まだ記録がありません。ワーク管理タブから結果を入力してみましょう。</div>';
      return;
    }
    els.fullLogList.innerHTML = '';
    logs.forEach(function(l){
      var wb = getWorkbook(l.workbookId);
      var st = l.status==='done'?'完了':(l.status==='partial'?'一部達成':'できなかった');
      var row = document.createElement('div');
      row.className = 'log-row';
      row.innerHTML =
        '<div class="log-date">'+fmtDate(l.date)+'</div>'+
        '<div class="log-body">'+escapeHtml(wb?wb.name:'(削除済み)')+
          '<div class="log-meta">予定'+l.plannedPages+'p / 実績'+l.actualPages+'p'+(l.note?'　・　'+escapeHtml(l.note):'')+'</div>'+
        '</div>'+
        '<div class="status-pill '+l.status+'">'+st+'</div>';
      els.fullLogList.appendChild(row);
    });
  }

  // ---------- Day rollover (24:00 reset) ----------
  // Compares the current calendar date against the last-tracked date on every
  // clock tick (every second) so the reset happens live, without needing a
  // page reload, the moment midnight passes.
  var trackedDateStr = todayStr();
  function checkDateRollover(){
    var now = todayStr();
    if(now !== trackedDateStr){
      handleDateRollover(trackedDateStr, now);
      trackedDateStr = now;
    }
  }
  function handleDateRollover(oldDate, newDate){
    // If the timer was running across midnight, credit the elapsed time to
    // the day it was actually studied on (oldDate) before resetting, so no
    // study time is ever silently lost.
    if(timerRunning){
      var elapsedSec = timerElapsedSecCurrent();
      var minutes = Math.round(elapsedSec/60);
      clearInterval(timerInterval); timerInterval = null;
      timerRunning = false;
      timerStartEpoch = null;
      timerAccumMs = 0;
      var startBtn = document.getElementById('timerStartBtn');
      if(startBtn) startBtn.textContent = '▶ START';
      if(minutes >= 1){
        var subId = timerSubjectIdAtStart || (els.timerSubjectSelect && els.timerSubjectSelect.value) || state.selectedSubjectId;
        if(subId){
          state.sessions.push({id: uid(), subjectId: subId, date: oldDate, minutes: minutes});
          addXp(minutes*2);
        }
      }
    } else {
      timerAccumMs = 0; timerStartEpoch = null;
    }
    localStorage.removeItem(TIMER_STORE_KEY);
    saveState();
    renderTimerDisplay();
    renderAll();
    maybeShowDailyStartPrompt();
    showToast('日付が変わりました（24:00）。学習時間をリセットしました');
  }

  // ---------- Timer ----------
  // Timestamp-based engine: elapsed/remaining time is always computed from
  // real wall-clock timestamps (Date.now()) rather than by counting interval
  // ticks. This keeps the timer accurate even when the browser throttles
  // setInterval in a hidden/background tab. The running state is also
  // persisted to localStorage, so switching tabs, reloading the page, or
  // closing and reopening the tab never stops or desyncs the timer — it
  // simply picks up from the real elapsed time when the page becomes active
  // again.
  var TIMER_STORE_KEY = 'studyControlTimerState_v1';
  var timerMinutes = 25;
  var timerFreeMode = true;
  var timerRunning = false;
  var timerInterval = null;
  var timerStartEpoch = null;   // ms timestamp when the current running segment began
  var timerAccumMs = 0;         // ms accumulated from previous (paused) segments
  var timerSubjectIdAtStart = null;
  var timerCompletionHandled = false;
  // When a countdown is launched from a Mission Queue / Task Queue row (via
  // the ▶開始 shortcut), this remembers which task or workbook log it belongs
  // to, so finishing the timer can complete that item automatically instead
  // of just logging generic subject minutes.
  var timerLinkedTarget = null; // {type:'task', subjectId, taskId} | {type:'worklog', logId} | null

  function timerElapsedMs(){
    var extra = (timerRunning && timerStartEpoch) ? (Date.now() - timerStartEpoch) : 0;
    return timerAccumMs + extra;
  }
  function timerElapsedSecCurrent(){ return Math.max(0, Math.floor(timerElapsedMs()/1000)); }
  function timerSecondsLeftCurrent(){ return Math.max(0, timerMinutes*60 - timerElapsedSecCurrent()); }

  function saveTimerState(){
    try{
      localStorage.setItem(TIMER_STORE_KEY, JSON.stringify({
        timerMinutes: timerMinutes,
        timerFreeMode: timerFreeMode,
        timerRunning: timerRunning,
        timerStartEpoch: timerStartEpoch,
        timerAccumMs: timerAccumMs,
        timerSubjectIdAtStart: timerSubjectIdAtStart,
        dateStr: todayStr()
      }));
    }catch(e){}
  }
  function loadTimerState(){
    try{
      var raw = localStorage.getItem(TIMER_STORE_KEY);
      if(!raw) return;
      var t = JSON.parse(raw);
      if(!t) return;
      // A saved timer from a previous day is stale — day rollover already
      // flushes/resets running timers, so just discard it here.
      if(t.dateStr && t.dateStr !== todayStr()){
        localStorage.removeItem(TIMER_STORE_KEY);
        return;
      }
      timerMinutes = t.timerMinutes || 25;
      timerFreeMode = !!t.timerFreeMode;
      timerRunning = !!t.timerRunning;
      timerStartEpoch = t.timerStartEpoch || null;
      timerAccumMs = t.timerAccumMs || 0;
      timerSubjectIdAtStart = t.timerSubjectIdAtStart || null;
    }catch(e){}
  }

  // Today's total = whatever's already been recorded to sessions today,
  // plus whatever the current (not-yet-recorded) segment has accumulated —
  // so the total ticks up live in step with the current-session timer
  // instead of only jumping when a session is finished.
  function todayTotalSecondsLive(){
    var recordedSec = minutesForDate(todayStr()) * 60;
    return recordedSec + timerElapsedSecCurrent();
  }
  function formatHMS(totalSec){
    totalSec = Math.max(0, Math.floor(totalSec));
    var h = Math.floor(totalSec/3600), m = Math.floor((totalSec%3600)/60), s = totalSec%60;
    if(h>0) return String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
    return String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
  }
  function renderTimerDisplay(){
    var sec = timerFreeMode ? timerElapsedSecCurrent() : timerSecondsLeftCurrent();
    var m = Math.floor(sec/60), s = sec%60;
    els.timerDisplay.textContent = String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
    if(els.timerTotalVal) els.timerTotalVal.textContent = formatHMS(todayTotalSecondsLive());
    if(els.timerGoalVal){
      var goalMin = state.settings.dailyGoalMinutes;
      if(!goalMin){
        els.timerGoalVal.textContent = '未設定';
        els.timerGoalVal.classList.remove('goal-reached');
        els.timerGoalVal.classList.add('goal-unset');
      } else {
        var goalSec = goalMin * 60;
        var remainSec = goalSec - todayTotalSecondsLive();
        var reached = remainSec <= 0;
        els.timerGoalVal.textContent = reached ? '達成 🎉' : formatHMS(remainSec);
        els.timerGoalVal.classList.toggle('goal-reached', reached);
        els.timerGoalVal.classList.remove('goal-unset');
      }
    }
    var barFill = document.getElementById('timerBarFill');
    if(barFill){
      if(timerFreeMode){
        // No fixed duration to count down from, so the bar pulses to show
        // "recording in progress" instead of depleting toward nothing.
        barFill.style.width = '100%';
        barFill.classList.toggle('pulse', timerRunning);
      } else {
        barFill.classList.remove('pulse');
        var totalSec = Math.max(1, timerMinutes*60);
        var pct = Math.max(0, Math.min(100, (sec/totalSec)*100));
        barFill.style.width = pct + '%';
      }
    }
  }

  function tick(){
    renderTimerDisplay();
    updateTimerStatusBadge();
    if(!timerFreeMode && timerRunning && timerSecondsLeftCurrent() <= 0 && !timerCompletionHandled){
      timerCompletionHandled = true;
      clearInterval(timerInterval);
      timerInterval = null;
      timerRunning = false;
      timerStartEpoch = null;
      timerAccumMs = 0;
      document.getElementById('timerStartBtn').textContent = '▶ START';
      saveTimerState();
      var wasLinked = !!timerLinkedTarget;
      finishTimerSession(timerMinutes);
      renderTimerDisplay();
      syncTimerLockState();
      if(state.settings.sound) playChime();
      if(!wasLinked) showToast('タイマー終了！お疲れ様でした 🎉');
      timerCompletionHandled = false;
    }
  }

  // ---------- Single source of truth for "is a timer running right now?" ----------
  // Keeps every control that depends on timer state in sync at once: the
  // persistent status badge (visible from any tab), the timer panel's
  // subject-color theming, the subject select (locked while running, since
  // it can't be changed mid-session), and the ▶開始 shortcut buttons in
  // Task Queue / Mission Queue (disabled while a session is already active,
  // so it's never ambiguous which countdown is "the" one).
  function syncTimerLockState(){
    if(els.timerSubjectSelect) els.timerSubjectSelect.disabled = timerRunning;
    syncTimerButtons();
    updateTimerStatusBadge();
    applyTimerColor();
    renderTasks();
    renderMissionPanel();
  }
  // START only makes sense once a subject exists to track. RESET and
  // "完了として記録" only make sense once the current segment has actually
  // accumulated some time (running, or paused with elapsed time) — pressing
  // them against a fresh 00:00 clock has nothing to reset/record. Rather
  // than showing them grayed out, they're hidden entirely until they're
  // actually actionable.
  function syncTimerButtons(){
    var startBtn = document.getElementById('timerStartBtn');
    var resetBtn = document.getElementById('timerResetBtn');
    var doneBtn = document.getElementById('timerDoneBtn');
    var hasElapsed = timerElapsedMs() > 0;
    if(startBtn) startBtn.style.display = state.subjects.length ? '' : 'none';
    if(resetBtn) resetBtn.style.display = hasElapsed ? '' : 'none';
    if(doneBtn) doneBtn.style.display = hasElapsed ? '' : 'none';
  }
  // Themes the Focus Engine panel with the color of whichever subject is
  // currently being tracked, so it's visually obvious at a glance.
  function applyTimerColor(){
    var panel = document.getElementById('timerPanel');
    if(!panel) return;
    var subId = timerRunning ? (timerSubjectIdAtStart || els.timerSubjectSelect.value) : null;
    var sub = subId ? getSubject(subId) : null;
    if(sub){
      panel.style.setProperty('--timer-accent', sub.color);
      panel.classList.add('running');
    } else {
      panel.style.removeProperty('--timer-accent');
      panel.classList.remove('running');
    }
    var hint = document.getElementById('timerHint');
    if(hint) hint.style.display = timerRunning ? 'none' : '';
  }
  function updateTimerStatusBadge(){
    var badge = document.getElementById('timerStatusBadge');
    var text = document.getElementById('timerStatusText');
    if(!badge || !text) return;
    if(timerRunning){
      var subId = timerSubjectIdAtStart || els.timerSubjectSelect.value;
      var sub = getSubject(subId);
      var sec = timerFreeMode ? timerElapsedSecCurrent() : timerSecondsLeftCurrent();
      var m = Math.floor(sec/60), s = sec%60;
      var label = timerFreeMode ? '経過' : '残り';
      text.innerHTML = '<b>'+(sub?escapeHtml(sub.name):'学習')+'</b> '+label+' '+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
      badge.classList.add('show');
    } else {
      badge.classList.remove('show');
    }
  }
  var timerStatusBadgeEl = document.getElementById('timerStatusBadge');
  if(timerStatusBadgeEl){
    timerStatusBadgeEl.addEventListener('click', function(){
      switchTab('dashboard');
      focusTimerPanel();
    });
  }

  // ---------- Start-timer shortcuts (Mission Queue / Task Queue "▶開始") ----------
  // Launches the Focus Engine timer directly from a list row: picks the
  // subject, sets the duration, starts the countdown immediately, and
  // scrolls the timer panel into view so the user sees it running.
  function startFocusSession(subjectId, minutes, linked){
    if(!state.subjects.length){ showToast('先に科目を追加してください'); return; }
    if(timerRunning){ showToast('タイマーが動いています。先に一時停止/リセットしてください'); return; }
    minutes = Math.max(5, Math.round((minutes||25)/5)*5);
    if(subjectId && els.timerSubjectSelect.querySelector('option[value="'+subjectId+'"]')){
      els.timerSubjectSelect.value = subjectId;
    }
    timerFreeMode = false;
    timerMinutes = minutes;
    timerAccumMs = 0;
    timerStartEpoch = Date.now();
    timerRunning = true;
    timerSubjectIdAtStart = els.timerSubjectSelect.value || subjectId || state.selectedSubjectId;
    timerLinkedTarget = linked || null;
    clearInterval(timerInterval);
    timerInterval = setInterval(tick, 1000);
    document.getElementById('timerStartBtn').textContent = '⏸ PAUSE';
    renderTimerDisplay();
    saveTimerState();
    syncTimerLockState();
    focusTimerPanel();
    showToast('カウントダウンを開始しました（'+minutes+'分）');
  }
  function focusTimerPanel(){
    var panel = els.timerDisplay.closest('.panel');
    if(!panel) return;
    panel.scrollIntoView({behavior:'smooth', block:'center'});
    panel.classList.add('panel-flash');
    setTimeout(function(){ panel.classList.remove('panel-flash'); }, 1200);
  }

  function playChime(){
    try{
      var ctx = new (window.AudioContext||window.webkitAudioContext)();
      [880,1108,1318].forEach(function(freq, i){
        var o = ctx.createOscillator(), g = ctx.createGain();
        o.type='sine'; o.frequency.value=freq;
        o.connect(g); g.connect(ctx.destination);
        var t0 = ctx.currentTime + i*0.15;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.15, t0+0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t0+0.4);
        o.start(t0); o.stop(t0+0.42);
      });
    }catch(e){}
  }

  document.getElementById('timerStartBtn').addEventListener('click', function(){
    if(!state.subjects.length){ showToast('先に科目を追加してください'); return; }
    if(timerRunning){
      timerAccumMs += Date.now() - timerStartEpoch;
      timerStartEpoch = null;
      timerRunning = false;
      clearInterval(timerInterval);
      timerInterval = null;
      this.textContent = '▶ START';
    } else {
      // A genuinely fresh start (nothing paused, no task/workbook linked)
      // has no duration to count down from anymore — there's no picker for
      // it in this panel — so it always begins as a plain count-up. Resuming
      // a paused session (fixed-duration or linked) keeps its existing mode.
      if(timerAccumMs === 0 && !timerLinkedTarget){
        timerFreeMode = true;
      }
      timerRunning = true;
      timerStartEpoch = Date.now();
      timerSubjectIdAtStart = els.timerSubjectSelect.value || state.selectedSubjectId;
      clearInterval(timerInterval);
      timerInterval = setInterval(tick, 1000);
      this.textContent = '⏸ PAUSE';
      tick();
    }
    saveTimerState();
    syncTimerLockState();
  });
  document.getElementById('timerResetBtn').addEventListener('click', function(){
    clearInterval(timerInterval); timerInterval = null;
    timerRunning = false;
    timerStartEpoch = null;
    timerAccumMs = 0;
    timerLinkedTarget = null;
    timerFreeMode = true;
    document.getElementById('timerStartBtn').textContent = '▶ START';
    renderTimerDisplay();
    saveTimerState();
    syncTimerLockState();
  });
  document.getElementById('timerDoneBtn').addEventListener('click', function(){
    if(!state.subjects.length){ showToast('先に科目を追加してください'); return; }
    var elapsedSec = timerElapsedSecCurrent();
    var minsDone = timerFreeMode
      ? Math.max(1, Math.round(elapsedSec/60))
      : Math.max(1, Math.min(timerMinutes, Math.round(elapsedSec/60)));
    clearInterval(timerInterval); timerInterval = null;
    timerRunning = false;
    timerStartEpoch = null;
    timerAccumMs = 0;
    document.getElementById('timerStartBtn').textContent = '▶ START';
    saveTimerState();
    finishTimerSession(minsDone);
    renderTimerDisplay();
    syncTimerLockState();
  });

  function completeSession(minutes){
    var subId = timerSubjectIdAtStart || els.timerSubjectSelect.value || state.selectedSubjectId;
    if(!subId) return;
    state.sessions.push({id: uid(), subjectId: subId, date: todayStr(), minutes: minutes});
    var xpGain = minutes * 2;
    addXp(xpGain);
    saveState();
    renderAll();
    var sub = getSubject(subId);
    showToast((sub?sub.name:'') + ' を'+minutes+'分記録 / +'+xpGain+' XP');
  }

  // Completes whatever the just-finished timer was for. If it was launched
  // via a Mission Queue / Task Queue "▶開始" shortcut, this finishes that
  // specific task or workbook log (marking it done / recording the result)
  // instead of only logging generic subject minutes — so pressing 開始,
  // studying, and finishing is a single consistent flow everywhere.
  function finishTimerSession(minutes){
    var linked = timerLinkedTarget;
    timerLinkedTarget = null;
    if(linked && linked.type==='task'){
      completeSession(minutes);
      var sub = getSubject(linked.subjectId);
      var t = sub && sub.tasks.find(function(x){return x.id===linked.taskId;});
      if(t && !t.done){
        t.done = true;
        saveState();
        renderTasks(); renderSubjectMgmt(); renderMissionPanel();
      }
      return;
    }
    if(linked && linked.type==='worklog'){
      var log = state.workLogs.find(function(l){return l.id===linked.logId;});
      if(log && log.status==='pending'){
        var wb = getWorkbook(log.workbookId);
        var prevActual = log.actualPages || 0;
        log.status = 'done';
        log.actualPages = log.plannedPages;
        if(wb){
          wb.currentPage = Math.max(0, Math.min(wb.totalPages, wb.currentPage - prevActual + log.plannedPages));
        }
        var subjId = wb && wb.subjectId ? wb.subjectId : state.selectedSubjectId;
        setLogMinutes(log, minutes, subjId);
        var pageXp = log.plannedPages*3 + 15;
        var timeXp = minutes*2;
        grantLogXp(log, pageXp + timeXp);
        saveState(); renderAll();
        showToast((wb?wb.name:'')+' を予定通り完了・'+minutes+'分 / +'+(pageXp+timeXp)+' XP');
        return;
      }
      completeSession(minutes);
      return;
    }
    completeSession(minutes);
  }

  // Recompute/redraw the instant the tab becomes visible again or the window
  // regains focus, so the timer (and completion chime/toast) catches up
  // immediately instead of waiting for the next throttled interval tick.
  document.addEventListener('visibilitychange', function(){
    if(!document.hidden){
      checkDateRollover();
      if(timerRunning) tick();
    }
  });
  window.addEventListener('focus', function(){
    checkDateRollover();
    if(timerRunning) tick();
  });
  window.addEventListener('beforeunload', function(){
    if(timerRunning) saveTimerState();
  });

  // ---------- Render all ----------
  function renderAll(){
    renderTopStats();
    renderStreak();
    renderSubjectList();
    renderSubjectMgmt();
    renderSubjectBreakdown();
    renderTimerSubjectSelect();
    renderGauge();
    renderWeekBars();
    renderTrendChart();
    renderTasks();
    renderHeatmap();
    renderWorkbooks();
    renderWbBadge();
    renderMissionPanel();
    renderFullLog();
    renderTimerDisplay();
  }

  // ---------- init ----------
  loadTimerState();
  renderTimerDisplay();
  renderAll();
  renderClock();
  setInterval(renderClock, 1000);
  if(timerRunning){
    document.getElementById('timerStartBtn').textContent = '⏸ PAUSE';
    timerInterval = setInterval(tick, 1000);
    tick(); // catch up immediately in case time already elapsed while the page/tab was closed
  }
  syncTimerLockState();
  maybeShowDailyStartPrompt();
  window.addEventListener('storage', function(){ /* single-tab app, no-op */ });

})();
