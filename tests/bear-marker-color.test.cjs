const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {merge}=require('../public/js/realtime/bear-estimate-store');

test('local and shared bear markers use the estimation method for labels and pulse rings',async()=>{
  const [Feature,Point,Vector,Style,Icon,Text,Fill,Stroke,Circle]=await Promise.all([
    'ol/Feature.js','ol/geom/Point.js','ol/source/Vector.js','ol/style/Style.js','ol/style/Icon.js',
    'ol/style/Text.js','ol/style/Fill.js','ol/style/Stroke.js','ol/style/Circle.js'
  ].map(path=>import(path).then(module=>module.default)));
  const source=fs.readFileSync('public/js/client-ol.js','utf8');
  // Avoid image loading in Node; the styles and circles below are actual OpenLayers objects.
  const context=vm.createContext({ol:{Feature,geom:{Point},style:{Style,Icon:class extends Icon{constructor(options){super({...options,src:undefined,img:{width:34,height:34,src:'bear'},imgSize:[34,34]});}},Text,Fill,Stroke,Circle}},
    bearMarkerSource:new Vector(),mapCoordFromWgs84:(lat,lng)=>[lng,lat],buildBearEstimatePopupHtml:()=>'',
    BEAR_LABEL_OFFSET_Y:12,realtimeBearMarkerPulse:.5,startBearMarkerAnimation(){},stopBearMarkerAnimation(){}});
  const helpers=source.indexOf('  function parseBearEstimateJson(');
  vm.runInContext(source.slice(helpers,source.indexOf('  // 웹 환경에서 bears.json',helpers)),context);
  const start=source.indexOf('  const BEAR_MARKER_PALETTE');
  const end=source.indexOf('  // CAPTURE_MOCK',start);
  vm.runInContext(source.slice(start,end),context);
  const mapping=source.indexOf('  function mapBearMarkerItems(');
  vm.runInContext(source.slice(mapping,source.indexOf('  function readBearPeriodFilter(',mapping)),context);
  const colors=['#C24A00','#1D4ED8'];
  for(const [count,method] of [[1,null],[2,null],[3,null],[4,null],[5,null],[8,null],[3,'single'],[1,'intersection']]){
    const color=colors[(method==='single'||(!method&&count===1))?0:1];
    const observations=Array.from({length:count},(_,index)=>({id:String(index)}));
    const rows=merge([
      {id:'local',bear_code:'KF-58',lat:35,lng:127,team_color:'#000000',estimation_method:method,source_observations:observations},
      {id:'local-shared',bear_code:'KF-59',lat:35,lng:127.5,team_color:'#FFFFFF',estimation_method:method,source_observation_ids:JSON.stringify(observations.map(obs=>obs.id))}
    ],[
      {id:'remote-1',bear_estimate_id:'shared',bear_code:'KF-47',lat:35,lng:128,team_color:'#DEDEDE',
        source_observations:[],payload:{estimation_method:method,source_observations_json:JSON.stringify(observations)}},
      {id:'remote-2',bear_estimate_id:'local-shared',bear_code:'KF-59',lat:35,lng:127.5,source_observations:[]}
    ]);
    context.renderBearMarkers(context.mapBearMarkerItems(rows,false));
    const byId=id=>context.bearMarkerSource.getFeatures().find(feature=>feature.get('bearEstimateData').id===id);
    const local=byId('local'),shared=byId('shared'),localShared=byId('local-shared');
    const expected=context.bearMarkerTint(color,.95);
    assert.equal(local.getStyle().getText().getBackgroundFill().getColor(),expected);
    assert.equal(local.getStyle().getText().getFill().getColor(),'#ffffff');
    const styles=shared.getStyleFunction()();
    assert.equal(styles[2].getText().getBackgroundFill().getColor(),expected);
    assert.equal(styles[2].getText().getFill().getColor(),'#ffffff');
    assert.equal(styles[1].getImage().getStroke().getColor(),context.bearMarkerTint(color,.8));
    assert.equal(styles[0].getImage().getStroke().getColor(),context.bearMarkerTint(color,.32+.5*.28));
    const localSharedStyles=localShared.getStyleFunction()();
    assert.equal(localSharedStyles.length,3);
    assert.equal(localSharedStyles[0].getImage().getStroke().getColor(),styles[0].getImage().getStroke().getColor());
    assert.equal(localSharedStyles[2].getText().getBackgroundFill().getColor(),expected);
  }
  assert.equal(context.bearMarkerColor({estimation_method:'single'}),colors[0]);
  assert.equal(context.bearMarkerColor({source_observations:[],source_observations_json:'[{},{}]'}),colors[1]);
  assert.equal(context.bearMarkerColor({source_observation_ids:'bad json',analysis_rays:[{},{},{}]}),colors[1]);
  assert.equal(context.bearMarkerColor({intersections_count:3,team_color:'#DEDEDE'}),colors[1]);
  assert.equal(context.bearMarkerColor({}), '#526174');
  assert.equal(context.bearMarkerColor({estimation_method:'single',source_observations:[{},{}]}),colors[0]);
  assert.equal(context.bearMarkerColor({estimation_method:'intersection',source_observations:[{}]}),colors[1]);
  assert.equal(context.bearMarkerColor({analysis_options_json:JSON.stringify({estimationMethod:'single'}),source_observations:[{},{}]}),colors[0]);
});

