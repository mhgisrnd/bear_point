package com.bearpoint.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/** Keeps a user-initiated APK transfer alive while its activity is not visible. */
public final class AppUpdateDownloadService extends Service {
    private static final String CHANNEL = "app_update_download";
    private static final int NOTICE = 2410;
    private PowerManager.WakeLock wakeLock;

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (Build.VERSION.SDK_INT >= 26) {
            getSystemService(NotificationManager.class).createNotificationChannel(
                new NotificationChannel(CHANNEL, "앱 업데이트 다운로드", NotificationManager.IMPORTANCE_LOW));
        }
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pending = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        var notice = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_bearmap_notification)
            .setContentTitle("앱 업데이트 다운로드 중")
            .setContentText("다운로드와 파일 검증이 진행 중입니다.")
            .setContentIntent(pending).setOngoing(true).setOnlyAlertOnce(true).build();
        ServiceCompat.startForeground(this, NOTICE, notice,
            Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC : 0);
        if (wakeLock == null) {
            wakeLock = ((PowerManager) getSystemService(POWER_SERVICE)).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "BearPoint:AppUpdate");
            wakeLock.acquire(2L * 60 * 60 * 1000);
        }
        return START_NOT_STICKY;
    }

    @Override public void onTimeout(int startId, int fgsType) {
        AppUpdatePlugin.cancelActiveDownload();
        stopSelf();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override public void onDestroy() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }
}
