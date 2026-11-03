package com.bearpoint.app;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import android.location.Location;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.util.UUID;

/** Owned by the native recorder, independent of the WebView/Capacitor connection. */
final class GpsTrackStore extends SQLiteOpenHelper {
    private static GpsTrackStore instance;
    static synchronized GpsTrackStore get(Context context) {
        if (instance == null) instance = new GpsTrackStore(context.getApplicationContext());
        return instance;
    }
    private GpsTrackStore(Context context) { super(context, "GpsTracks.db", null, 2); }
    @Override public void onCreate(SQLiteDatabase db) {
        db.execSQL("CREATE TABLE tracks (id TEXT PRIMARY KEY, owner TEXT NOT NULL, team_id TEXT, team_name TEXT, team_color TEXT, color TEXT NOT NULL, interval_seconds INTEGER NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER, status TEXT NOT NULL, distance REAL NOT NULL DEFAULT 0, point_count INTEGER NOT NULL DEFAULT 0, error TEXT)");
        db.execSQL("CREATE TABLE points (track_id TEXT NOT NULL, seq INTEGER NOT NULL, lat REAL NOT NULL, lng REAL NOT NULL, recorded_at INTEGER NOT NULL, accuracy REAL NOT NULL, PRIMARY KEY(track_id,seq))");
        indexes(db);
    }
    private void indexes(SQLiteDatabase db) {
        db.execSQL("CREATE INDEX IF NOT EXISTS tracks_started_idx ON tracks(started_at DESC)");
        db.execSQL("CREATE INDEX IF NOT EXISTS tracks_team_started_idx ON tracks(team_id,started_at DESC)");
    }
    @Override public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) { if(oldVersion<2)indexes(db); }
    synchronized JSObject create(JSObject options) throws Exception {
        if (active() != null) throw new IllegalStateException("이미 이동 기록이 진행 중입니다.");
        String id = UUID.randomUUID().toString();
        ContentValues values = new ContentValues();
        for (String key : new String[]{"owner", "team_id", "team_name", "team_color", "color"}) values.put(key, options.getString(key));
        values.put("id", id); values.put("interval_seconds", options.getInt("interval_seconds"));
        values.put("started_at", System.currentTimeMillis()); values.put("status", "recording");
        getWritableDatabase().insertOrThrow("tracks", null, values); return detail(id, false);
    }
    synchronized void finish(String id, String status, String error) {
        String emptyError=(error==null?"":error+" ")+"GPS 위치가 수신되지 않아 기록을 저장하지 않았습니다.";
        getWritableDatabase().execSQL("UPDATE tracks SET status=CASE WHEN point_count=0 THEN 'discarded' ELSE ? END,ended_at=?,error=CASE WHEN point_count=0 THEN ? ELSE ? END WHERE id=? AND status='recording'",new Object[]{status,System.currentTimeMillis(),emptyError,error,id});
    }
    synchronized void recover() {
        if (GpsTrackService.running()) return;
        getWritableDatabase().execSQL("UPDATE tracks SET status=CASE WHEN point_count=0 THEN 'discarded' ELSE 'interrupted' END,ended_at=COALESCE((SELECT MAX(recorded_at) FROM points WHERE track_id=tracks.id),started_at),error=CASE WHEN point_count=0 THEN 'GPS 위치가 수신되지 않아 기록을 저장하지 않았습니다.' ELSE '기록 서비스가 중단되었습니다. 저장된 경로는 유지됩니다.' END WHERE status='recording'");
    }
    synchronized JSObject active() throws Exception {
        try (Cursor cursor = getReadableDatabase().rawQuery("SELECT id FROM tracks WHERE status='recording' LIMIT 1", null)) {
            return cursor.moveToFirst() ? detail(cursor.getString(0), false) : null;
        }
    }
    synchronized JSObject list(int offset, String owner, String team, Long from, Long to) throws Exception {
        java.util.ArrayList<String> clauses=new java.util.ArrayList<>(),args=new java.util.ArrayList<>();
        clauses.add("point_count>0 AND status!='discarded'");
        if(!owner.isEmpty()){clauses.add("instr(lower(owner),lower(?))>0");args.add(owner);}
        if("__unassigned__".equals(team))clauses.add("(team_id IS NULL OR team_id='')");
        else if(!team.isEmpty()){clauses.add("team_id=?");args.add(team);}
        if(from!=null){clauses.add("started_at>=?");args.add(String.valueOf(from));}
        if(to!=null){clauses.add("started_at<?");args.add(String.valueOf(to));}
        String where=clauses.isEmpty()?"":" WHERE "+android.text.TextUtils.join(" AND ",clauses);
        long total;
        try(Cursor cursor=getReadableDatabase().rawQuery("SELECT COUNT(*) FROM tracks"+where,args.toArray(new String[0]))){cursor.moveToFirst();total=cursor.getLong(0);}
        args.add(String.valueOf(offset));JSArray rows = new JSArray();
        try (Cursor cursor = getReadableDatabase().rawQuery("SELECT * FROM tracks"+where+" ORDER BY started_at DESC,id DESC LIMIT 30 OFFSET ?", args.toArray(new String[0]))) {
            while (cursor.moveToNext()) rows.put(row(cursor));
        }
        JSArray teams=new JSArray();java.util.HashSet<String> ids=new java.util.HashSet<>();
        try(Cursor cursor=getReadableDatabase().rawQuery("SELECT team_id,team_name,team_color FROM tracks WHERE point_count>0 AND status!='discarded' ORDER BY started_at DESC,id DESC",null)){
            while(cursor.moveToNext()){
                String id=cursor.isNull(0)||cursor.getString(0).isEmpty()?"__unassigned__":cursor.getString(0);
                if(ids.add(id))teams.put(new JSObject().put("id",id).put("name",cursor.isNull(1)?"미지정":cursor.getString(1)).put("color",cursor.isNull(2)?"#7e90a2":cursor.getString(2)));
            }
        }
        return new JSObject().put("items",rows).put("total",total).put("teams",teams);
    }
    private JSObject row(Cursor cursor) throws Exception {
        JSObject result = new JSObject();
        for (int i = 0; i < cursor.getColumnCount(); i++) {
            if (cursor.isNull(i)) result.put(cursor.getColumnName(i), org.json.JSONObject.NULL);
            else if (cursor.getType(i) == Cursor.FIELD_TYPE_INTEGER) result.put(cursor.getColumnName(i), cursor.getLong(i));
            else if (cursor.getType(i) == Cursor.FIELD_TYPE_FLOAT) result.put(cursor.getColumnName(i), cursor.getDouble(i));
            else result.put(cursor.getColumnName(i), cursor.getString(i));
        }
        return result;
    }
    synchronized JSObject detail(String id, boolean points) throws Exception {
        JSObject result;
        try (Cursor cursor = getReadableDatabase().rawQuery("SELECT * FROM tracks WHERE id=?", new String[]{id})) {
            if (!cursor.moveToFirst()) throw new IllegalArgumentException("기록을 찾을 수 없습니다.");
            result = row(cursor);
        }
        if (points) {
            JSArray coordinates = new JSArray();
            try (Cursor cursor = getReadableDatabase().rawQuery("SELECT lat,lng,recorded_at,accuracy FROM points WHERE track_id=? ORDER BY seq", new String[]{id})) {
                while (cursor.moveToNext()) coordinates.put(new JSObject().put("lat",cursor.getDouble(0)).put("lng",cursor.getDouble(1)).put("recorded_at",cursor.getLong(2)).put("accuracy",cursor.getDouble(3)));
            }
            result.put("points", coordinates);
        }
        return result;
    }
    synchronized boolean append(String id, Location location) throws Exception {
        if (!location.hasAccuracy() || location.getAccuracy() > 100 || location.getAccuracy() < 0) return false;
        if (!Double.isFinite(location.getLatitude()) || !Double.isFinite(location.getLongitude()) || Math.abs(location.getLatitude()) > 90 || Math.abs(location.getLongitude()) > 180) return false;
        if (Math.abs(System.currentTimeMillis() - location.getTime()) > 60000) return false;
        JSObject track = detail(id, false);
        if (!"recording".equals(track.getString("status"))) return false;
        int count = track.getInt("point_count"); double distance = 0;
        try (Cursor last = getReadableDatabase().rawQuery("SELECT lat,lng,recorded_at,accuracy FROM points WHERE track_id=? ORDER BY seq DESC LIMIT 1", new String[]{id})) {
            if (last.moveToFirst()) {
                long delta = location.getTime() - last.getLong(2);
                if (delta < track.getInt("interval_seconds") * 1000L) return false;
                float[] measured = new float[1]; Location.distanceBetween(last.getDouble(0), last.getDouble(1), location.getLatitude(), location.getLongitude(), measured);
                if (measured[0] / (delta / 1000.0) > 60) return false;
                if(measured[0]<=Math.max(5,Math.max(last.getDouble(3),location.getAccuracy())))return false;
                distance = measured[0];
            }
        }
        SQLiteDatabase db = getWritableDatabase(); db.beginTransaction();
        try {
            ContentValues point = new ContentValues(); point.put("track_id",id); point.put("seq",count);
            point.put("lat",location.getLatitude()); point.put("lng",location.getLongitude());
            point.put("recorded_at",location.getTime()); point.put("accuracy",location.getAccuracy());
            db.insertOrThrow("points",null,point);
            db.execSQL("UPDATE tracks SET distance=distance+?, point_count=point_count+1 WHERE id=?", new Object[]{distance,id});
            db.setTransactionSuccessful();
        } finally { db.endTransaction(); }
        return true;
    }
}
