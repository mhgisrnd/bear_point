package com.bearpoint.app;

import android.Manifest;
import android.location.LocationManager;
import android.content.Context;
import android.content.Intent;
import android.provider.Settings;
import android.app.AlertDialog;
import androidx.activity.result.ActivityResult;
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
    private boolean awaitingLocationSettings;
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
                if (!manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
                    awaitingLocationSettings = true;
                    new AlertDialog.Builder(getActivity()).setTitle("GPS 켜기")
                        .setMessage("기기의 위치 기능이 꺼져 있습니다. 위치 설정에서 GPS를 켠 뒤 돌아오면 기록을 시작합니다.")
                        .setPositiveButton("위치 설정", (dialog, which) -> {
                            starting = true;
                            try { startActivityForResult(call, new Intent(Settings.ACTION_LOCATION_SOURCE_SETTINGS), "locationSettingsResult"); }
                            catch (RuntimeException error) { awaitingLocationSettings=false; starting=false; call.reject("위치 설정을 열지 못했습니다. 기기 설정에서 GPS를 켜주세요."); }
                        })
                        .setNegativeButton("취소", (dialog, which) -> cancelLocationStart(call))
                        .setOnCancelListener(dialog -> cancelLocationStart(call))
                        .show();
                    return;
                }
                String owner = call.getString("owner","").trim(), team = call.getString("team_id","");
                String color = call.getString("team_color","#2563EB"); int interval = call.getInt("interval_seconds",10);
                if (owner.isEmpty() || owner.length()>100 || !team.matches("[a-zA-Z0-9_-]{1,100}") || !color.matches("#[0-9a-fA-F]{6}") || !(interval==5||interval==10||interval==30||interval==60)) throw new IllegalArgumentException("담당자·팀과 이동 기록 설정을 확인해주세요.");
                store().recover();
                call.getData().put("color",color);
                JSObject track = store().create(call.getData()); created = track.getString("id");
                GpsTrackService.launch(getContext(),created); call.resolve(track);
            } catch (Exception error) {
                awaitingLocationSettings=false;
                if (created != null) { try { store().finish(created,"interrupted",error.getMessage()); } catch (RuntimeException ignored) {} }
                call.reject(error.getMessage());
            } finally { if (!awaitingLocationSettings) starting=false; }
        });
    }
    @ActivityCallback private void locationSettingsResult(PluginCall call, ActivityResult result) {
        awaitingLocationSettings=false;
        if (call == null) { starting=false; return; }
        LocationManager manager = (LocationManager)getContext().getSystemService(Context.LOCATION_SERVICE);
        if (!manager.isProviderEnabled(LocationManager.GPS_PROVIDER)) {
            starting=false; call.reject("GPS가 꺼져 있어 기록을 시작하지 않았습니다."); return;
        }
        starting=true;
        notificationResult(call);
    }
    private void cancelLocationStart(PluginCall call) {
        awaitingLocationSettings=false; starting=false;
        call.reject("GPS가 꺼져 있어 기록을 시작하지 않았습니다.");
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
        try { JSObject result = new JSObject(); result.put("active",store().active()); result.put("location_warning", GpsTrackService.locationWarning()); call.resolve(result); }
        catch (Exception error) { call.reject(error.getMessage()); }
    }
    @PluginMethod public void updateInterval(PluginCall call) {
        main.post(() -> {
            try {
                int interval = call.getInt("interval_seconds",0);
                if (!(interval==5 || interval==10 || interval==30 || interval==60)) throw new IllegalArgumentException("기록 간격을 확인해주세요.");
                JSObject result = new JSObject();
                result.put("active", GpsTrackService.updateInterval(interval));
                call.resolve(result);
            } catch (Exception error) { call.reject(error.getMessage()); }
        });
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
