package com.bearpoint.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import androidx.core.app.NotificationManagerCompat;
import com.google.android.play.core.integrity.IntegrityServiceException;
import com.google.android.play.core.integrity.StandardIntegrityException;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.FirebaseApp;
import com.google.firebase.appcheck.FirebaseAppCheck;
import com.google.firebase.messaging.FirebaseMessaging;
import java.util.UUID;
import java.util.Locale;
import java.util.regex.Pattern;
import org.json.JSONObject;

@CapacitorPlugin(name = "BearPush")
public final class BearPushPlugin extends Plugin {
    private static final Pattern HTTP_ERROR = Pattern.compile("(?i)(?:code:|http)\\s*([1-5][0-9]{2})\\b");
    private SharedPreferences preferences() {
        return getContext().getSharedPreferences("bearpoint_push", Context.MODE_PRIVATE);
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
        if (!notificationsEnabled(context)) {
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
