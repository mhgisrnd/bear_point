package com.bearpoint.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.ServiceInfo;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbManager;
import android.os.Build;
import android.os.IBinder;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.service.notification.StatusBarNotification;
import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;
import java.util.Locale;

/** Keeps an explicitly started USB scan or fixed reception alive in the background. */
public final class SdrScanService extends Service {
    private static final String CHANNEL = "sdr_scan";
    private static final String ACTION_START = "com.bearpoint.app.SDR_SCAN_START";
    private static final String ACTION_STOP = "com.bearpoint.app.SDR_SCAN_STOP";
    private static final String ACTION_DISMISSED = "com.bearpoint.app.SDR_SCAN_DISMISSED";
    private static final int NOTIFICATION_ID = 2401;
    private static SdrScanService active;
    private static boolean requested;
    private static String operation;
    private boolean handoff;
    private SdrRuntime runtime;
    private PowerManager.WakeLock wakeLock;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final Runnable retire = () -> {
        if (!requested) stopSelf();
    };
    private final Runnable renewWakeLock = new Runnable() {
        @Override public void run() {
            if (wakeLock == null) return;
            if (wakeLock.isHeld()) wakeLock.release();
            wakeLock.acquire(10 * 60 * 1000L);
            main.postDelayed(this, 9 * 60 * 1000L);
        }
    };
    private final Runnable restoreNotification = () -> {
        if (canShowNotification()) updateNotification(notificationTitle());
    };
    private final Runnable verifyNotification = new Runnable() {
        @Override public void run() {
            if (!canShowNotification()) return;
            NotificationManager manager = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            boolean visible = false;
            for (StatusBarNotification shown : manager.getActiveNotifications()) {
                if (shown.getId() == NOTIFICATION_ID) { visible = true; break; }
            }
            if (!visible) updateNotification(notificationTitle());
            main.postDelayed(this, 30000);
        }
    };

    private static String notificationTitle() {
        return "scan".equals(operation) ? "대역 탐색 중" : "주파수 고정 수신 중";
    }

    private static String mhz(int hz) {
        return String.format(Locale.US, "%.3f", hz / 1_000_000.0);
    }

    private String notificationDetail() {
        if (!requested || operation == null) return "수신 종료 중";
        if ("scan".equals(operation)) {
            int startHz = runtime.sdr.scan.optInt("startHz");
            int endHz = runtime.sdr.scan.optInt("endHz");
            return startHz > 0 && endHz > 0
                ? "IQ 분석 · " + mhz(startHz) + "–" + mhz(endHz) + " MHz"
                : "IQ 분석 · 대역 준비 중";
        }
        int hz = runtime.sdr.tunedFrequencyHz;
        String mode = "wfm".equals(runtime.sdr.mode) ? "WFM" : "IQ 분석";
        return hz > 0 ? mode + " · " + mhz(hz) + " MHz" : mode + " · 주파수 준비 중";
    }

