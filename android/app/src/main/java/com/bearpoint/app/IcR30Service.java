package com.bearpoint.app;

import android.app.Notification;
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
    private static final String MUTE = "com.bearpoint.app.IC_R30_MUTE";
    private static final String UNMUTE = "com.bearpoint.app.IC_R30_UNMUTE";
    private static final int ID = 2402;
    private static final long OPERATION_WAKE_TIMEOUT_MS = 40_000;
    private static IcR30Service active;
    private static Runnable onStop;
    private static boolean operationInProgress;
    private static boolean background, audioForeground, audioReady, audioPlaying, audioMuted;
    interface AudioControl { void setMuted(boolean muted); }
    private static AudioControl audioControl;
    private final Handler main = new Handler(Looper.getMainLooper());
    private PowerManager.WakeLock wakeLock, audioWakeLock;
    private final Runnable retire = () -> { if (onStop == null) stopSelf(); };

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
        background = false;
        keepAwakeForOperation(true);
        if (active != null) active.main.removeCallbacks(active.retire);
        try { ContextCompat.startForegroundService(context, new Intent(context, IcR30Service.class)); }
        catch (RuntimeException error) { onStop = null; keepAwakeForOperation(false); throw error; }
    }

    static void release() {
        endAudio();
        onStop = null;
        keepAwakeForOperation(false);
        if (active != null) {
            active.main.removeCallbacks(active.retire);
            active.main.postDelayed(active.retire, 300);
        }
    }

    static void keepAwakeForOperation(boolean needed) {
        operationInProgress = needed;
        if (active != null) active.updateWakeLock();
    }

    private void updateWakeLock() {
        if (wakeLock == null) return;
        if (operationInProgress && !wakeLock.isHeld()) wakeLock.acquire(OPERATION_WAKE_TIMEOUT_MS);
        if (!operationInProgress && wakeLock.isHeld()) wakeLock.release();
    }

    static boolean beginAudio(AudioControl control) {
        if (active == null || onStop == null) return false;
        if (!audioForeground) {
            try { active.promote(true); }
            catch (RuntimeException error) {
                Log.w("IcR30", "Cannot enable foreground USB audio", error);
                return false;
            }
            audioForeground = true;
            active.updateAudioWakeLock();
        }
        audioControl = control;
        return true;
    }

    static void endAudio() {
        if (!audioForeground) return;
        audioForeground = audioReady = audioPlaying = audioMuted = false;
        audioControl = null;
        if (active == null) return;
        active.updateAudioWakeLock();
        try { active.promote(false); }
        catch (RuntimeException error) {
            Log.w("IcR30", "Cannot update foreground service type after audio ended", error);
            active.refreshNotification();
        }
    }

    static void audioChanged(boolean ready, boolean playing, boolean muted) {
        if (!audioForeground || (audioReady == ready && audioPlaying == playing && audioMuted == muted)) return;
        audioReady = ready;
        audioPlaying = playing;
        audioMuted = muted;
        if (active != null) active.refreshNotification();
    }

    static void setBackground(boolean value) {
        if (background == value) return;
        background = value;
        if (active != null && audioReady) active.refreshNotification();
    }

    private void updateAudioWakeLock() {
        if (audioWakeLock == null) return;
        if (audioForeground && !audioWakeLock.isHeld()) audioWakeLock.acquire();
        if (!audioForeground && audioWakeLock.isHeld()) audioWakeLock.release();
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
        String action = intent == null ? null : intent.getAction();
        if (STOP.equals(action)) {
            stopConnection();
            stopSelf();
            return START_NOT_STICKY;
        }
        if (MUTE.equals(action) || UNMUTE.equals(action)) {
            if (audioReady && audioControl != null) audioControl.setMuted(MUTE.equals(action));
            else if (onStop == null) stopSelf();
            return START_NOT_STICKY;
        }
        try {
            promote(audioForeground);
            if (onStop == null) { stopSelf(); return START_NOT_STICKY; }
            if (wakeLock == null) {
                wakeLock = ((PowerManager) getSystemService(POWER_SERVICE))
                    .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "BearPoint:IcR30");
                audioWakeLock = ((PowerManager) getSystemService(POWER_SERVICE))
                    .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "BearPoint:IcR30Audio");
            }
            updateWakeLock();
            updateAudioWakeLock();
        } catch (RuntimeException error) {
            Log.e("IcR30", "Foreground connection service failed", error);
            stopConnection();
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    private void promote(boolean audio) {
        int type = Build.VERSION.SDK_INT >= 29 ? ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE : 0;
        if (audio && Build.VERSION.SDK_INT >= 29) type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK;
        if (audio && Build.VERSION.SDK_INT >= 30) type |= ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE;
        ServiceCompat.startForeground(this, ID, notification(), type);
    }

    private void refreshNotification() {
        ((NotificationManager) getSystemService(NOTIFICATION_SERVICE)).notify(ID, notification());
    }

    private PendingIntent action(String action, int requestCode) {
        return PendingIntent.getService(this, requestCode, new Intent(this, IcR30Service.class).setAction(action),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification notification() {
        PendingIntent open = PendingIntent.getActivity(this, ID,
                new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP),
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String text = "화면을 꺼도 연결을 유지합니다.";
        if (audioReady) {
            if (audioPlaying) text = background ? "백그라운드에서 수신음 재생 중" : "수신음 재생 중";
            else text = audioMuted ? "USB 오디오 · 음소거" : "USB 오디오 · 재생 중단";
        }
        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_sdr_notification).setContentTitle("IC-R30 Bluetooth 연결 유지")
                .setContentText(text).setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true);
        if (audioReady) builder.addAction(0, audioPlaying ? "음소거" : "소리 켜기",
                action(audioPlaying ? MUTE : UNMUTE, audioPlaying ? ID + 1 : ID + 2));
        return builder.addAction(0, "연결 해제", action(STOP, ID)).build();
    }

    @Override public void onDestroy() {
        main.removeCallbacks(retire);
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        if (audioWakeLock != null && audioWakeLock.isHeld()) audioWakeLock.release();
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
