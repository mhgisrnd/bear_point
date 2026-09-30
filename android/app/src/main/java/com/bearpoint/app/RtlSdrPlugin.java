package com.bearpoint.app;

import android.app.PendingIntent;
import android.Manifest;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.hardware.usb.UsbDevice;
import android.hardware.usb.UsbDeviceConnection;
import android.hardware.usb.UsbManager;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.os.Build;
import androidx.core.content.ContextCompat;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import androidx.core.view.ViewCompat;
import androidx.core.view.WindowInsetsCompat;
import android.view.View;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.UUID;

/** USB permissions and foreground single-frequency IQ diagnostics. */
@CapacitorPlugin(name = "RtlSdr", permissions = {
    @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
})
public class RtlSdrPlugin extends Plugin {
    private final Handler main = new Handler(Looper.getMainLooper());
    private UsbManager usb;
    private SdrRuntime runtime;
    private SdrReceiver sdr;
    private final Runnable runtimeListener = this::publish;
    private String permissionAction;
    private PluginCall permissionCall;
    private PluginCall pendingScanCall;
    private PluginCall pendingReceptionCall;
    private String requestedId;
    private String requestToken;
    private PendingIntent permissionIntent;
    private boolean registered;
    private boolean destroyed;
    private boolean paused;
    private String lastError;
    private final Runnable timeout = () -> {
        reconcilePermission();
        failPermission("USB_PERMISSION_TIMEOUT", "권한 요청 시간이 초과되었습니다. 다시 시도하세요.");
    };

