package com.bearpoint.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.UUID;

public class BearMessagingService extends FirebaseMessagingService {
    static void createChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationChannel channel = new NotificationChannel(
            context.getString(R.string.bear_tracking_notification_channel_id),
            context.getString(R.string.bear_tracking_notification_channel_name),
            NotificationManager.IMPORTANCE_DEFAULT
        );
        context.getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }

    @Override
    public void onMessageReceived(RemoteMessage message) {
        RemoteMessage.Notification notification = message.getNotification();
        if (notification == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                    != PackageManager.PERMISSION_GRANTED) {
            return;
        }

        // Firebase displays notification payloads itself while the app is in the background.
        createChannel(this);
        Intent intent = new Intent(this, MainActivity.class);
        PendingIntent openApp = PendingIntent.getActivity(this, 0, intent, PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder builder = new NotificationCompat.Builder(
            this, getString(R.string.bear_tracking_notification_channel_id)
        )
            .setSmallIcon(R.drawable.ic_bearmap_notification)
            .setContentTitle(notification.getTitle() == null ? getString(R.string.app_name) : notification.getTitle())
            .setContentText(notification.getBody())
            .setContentIntent(openApp)
            .setVisibility(NotificationCompat.VISIBILITY_PRIVATE)
            .setAutoCancel(true);
        String tag = notification.getTag();
        if (tag == null) tag = message.getMessageId();
        NotificationManagerCompat.from(this).notify(tag == null ? UUID.randomUUID().toString() : tag, 0, builder.build());
    }
}
