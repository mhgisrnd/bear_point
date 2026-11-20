package com.bearpoint.app;

import android.media.AudioDeviceInfo;
import org.junit.Test;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

public class SdrAudioOutputTest {
    @Test public void r30AcceptsBluetoothMediaOutputsWithoutUsingCallAudioOrUsb() {
        assertTrue(SdrAudioOutput.isBluetoothMedia(AudioDeviceInfo.TYPE_BLUETOOTH_A2DP));
        assertTrue(SdrAudioOutput.isBluetoothMedia(AudioDeviceInfo.TYPE_BLE_HEADSET));
        assertTrue(SdrAudioOutput.isBluetoothMedia(AudioDeviceInfo.TYPE_BLE_SPEAKER));
        assertFalse(SdrAudioOutput.isBluetoothMedia(AudioDeviceInfo.TYPE_BLUETOOTH_SCO));
        assertFalse(SdrAudioOutput.isBluetoothMedia(AudioDeviceInfo.TYPE_USB_HEADSET));
        assertFalse(SdrAudioOutput.isBluetoothMedia(AudioDeviceInfo.TYPE_BUILTIN_SPEAKER));
    }
}
