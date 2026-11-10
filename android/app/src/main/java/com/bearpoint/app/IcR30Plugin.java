package com.bearpoint.app;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.os.SystemClock;
import android.net.Uri;
import androidx.core.content.FileProvider;
import android.provider.Settings;
import android.util.Log;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.IOException;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.util.UUID;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "IcR30", permissions = {
    @Permission(strings = {Manifest.permission.BLUETOOTH_CONNECT}, alias = "bluetooth"),
    @Permission(strings = {Manifest.permission.POST_NOTIFICATIONS}, alias = "notifications")
})
public final class IcR30Plugin extends Plugin {
    private static final String TAG = "IcR30";
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805f9b34fb");
    private static final long CIV_STARTUP_DELAY_MS = 1500;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ScheduledExecutorService io = Executors.newSingleThreadScheduledExecutor();
    private BluetoothSocket socket;
    private IcR30Civ client;
    private ScheduledFuture<?> poll;
    private PluginCall connectingCall;
    private PluginCall settingCall;
    private PluginCall permissionCall;
    private volatile int generation;
    private boolean stopped;
    private String state = "idle", deviceId = "", deviceName = "", lastError = "";
    private JSObject measurement;
    private final IcR30TestRecording test = new IcR30TestRecording();
    private long metadataAt;
    private Runnable testDeadline;

    private File recordingFile;
    private IcR30LogStore logStore() { return new IcR30LogStore(getContext().getFilesDir()); }
    private JSObject testSnapshot() {
        JSObject result = new JSObject();
        result.put("active", test.active());
        JSArray records = new JSArray();
        try {
            for (File file : logStore().list()) {
                if (test.active() && file.equals(recordingFile)) continue;
                JSObject record = new JSObject();
                record.put("id", file.getName());
                record.put("createdAt", file.lastModified());
                record.put("bytes", file.length());
                records.put(record);
            }
        } catch (IOException error) {
            Log.e(TAG, "IC-R30 log listing failed", error);
            result.put("error", error.getMessage());
        }
        result.put("records", records);
        result.put("available", records.length() > 0);
        result.put("count", test.count());
        result.put("marks", test.marks());
        result.put("min", test.min());
        result.put("max", test.max());
        result.put("changes", test.changes());
        result.put("meanIntervalMs", test.meanInterval());
        result.put("maxIntervalMs", test.maxInterval());
        result.put("durationMs", test.duration(SystemClock.elapsedRealtime()));
        result.put("reason", test.reason());
        JSArray points = new JSArray();
        for (long[] point : test.recent()) {
            JSArray pair = new JSArray();
            pair.put(point[0]); pair.put(point[1]);
            points.put(pair);
        }
        result.put("recent", points);
        return result;
    }

    private BluetoothAdapter adapter() {
        BluetoothManager manager = (BluetoothManager) getContext().getSystemService(Context.BLUETOOTH_SERVICE);
        return manager == null ? null : manager.getAdapter();
    }
    private boolean permitted() {
        return Build.VERSION.SDK_INT < 31 || getPermissionState("bluetooth") == PermissionState.GRANTED;
    }
    private JSObject snapshot() {
        BluetoothAdapter adapter = adapter();
        JSObject result = new JSObject();
        result.put("supported", adapter != null);
        result.put("permissionGranted", permitted());
        result.put("enabled", adapter != null && permitted() && adapter.isEnabled());
        result.put("state", state);
        result.put("deviceId", deviceId);
        result.put("deviceName", deviceName);
        result.put("error", lastError);
        result.put("measurement", measurement == null ? JSObject.NULL : measurement);
        result.put("test", testSnapshot());
        return result;
    }
    private void publish() { notifyListeners("receiverStateChanged", snapshot()); }

