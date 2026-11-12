const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('public/js/tracking/gps-track-ui.js','utf8');
function commands(){
  let state=null,starts=0,stops=0;
  const errors=[],toasts=[],events=[];
  const context={native:true,active:null,displayed:{id:'previous-route'},initial:false,busy:false,recordingOperation:0,recordingTarget:null,viewVersion:0,
    start:{addEventListener(){}},stop:{addEventListener(){}},paint(){},message:{},source:{clear:()=>events.push('clear')},
    root:{__bpShowToast:text=>toasts.push(text),BearAppSettings:{requireIdentity:async()=>({owner:'Tester'}),store:{load:async()=>{},snapshot:()=>({tracking:{interval_seconds:10}})}}},
    plugin:{status:async()=>({active:state}),start:async()=>{starts++;state={id:'new',point_count:0};return state;},stop:async()=>{stops++;state=null;return {id:'new',status:'saved'};}},
    show:async()=>{},loadHistory:async()=>{},syncRecords(){}};
  context.action=async fn=>{if(context.busy)return;context.busy=true;try{await fn();}catch(error){errors.push(error.message);}finally{context.busy=false;}};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('    async function startRecording('),source.indexOf('    function close()')),context);
  return {context,errors,toasts,events,starts:()=>starts,stops:()=>stops,setState:value=>state=value};
}
test('quick ON/OFF shares start/save commands without opening a list and checks the native state',async()=>{
  const f=commands();await f.context.setRecording(true);
  assert.equal(f.context.active.id,'new');assert.equal(f.starts(),1);assert.match(f.toasts[0],/기록을 시작/);
  await f.context.setRecording(true);assert.equal(f.starts(),1,'already running must not start twice');
  await f.context.setRecording(false);assert.equal(f.context.active,null);assert.equal(f.stops(),1);assert.match(f.toasts[1],/저장/);
  await f.context.setRecording(false);assert.equal(f.stops(),1,'already stopped through system notification must not stop twice');
});
test('denied permission keeps OFF and preserves the previously displayed route',async()=>{
  const f=commands();f.context.plugin.start=async()=>{throw Error('permission denied');};
  await f.context.setRecording(true);
  assert.equal(f.context.active,null);assert.equal(f.context.displayed.id,'previous-route');assert.deepEqual(f.events,[]);
  assert.deepEqual(f.errors,['permission denied']);assert.equal(f.context.busy,false);assert.equal(f.context.recordingTarget,null);
});
test('saving failure keeps ON; rapid repeated presses cannot duplicate a pending start',async()=>{
  const f=commands();let release,calls=0;
  f.context.plugin.start=async()=>{calls++;await new Promise(resolve=>release=resolve);const value={id:'new'};f.setState(value);return value;};
  const first=f.context.setRecording(true);await new Promise(resolve=>setImmediate(resolve));
  await f.context.setRecording(true);assert.equal(calls,1);release();await first;
  f.context.plugin.stop=async()=>({id:'new',status:'recording',save_error:'저장 공간이 부족합니다'});
  await f.context.setRecording(false);assert.equal(f.context.active.id,'new');assert.match(f.errors[0],/저장 공간/);
  assert.equal(f.context.recordingTarget,null);
});
test('a status response started before a recording operation cannot overwrite the new state',async()=>{
  let resolve;const context={polling:false,busy:false,recordingOperation:0,document:{hidden:false},plugin:{status:()=>new Promise(done=>resolve=done)},active:{id:'new'}};
  vm.createContext(context);
  const begin=source.indexOf('    async function poll()');
  vm.runInContext(source.slice(begin,source.indexOf('    async function startRecording(',begin)),context);
  const pending=context.poll();context.recordingOperation++;resolve({active:null});await pending;
  assert.equal(context.active.id,'new');assert.equal(context.polling,false);
});
test('native switch renders actual states; web displays the design without enabling recording',()=>{
  const attributes={},events={},state={};let appended=0;
  const button={disabled:false,dataset:{},setAttribute:(key,value)=>attributes[key]=value,querySelector:()=>state,addEventListener:(name,fn)=>events[name]=fn};
  const root={},document={createElement:()=>button,getElementById:()=>({append:()=>appended++})},changes=[];
  vm.runInNewContext(fs.readFileSync('public/js/tracking/gps-recording-toggle.js','utf8'),{window:root,document});
  const preview=root.BearGpsRecordingToggle.create({native:false,onChange:value=>changes.push(value)});assert.equal(appended,1);
  preview.render({active:null,busy:false,ready:true});events.click();
  assert.equal(state.textContent,'OFF');assert.equal(button.disabled,true);assert.equal(changes.length,0);assert.match(button.title,/앱에서/);
  const control=root.BearGpsRecordingToggle.create({native:true,onChange:value=>changes.push(value)});
  control.render({active:null,busy:false,ready:false});events.click();assert.equal(changes.length,0);
  control.render({active:null,busy:false,ready:true});events.click();assert.deepEqual(changes,[true]);assert.equal(state.textContent,'OFF');
  control.render({active:{point_count:0},busy:false,ready:true});assert.equal(attributes['aria-checked'],'true');assert.equal(button.dataset.waiting,'true');assert.match(button.title,/GPS/);
  events.click();assert.deepEqual(changes,[true,false]);
  control.render({active:{point_count:1},busy:true,ready:true,pending:false});assert.equal(state.textContent,'저장 중');events.click();assert.equal(changes.length,2);
  control.render({active:{point_count:1},busy:true,ready:true});assert.equal(state.textContent,'확인 중');
});
