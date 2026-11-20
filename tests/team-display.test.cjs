const {test}=require('node:test');
const assert=require('node:assert/strict');
const {resolve}=require('../public/js/settings/team-display');

test('current team metadata overrides historical display values without changing the saved record',()=>{
  const saved={id:'obs',team_id:'gurye',team_name:'Old name',team_color:'#111111',server_version:4};
  const latest=[{id:'gurye',name:'New name',color:'#123456'}];
  assert.deepEqual(resolve(saved,latest),{...saved,team_name:'New name',team_color:'#123456'});
  assert.equal(saved.team_name,'Old name');assert.equal(saved.team_color,'#111111');
  latest[0]={id:'gurye',name:'Renamed',color:'#ABCDEF'};
  assert.equal(resolve(saved,latest).team_color,'#ABCDEF');
});
test('unassigned or removed teams retain their recorded fallback instead of acquiring another team',()=>{
  const saved={team_id:'removed',team_name:'Recorded',team_color:'#112233'};
  assert.equal(resolve(saved,[]),saved);
  const unassigned={team_color:null};
  assert.equal(resolve(unassigned,[{id:'other',name:'Other',color:'#FFFFFF'}]),unassigned);
  assert.equal(resolve(null,[]),null);
});
