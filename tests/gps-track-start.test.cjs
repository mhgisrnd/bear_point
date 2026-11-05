const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('public/js/tracking/gps-track-ui.js','utf8');
for(const succeeds of [true,false])test(succeeds?'recorder starts independently of map location controls':'cancelled device GPS or permission request preserves the selected route',async()=>{
 let click,error;
 const events=[];
 const context={start:{addEventListener(_name,handler){click=handler;}},action:async fn=>{try{await fn();}catch(e){error=e;}},
 root:{BearAppSettings:{requireIdentity:async()=>({owner:'Tester'}),store:{load:async()=>{},snapshot:()=>({tracking:{interval_seconds:10}})}}},
 ensureGpsEnabled:async()=>{throw Error('map GPS must not be used');},
 plugin:{start:async()=>{events.push('start');if(!succeeds)throw Error('device location cancelled');return {id:'new'};}},
 displayed:{id:'old'},active:null,viewVersion:0,source:{clear(){events.push('clear');}},message:{},native:true,
 show:async()=>{},loadHistory:async()=>{}};
 const begin=source.indexOf("    start.addEventListener('click'");
 vm.runInNewContext(source.slice(begin,source.indexOf("    stop.addEventListener",begin)),context);
 click();await new Promise(resolve=>setImmediate(resolve));
 assert.deepEqual(events,succeeds?['start','clear']:['start']);
 assert.equal(context.displayed?.id,succeeds?undefined:'old');
 assert.equal(error?.message,succeeds?undefined:'device location cancelled');
});
