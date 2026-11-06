package com.bearpoint.app;

import android.content.Context;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbManager;
import android.os.Handler;
import android.os.Looper;

/** Process-owned SDR state shared by the WebView bridge and the scan service. Main-thread only. */
final class SdrRuntime {
    private static SdrRuntime instance;

    static synchronized SdrRuntime get(Context context) {
        if (instance == null) instance = new SdrRuntime(context.getApplicationContext());
        return instance;
    }

    final Handler main = new Handler(Looper.getMainLooper());
    final UsbManager usb;
    final SdrReceiver sdr;
    UsbDeviceConnection connection;
    String connectedId;
    String serviceError = "";
    long receiverUiRequestSerial, receiverUiRequestId;
    Runnable listener;

    private SdrRuntime(Context context) {
        usb = (UsbManager) context.getSystemService(Context.USB_SERVICE);
        sdr = new SdrReceiver(main, this::changed);
        SdrAudioInterruption interruptions = new SdrAudioInterruption(
            () -> "starting".equals(sdr.state) || "receiving".equals(sdr.state) || "scanning".equals(sdr.state),
            reason -> {
                SdrScanService.release(); // Drop foreground notification ownership, retain the USB connection.
                sdr.stop();
                sdr.audio.interruptionNotice(reason);
                changed();
            });
        sdr.audio = new SdrAudioOutput(context, main, this::changed, interruptions);
    }

    void changed() {
        if (listener != null) listener.run();
        SdrScanService.onReceiverChanged(this);
    }

    void closeUsb() {
        closeUsb(null);
    }

    void closeUsb(SdrReceiver.CloseCompletion complete) {
        sdr.closeUsb(connection,complete);
        connection = null;
        connectedId = null;
        changed();
    }
}
