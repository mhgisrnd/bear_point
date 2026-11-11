const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {parse}=require('node-html-parser');
const obs=fs.readFileSync('public/js/obs/obsList.js','utf8');
const gps=fs.readFileSync('public/js/tracking/gps-track-ui.js','utf8');
test('all three app search rows share controls and start with reset disabled',()=>{
  const html=parse(fs.readFileSync('public/index.html','utf8'));
  for(const id of ['search-query','bear-code-query']){
    const row=html.querySelector('#'+id).parentNode;
    assert.ok(row.classList.contains('list-search-row'));
    assert.ok(row.querySelector('input.list-search-input[type=search]'));
    assert.ok(row.querySelector('.list-search-reset').hasAttribute('disabled'));
  }
  const start=gps.indexOf('panel.innerHTML=`')+'panel.innerHTML=`'.length;
  const row=parse(gps.slice(start,gps.indexOf('`;',start))).querySelector('.list-search-row');
  assert.ok(row.querySelector('input.list-search-input[type=search]'));
  assert.ok(row.querySelector('.list-search-reset').hasAttribute('disabled'));
});
test('observation reset follows actual search and filters, ignoring preset hidden dates',()=>{
  const start=obs.indexOf('  function syncFilterControls()');
  const fn=obs.slice(start,obs.indexOf('  function ensureAnalysisOptionsDialog()',start));
  const filters={owner:'',team:'',period:'all'};
  const c={window:{BearObservationFilters:require('../public/js/obs/observation-filters')},readObservationFilters:()=>filters,
    lastRegisteredOwner:()=>'',mineOwnerFilter:'',searchQueryEl:{value:''},btnSearchClearEl:{disabled:false},periodFilterEl:{value:'all'}};
  for(const name of new Set(fn.match(/\b\w+El\b/g)))if(!(name in c))c[name]=null;
  vm.createContext(c);vm.runInContext(fn,c);
  c.syncFilterControls();assert.equal(c.btnSearchClearEl.disabled,true);
  c.searchQueryEl.value='KM';c.syncFilterControls();assert.equal(c.btnSearchClearEl.disabled,false);
  c.searchQueryEl.value='';filters.team='team';c.syncFilterControls();assert.equal(c.btnSearchClearEl.disabled,false);
  filters.team='';filters.period='day';c.syncFilterControls();assert.equal(c.btnSearchClearEl.disabled,false);
  filters.period='all';c.syncFilterControls();assert.equal(c.btnSearchClearEl.disabled,true);
});
test('movement reset follows draft input, filters and busy state',()=>{
  const reset={},c={busy:false,teamId:'',period:'all',search:{elements:{owner:{value:''}}},panel:{querySelector:()=>reset},
    appliedQuery:{},filterPanel:{hidden:true},filterButton:{classList:{toggle(){}}},filterBadge:{}};
  vm.createContext(c);const start=gps.indexOf('    function paintFilterState()');
  vm.runInContext(gps.slice(start,gps.indexOf('    function setFilterPanelOpen(',start)),c);
  c.paintFilterState();assert.equal(reset.disabled,true);
  c.search.elements.owner.value='Kim';c.paintFilterState();assert.equal(reset.disabled,false);
  c.search.elements.owner.value='';c.teamId='team';c.paintFilterState();assert.equal(reset.disabled,false);
  c.teamId='';c.period='range';c.paintFilterState();assert.equal(reset.disabled,false);
  c.period='all';c.paintFilterState();assert.equal(reset.disabled,true);
  c.search.elements.owner.value='Kim';c.busy=true;c.paintFilterState();assert.equal(reset.disabled,true);
});