    private boolean canShowNotification() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).getNotificationChannel(CHANNEL);
            if (channel == null || channel.getImportance() == NotificationManager.IMPORTANCE_NONE) return false;
        }
        return requested && active == this && runtime != null && runtime.connection != null &&
            ("starting".equals(runtime.sdr.state) ||
                ("scan".equals(operation) ? "scanning".equals(runtime.sdr.state) : "receiving".equals(runtime.sdr.state))) &&
            NotificationManagerCompat.from(this).areNotificationsEnabled();
    }

    private final BroadcastReceiver detached = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if (ACTION_DISMISSED.equals(intent.getAction())) {
                if (canShowNotification()) {
                    main.removeCallbacks(restoreNotification);
                    main.postDelayed(restoreNotification, 3000);
                }
                return;
            }
            if (!UsbManager.ACTION_USB_DEVICE_DETACHED.equals(intent.getAction())) return;
            UsbDevice device = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
            if (runtime == null || runtime.connectedId == null || device == null ||
                !runtime.connectedId.equals(device.getDeviceName())) return;
            runtime.closeUsb();
            handoff = true;
            requested = false;
            operation = null;
            stopSelf();
        }
    };

    static boolean isRunning() { return requested; }
    static boolean isScanning() { return requested && "scan".equals(operation); }
    static boolean isReceiving() { return requested && "fixed".equals(operation); }

    static void launch(Context context, String nextOperation) {
        if (requested) return;
        operation = nextOperation;
        requested = true;
        if (active != null) {
            active.main.removeCallbacks(active.retire);
            active.handoff = false;
        }
        try {
            ContextCompat.startForegroundService(context, new Intent(context, SdrScanService.class).setAction(ACTION_START));
        } catch (RuntimeException failure) {
            requested = false;
            operation = null;
            throw failure;
        }
    }

    /** Stop foreground ownership while retaining USB in the current process. */
    static void release() {
        requested = false;
        operation = null;
        if (active != null) {
            active.handoff = true;
            // A candidate may switch from scan to fixed reception immediately.
            active.main.removeCallbacks(active.retire);
            active.main.postDelayed(active.retire, 300);
        }
    }

    static void onReceiverChanged(SdrRuntime runtime) {
        if (active == null || active.runtime != runtime) return;
        if (runtime.connection == null) {
            requested = false;
            operation = null;
            active.handoff = true;
            active.stopSelf();
            return;
        }
        if ("error".equals(runtime.sdr.state)) {
            runtime.serviceError = runtime.sdr.error;
            requested = false;
            operation = null;
            active.handoff = true;
            runtime.closeUsb();
            active.stopSelf();
        }
    }

    @Override public void onCreate() {
        super.onCreate();
        runtime = SdrRuntime.get(this);
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, "SDR 수신", NotificationManager.IMPORTANCE_LOW);
            ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).createNotificationChannel(channel);
        }
        IntentFilter events = new IntentFilter(UsbManager.ACTION_USB_DEVICE_DETACHED);
        events.addAction(ACTION_DISMISSED);
        ContextCompat.registerReceiver(this, detached, events,
            ContextCompat.RECEIVER_NOT_EXPORTED);
        active = this;
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            requested = false;
            operation = null;
            runtime.sdr.stop(() -> {
                handoff = true;
                stopSelf();
            });
            updateNotification("수신 정지 중…");
            return START_NOT_STICKY;
        }
        if (!requested || runtime.connection == null) {
            handoff = true;
            stopSelf();
            return START_NOT_STICKY;
        }
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification(notificationTitle()),
            Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE : 0);
        main.removeCallbacks(verifyNotification);
        main.postDelayed(verifyNotification, 30000);
        if (wakeLock == null) {
            PowerManager power = (PowerManager) getSystemService(POWER_SERVICE);
            wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "BearPoint:SdrScan");
            renewWakeLock.run();
        }
        return START_NOT_STICKY;
    }

    private Notification notification(String title) {
        Intent open = new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openAction = PendingIntent.getActivity(this, 0, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent stop = new Intent(this, SdrScanService.class).setAction(ACTION_STOP);
        PendingIntent stopAction = PendingIntent.getService(this, 1, stop, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        Intent dismissed = new Intent(ACTION_DISMISSED).setPackage(getPackageName());
        PendingIntent dismissedAction = PendingIntent.getBroadcast(this, 2, dismissed, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_sdr_notification).setContentTitle(title).setContentText(notificationDetail())
            .setContentIntent(openAction).setDeleteIntent(dismissedAction).setOngoing(true).setOnlyAlertOnce(true)
            .addAction(0, "정지", stopAction).build();
    }

    private void updateNotification(String title) {
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(NOTIFICATION_ID, notification(title));
    }

    @Override public void onDestroy() {
        unregisterReceiver(detached);
        main.removeCallbacks(restoreNotification);
        main.removeCallbacks(verifyNotification);
        main.removeCallbacks(renewWakeLock);
        main.removeCallbacks(retire);
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        if (active == this) active = null;
        requested = false;
        operation = null;
        if (!handoff && runtime != null) runtime.closeUsb();
        super.onDestroy();
    }

    @Nullable @Override public IBinder onBind(Intent intent) { return null; }
}
