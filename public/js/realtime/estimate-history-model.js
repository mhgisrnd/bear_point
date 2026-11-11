(function(root){
  'use strict';
  function timestamp(value){
    if(!value)return NaN;
    let text=String(value).trim();
    if(/^\d{4}-\d\d-\d\d[ T]\d\d:\d\d/.test(text)&&!/(Z|[+-]\d\d:?\d\d)$/i.test(text))text=text.replace(' ','T')+'+09:00';
    return new Date(text).getTime();
  }
  function normalize(rows){
    const items=new Map();
    for(const row of rows||[]){
      if(row.id==null||row.lat==null||row.lat===''||(row.lng??row.lon)==null||(row.lng??row.lon)==='')continue;
      const lat=Number(row.lat),lng=Number(row.lng??row.lon),time=timestamp(row.created_at||row.source_created_at||row.createdAt||row.uploaded_at);
      if(row.deleted||row._cacheDeleted||row.use_yn===false||!Number.isFinite(lat)||!Number.isFinite(lng)||Math.abs(lat)>90||Math.abs(lng)>180||!Number.isFinite(time))continue;
      const key=String(row.id);
      const options=typeof row.analysis_options==='object'?row.analysis_options:{};
      const method=row.estimation_method||options?.estimationMethod;
      items.set(key,{...row,id:key,lat,lng,time,iso:new Date(time).toISOString(),method:method==='single'?'single':method==='intersection'||Number(row.intersections_count)>0?'intersection':'unknown'});
    }
    return [...items.values()].sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id,undefined,{numeric:true}));
  }
  function filter(rows,period,filters){return rows.filter(row=>filters.matchesPeriod(row.iso,period));}
  function groupPoints(points,resolution,distance=36){
    const size=Math.max(Number(resolution)||1,Number.EPSILON)*distance;
    const groups=[],buckets=new Map();
    for(let index=points.length-1;index>=0;index--){
      const point=points[index],x=Math.floor(point[0]/size),y=Math.floor(point[1]/size);
      let nearest=null,best=size;
      for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)for(const group of buckets.get((x+dx)+','+(y+dy))||[]){
        const separation=Math.hypot(point[0]-group.coordinate[0],point[1]-group.coordinate[1]);
        if(separation<=best){best=separation;nearest=group;}
      }
      if(nearest)nearest.indices.push(index);
      else{
        const group={coordinate:point,indices:[index]};groups.push(group);
        const key=x+','+y;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(group);
      }
    }
    for(const group of groups)group.indices.sort((a,b)=>a-b);
    return groups;
  }
  const api={normalize,filter,timestamp,groupPoints};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.BearEstimateHistoryModel=api;
})(typeof window!=='undefined'?window:globalThis);
