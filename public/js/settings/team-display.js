(function(root){
  'use strict';
  function resolve(record,teams){
    if(!record)return record;
    const catalog=teams||root.BearAppSettings?.store?.snapshot()?.items||[];
    const team=catalog.find(team=>team.id===record.team_id);
    if(!team)return record;
    return {...record,team_name:team.name,team_color:team.color};
  }
  const api={resolve};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.BearTeamDisplay=api;
})(typeof window==='undefined'?globalThis:window);
