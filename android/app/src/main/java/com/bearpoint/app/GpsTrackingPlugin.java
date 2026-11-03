package com.bearpoint.app;

import android.Manifest;
import android.location.LocationManager;
import android.content.Context;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import com.getcapacitor.*;
import com.getcapacitor.annotation.*;

@CapacitorPlugin(name="GpsTracking", permissions={
    @Permission(strings={Manifest.permission.ACCESS_FINE_LOCATION,Manifest.permission.ACCESS_COARSE_LOCATION},alias="location"),
    @Permission(strings={Manifest.permission.POST_NOTIFICATIONS},alias="notifications")
})
public final class GpsTrackingPlugin extends Plugin {
    private boolean starting;
    private final Handler main = new Handler(Looper.getMainLooper());
    @Override public void load() { GpsTrackService.prepare(getContext()); GpsTrackStore.get(getContext()).recover(); }
    private GpsTrackStore store() { return GpsTrackStore.get(getContext()); }
    @PluginMethod public void start(PluginCall call) {
        if (starting || GpsTrackService.running()) { call.reject("이미 이동 기록을 시작했거나 진행 중입니다."); return; }
        starting = true;
        if (getPermissionState("location") != PermissionState.GRANTED) requestPermissionForAlias("location",call,"locationResult");
        else locationResult(call);
    }
    @PermissionCallback private void locationResult(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) { starting=false; call.reject("이동 기록에 정확한 위치 권한이 필요합니다."); return; }
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) requestPermissionForAlias("notifications",call,"notificationResult");
        else notificationResult(call);
    }
    @PermissionCallback private void notificationResult(PluginCall call) {
        main.post(() -> {
            String created = null;
            try {
                if (!GpsTrackService.notificationsAllowed(getContext())) throw new IllegalStateException("기록 중 상태와 종료 버튼을 표시하려면 알림을 허용해주세요.");
                LocationManager manager = (LocationManager)getContext().getSystemService(Context.LOCATION_SERVICE);
                if (!manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) throw new IllegalStateException("휴대폰 GPS 위치 기능을 켜주세요.");
                String owner = call.getString("owner","").trim(), team = call.getString("team_id","");
                String color = call.getString("color","#2563EB"); int interval = call.getInt("interval_seconds",10);
                if (owner.isEmpty() || owner.length()>100 || !team.matches("[a-zA-Z0-9_-]{1,100}") || !color.matches("#[0-9a-fA-F]{6}") || !(interval==5||interval==10||interval==30||interval==60)) throw new IllegalArgumentException("담당자·팀과 이동 기록 설정을 확인해주세요.");
                store().recover();
                JSObject track = store().create(call.getData()); created = track.getString("id");
                GpsTrackService.launch(getContext(),created); call.resolve(track);
            } catch (Exception error) {
                if (created != null) { try { store().finish(created,"interrupted",error.getMessage()); } catch (RuntimeException ignored) {} }
                call.reject(error.getMessage());
            } finally { starting=false; }
        });
    }
    @PluginMethod public void stop(PluginCall call) {
        main.post(() -> {
            try {
                if (!GpsTrackService.running()) store().recover();
                JSObject track = store().active();
                GpsTrackService.stop();
                call.resolve(track == null ? new JSObject() : store().detail(track.getString("id"),false));
            } catch (Exception error) { call.reject(error.getMessage()); }
        });
    }
    @PluginMethod public void status(PluginCall call) {
        try { JSObject result = new JSObject(); result.put("active",store().active()); call.resolve(result); }
        catch (Exception error) { call.reject(error.getMessage()); }
    }
    @PluginMethod public void list(PluginCall call) {
        try {
            String owner=call.getString("owner","").trim(),team=call.getString("team_id","");
            Long from=call.getData().isNull("from")?null:call.getData().getLong("from"),to=call.getData().isNull("to")?null:call.getData().getLong("to");
            if(owner.length()>100||(!team.isEmpty()&&!team.matches("[a-zA-Z0-9_-]{1,100}"))||(from!=null&&to!=null&&from>=to))throw new IllegalArgumentException("검색 조건을 확인해주세요.");
            call.resolve(store().list(Math.max(0,call.getInt("offset",0)),owner,team,from,to));
        }
        catch (Exception error) { call.reject(error.getMessage()); }
    }
    @PluginMethod public void detail(PluginCall call) {
        try { call.resolve(store().detail(call.getString("id",""),true)); }
        catch (Exception error) { call.reject(error.getMessage()); }
    }
}
