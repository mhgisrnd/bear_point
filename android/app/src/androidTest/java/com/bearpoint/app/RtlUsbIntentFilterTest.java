package com.bearpoint.app;

import android.content.IntentFilter;
import android.hardware.usb.UsbManager;
import android.net.Uri;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import org.junit.Test;
import org.junit.runner.RunWith;
import static org.junit.Assert.*;

/** Requires a device/emulator: tests the real Android Intent matching rules. */
@RunWith(AndroidJUnit4.class)
public class RtlUsbIntentFilterTest {
    private static final String ACTION = "com.bearpoint.app.RTL_USB_PERMISSION";

    @Test public void permissionReplyWithRequestUriMatches() {
        Uri uri = Uri.parse("bearpoint-usb://permission/request-123");
        // Regression: the former action-only filter dropped every permission reply.
        assertEquals(IntentFilter.NO_MATCH_DATA,
            new IntentFilter(ACTION).match(ACTION, null, uri.getScheme(), uri, null, "test"));
        assertTrue(RtlSdrPlugin.permissionFilter(ACTION)
            .match(ACTION, null, uri.getScheme(), uri, null, "test") >= 0);
    }

    @Test public void unrelatedPermissionReplyDoesNotMatch() {
        Uri uri = Uri.parse("https://permission/request-123");
        assertTrue(RtlSdrPlugin.permissionFilter(ACTION)
            .match(ACTION, null, uri.getScheme(), uri, null, "test") < 0);
    }

    @Test public void deviceEventsStillMatchWithoutUri() {
        IntentFilter filter = RtlSdrPlugin.deviceFilter();
        assertTrue(filter.match(UsbManager.ACTION_USB_DEVICE_ATTACHED, null, null, null, null, "test") >= 0);
        assertTrue(filter.match(UsbManager.ACTION_USB_DEVICE_DETACHED, null, null, null, null, "test") >= 0);
    }
}