    @PluginMethod public void getStatus(PluginCall call) {
        main.post(() -> {
            try { call.resolve(snapshot()); }
            catch (SecurityException error) { call.reject("Bluetooth 권한을 확인해주세요.", error); }
        });
    }
    @PluginMethod public void listDevices(PluginCall call) {
        main.post(() -> {
            if (!permitted()) {
                if (permissionCall != null) { call.reject("Bluetooth 권한 요청이 진행 중입니다."); return; }
                permissionCall = call;
                requestPermissionForAlias("bluetooth", call, "bluetoothPermissionResult");
            } else listPaired(call);
        });
    }
    @PermissionCallback private void bluetoothPermissionResult(PluginCall call) {
        main.post(() -> {
            permissionCall = null;
            if (!permitted()) { call.reject("근처 기기 권한을 허용해야 IC-R30에 연결할 수 있습니다."); return; }
            listPaired(call);
        });
    }
    private void listPaired(PluginCall call) {
        try {
            BluetoothAdapter adapter = adapter();
            if (adapter == null) throw new IllegalStateException("Bluetooth를 지원하지 않는 기기입니다.");
            if (!adapter.isEnabled()) throw new IllegalStateException("Android 설정에서 Bluetooth를 켜고 IC-R30과 페어링하세요.");
            JSArray devices = new JSArray();
            for (BluetoothDevice device : adapter.getBondedDevices()) {
                JSObject info = new JSObject();
                info.put("deviceId", device.getAddress());
                info.put("name", device.getName() == null ? "Bluetooth 기기" : device.getName());
                info.put("deviceType", device.getType());
                BluetoothClass deviceClass = device.getBluetoothClass();
                info.put("deviceClass", deviceClass == null ? JSObject.NULL : deviceClass.getDeviceClass());
                info.put("majorDeviceClass", deviceClass == null ? JSObject.NULL : deviceClass.getMajorDeviceClass());
                ParcelUuid[] cachedUuids = device.getUuids();
                JSArray serviceUuids = new JSArray();
                boolean sppSupported = false;
                if (cachedUuids != null) {
                    for (ParcelUuid service : cachedUuids) {
                        serviceUuids.put(service.getUuid().toString());
                        if (SPP.equals(service.getUuid())) sppSupported = true;
                    }
                }
                info.put("serviceUuids", serviceUuids);
                info.put("serviceInfoAvailable", cachedUuids != null && cachedUuids.length > 0);
                info.put("sppSupported", sppSupported);
                devices.put(info);
            }
            JSObject result = snapshot();
            result.put("devices", devices);
            call.resolve(result);
        } catch (IllegalStateException | SecurityException error) { call.reject(error.getMessage(), error); }
    }
    @PluginMethod public void openSettings(PluginCall call) {
        main.post(() -> {
            try { getActivity().startActivity(new Intent(Settings.ACTION_BLUETOOTH_SETTINGS)); call.resolve(); }
            catch (android.content.ActivityNotFoundException error) { call.reject("Bluetooth 설정을 열지 못했습니다.", error); }
        });
    }
    @PluginMethod public void connect(PluginCall call) {
        main.post(() -> {
            if (permissionCall != null) { call.reject("권한 요청이 진행 중입니다."); return; }
            if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
                permissionCall = call;
                requestPermissionForAlias("notifications", call, "connectionPermissionResult");
            } else connectPermitted(call);
        });
    }
    @PermissionCallback private void connectionPermissionResult(PluginCall call) {
        permissionCall = null;
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") != PermissionState.GRANTED) {
            call.reject("연결 유지 알림을 표시하려면 알림 권한을 허용해주세요.");
            return;
        }
        connectPermitted(call);
    }
    private void connectPermitted(PluginCall call) {
        main.post(() -> {
            if (stopped) { call.reject("앱 화면으로 돌아온 뒤 다시 연결하세요."); return; }
            if (socket != null || connectingCall != null) { call.reject("기존 수신기 연결을 먼저 해제하세요."); return; }
            if (!permitted()) { call.reject("기기 목록에서 Bluetooth 권한을 먼저 허용하세요."); return; }
            if (!IcR30Service.notificationsAllowed(getContext())) { call.reject("앱 설정에서 IC-R30 연결 알림을 허용해주세요."); return; }
            try {
                BluetoothAdapter adapter = adapter();
                if (adapter == null || !adapter.isEnabled()) throw new IllegalStateException("Bluetooth를 켜주세요.");
                String address = call.getString("deviceId", "");
                BluetoothDevice selected = null;
                for (BluetoothDevice device : adapter.getBondedDevices()) {
                    if (device.getAddress().equals(address)) selected = device;
                }
                if (selected == null) throw new IllegalArgumentException("페어링된 IC-R30을 선택해주세요.");
                BluetoothSocket opened = selected.createRfcommSocketToServiceRecord(SPP);
                socket = opened;
                deviceId = address;
                deviceName = selected.getName() == null ? "IC-R30" : selected.getName();
                connectingCall = call;
                state = "connecting";
                lastError = "";
                measurement = null;
                int token = ++generation;
                IcR30Service.launch(getContext(), () -> fail("IC-R30 연결 유지가 종료되었습니다."));
                publish();
                Runnable timeout = () -> {
                    if (token == generation && connectingCall != null) fail("Bluetooth 연결 시간이 초과되었습니다. IC-R30 SPP 설정과 다른 앱의 연결을 확인하세요.");
                };
                main.postDelayed(timeout, 20000);
                io.execute(() -> {
                    IcR30Civ pendingClient = null;
                    try {
                        opened.connect();
                        Log.d(TAG, "SPP connected; waiting for IC-R30 CI-V startup");
                        boolean debug = (getContext().getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
                        IcR30Civ civ = new IcR30Civ(opened.getInputStream(), opened.getOutputStream(), 3000,
                            message -> { if (debug) Log.d(TAG, message); });
                        pendingClient = civ;
                        // The IC-R30 accepts RFCOMM before its CI-V endpoint is ready; early requests get no reply.
                        try { Thread.sleep(CIV_STARTUP_DELAY_MS); }
                        catch (InterruptedException error) {
                            Thread.currentThread().interrupt();
                            throw new IOException("CI-V 연결 확인이 취소되었습니다.", error);
                        }
                        if (token != generation) throw new IOException("CI-V 연결 확인이 취소되었습니다.");
                        JSObject reading = read(civ);
                        main.post(() -> {
                            main.removeCallbacks(timeout);
                            if (token != generation) {
                                try { civ.close(); }
                                catch (IOException error) { Log.w(TAG, "Cancelled CI-V reader cleanup failed", error); }
                                return;
                            }
                            client = civ;
                            state = "connected";
                            measurement = reading;
                            connectingCall = null;
                            publish();
                            call.resolve(snapshot());
                            schedulePoll(token, civ);
                        });
                    } catch (IOException | SecurityException error) {
                        if (pendingClient != null) {
                            try { pendingClient.close(); }
                            catch (IOException closeError) { error.addSuppressed(closeError); }
                        }
                        main.post(() -> {
                            main.removeCallbacks(timeout);
                            if (token == generation) fail(error.getMessage());
                        });
                    }
                });
            } catch (IOException | RuntimeException error) {
                lastError = error.getMessage();
                if (connectingCall == call) closeSession(lastError);
                else call.reject(lastError, error);
            }
        });
    }
    private JSObject read(IcR30Civ civ) throws IOException { return read(civ, false, null); }
    private static long requiredLong(JSObject value, String key) throws IOException {
        try { return value.getLong(key); }
        catch (org.json.JSONException error) { throw new IOException("측정값 필드 오류: " + key, error); }
    }
    private JSObject read(IcR30Civ civ, boolean fast, JSObject previous) throws IOException {
        JSObject reading = new JSObject();
        if (!fast || previous == null || SystemClock.elapsedRealtime() - metadataAt >= 2000) {
            reading.put("frequencyHz", civ.frequency());
            reading.put("mode", civ.mode());
            metadataAt = SystemClock.elapsedRealtime();
        } else {
            reading.put("frequencyHz", requiredLong(previous, "frequencyHz"));
            reading.put("mode", previous.getString("mode"));
        }
        long queryStart = SystemClock.elapsedRealtime();
        reading.put("smeter", civ.smeter());
        reading.put("time", System.currentTimeMillis());
        reading.put("elapsedMs", SystemClock.elapsedRealtime());
        reading.put("queryMs", SystemClock.elapsedRealtime() - queryStart);
        reading.put("metadataAgeMs", SystemClock.elapsedRealtime() - metadataAt);
        return reading;
    }
    private void schedulePoll(int token, IcR30Civ civ) {
        JSObject previous = measurement;
        poll = io.schedule(() -> {
            if (token != generation) return;
            try {
                JSObject reading = read(civ, test.active(), previous);
                if (token != generation) return;
                test.sample(requiredLong(reading, "time"), requiredLong(reading, "elapsedMs"),
                    requiredLong(reading, "frequencyHz"), reading.getString("mode"), reading.getInteger("smeter"),
                    requiredLong(reading, "queryMs"), requiredLong(reading, "metadataAgeMs"));
                main.post(() -> {
                    if (token != generation) return;
                    measurement = reading;
                    lastError = "";
                    publish();
                    schedulePoll(token, civ);
                });
            } catch (IOException error) {
                main.post(() -> { if (token == generation) fail(error.getMessage()); });
            }
        }, test.active() ? IcR30TestRecording.POLL_DELAY_MS : 500, TimeUnit.MILLISECONDS);
    }
    @PluginMethod public void startTest(PluginCall call) {
        main.post(() -> {
            if (!"connected".equals(state) || settingCall != null || measurement == null) {
                call.reject("수신기 연결과 설정 완료 후 테스트를 시작하세요."); return;
            }
            try {
                if (test.active()) { call.reject("이미 로그를 기록 중입니다."); return; }
                recordingFile = logStore().create();
                try { test.start(recordingFile, SystemClock.elapsedRealtime()); }
                catch (IOException error) {
                    if (!recordingFile.delete()) Log.e(TAG, "Failed recording file cleanup: " + recordingFile.getName());
                    throw error;
                }
                if (testDeadline != null) main.removeCallbacks(testDeadline);
                testDeadline = () -> {
                    try { stopTestRecording("time_limit"); publish(); }
                    catch (IOException error) { fail("테스트 기록 종료 실패: " + error.getMessage()); }
                };
                main.postDelayed(testDeadline, IcR30TestRecording.LIMIT_MS);
                publish();
                call.resolve(snapshot());
            } catch (IOException error) { call.reject("테스트 기록 시작 실패: " + error.getMessage(), error); }
        });
    }
    private void stopTestRecording(String reason) throws IOException {
        if (testDeadline != null) { main.removeCallbacks(testDeadline); testDeadline = null; }
        test.stop(reason);
    }
    @PluginMethod public void stopTest(PluginCall call) {
        main.post(() -> {
            try { stopTestRecording("manual"); publish(); call.resolve(snapshot()); }
            catch (IOException error) { fail("테스트 기록 종료 실패: " + error.getMessage()); call.reject(lastError, error); }
        });
    }
    @PluginMethod public void markTest(PluginCall call) {
        main.post(() -> {
            try {
                test.mark(System.currentTimeMillis(), SystemClock.elapsedRealtime());
                publish(); call.resolve(snapshot());
            } catch (IOException error) { call.reject("청취 표시 기록 실패: " + error.getMessage(), error); }
        });
    }
    @PluginMethod public void shareTest(PluginCall call) {
        main.post(() -> {
            if (test.active()) { call.reject("테스트를 종료한 뒤 CSV를 공유하세요."); return; }
            if (stopped) { call.reject("앱 화면에서 CSV를 공유하세요."); return; }
            try {
                File source = logStore().find(call.getString("id", ""));
                File shared = new File(getContext().getCacheDir(), source.getName());
                try (FileInputStream input = new FileInputStream(source);
                     FileOutputStream output = new FileOutputStream(shared)) {
                    byte[] buffer = new byte[8192];
                    int count;
                    while ((count = input.read(buffer)) != -1) output.write(buffer, 0, count);
                }
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", shared);
                Intent send = new Intent(Intent.ACTION_SEND).setType("text/csv").putExtra(Intent.EXTRA_STREAM, uri)
                    .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                getActivity().startActivity(Intent.createChooser(send, "S-Meter 테스트 CSV 공유"));
                call.resolve();
            } catch (IOException | RuntimeException error) { call.reject("CSV 공유 실패: " + error.getMessage(), error); }
        });
    }
    @PluginMethod public void deleteTest(PluginCall call) {
        main.post(() -> {
            if (test.active()) { call.reject("기록을 종료한 뒤 삭제하세요."); return; }
            try {
                logStore().delete(call.getString("id", ""));
                publish();
                call.resolve(snapshot());
            } catch (IOException error) { call.reject("로그 삭제 실패: " + error.getMessage(), error); }
        });
    }
    @PluginMethod public void setFrequency(PluginCall call) { set(call, true); }
    @PluginMethod public void setMode(PluginCall call) { set(call, false); }
    private void set(PluginCall call, boolean frequency) {
        main.post(() -> {
            if (!"connected".equals(state) || client == null) { call.reject("IC-R30을 먼저 연결하세요."); return; }
            if (test.active()) { call.reject("테스트를 종료한 뒤 주파수·모드를 변경하세요."); return; }
            if (settingCall != null) { call.reject("수신기 설정이 진행 중입니다."); return; }
            final long hz;
            final String mode = call.getString("mode", "");
            try {
                Object value = call.getData().opt("frequencyHz");
                if (frequency && (!(value instanceof Number) || !Double.isFinite(((Number) value).doubleValue()) ||
                        ((Number) value).doubleValue() != ((Number) value).longValue())) {
                    throw new IllegalArgumentException("주파수는 정수 Hz 값이어야 합니다.");
                }
                hz = frequency ? ((Number) value).longValue() : 0;
                if (frequency) IcR30Civ.frequencyCommand(hz); else IcR30Civ.modeCommand(mode);
            } catch (IllegalArgumentException error) { call.reject(error.getMessage(), error); return; }
            int token = generation;
            IcR30Civ civ = client;
            settingCall = call;
            measurement = null;
            publish();
            io.execute(() -> {
                if (token != generation) return;
                try {
                    if (frequency) civ.setFrequency(hz); else civ.setMode(mode);
                    JSObject reading = read(civ);
                    main.post(() -> {
                        if (token != generation) return;
                        settingCall = null;
                        measurement = reading;
                        publish();
                        call.resolve(snapshot());
                    });
                } catch (IOException error) {
                    main.post(() -> { if (token == generation) fail(error.getMessage()); });
                }
            });
        });
    }
    @PluginMethod public void disconnect(PluginCall call) {
        main.post(() -> {
            IOException error = closeSession("Bluetooth 연결이 취소되었습니다.");
            publish();
            if (error == null) call.resolve(snapshot()); else call.reject(lastError, error);
        });
    }
    private IOException closeSession(String reason) {
        IcR30Service.release();
        ++generation;
        if (poll != null) { poll.cancel(false); poll = null; }
        BluetoothSocket old = socket;
        IcR30Civ oldClient = client;
        socket = null;
        client = null;
        state = "idle";
        measurement = null;
        deviceId = deviceName = "";
        if (connectingCall != null) { connectingCall.reject(reason); connectingCall = null; }
        if (settingCall != null) { settingCall.reject(reason); settingCall = null; }
        IOException closeError = null;
        try { stopTestRecording("disconnected"); }
        catch (IOException error) { closeError = error; }
        if (old != null) {
            try { old.close(); }
            catch (IOException error) {
                if (closeError == null) closeError = error;
                else closeError.addSuppressed(error);
            }
        }
        if (oldClient != null) {
            try { oldClient.close(); }
            catch (IOException error) {
                if (closeError == null) closeError = error;
                else closeError.addSuppressed(error);
            }
        }
        if (closeError != null) {
            lastError = "Bluetooth 연결 정리 실패: " + closeError.getMessage();
            Log.e(TAG, lastError, closeError);
        }
        return closeError;
    }
    private void fail(String reason) {
        lastError = reason == null ? "Bluetooth 통신 오류가 발생했습니다." : reason;
        Log.w(TAG, lastError);
        closeSession(lastError);
        publish();
    }
    @Override protected void handleOnStart() { main.post(() -> stopped = false); }
    @Override protected void handleOnStop() {
        main.post(() -> stopped = true);
    }
    @Override protected void handleOnDestroy() {
        main.post(() -> {
            closeSession("앱 종료로 IC-R30 연결을 해제했습니다.");
            io.shutdownNow();
        });
    }
}
