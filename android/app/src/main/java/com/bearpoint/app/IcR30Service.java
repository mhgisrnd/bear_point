package com.bearpoint.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;

public final class IcR30Service extends Service {
    private static final String CHANNEL = "ic_r30_connection";
    private static final String STOP = "com.bearpoint.app.IC_R30_STOP";
    private static final int ID = 2402;
    private static IcR30Service active;
    private static Runnable onStop;
    private final Handler main = new Handler(Looper.getMainLooper());
    private PowerManager.WakeLock wakeLock;
    private final Runnable retire = () -> { if (onStop == null) stopSelf(); };
    private final Runnable renew = new Runnable() {
        @Override public void run() {
            if (wakeLock == null) return;
            if (wakeLock.isHeld()) wakeLock.release();
            wakeLock.acquire(10 * 60 * 1000L);
            main.postDelayed(this, 9 * 60 * 1000L);
        }
    };

    static boolean notificationsAllowed(Context context) {
        NotificationManager manager = (NotificationManager) context.getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26) {
            manager.createNotificationChannel(new NotificationChannel(CHANNEL, "IC-R30 수신기 연결", NotificationManager.IMPORTANCE_LOW));
            if (manager.getNotificationChannel(CHANNEL).getImportance() == NotificationManager.IMPORTANCE_NONE) return false;
        }
        return NotificationManagerCompat.from(context).areNotificationsEnabled();
    }

    static void launch(Context context, Runnable stop) {
        if (!notificationsAllowed(context)) throw new IllegalStateException("백그라운드 연결 상태와 해제 버튼을 표시하려면 알림을 허용해주세요.");
        onStop = stop;
        if (active != null) active.main.removeCallbacks(active.retire);
        try { ContextCompat.startForegroundService(context, new Intent(context, IcR30Service.class)); }
        catch (RuntimeException error) { onStop = null; throw error; }
    }

    static void release() {
        onStop = null;
        if (active != null) {
            active.main.removeCallbacks(active.retire);
            active.main.postDelayed(active.retire, 300);
        }
    }

    private static void stopConnection() {
        Runnable stop = onStop;
        onStop = null;
        if (stop != null) stop.run();
    }

    @Override public void onCreate() {
        super.onCreate();
        active = this;
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && STOP.equals(intent.getAction())) {
            stopConnection();
            stopSelf();
            return START_NOT_STICKY;
        }
        PendingIntent open = PendingIntent.getActivity(this, ID,
            new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent stop = PendingIntent.getService(this, ID,
            new Intent(this, IcR30Service.class).setAction(STOP),
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        try {
            ServiceCompat.startForeground(this, ID,
                new NotificationCompat.Builder(this, CHANNEL).setSmallIcon(R.drawable.ic_sdr_notification)
                    .setContentTitle("IC-R30 Bluetooth 연결 유지")
                    .setContentText("화면을 꺼도 주파수·신호 세기 조회를 계속합니다.")
                    .setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true)
                    .addAction(0, "연결 해제", stop).build(),
                Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE : 0);
            if (onStop == null) { stopSelf(); return START_NOT_STICKY; }
            if (wakeLock == null) {
                wakeLock = ((PowerManager) getSystemService(POWER_SERVICE))
                    .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "BearPoint:IcR30");
                renew.run();
            }
        } catch (RuntimeException error) {
            Log.e("IcR30", "Foreground connection service failed", error);
            stopConnection();
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    @Override public void onDestroy() {
        main.removeCallbacks(renew);
        main.removeCallbacks(retire);
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        if (active == this) {
            active = null;
            stopConnection();
        }
        super.onDestroy();
    }

    @Override public void onTaskRemoved(Intent rootIntent) {
        stopConnection();
        stopSelf();
        super.onTaskRemoved(rootIntent);
    }

    @Override public IBinder onBind(Intent intent) { return null; }
}
