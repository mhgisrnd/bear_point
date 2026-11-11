(function(root){
  'use strict';
  function numberCircle(index,x,y,selected,current){
    const chosen=index===selected,active=index===current;
    return `<circle cx="${x}" cy="${y}" r="11" fill="${active?(chosen?'#0f9f88':'#e7f7f2'):chosen?'#2563eb':'#fff'}" stroke="${active?'#0f9f88':chosen?'#2563eb':'#71859d'}" stroke-width="1.5"/><text x="${x}" y="${y}" text-anchor="middle" dominant-baseline="central" font-family="system-ui, sans-serif" font-size="11" font-weight="700" fill="${chosen?'#fff':active?'#087f6c':'#243c56'}">${index+1}</text>`;
  }
  function single(index,selected,current){
    return {svg:`<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 26 26">${numberCircle(index,13,13,selected,current)}</svg>`,width:26,height:26};
  }
  function badge(indices,selected,current){
    const wanted=indices.length<=3?indices.slice():[indices[0],selected,current].filter(index=>indices.includes(index));
    const shown=[...new Set(wanted)];
    for(const index of indices){if(shown.length>=3)break;if(!shown.includes(index))shown.push(index);}
    shown.sort((a,b)=>a-b);
    const extra=indices.length-shown.length,extraText='+'+extra;
    const extraWidth=extra?Math.max(28,extraText.length*7+8):0;
    const width=12+shown.length*24+(shown.length-1)*8+(extra?8+extraWidth:0),height=43;
    const circles=shown.map((index,position)=>{
      return numberCircle(index,18+position*32,20,selected,current);
    }).join('');
    const more=extra?`<text x="${width-6-extraWidth/2}" y="20" text-anchor="middle" dominant-baseline="central" font-family="system-ui, sans-serif" font-size="11" font-weight="700" fill="#64748b">${extraText}</text>`:'';
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><path d="M${width/2-5} 35 L${width/2} 42 L${width/2+5} 35" fill="#fff" stroke="#91a6bf" stroke-width="1.2"/><rect x="1" y="3" width="${width-2}" height="33" rx="16" fill="#fff" stroke="#91a6bf" stroke-width="1.2"/>${circles}${more}</svg>`;
    const currentPosition=shown.indexOf(current);
    return {svg,width,height,shown,currentOffsetX:currentPosition<0?0:18+currentPosition*32-width/2};
  }
  function hitIndex(marker,x,y){
    const position=marker.shown.findIndex((index,position)=>Math.hypot(x-(18+position*32),y-20)<=15);
    return position<0?null:marker.shown[position];
  }
  const api={badge,single,hitIndex};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.BearEstimateHistoryMarkers=api;
})(typeof window!=='undefined'?window:globalThis);
