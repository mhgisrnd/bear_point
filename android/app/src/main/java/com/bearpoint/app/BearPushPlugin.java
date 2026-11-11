package com.bearpoint.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.provider.Settings;
import android.os.Build;
import androidx.core.app.NotificationManagerCompat;
import com.google.android.play.core.integrity.IntegrityServiceException;
import com.google.android.play.core.integrity.StandardIntegrityException;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import com.google.firebase.FirebaseApp;
import com.google.firebase.appcheck.FirebaseAppCheck;
import com.google.firebase.messaging.FirebaseMessaging;
import java.util.UUID;
import java.util.Locale;
import java.util.regex.Pattern;
import org.json.JSONObject;

@CapacitorPlugin(name = "BearPush", permissions = {
    @Permission(strings = {Manifest.permission.POST_NOTIFICATIONS}, alias = "notifications")
})
public final class BearPushPlugin extends Plugin {
    private String pendingEstimateId;

    @Override public void load() { captureNotificationOpen(getActivity().getIntent()); }

    @Override protected void handleOnNewIntent(Intent intent) { captureNotificationOpen(intent); }

    private synchronized void captureNotificationOpen(Intent intent) {
        if (intent == null) return;
        String id = intent.getStringExtra("bear_estimate_server_id");
        if (id == null || !id.matches("[1-9][0-9]{0,18}")) return;
        pendingEstimateId = id;
        intent.removeExtra("bear_estimate_server_id");
        notifyListeners("notificationOpened", new JSObject());
    }

    @PluginMethod public synchronized void consumeNotificationOpen(PluginCall call) {
        String id = pendingEstimateId;
        pendingEstimateId = null;
        call.resolve(new JSObject().put("serverId", id == null ? JSONObject.NULL : id));
    }

    private static final Pattern HTTP_ERROR = Pattern.compile("(?i)(?:code:|http)\\s*([1-5][0-9]{2})\\b");
    private SharedPreferences preferences() {
        return getContext().getSharedPreferences("bearpoint_push", Context.MODE_PRIVATE);
    }

    @PluginMethod
    public void initializeNotifications(PluginCall call) {
        // An explicit in-app choice always wins, including OFF with OS permission.
        if (preferences().contains("notifications_enabled")) {
            getNotificationSettings(call);
            return;
        }
        boolean asked = preferences().getBoolean("permission_requested", false);
        if (Build.VERSION.SDK_INT >= 33 && !asked
                && getActivity().checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            preferences().edit().putBoolean("permission_requested", true).apply();
            requestPermissionForAlias("notifications", call, "initialNotificationPermissionResult");
            return;
        }
        initialNotificationPermissionResult(call);
    }

    @PermissionCallback
    private void initialNotificationPermissionResult(PluginCall call) {
        if (!preferences().contains("notifications_enabled")) {
            boolean enabled = notificationsEnabled(getContext());
            if (!preferences().edit().putBoolean("notifications_enabled", enabled).commit()) {
                call.reject("알림 설정을 저장하지 못했습니다.");
                return;
            }
            if (!FirebaseApp.getApps(getContext()).isEmpty()) FirebaseMessaging.getInstance().setAutoInitEnabled(enabled);
        }
        getNotificationSettings(call);
    }

    @PluginMethod
    public void getNotificationSettings(PluginCall call) {
        call.resolve(new JSObject().put("enabled", preferences().getBoolean("notifications_enabled", true))
            .put("permissionGranted", notificationsEnabled(getContext())));
    }

