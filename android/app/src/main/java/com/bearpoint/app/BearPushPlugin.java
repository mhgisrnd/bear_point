package com.bearpoint.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Build;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.firebase.FirebaseApp;
import com.google.firebase.appcheck.FirebaseAppCheck;
import com.google.firebase.messaging.FirebaseMessaging;
import java.util.UUID;
import org.json.JSONObject;

@CapacitorPlugin(name = "BearPush")
public final class BearPushPlugin extends Plugin {
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
    public void getRegistration(PluginCall call) {
        Context context = getContext();
        if (FirebaseApp.getApps(context).isEmpty()) {
            call.reject("Firebase 설정을 사용할 수 없습니다.");
            return;
        }
        FirebaseAppCheck.getInstance().getAppCheckToken(false)
            .addOnSuccessListener(attestation -> resolveRegistration(call, attestation.getToken()))
            .addOnFailureListener(error -> call.reject("앱 무결성 확인에 실패했습니다."));
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
                call.reject("푸시 수신 정보를 가져오지 못했습니다.");
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