    private final BroadcastReceiver receiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            if (permissionAction.equals(action)) {
                // Ignore stale replies after detach, cancellation or another request.
                if (permissionCall == null || !requestToken.equals(intent.getDataString())) return;
                UsbDevice device = find(requestedId);
                if (device == null) {
                    failPermission("USB_DEVICE_DETACHED", "권한 요청 중 장치가 분리되었습니다.");
                } else if (usb.hasPermission(device)) {
                    completePermission(device);
                } else {
                    failPermission("USB_PERMISSION_DENIED", "USB 접근 권한이 승인되지 않았습니다.");
                }
            } else if (UsbManager.ACTION_USB_DEVICE_DETACHED.equals(action)) {
                // The event identifies the old device even if a new one has appeared.
                UsbDevice removed = intent.getParcelableExtra(UsbManager.EXTRA_DEVICE);
                String id = removed == null ? null : removed.getDeviceName();
                if (runtime.connectedId != null && (runtime.connectedId.equals(id) || find(runtime.connectedId) == null)) closeConnection();
                if (requestedId != null && (requestedId.equals(id) || find(requestedId) == null)) {
                    failPermission("USB_DEVICE_DETACHED", "권한 요청 중 장치가 분리되었습니다.");
                }
                publish();
            } else if (UsbManager.ACTION_USB_DEVICE_ATTACHED.equals(action)) {
                publish();
            }
        }
    };

    @Override public void load() {
        runtime = SdrRuntime.get(getContext());
        sdr = runtime.sdr;
        runtime.listener = runtimeListener;
        usb = runtime.usb;
        permissionAction = getContext().getPackageName() + ".RTL_USB_PERMISSION";
        // USB system broadcasts originate in system_server; permission replies use our PendingIntent.
        // A filter without a data scheme cannot receive our URI-bearing permission Intent.
        ContextCompat.registerReceiver(getContext(), receiver, permissionFilter(permissionAction), ContextCompat.RECEIVER_NOT_EXPORTED);
        registered = true;
        ContextCompat.registerReceiver(getContext(), receiver, deviceFilter(), ContextCompat.RECEIVER_NOT_EXPORTED);
    }

    static IntentFilter permissionFilter(String action) {
        IntentFilter filter = new IntentFilter(action);
        filter.addDataScheme("bearpoint-usb");
        return filter;
    }

    static IntentFilter deviceFilter() {
        // Attach/detach broadcasts have no data URI; keep them in a separate filter.
        IntentFilter filter = new IntentFilter(UsbManager.ACTION_USB_DEVICE_ATTACHED);
        filter.addAction(UsbManager.ACTION_USB_DEVICE_DETACHED);
        return filter;
    }

    private boolean hostSupported() {
        return usb != null && getContext().getPackageManager().hasSystemFeature(PackageManager.FEATURE_USB_HOST);
    }

    private UsbDevice find(String id) {
        return usb == null || id == null ? null : usb.getDeviceList().get(id);
    }

    private boolean candidate(UsbDevice device) {
        // Initial supported USB IDs; this is NOT proof of tuner compatibility.
        return device.getVendorId() == 0x0bda && (device.getProductId() == 0x2832 || device.getProductId() == 0x2838);
    }

    private JSObject deviceInfo(UsbDevice device) {
        JSObject result = new JSObject();
        result.put("deviceId", device.getDeviceName());
        result.put("vendorId", device.getVendorId());
        result.put("productId", device.getProductId());
        result.put("name", device.getProductName() == null ? "USB 장치" : device.getProductName());
        result.put("candidate", candidate(device));
        result.put("hasPermission", usb.hasPermission(device));
        result.put("connected", device.getDeviceName().equals(runtime.connectedId));
        result.put("tuner", "unverified");
        // Do not read serial numbers before permission, or expose native file descriptors.
        return result;
    }

    private JSObject snapshot() {
        if (runtime.connectedId != null && find(runtime.connectedId) == null) closeConnection();
        JSObject result = new JSObject();
        JSArray devices = new JSArray();
        if (usb != null) for (UsbDevice device : usb.getDeviceList().values()) devices.put(deviceInfo(device));
        result.put("hostSupported", hostSupported());
        result.put("devices", devices);
        result.put("state", !hostSupported() ? "unsupported" : permissionCall != null ? "permissionPending" : runtime.connection != null ? "connected" : "idle");
        result.put("connectedDeviceId", runtime.connectedId == null ? "" : runtime.connectedId);
        result.put("backgroundScanning", SdrScanService.isScanning());
        result.put("backgroundReceiving", SdrScanService.isReceiving());
        result.put("lastError", lastError == null ? "" : lastError);
        result.put("rfReady", "receiving".equals(sdr.state));
        result.put("receptionState", sdr.state);
        result.put("fixedResultAvailable", sdr.fixedResultAvailable);
        result.put("reception", sdr.metrics);
        result.put("scan", sdr.scan);
        result.put("scanResumeAvailable", sdr.hasScanSession());
        result.put("receptionError", runtime.serviceError.isEmpty() ? sdr.error : runtime.serviceError);
        result.put("audio", sdr.audio.snapshot());
        result.put("viewportInsets", viewportInsets());
        return result;
    }

    private JSObject viewportInsets() {
        JSObject result = new JSObject();
        if (getBridge() == null || getActivity() == null || getBridge().getWebView() == null) return result;
        View content = getBridge().getWebView(), window = getActivity().getWindow().getDecorView();
        WindowInsetsCompat rootInsets = ViewCompat.getRootWindowInsets(content);
        if (rootInsets == null) return result;
        androidx.core.graphics.Insets bars = rootInsets.getInsets(WindowInsetsCompat.Type.systemBars() | WindowInsetsCompat.Type.displayCutout());
        int[] origin = new int[2], webOrigin = new int[2];
        window.getLocationInWindow(origin); content.getLocationInWindow(webOrigin);
        double[] overlap = SdrViewport.overlap(
            new int[]{origin[0], origin[1], origin[0] + window.getWidth(), origin[1] + window.getHeight()},
            new int[]{webOrigin[0], webOrigin[1], webOrigin[0] + content.getWidth(), webOrigin[1] + content.getHeight()},
            new int[]{bars.left, bars.top, bars.right, bars.bottom}, getContext().getResources().getDisplayMetrics().density);
        String[] sides = {"left", "top", "right", "bottom"};
        for (int i = 0; i < sides.length; i++) result.put(sides[i], overlap[i]);
        return result;
    }

    private void publish() {
        if (!destroyed) notifyListeners("usbStateChanged", snapshot());
    }

    private void execute(PluginCall call, Runnable action) {
        main.post(() -> {
            if (destroyed) { call.reject("플러그인이 종료되었습니다.", "USB_CLOSED"); return; }
            try { action.run(); }
            catch (Exception error) {
                if (permissionCall == call) clearPermission();
                lastError = "USB_ERROR";
                call.reject("USB 처리 실패: " + error.getMessage(), "USB_ERROR", error);
                publish();
            }
        });
    }

    private UsbDevice selected(PluginCall call) {
        if (!hostSupported()) { call.reject("USB Host를 지원하지 않습니다.", "USB_HOST_UNSUPPORTED"); return null; }
        UsbDevice device = find(call.getString("deviceId"));
        if (device == null) { call.reject("장치가 연결되어 있지 않습니다.", "USB_DEVICE_NOT_FOUND"); return null; }
        if (!candidate(device)) { call.reject("현재 진단에서 지원하는 RTL2832U USB ID가 아닙니다.", "USB_DEVICE_UNSUPPORTED"); return null; }
        return device;
    }

    @PluginMethod public void getStatus(PluginCall call) {
        execute(call, () -> { reconcilePermission(); call.resolve(snapshot()); });
    }
    @PluginMethod public void listDevices(PluginCall call) {
        execute(call, () -> { reconcilePermission(); call.resolve(snapshot()); });
    }

    @PluginMethod public void requestDevicePermission(PluginCall call) {
        execute(call, () -> {
            if (permissionCall != null) { call.reject("권한 요청이 진행 중입니다.", "USB_BUSY"); return; }
            UsbDevice device = selected(call);
            if (device == null) return;
            if (usb.hasPermission(device)) { call.resolve(deviceInfo(device)); return; }
            permissionCall = call;
            requestedId = device.getDeviceName();
            requestToken = "bearpoint-usb://permission/" + UUID.randomUUID();
            Intent intent = new Intent(permissionAction).setPackage(getContext().getPackageName()).setData(Uri.parse(requestToken));
            permissionIntent = PendingIntent.getBroadcast(getContext(), 0, intent, PendingIntent.FLAG_IMMUTABLE);
            main.postDelayed(timeout, 90000);
            usb.requestPermission(device, permissionIntent);
            lastError = null;
            publish();
        });
    }

    @PluginMethod public void openDevice(PluginCall call) {
        execute(call, () -> {
            if (SdrScanService.isRunning() && !call.getString("deviceId", "").equals(runtime.connectedId)) {
                call.reject("탐색을 정지한 뒤 다른 USB 장치를 연결하세요."); return;
            }
            if (permissionCall != null) { call.reject("권한 요청이 진행 중입니다.", "USB_BUSY"); return; }
            UsbDevice device = selected(call);
            if (device == null) return;
            if (!usb.hasPermission(device)) { call.reject("USB 권한을 먼저 요청하세요.", "USB_PERMISSION_REQUIRED"); return; }
            if (!device.getDeviceName().equals(runtime.connectedId)) {
                closeConnection();
                runtime.connection = usb.openDevice(device);
                if (runtime.connection == null) {
                    lastError = "USB_OPEN_FAILED";
                    call.reject("USB 연결을 열지 못했습니다. 장치와 다른 수신 앱을 확인하세요.", lastError);
                    publish();
                    return;
                }
                runtime.connectedId = device.getDeviceName();
            }
            lastError = null;
            runtime.serviceError = "";
            call.resolve(snapshot());
            publish();
        });
    }

    @PluginMethod public void closeDevice(PluginCall call) {
        execute(call, () -> {
            failPermission("USB_CANCELLED", "권한 요청을 취소했습니다.");
            SdrScanService.release();
            closeConnection();
            lastError = null;
            call.resolve(snapshot());
            publish();
        });
    }

    private void closeConnection() {
        runtime.closeUsb();
    }

    @PluginMethod public void startReception(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissionForAlias("notifications", call, "onReceptionNotificationPermission");
            return;
        }
        beginReception(call);
    }

    @PermissionCallback private void onReceptionNotificationPermission(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            call.reject("Background reception requires notification permission.");
            return;
        }
        main.post(() -> {
            if (destroyed) { call.reject("Plugin has been destroyed."); return; }
            if (paused) pendingReceptionCall = call;
            else beginReception(call);
        });
    }

    private void beginReception(PluginCall call) {
        execute(call, () -> {
            if (paused) { call.reject("앱 화면에서 수신을 시작하세요."); return; }
            if (runtime.connection == null) { call.reject("USB 연결을 먼저 확인하세요."); return; }
            int hz = call.getInt("frequencyHz", 150000000);
            int rate = call.getInt("sampleRate", 1024000);
            int gain = call.getInt("gainTenthsDb", 100);
            int ppm = call.getInt("ppm", 0);
            String mode = call.getString("mode", "iq"), band = call.getString("band", "vhf");
            int listen = call.getInt("listenFrequencyHz", hz), deemphasis = call.getInt("deemphasisUs", 75);
            if (!SdrSettings.validFrequency(call.getString("band", "vhf"), hz) || !SdrSettings.validRate(rate)
                || gain < -100 || gain > 500 || ppm < -100 || ppm > 100
                || !SdrSettings.validDemodulation(mode, band, hz, listen, rate, deemphasis)) {
                call.reject("수신 설정 범위를 확인하세요."); return;
            }
            sdr.start(runtime.connection, hz, rate, gain, ppm, mode, listen, deemphasis);
            try { SdrScanService.launch(getContext(), "fixed"); }
            catch (RuntimeException failure) { sdr.stop(); throw failure; }
            call.resolve(snapshot()); publish();
        });
    }

    @PluginMethod public void stopReception(PluginCall call) {
        execute(call, () -> {
            SdrScanService.release();
            sdr.stop(() -> call.resolve(snapshot())); publish();
        });
    }

    @PluginMethod public void clearScanHistory(PluginCall call) {
        execute(call, () -> {
            sdr.clearScanHistory();
            call.resolve(snapshot());
            publish();
        });
    }

    @PluginMethod public void clearReceptionResult(PluginCall call) {
        execute(call, () -> {
            sdr.clearReceptionResult();
            runtime.serviceError = "";
            call.resolve(snapshot());
            publish();
        });
    }

    @PluginMethod public void startScan(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 &&
            ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            requestPermissionForAlias("notifications", call, "onNotificationPermission");
            return;
        }
        beginScan(call);
    }

    @PermissionCallback private void onNotificationPermission(PluginCall call) {
        if (ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            call.reject("백그라운드 탐색 알림 권한을 허용하세요.");
            return;
        }
        main.post(() -> {
            if (destroyed) { call.reject("플러그인이 종료되었습니다."); return; }
            if (paused) pendingScanCall = call;
            else beginScan(call);
        });
    }

    private void beginScan(PluginCall call) {
        execute(call, () -> {
            if (paused) { call.reject("앱 화면에서 탐색을 시작하세요."); return; }
            if (runtime.connection == null) { call.reject("USB 연결을 먼저 확인하세요."); return; }
            int gain = call.getInt("gainTenthsDb", 100), ppm = call.getInt("ppm", 0);
            if (gain < -100 || gain > 500 || ppm < -100 || ppm > 100) {
                call.reject("Gain·PPM 설정 범위를 확인하세요."); return;
            }
            SdrScan plan = new SdrScan(call.getString("band", "vhf"), call.getInt("startHz", 148000000),
                call.getInt("endHz", 174000000), call.getInt("sampleRate", 1024000),
                call.getInt("dwellMs", 1000), call.getDouble("thresholdDb", 10d));
            if (Boolean.TRUE.equals(call.getBoolean("resume", false))) sdr.resumeScan(runtime.connection, plan, gain, ppm);
            else sdr.startScan(runtime.connection, plan, gain, ppm);
            try { SdrScanService.launch(getContext(), "scan"); }
            catch (RuntimeException failure) { sdr.stop(); throw failure; }
            call.resolve(snapshot()); publish();
        });
    }

    @PluginMethod public void setAudio(PluginCall call) {
        execute(call, () -> {
            sdr.setAudio(call.getBoolean("enabled"), call.getDouble("volume"));
            call.resolve(snapshot()); publish();
        });
    }

    @Override protected void handleOnPause() {
        main.post(() -> {
            paused = true;
            if (!destroyed && !SdrScanService.isRunning() &&
                ("receiving".equals(sdr.state) || "starting".equals(sdr.state) || "scanning".equals(sdr.state))) {
                sdr.stop(); publish();
            }
        });
    }

    private void clearPermission() {
        main.removeCallbacks(timeout);
        if (permissionIntent != null) permissionIntent.cancel();
        permissionIntent = null;
        permissionCall = null;
        requestedId = null;
        requestToken = null;
    }

    private void completePermission(UsbDevice device) {
        if (permissionCall == null) return;
        PluginCall call = permissionCall;
        clearPermission();
        lastError = null;
        call.resolve(deviceInfo(device));
        publish();
    }

    private void reconcilePermission() {
        if (permissionCall == null) return;
        UsbDevice device = find(requestedId);
        if (device == null) {
            failPermission("USB_DEVICE_DETACHED", "장치가 분리되었습니다.");
        } else if (usb.hasPermission(device)) {
            completePermission(device);
        }
        // Lack of permission alone does not mean denial: the dialog may still be open.
    }

    private void failPermission(String code, String message) {
        if (permissionCall == null) return;
        PluginCall call = permissionCall;
        clearPermission();
        lastError = code;
        call.reject(message, code);
        publish();
    }

    @Override protected void handleOnResume() {
        main.post(() -> {
            if (destroyed) return;
            paused = false;
            reconcilePermission();
            if (pendingScanCall != null) {
                PluginCall scanCall = pendingScanCall;
                pendingScanCall = null;
                beginScan(scanCall);
            }
            if (pendingReceptionCall != null) {
                PluginCall receptionCall = pendingReceptionCall;
                pendingReceptionCall = null;
                beginReception(receptionCall);
            }
            publish();
        });
    }

    @Override protected void handleOnDestroy() {
        main.post(() -> {
            destroyed = true;
            if (pendingReceptionCall != null) { pendingReceptionCall.reject("Plugin has been destroyed."); pendingReceptionCall = null; }
            if (pendingScanCall != null) { pendingScanCall.reject("앱이 종료되어 탐색을 시작하지 않았습니다."); pendingScanCall = null; }
            failPermission("USB_CLOSED", "플러그인이 종료되었습니다.");
            if (!SdrScanService.isRunning()) closeConnection();
            if (registered) getContext().unregisterReceiver(receiver);
            registered = false;
            if (runtime.listener == runtimeListener) runtime.listener = null;
        });
    }
}