test('the map legend keeps all catalogue teams and unassigned visible across menu and selection changes', () => {
  const { parse } = require('node-html-parser');
  const { DEFAULT_TEAMS } = require('../public/js/settings/app-settings-store');
  const html = parse(fs.readFileSync('public/index.html', 'utf8'));
  const getElement = id => html.querySelector('#' + id);
  const button = getElement('btn-map-legend');
  const details = getElement(button.getAttribute('aria-controls'));
  const disclosure = getElement('map-legend-disclosure');
  const list = getElement('bear-marker-legend-items');
  const teamList = getElement('observation-legend-items');
  assert.equal(html.querySelector('#map').querySelector('#btn-map-legend'), button);
  assert.equal(button.tagName, 'SUMMARY');
  assert.equal(disclosure.tagName, 'DETAILS');
  assert.equal(disclosure.hasAttribute('open'), false);
  assert.equal(disclosure.querySelector('#map-marker-legend'),details);
  disclosure.open = false;
  disclosure.contains = target => {
    for (let node = target; node; node = node.parentNode) if (node === disclosure) return true;
    return false;
  };
  for (const element of [button, disclosure]) {
    element.on = {};
    element.addEventListener = (event, listener) => { element.on[event] = listener; };
  }
  for (const element of [list, teamList]) {
    element.replaceChildren = (...items) => { element.set_content(''); items.forEach(item => element.appendChild(item)); };
  }
  let catalog = [], back;
  const events = {}, documentEvents = {};
  const context = vm.createContext({
    document: {
      getElementById: getElement,
      addEventListener:(name, listener, capture)=>{assert.equal(capture,true);documentEvents[name]=listener;},
      createElement: tag => {
        const item = parse('<' + tag + '></' + tag + '>').firstChild;
        item.style = { setProperty(name, value) { item.setAttribute('style', name + ':' + value); } };
        return item;
      }
    },
    window: {
      BearAppSettingsStore:{DEFAULT_TEAMS},
      BearAppSettings:{store:{snapshot:()=>({items:catalog})}},
      addEventListener:(name, listener)=>{events[name]=listener;}
    },
    map:{getOverlayContainerStopEvent:()=>({appendChild:element=>assert.equal(element,disclosure)})},
    observationMarkerLayer:{on:()=>assert.fail('The legend should not track layer visibility')},
    observationMarkerSource:{on:()=>assert.fail('The legend should not track observation selection')},
    getEstimationMethodLabel: item => item.estimation_method === 'single' ? '\uB2E8\uC77C \uAD00\uCE21' : '\uAD50\uCC28 \uBD84\uC11D',
    OBSERVATION_NO_TEAM_COLOR:'#7e90a2',
    OBSERVATION_HEADING_ICON_SIZE:40,
    registerBackClosableOverlay:(_,callback)=>{back=callback;return ()=>{back=null;};}
  });
  const source = fs.readFileSync('public/js/client-ol.js', 'utf8');
  vm.runInContext(source.slice(source.indexOf('  function createHeadingIconDataUri('), source.indexOf('  function createMyLocationIconDataUri(')), context);
  vm.runInContext(source.slice(source.indexOf('  function getObservationTeamColor('), source.indexOf('  function createObservationStyleFromMarker(')), context);
  vm.runInContext(source.slice(source.indexOf('  const BEAR_MARKER_PALETTE'), source.indexOf('  function bearMarkerTint')), context);
  context.initializeMapMarkerLegend();
  assert.deepEqual(list.querySelectorAll('li').map(item => item.textContent), ['\uAD50\uCC28 \uBD84\uC11D', '\uB2E8\uC77C \uAD00\uCE21']);
  assert.deepEqual(list.querySelectorAll('li').map(item => item.getAttribute('style')),
    ['intersection','single'].map(estimation_method => '--map-legend-swatch:' + context.bearMarkerColor({ estimation_method })));
  assert.deepEqual(list.querySelectorAll('img').map(icon => icon.getAttribute('src')),
    ['#1D4ED8','#C24A00'].map(color=>context.createBearMarkerIconDataUri(color)));
  for(const color of ['#1D4ED8','#C24A00']){
    const uri=context.createBearMarkerIconDataUri(color);
    const svg=decodeURIComponent(uri.split(',')[1]);
    assert.ok(svg.includes('fill="'+color+'"'));
    assert.match(svg,/fill="#242827"/);
    assert.doesNotMatch(svg,/<image|base64/);
    assert.equal(context.createBearMarkerIconDataUri(color),uri);
  }
  const setOpen = value => { disclosure.open = value; disclosure.on.toggle(); };
  setOpen(true);
  assert.equal(disclosure.open, true);
  const teams = () => teamList.querySelectorAll('li').map(item => [item.textContent, item.getAttribute('style')]);
  const expected = [...DEFAULT_TEAMS, {name:'미지정',color:'#7e90a2'}];
  assert.deepEqual(teams(), expected.map(team => [team.name,'--map-legend-swatch:' + team.color]));
  assert.deepEqual(teamList.querySelectorAll('img').map(icon => icon.getAttribute('src')),
    expected.map(team => context.createHeadingIconDataUri(40,team.color,5.5)));
  assert.equal(getElement('observation-legend-title').textContent, '관측점');
  catalog = [{...DEFAULT_TEAMS[0],color:'#B91C1C'}];
  events['bearpoint:teams-changed']();
  assert.deepEqual(teams(), expected.map((team,index) => [team.name,'--map-legend-swatch:' + (index===0?'#B91C1C':team.color)]));
  documentEvents.pointerdown({target:teamList.querySelector('li')});
  assert.equal(disclosure.open, true);
  documentEvents.pointerdown({target:getElement('map')});
  assert.equal(disclosure.open, false);
  setOpen(true);
  back();
  assert.equal(disclosure.open, false);
  setOpen(true);
  setOpen(false);
  assert.equal(disclosure.open, false);
});
