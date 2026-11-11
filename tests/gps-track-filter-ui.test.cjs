const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {parse}=require('node-html-parser');
const source=fs.readFileSync('public/js/tracking/gps-track-ui.js','utf8');
test('movement and observation shortcuts sit beside search inputs; movement team and period share one row',()=>{
  const begin=source.indexOf('panel.innerHTML=`')+'panel.innerHTML=`'.length;
  const page=parse(source.slice(begin,source.indexOf('`;',begin)));
  const search=page.querySelector('.gps-history-search-row');
  assert.ok(search.querySelector('[name=owner]'));
  assert.ok(search.querySelector('[data-mine]'));
  assert.equal(search.querySelector('[type=submit]'),null);
  const selects=page.querySelector('.list-filter-selects');
  assert.ok(selects.querySelector('[name=team]'));assert.ok(selects.querySelector('[name=period]'));
  const dates=page.querySelector('.list-filter-dates');
  assert.equal(dates.querySelectorAll('input').length,5);assert.equal(dates.querySelectorAll('select').length,0);
  const app=parse(fs.readFileSync('public/index.html','utf8'));
  assert.ok(app.querySelector('.obs-search-bar #btn-obs-filter-mine'));
  assert.equal(app.querySelector('#obs-filter-panel #btn-obs-filter-mine'),null);
});
test('typing applies the latest query immediately; mine toggles and reset clears team and period',async()=>{
  const element=value=>({value,handlers:{},addEventListener(type,fn){this.handlers[type]=fn;}});
  const elements={owner:element(''),team:element(''),period:element('all'),day:element('2026-11-11'),month:element('2026-11'),year:element('2026'),rangeStart:element('2026-11-11'),rangeEnd:element('2026-11-11')};
  const reset=element(''),mine=element(''),search=element('');search.elements=elements;
  const requests=[];
  const context={filters:require('../public/js/tracking/gps-track-filters'),search,teamSelect:elements.team,mineButton:mine,
    period:'all',teamId:'',message:{},appliedQuery:{},paintFilterState(){},paintMine(){},periodFields(){},myOwner:()=> 'Kim',
    root:{addEventListener(){}},panel:{querySelector:()=>reset},action:fn=>fn(),setFilterPanelOpen(){},
    loadHistory:async()=>{requests.push(context.appliedQuery);}};
  vm.createContext(context);
  const start=source.indexOf('    async function applyFilters(');
  vm.runInContext(source.slice(start,source.indexOf('    more.addEventListener',start)),context);
  elements.owner.value='K';elements.owner.handlers.input();
  elements.owner.value='Kim';elements.owner.handlers.input();
  assert.deepEqual(requests.map(query=>query.owner),['K','Kim']);
  mine.handlers.click();assert.equal(context.appliedQuery.owner,'');
  mine.handlers.click();assert.equal(context.appliedQuery.owner,'Kim');
  elements.team.value='regional';elements.team.handlers.change();assert.equal(context.appliedQuery.team_id,'regional');
  elements.period.value='day';elements.period.handlers.change();assert.notEqual(context.appliedQuery.from,null);
  await reset.handlers.click();assert.equal(context.appliedQuery.owner,'');assert.equal(context.appliedQuery.team_id,'');assert.equal(context.appliedQuery.from,null);
});