    @PluginMethod
    public void setNotificationsEnabled(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled"));
        if (!preferences().edit().putBoolean("notifications_enabled", enabled).commit()) {
            call.reject("알림 설정을 저장하지 못했습니다.");
            return;
        }
        if (!FirebaseApp.getApps(getContext()).isEmpty()) FirebaseMessaging.getInstance().setAutoInitEnabled(enabled);
        if (!enabled && !FirebaseApp.getApps(getContext()).isEmpty()) {
            // FCM displays notification payloads itself in the background.
            // Retire the token as well as unregistering it from our server.
            FirebaseMessaging.getInstance().deleteToken().addOnCompleteListener(task -> {
                if (task.isSuccessful()) getNotificationSettings(call);
                else call.reject("알림 중단 설정은 저장했지만 수신 연결 해제에 실패했습니다. 인터넷 연결 후 다시 확인해주세요.");
            });
        } else getNotificationSettings(call);
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33
                && getActivity().checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            boolean asked = preferences().getBoolean("permission_requested", false);
            if (asked && !getActivity().shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS)) {
                call.resolve(new JSObject().put("permissionGranted", false).put("needsSettings", true));
                return;
            }
            preferences().edit().putBoolean("permission_requested", true).apply();
            requestPermissionForAlias("notifications", call, "notificationPermissionResult");
        } else notificationPermissionResult(call);
    }

    @PermissionCallback
    private void notificationPermissionResult(PluginCall call) {
        boolean granted = notificationsEnabled(getContext());
        call.resolve(new JSObject().put("permissionGranted", granted).put("needsSettings", !granted));
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
            .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O || intent.resolveActivity(getContext().getPackageManager()) == null) {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                android.net.Uri.parse("package:" + getContext().getPackageName()));
        }
        try { startActivityForResult(call, intent, "notificationSettingsResult"); }
        catch (Exception error) { call.reject("휴대폰 알림 설정을 열지 못했습니다.", error); }
    }

    @com.getcapacitor.annotation.ActivityCallback
    private void notificationSettingsResult(PluginCall call, androidx.activity.result.ActivityResult result) {
        if (call != null) getNotificationSettings(call);
    }

    private synchronized String installationId() {
        SharedPreferences preferences = preferences();
        String id = preferences.getString("installation_id", null);
        if (id == null) {
            id = UUID.randomUUID().toString();
            preferences.edit().putString("installation_id", id).apply();
        }
        return id;
    }

    private synchronized String credential() {
        String credential = preferences().getString("credential", "");
        if (credential.isEmpty()) {
            credential = (UUID.randomUUID().toString() + UUID.randomUUID()).replace("-", "");
            preferences().edit().putString("credential", credential).apply();
        }
        return credential;
    }

    @PluginMethod
    public void getCredentials(PluginCall call) {
        call.resolve(new JSObject().put("installation_id", installationId())
            .put("credential", credential()));
    }

    @PluginMethod
    public void getAppCheckToken(PluginCall call) {
        if (FirebaseApp.getApps(getContext()).isEmpty()) {
            call.reject("Firebase 설정을 사용할 수 없습니다.", "FIREBASE_CONFIG");
            return;
        }
        FirebaseAppCheck.getInstance().getAppCheckToken(false)
            .addOnSuccessListener(attestation -> call.resolve(new JSObject().put("token", attestation.getToken())))
            .addOnFailureListener(error -> call.reject("앱 인증에 실패했습니다.", "APP_CHECK"));
    }

    @PluginMethod
    public void getRegistration(PluginCall call) {
        Context context = getContext();
        if (FirebaseApp.getApps(context).isEmpty()) {
            call.reject("Firebase 설정을 사용할 수 없습니다.", "FIREBASE_CONFIG");
            return;
        }
        FirebaseAppCheck.getInstance().getAppCheckToken(false)
            .addOnSuccessListener(attestation -> resolveRegistration(call, attestation.getToken()))
            .addOnFailureListener(error -> call.reject("진단: " + describeAppCheckError(error), "APP_CHECK"));
    }

    private static String describeAppCheckError(Exception error) {
        String httpStatus = null;
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            if (cause instanceof StandardIntegrityException) {
                return "Play Integrity 오류 코드 " + ((StandardIntegrityException) cause).getErrorCode();
            }
            if (cause instanceof IntegrityServiceException) {
                return "Play Integrity 오류 코드 " + ((IntegrityServiceException) cause).getErrorCode();
            }
            String message = cause.getMessage();
            if (message == null) continue;
            String normalized = message.toLowerCase(Locale.ROOT);
            if (normalized.contains("too many attempts")) return "Firebase가 연속 인증 요청을 일시 제한했습니다.";
            if (normalized.contains("no appcheckprovider installed")) return "Play Integrity 인증 제공자가 초기화되지 않았습니다.";
            var status = HTTP_ERROR.matcher(message);
            if (status.find()) {
                httpStatus = "Firebase App Check HTTP " + status.group(1);
                if (normalized.contains("app attestation failed")) return httpStatus + " · 앱 증명 거부";
                if (normalized.contains("api key not valid")) return httpStatus + " · Firebase API 키 오류";
                if (normalized.contains("permission denied") || normalized.contains("permission_denied")) return httpStatus + " · 요청 권한 거부";
                if (normalized.contains("has not been used") || normalized.contains("api is disabled")) return httpStatus + " · Firebase API 사용 설정 확인 필요";
            }
        }
        return httpStatus == null ? error.getClass().getSimpleName() : httpStatus;
    }

    private void resolveRegistration(PluginCall call, String appCheckToken) {
        Context context = getContext();
        JSObject registration = new JSObject().put("installation_id", installationId())
            .put("credential", credential()).put("app_check_token", appCheckToken);
        if (!preferences().getBoolean("notifications_enabled", true) || !notificationsEnabled(context)) {
            call.resolve(registration.put("token", JSONObject.NULL));
            return;
        }
        FirebaseMessaging.getInstance().getToken().addOnCompleteListener(task -> {
            if (!task.isSuccessful()) {
                call.reject("푸시 수신 정보를 가져오지 못했습니다.", "FCM_TOKEN");
                return;
            }
            call.resolve(registration.put("token", task.getResult()));
        });
    }

    private static boolean notificationsEnabled(Context context) {
        if (!NotificationManagerCompat.from(context).areNotificationsEnabled()) return false;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return true;
        NotificationChannel channel = context.getSystemService(NotificationManager.class)
            .getNotificationChannel(context.getString(R.string.bear_tracking_notification_channel_id));
        return channel == null || channel.getImportance() != NotificationManager.IMPORTANCE_NONE;
    }
}
