(function(root){
  'use strict';
  const KST=9*60*60*1000;
  const today=(now=Date.now())=>new Date(now+KST).toISOString().slice(0,10);
  function boundary(year,month=1,day=1){return Date.UTC(year,month-1,day)-KST;}
  function buildQuery(value={},now=Date.now()){
    const owner=String(value.owner||'').trim(),team_id=String(value.team_id||'');
    if(owner.length>100|| (team_id&&!/^[a-zA-Z0-9_-]{1,100}$/.test(team_id)))throw new Error('검색 조건을 확인해주세요.');
    let from=null,to=null;
    const period=value.period||'all';
    if(period==='today'||period==='day'){
      const date=period==='today'?today(now):String(value.day||'');
      if(!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('조회할 날짜를 선택해주세요.');
      const [y,m,d]=date.split('-').map(Number);from=boundary(y,m,d);
      if(y<1900||y>9999||today(from)!==date)throw new Error('올바른 날짜를 선택해주세요.');
      to=from+86400000;
    }else if(period==='month'){
      const month=String(value.month||'');if(!/^\d{4}-\d{2}$/.test(month))throw new Error('조회할 월을 선택해주세요.');
      const [y,m]=month.split('-').map(Number);if(y<1900||y>9999||m<1||m>12)throw new Error('올바른 월을 선택해주세요.');
      from=boundary(y,m);to=boundary(y,m+1);
    }else if(period==='year'){
      const year=String(value.year||'');if(!/^\d{4}$/.test(year)||Number(year)<1900)throw new Error('조회할 연도를 4자리로 입력해주세요.');
      from=boundary(Number(year));to=boundary(Number(year)+1);
    }else if(period!=='all')throw new Error('조회 기간을 확인해주세요.');
    return {owner,team_id,from,to};
  }
  function filter(rows,query={}){
    const owner=String(query.owner||'').trim().toLowerCase();
    return rows.filter(row=>(!owner||String(row.owner||'').toLowerCase().includes(owner))
      &&(!query.team_id||(query.team_id==='__unassigned__'?!row.team_id:row.team_id===query.team_id))
      &&(query.from==null||row.started_at>=query.from)&&(query.to==null||row.started_at<query.to));
  }
  function teams(rows){
    const result=new Map();
    for(const row of rows){const id=row.team_id||'__unassigned__';if(!result.has(id))result.set(id,{id,name:row.team_name||'미지정',color:row.team_color||'#7e90a2'});}
    return [...result.values()];
  }
  // Match the native/admin history order: recording start time, then ID, newest first.
  function sortHistory(rows){
    return [...rows].sort((a,b)=>{
      const time=Number(b.started_at)-Number(a.started_at);
      if(Number.isFinite(time)&&time!==0)return time;
      const left=String(a.id),right=String(b.id);
      return left===right?0:left<right?1:-1;
    });
  }
  const api={today,buildQuery,filter,teams,sortHistory};if(typeof module==='object'&&module.exports)module.exports=api;else root.BearGpsTrackFilters=api;
})(typeof window==='object'?window:globalThis);
