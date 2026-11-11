const { test } = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const { createAppRealtimeRouter } = require("../src/routes/appRealtimeRoutes");

test('history forwards only a validated entity code and pagination to the history endpoint',async()=>{
  const requests=[];const app=express();
  app.use('/api/app-realtime',createAppRealtimeRouter({apiBase:'https://admin.test/api/realtime',fetchImpl:async(url,options)=>{
    requests.push({url,options});return {status:200,json:async()=>({ok:true,items:[{id:'old',active:false}],total:1})};
  }}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base=`http://127.0.0.1:${server.address().port}/api/app-realtime/bear-estimates/history`;
  try{
    assert.equal((await fetch(base)).status,400);assert.equal(requests.length,0);
    const response=await fetch(base+'?bearCode=MH-001&page=2&pageSize=100');
    assert.equal((await response.json()).items[0].active,false);
    assert.equal(requests[0].url,'https://admin.test/api/realtime/bear-estimates/history?bearCode=MH-001&page=2&pageSize=100');
  }finally{await new Promise(resolve=>server.close(resolve));}
});

test("web uses the same-origin gateway and native retains the configured remote API", () => {
  const source = fs.readFileSync(path.join(__dirname, "../public/js/realtime/realtimeList.js"), "utf8");
  const start = source.indexOf("    function resolveApiBase() {");
  const end = source.indexOf("    const API_BASE", start);
  for (const native of [false, true]) {
    const context = vm.createContext({ options: {}, normalizeApiBase: value => String(value || "").replace(/\/$/, ""),
      isNativeCapacitorRuntime: () => native, window: { BEAR_RUNTIME_CONFIG: { realtimeApiBase: "https://remote.test/api/realtime" } } });
    vm.runInContext(source.slice(start, end), context);
    assert.equal(context.resolveApiBase(), native ? "https://remote.test/api/realtime" : "api/app-realtime");
    context.options.apiBase = "https://override.test/api";
    assert.equal(context.resolveApiBase(), "https://override.test/api");
  }
});

test("gateway forwards remote records and uploads without forwarding browser credentials", async () => {
  const calls = [];
  const router = createAppRealtimeRouter({ apiBase: "https://remote.test/base/api/realtime", fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return { status: 200, json: async () => options.method === "GET" ? { ok: true, items: [{ id: "remote-only" }] } : { ok: true, item: JSON.parse(options.body) } };
  } });
  const app = express(); app.use(express.json()); app.use("/api/app-realtime", router);
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  const url = `http://127.0.0.1:${server.address().port}/api/app-realtime/bear-estimates`;
  try {
    const result = await fetch(url + "?limit=200");
    assert.deepEqual((await result.json()).items, [{ id: "remote-only" }]);
    assert.equal(calls[0].url, "https://remote.test/base/api/realtime/bear-estimates?limit=200");
    const posted = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Cookie: "admin_session=local-only" }, body: JSON.stringify({ id: "estimate-1", lat: 35, lng: 127 }) });
    assert.equal((await posted.json()).item.id, "estimate-1");
    assert.equal(calls[1].options.headers.Cookie, undefined);
    assert.equal(calls[1].options.method, "POST");
    assert.equal((await fetch(url, { method: "DELETE" })).status, 404);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("upstream failure becomes an explicit API error, not an empty successful list", async () => {
  const app = express();
  app.use(createAppRealtimeRouter({ apiBase: "https://remote.test/api/realtime", fetchImpl: async () => { throw new Error("upstream offline"); } }));
  const server = app.listen(0, "127.0.0.1"); await new Promise(resolve => server.once("listening", resolve));
  try {
    const result = await fetch(`http://127.0.0.1:${server.address().port}/bear-estimates`);
    assert.equal(result.status, 502);
    const body = await result.json(); assert.equal(body.ok, false); assert.ok(body.message);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("team gateway reaches administrator catalog beneath the configured context and allows only reads", async () => {
  let request;
  const app=express();app.use('/api/app-realtime',createAppRealtimeRouter({apiBase:'https://admin.test/bear/api/realtime',fetchImpl:async(url,options)=>{
    request={url,options};return {status:200,json:async()=>({ok:true,items:[]})};
  }}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try {
    const url=`http://127.0.0.1:${server.address().port}/api/app-realtime/teams`;
    const result=await fetch(url,{headers:{Cookie:'private-session'}});
    assert.equal(result.status,200);assert.equal(request.url,'https://admin.test/bear/api/teams');
    assert.deepEqual(Object.keys(request.options.headers),['Accept']);
    assert.equal((await fetch(url,{method:'POST'})).status,404);
  } finally {await new Promise(resolve=>server.close(resolve));}
});

test("local web team override does not change realtime or native runtime endpoints", async () => {
  const { getRuntimeConfig } = require('../src/config/runtime-config');
  const config=getRuntimeConfig({APP_API_ENV:'dev',REALTIME_API_BASE_DEV:'https://remote.test/api/realtime',WEB_TEAMS_API_URL:'http://localhost:9090/api/teams'});
  assert.equal(config.realtimeApiBase,'https://remote.test/api/realtime');
  assert.equal(config.webTeamsApiUrl,'http://localhost:9090/api/teams');
  assert.equal(getRuntimeConfig({APP_API_ENV:'dev',REALTIME_API_BASE_DEV:'https://remote.test/base/api/realtime'}).webTeamsApiUrl,'https://remote.test/base/api/teams');
  const calls=[];
  const app=express();app.use(createAppRealtimeRouter({apiBase:config.realtimeApiBase,teamsApiUrl:config.webTeamsApiUrl,fetchImpl:async url=>{
    calls.push(url);return {status:200,json:async()=>({ok:true,items:[]})};
  }}));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  try {
    const base=`http://127.0.0.1:${server.address().port}`;
    await fetch(base+'/teams');await fetch(base+'/bear-estimates');
    assert.equal(calls[0],'http://localhost:9090/api/teams');
    assert.equal(calls[1],'https://remote.test/api/realtime/bear-estimates?limit=200');
    const runtimeSource=fs.readFileSync(path.join(__dirname,'../scripts/generate-runtime-config.js'),'utf8');
    assert.equal(runtimeSource.includes('webTeamsApiUrl'),false);
  } finally {await new Promise(resolve=>server.close(resolve));}
});


test("movement gateway sends GPS records only to its configured administrator endpoint",async()=>{
 const calls=[];const app=express();app.use(express.json({limit:'16mb'}));
 app.use('/api/app-realtime',createAppRealtimeRouter({apiBase:'https://remote.test/api/realtime',movementApiUrl:'https://admin.test/base/api/realtime/movement-tracks',fetchImpl:async(url,options)=>{calls.push({url,options});return {status:200,json:async()=>({ok:true,id:'track'})};}}));
 const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
 const url=`http://127.0.0.1:${server.address().port}/api/app-realtime/movement-tracks`;
 try {
  const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json',Cookie:'local-only'},body:JSON.stringify({id:'track',points:[]})});
  assert.equal(response.status,200);assert.equal(calls[0].url,'https://admin.test/base/api/realtime/movement-tracks');assert.equal(calls[0].options.headers.Cookie,undefined);
  assert.equal((await fetch(url)).status,200);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test("movement gateway forwards anonymous shared reads without credentials", async () => {
  const calls = [], app = express();
  app.use((req, res, next) => { if (req.headers.cookie === "local-admin") req.adminSession = {}; next(); });
  app.use(createAppRealtimeRouter({
    apiBase: "https://admin.test/api/realtime", movementReadKey: "server-only-key",
    fetchImpl: async (url, options) => {
      calls.push({url, options});
      return {status: 200, json: async () => ({ok: true, items: []})};
    }
  }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}/movement-tracks`;
    const headers = {Cookie: "local-admin"};
    assert.equal((await fetch(base + "?page=2", {headers})).status, 200);
    const id = "127ef8a9-9b43-4c4a-8e36-f8dc244a39df";
    assert.equal((await fetch(base + "/" + id, {headers})).status, 200);
    assert.deepEqual(calls.map(call => call.url), [
      "https://admin.test/api/realtime/movement-tracks?page=2",
      "https://admin.test/api/realtime/movement-tracks/" + id
    ]);
    assert.ok(calls.every(call => !call.options.headers.Authorization && !call.options.headers.Cookie));
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test("anonymous web reads use the upstream API without a key", async () => {
  const app=express(), id="127ef8a9-9b43-4c4a-8e36-f8dc244a39df";
  const track={id,started_at:100,points:[{lat:35,lng:127}]};
  let reads=0;
  app.use((req,_res,next)=>{if(req.headers.cookie==='admin')req.adminSession={};next();});
  app.use('/bear/api/app-realtime',createAppRealtimeRouter({
    apiBase:'https://admin.test/api/realtime',
    fetchImpl:async(url)=>{
      reads++;
      if(url.endsWith('/00000000-0000-0000-0000-000000000000'))return {status:404,json:async()=>({ok:false})};
      return {status:200,json:async()=>url.endsWith('/'+id)?track:{ok:true,items:[track],total:1,page:1,pageSize:100}};
    }
  }));
  const server=app.listen(0,'127.0.0.1');
  await new Promise(resolve=>server.once('listening',resolve));
  try{
    const base=`http://127.0.0.1:${server.address().port}/bear/api/app-realtime/movement-tracks`;
    const headers={};
    const page=await fetch(base,{headers});
    assert.equal(page.headers.get('Cache-Control'),'no-store');
    assert.equal((await page.json()).items[0].id,id);
    assert.deepEqual((await (await fetch(base+'/'+id,{headers})).json()).points,track.points);
    assert.equal((await fetch(base+'/00000000-0000-0000-0000-000000000000',{headers})).status,404);
  }finally{await new Promise(resolve=>server.close(resolve));}
});
