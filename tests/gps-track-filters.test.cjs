const {test}=require('node:test');
const assert=require('node:assert/strict');
const {buildQuery,filter,today,teams}=require('../public/js/tracking/gps-track-filters');
const {createWebRecorder}=require('../public/js/tracking/gps-track-store');

test('day/month/year ranges use Korean midnight and exclusive upper boundaries',()=>{
  const rows=[
    {id:'before',started_at:Date.parse('2026-11-01T14:59:59.999Z')},
    {id:'start',started_at:Date.parse('2026-11-01T15:00:00Z')},
    {id:'end',started_at:Date.parse('2026-11-02T14:59:59.999Z')},
    {id:'after',started_at:Date.parse('2026-11-02T15:00:00Z')}
  ];
  assert.deepEqual(filter(rows,buildQuery({period:'day',day:'2026-11-02'})).map(row=>row.id),['start','end']);
  assert.deepEqual(buildQuery({period:'today'},Date.parse('2026-11-01T16:00:00Z')),buildQuery({period:'day',day:'2026-11-02'}));
  assert.equal(today(Date.parse('2026-12-31T15:00:00Z')),'2027-01-01');
  const december=buildQuery({period:'month',month:'2026-12'});
  assert.equal(december.from,Date.parse('2026-11-30T15:00:00Z'));assert.equal(december.to,Date.parse('2026-12-31T15:00:00Z'));
  const year=buildQuery({period:'year',year:'2026'});
  assert.equal(year.from,Date.parse('2025-12-31T15:00:00Z'));assert.equal(year.to,Date.parse('2026-12-31T15:00:00Z'));
  assert.doesNotThrow(()=>buildQuery({period:'day',day:'2024-02-29'}));
  for(const values of [{period:'day',day:'2026-02-29'},{period:'day',day:''},{period:'month',month:'2026-13'},{period:'year',year:'26'},{period:'other'},{owner:'a'.repeat(101)}])assert.throws(()=>buildQuery(values));
});
test('staff/team filters combine, treat wildcard symbols literally, and retain historical/inactive teams',()=>{
  const rows=[{owner:'Kim %_',team_id:'sancheong',team_name:'산청팀',team_color:'#EA580C'},
    {owner:'Kim',team_id:'gurye',team_name:'구례팀'}, {owner:'테스트',team_id:null},
    {owner:'Kim',team_id:'old_team',team_name:'과거팀'}];
  assert.equal(filter(rows,buildQuery({owner:' KIM ',team_id:'sancheong'})).length,1);
  assert.equal(filter(rows,buildQuery({owner:'%_'})).length,1);
  assert.equal(filter(rows,buildQuery({team_id:'__unassigned__'}))[0].owner,'테스트');
  assert.equal(teams(rows).find(team=>team.id==='old_team').name,'과거팀');
});
test('web history filters the complete set before pagination and exposes the full catalog',async()=>{
  const rows=Array.from({length:72},(_,i)=>({id:String(i),status:'saved',point_count:1,owner:i<40?'산청 담당자':'구례 담당자',team_id:i<40?'sancheong':'gurye',team_name:i<40?'산청팀':'구례팀',started_at:Date.parse('2026-11-02T00:00:00Z')}));
  const recorder=createWebRecorder({navigator:{locks:{request:(_n,_o,fn)=>Promise.resolve(fn(null))}},addEventListener(){}},{list:async()=>rows});
  const query=buildQuery({owner:'구례',team_id:'gurye',period:'day',day:'2026-11-02'});
  const first=await recorder.list(query),second=await recorder.list({...query,offset:30});
  assert.equal(first.total,32);assert.equal(first.items.length,30);assert.equal(second.items.length,2);
  assert.equal(first.teams.length,2);assert.equal(first.items[0].id,'40');
  assert.equal(new Set([...first.items,...second.items].map(row=>row.id)).size,32);
  assert.equal((await recorder.list(buildQuery({owner:'없는 담당자'}))).total,0);
});
