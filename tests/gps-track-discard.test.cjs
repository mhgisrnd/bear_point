const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Database=require('better-sqlite3');
const source=fs.readFileSync('android/app/src/main/java/com/bearpoint/app/GpsTrackStore.java','utf8');
function fixture(){
  const db=new Database(':memory:');
  for(const name of ['tracks','points'])db.exec(source.match(new RegExp('db.execSQL\\("(CREATE TABLE '+name+' [^"]+)"'))[1]);
  for(const [id,status] of [['current','recording'],['previous','saved']]){
    db.prepare("INSERT INTO tracks(id,owner,color,interval_seconds,started_at,status,point_count,distance) VALUES(?,'Tester','#2563EB',10,1,?,1,100)").run(id,status);
    db.prepare('INSERT INTO points VALUES(?,1,35,127,1,10)').run(id);
  }
  const block=source.slice(source.indexOf('if ("discarded".equals(status))'),source.indexOf('String emptyError'));
  const sql=[...block.matchAll(/db.execSQL\("([^"]+)"/g)].map(match=>match[1]);
  const discard=db.transaction(id=>{db.prepare(sql[0]).run(id,id);db.prepare(sql[1]).run(2,'discarded',id);});
  return {db,discard};
}
test('discard deletes only the current recording coordinates and excludes it from saved history',()=>{
  const {db,discard}=fixture();
  try{
    discard('current');
    assert.deepEqual(db.prepare('SELECT track_id FROM points').all(),[{track_id:'previous'}]);
    assert.equal(db.prepare("SELECT status FROM tracks WHERE id='current'").get().status,'discarded');
    assert.deepEqual(db.prepare("SELECT id FROM tracks WHERE point_count>0 AND status!='discarded'").all(),[{id:'previous'}]);
    discard('previous');
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM points').get().n,1,'saved records cannot be discarded through this operation');
  }finally{db.close();}
});
test('discard transaction failure preserves coordinates and the active recording for retry',()=>{
  const {db,discard}=fixture();
  try{
    db.exec("CREATE TRIGGER fail_discard BEFORE UPDATE ON tracks BEGIN SELECT RAISE(ABORT,'disk full'); END");
    assert.throws(()=>discard('current'),/disk full/);
    assert.equal(db.prepare("SELECT status FROM tracks WHERE id='current'").get().status,'recording');
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM points WHERE track_id='current'").get().n,1);
  }finally{db.close();}
});
