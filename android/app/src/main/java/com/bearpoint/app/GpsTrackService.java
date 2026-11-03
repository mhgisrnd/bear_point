package com.bearpoint.app;

import android.app.*;
import android.Manifest;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.content.pm.PackageManager;
import android.location.*;
import android.os.*;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSObject;
import java.util.Locale;

/** User-started offline location recorder; never depends on a WebView timer. */
public final class GpsTrackService extends Service implements LocationListener {
    private static final String CHANNEL = "gps_track";
    private static final String STOP = "com.bearpoint.app.GPS_STOP";
    private static final int NOTICE = 2402;
    private static volatile boolean requested;
    private static GpsTrackService active;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private LocationManager locations;
    private String id;
    private String saveError;
    private final Runnable heartbeat = new Runnable() {
        @Override public void run() {
            if (id == null) return;
            try {
                if (!notificationsAllowed(GpsTrackService.this)) { finish("interrupted", "알림이 꺼져 이동 기록을 종료했습니다."); return; }
                ((NotificationManager)getSystemService(NOTIFICATION_SERVICE)).notify(NOTICE, notification());
            } catch (Exception error) { finish("interrupted", "기록 상태 확인 실패: " + error.getMessage()); return; }
            handler.postDelayed(this, 15000);
        }
    };
    static boolean running() { return requested; }
    static void prepare(Context context) {
        if (Build.VERSION.SDK_INT >= 26) ((NotificationManager)context.getSystemService(NOTIFICATION_SERVICE))
            .createNotificationChannel(new NotificationChannel(CHANNEL, "이동 기록", NotificationManager.IMPORTANCE_LOW));
    }
    static boolean notificationsAllowed(Context context) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = ((NotificationManager)context.getSystemService(NOTIFICATION_SERVICE)).getNotificationChannel(CHANNEL);
            return channel != null && channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
        }
        return true;
    }
    static void launch(Context context, String id) {
        requested = true;
        try { ContextCompat.startForegroundService(context, new Intent(context, GpsTrackService.class).putExtra("id",id)); }
        catch (RuntimeException error) { requested = false; throw error; }
    }
    static void stop() { if (active != null) active.finish("saved", null); }
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && STOP.equals(intent.getAction())) { finish("saved", null); return START_NOT_STICKY; }
        if (id != null) return START_NOT_STICKY;
        id = intent == null ? null : intent.getStringExtra("id"); active = this;
        if (id == null) { requested = false; stopSelf(); return START_NOT_STICKY; }
        try {
            prepare(this);
            ServiceCompat.startForeground(this, NOTICE, notification(), Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION : 0);
            locations = (LocationManager)getSystemService(LOCATION_SERVICE);
            JSObject track = GpsTrackStore.get(this).detail(id, false);
            if (!locations.isProviderEnabled(LocationManager.GPS_PROVIDER)) throw new IllegalStateException("GPS 위치 기능을 켜주세요.");
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) != PackageManager.PERMISSION_GRANTED) throw new SecurityException("정확한 위치 권한이 필요합니다.");
            locations.requestLocationUpdates(LocationManager.GPS_PROVIDER, track.getInt("interval_seconds") * 1000L, 0, this, Looper.getMainLooper());
            handler.post(heartbeat);
        } catch (Exception error) { finish("interrupted", "기록 시작 실패: " + error.getMessage()); }
        return START_NOT_STICKY;
    }
    private Notification notification() throws Exception {
        JSObject track = GpsTrackStore.get(this).detail(id, false);
        String detail = track.getString("team_name") + " · " + track.getString("owner") + " · " + String.format(Locale.KOREA,"%.2f km",track.getDouble("distance")/1000);
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent content = PendingIntent.getActivity(this, NOTICE, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, NOTICE, new Intent(this,GpsTrackService.class).setAction(STOP), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this,CHANNEL).setSmallIcon(android.R.drawable.ic_menu_mylocation)
            .setContentTitle(saveError != null ? "저장 실패 · 종료·저장을 다시 눌러주세요" : track.getInt("point_count") == 0 || (locations != null && !locations.isProviderEnabled(LocationManager.GPS_PROVIDER)) ? "이동 기록 중 · GPS 수신 대기" : "이동 기록 중")
            .setContentText(detail).setStyle(new NotificationCompat.BigTextStyle().bigText(detail))
            .setWhen(track.getLong("started_at")).setUsesChronometer(true).setOngoing(true).setOnlyAlertOnce(true)
            .setContentIntent(content).addAction(android.R.drawable.ic_menu_save,"종료·저장",stop).build();
    }
    private void finish(String status, String error) {
        if (id != null) {
            try { GpsTrackStore.get(this).finish(id,status,error); }
            catch (RuntimeException failure) { // Keep the foreground service alive so the user can retry saving.
                saveError = failure.getMessage();
                handler.removeCallbacks(heartbeat); handler.postDelayed(heartbeat,1000); return;
            }
        }
        if (locations != null) locations.removeUpdates(this);
        handler.removeCallbacksAndMessages(null);
        id = null; requested = false; stopForeground(true); stopSelf();
    }
    @Override public void onLocationChanged(Location location) {
        if (id == null) return;
        try { GpsTrackStore.get(this).append(id,location); }
        catch (Exception error) { finish("interrupted", "위치 저장 실패: " + error.getMessage()); }
    }
    @Override public void onProviderDisabled(String provider) {}
    @Override public void onProviderEnabled(String provider) {}
    @Override public void onStatusChanged(String provider, int status, Bundle extras) {}
    @Override public void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        if (locations != null) locations.removeUpdates(this);
        if (id != null) { try { GpsTrackStore.get(this).finish(id,"interrupted","기록 서비스가 종료되었습니다."); } catch (RuntimeException ignored) {} }
        requested = false; active = null; super.onDestroy();
    }
}
