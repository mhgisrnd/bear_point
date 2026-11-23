package com.bearpoint.app;

import android.Manifest;
import android.bluetooth.BluetoothAdapter;
import android.bluetooth.BluetoothClass;
import android.bluetooth.BluetoothDevice;
import android.bluetooth.BluetoothManager;
import android.bluetooth.BluetoothSocket;
import android.content.Context;
import android.content.Intent;
import android.media.AudioDeviceInfo;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.os.ParcelUuid;
import android.os.SystemClock;
import android.net.Uri;
import android.provider.Settings;
import android.util.Log;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.IOException;
import java.io.File;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "IcR30", permissions = {
    @Permission(strings = {Manifest.permission.BLUETOOTH_CONNECT}, alias = "bluetooth"),
    @Permission(strings = {Manifest.permission.RECORD_AUDIO}, alias = "usbAudio"),
    @Permission(strings = {Manifest.permission.POST_NOTIFICATIONS}, alias = "notifications")
})
public final class IcR30Plugin extends Plugin {
    private static final String TAG = "IcR30";
    private static final UUID SPP = UUID.fromString("00001101-0000-1000-8000-00805f9b34fb");
    private static final long CIV_STARTUP_DELAY_MS = 1500;
    private static final long SPP_ATTEMPT_TIMEOUT_MS = 9000;
    private static final long SPP_RETRY_DELAY_MS = 800;
    private static final long CONNECTION_TIMEOUT_MS = 30000;
    private static final long METER_POLL_DELAY_MS = 50;
    private static final long LIVE_METADATA_INTERVAL_MS = 500;
    private static final long TEST_METADATA_INTERVAL_MS = 2000;
    private static final int CONNECTION_VOLUME = 20;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ScheduledExecutorService io = Executors.newSingleThreadScheduledExecutor();
    private final ExecutorService audioIo = Executors.newSingleThreadExecutor(task -> new Thread(task, "ic-r30-usb-audio"));
    private BluetoothSocket socket;
    private IcR30Civ client;
    private ScheduledFuture<?> poll;
    private PluginCall connectingCall;
    private PluginCall settingCall;
    private PluginCall permissionCall;
    private PluginCall audioPermissionCall;
    private boolean audioPermissionCancelled;
    private boolean usbAudioMuted;
    private IcR30UsbAudio usbAudio;
    private volatile int generation;
    private volatile boolean stopped;
    private String state = "idle", deviceId = "", deviceName = "", lastError = "";
    private String connectionProgress = "";
    private Runnable connectionDeadline;
    private JSObject measurement;
    private int volumeLevel = -1;
    private String volumeNotice = "";
    private final IcR30TestRecording test = new IcR30TestRecording();
    private long metadataAt;
    private Runnable testDeadline;
    private boolean preparingTest;

    private File recordingFile;
    private IcR30TestAudio recordingAudio;
    private int[] lastTestAudioPeaks = new int[0];
    private String testAudioNotice = "";
    private IcR30LogStore logStore() { return new IcR30LogStore(getContext().getFilesDir()); }
    private JSObject testSnapshot() {
        JSObject result = new JSObject();
        result.put("active", test.active());
        result.put("preparing",preparingTest);
        result.put("audioNotice", testAudioNotice);
        JSArray records = new JSArray();
        try {
            IcR30LogStore store = logStore();
            for (File file : store.list()) {
                if (test.active() && file.equals(recordingFile)) continue;
                long audioBytes = store.audioPath(file).length();
                JSObject record = new JSObject();
                record.put("id", file.getName());
                record.put("createdAt", file.lastModified());
                record.put("bytes", file.length() + audioBytes);
                record.put("hasAudio", audioBytes > 44);
                records.put(record);
            }
        } catch (IOException error) {
            Log.e(TAG, "IC-R30 log listing failed", error);
            result.put("error", error.getMessage());
        }
        result.put("records", records);
        result.put("available", records.length() > 0);
        result.put("count", test.count());
        result.put("min", test.min());
        result.put("max", test.max());
        result.put("changes", test.changes());
        result.put("meanIntervalMs", test.meanInterval());
        result.put("maxIntervalMs", test.maxInterval());
        result.put("durationMs", test.duration(SystemClock.elapsedRealtime()));
        result.put("reason", test.reason());
        result.put("audioTrace", testAudioTrace());
        return result;
    }

    private JSObject testAudioTrace() {
        JSArray peaks = new JSArray();
        for (int peak : recordingAudio == null ? lastTestAudioPeaks : recordingAudio.peaks()) peaks.put(peak);
        return new JSObject().put("id", recordingFile == null ? "" : recordingFile.getName())
            .put("recordedElapsedMs", test.duration(SystemClock.elapsedRealtime()))
            .put("recordingDurationMs", IcR30TestRecording.LIMIT_MS)
            .put("audioIntervalMs", SdrRecordedAudioPeaks.INTERVAL_MS).put("audioPeaks", peaks);
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
        result.put("connectionProgress", connectionProgress);
        result.put("measurement", measurement == null ? JSObject.NULL : measurement);
        result.put("volume", new JSObject().put("current", volumeLevel).put("default", CONNECTION_VOLUME).put("notice", volumeNotice));
        result.put("test", testSnapshot());
        return result;
    }
    private void publish() { notifyListeners("receiverStateChanged", snapshot()); }

    @PluginMethod public void getUsbAudioStatus(PluginCall call) {
        main.post(() -> syncUsbAudio(call, call.getBoolean("requestPermission", false)));
    }

    @PermissionCallback private void usbAudioPermissionResult(PluginCall call) {
        main.post(() -> {
            audioPermissionCall = null;
            if (audioPermissionCancelled) call.resolve(IcR30UsbAudio.state("idle", ""));
            else if (getPermissionState("usbAudio") == PermissionState.GRANTED) syncUsbAudio(call, false);
            else call.resolve(usbAudioPermissionNeeded());
        });
    }

    private JSObject usbAudioPermissionNeeded() {
        return IcR30UsbAudio.state("permission", "USB 오디오를 사용하려면 Android 마이크 권한을 허용하세요.");
    }

    private void syncUsbAudio(PluginCall call, boolean requestPermission) {
        if (stopped || !"connected".equals(state)) {
            call.resolve(IcR30UsbAudio.state("idle", ""));
            return;
        }
        if (usbAudio != null && !usbAudio.failed()) {
            JSObject audio = usbAudio.snapshot();
            if (recordingAudio != null) audio.put("diagnosticTrace", testAudioTrace());
            call.resolve(audio);
            return;
        }
        AudioDeviceInfo input = IcR30UsbAudio.findInput(getContext());
        if (input == null) {
            closeUsbAudio();
            call.resolve(IcR30UsbAudio.state("waiting", "USB 오디오 연결 대기 중"));
            return;
        }
        if (usbAudio != null && !usbAudio.usesInput(input)) closeUsbAudio();
        PermissionState permission = getPermissionState("usbAudio");
        if (permission != PermissionState.GRANTED) {
            if (audioPermissionCall != null) {
                call.resolve(IcR30UsbAudio.state("starting", "Android 마이크 권한 확인 중…"));
            } else if (requestPermission && permission == PermissionState.DENIED) {
                try {
                    getActivity().startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            Uri.fromParts("package", getContext().getPackageName(), null)));
                    call.resolve(usbAudioPermissionNeeded());
                } catch (android.content.ActivityNotFoundException error) {
                    call.resolve(IcR30UsbAudio.state("permission", "Android 앱 설정에서 마이크 권한을 허용하세요."));
                }
            } else if (requestPermission || permission == PermissionState.PROMPT) {
                audioPermissionCall = call;
                audioPermissionCancelled = false;
                requestPermissionForAlias("usbAudio", call, "usbAudioPermissionResult");
            } else call.resolve(usbAudioPermissionNeeded());
            return;
        }
        if (usbAudio == null) {
            if (!IcR30Service.beginAudio(this::setUsbAudioMuted)) {
                call.resolve(IcR30UsbAudio.state("waiting", "백그라운드 오디오 서비스 시작 대기 중"));
                return;
            }
            int filterLevel = getContext().getSharedPreferences("ic_r30_audio", Context.MODE_PRIVATE).getInt("filterLevel", 0);
            usbAudio = new IcR30UsbAudio(getContext(), main, input, usbAudioMuted, filterLevel, this::updateAudioNotification);
            audioIo.execute(usbAudio);
        }
        call.resolve(usbAudio.snapshot());
    }

    @PluginMethod public void setUsbAudioPlayback(PluginCall call) {
        main.post(() -> {
            if (usbAudio == null || usbAudio.failed()) { call.reject("USB 오디오가 연결되어 있지 않습니다."); return; }
            Object filter = call.getData().opt("filterLevel");
            Object muted = call.getData().opt("muted");
            if (filter != null && (!(filter instanceof Number) ||
                    ((Number) filter).doubleValue() != ((Number) filter).intValue() ||
                    ((Number) filter).intValue() < 0 || ((Number) filter).intValue() > 3)) {
                call.reject("필터 강도는 원음, 약, 중, 강 중에서 선택하세요.");
                return;
            }
            if (muted != null && !(muted instanceof Boolean)) { call.reject("음소거 상태가 올바르지 않습니다."); return; }
            if (filter != null) {
                int level = ((Number) filter).intValue();
                usbAudio.setFilterLevel(level);
                getContext().getSharedPreferences("ic_r30_audio", Context.MODE_PRIVATE).edit().putInt("filterLevel", level).apply();
            }
            if (muted != null) {
                setUsbAudioMuted((Boolean) muted);
            }
            call.resolve(usbAudio.snapshot());
        });
    }

    private void setUsbAudioMuted(boolean muted) {
        if (usbAudio == null || usbAudio.failed()) return;
        usbAudioMuted = muted;
        usbAudio.setMuted(muted);
        updateAudioNotification();
    }

    private void updateAudioNotification() {
        if (usbAudio == null || usbAudio.failed()) IcR30Service.endAudio();
        else IcR30Service.audioChanged(usbAudio.ready(), usbAudio.speakerEnabled(), usbAudioMuted);
    }

    private void closeUsbAudio() {
        audioPermissionCancelled = true;
        if (usbAudio != null) { usbAudio.stop(); usbAudio = null; }
        IcR30Service.endAudio();
    }

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
                deviceId = address;
                deviceName = selected.getName() == null ? "IC-R30" : selected.getName();
                connectingCall = call;
                state = "connecting";
                lastError = "";
                measurement = null;
                int token = ++generation;
                IcR30Service.launch(getContext(), () -> fail("IC-R30 연결 유지가 종료되었습니다."));
                connectionDeadline = () -> {
                    if (token == generation && connectingCall != null) fail(connectionProgress + " · 연결 시간이 초과되었습니다.");
                };
                main.postDelayed(connectionDeadline, CONNECTION_TIMEOUT_MS);
                connectSpp(selected, token, false);
            } catch (RuntimeException error) {
                lastError = error.getMessage();
                if (connectingCall == call) fail(lastError);
                else call.reject(lastError, error);
            }
        });
    }

    private void setConnectionProgress(int token, String progress) {
        if (token != generation || connectingCall == null) return;
        connectionProgress = progress;
        publish();
    }

    @android.annotation.SuppressLint("MissingPermission") // connectPermitted checks BLUETOOTH_CONNECT.
    private void connectSpp(BluetoothDevice device, int token, boolean retry) {
        if (token != generation || connectingCall == null) return;
        setConnectionProgress(token, retry ? "Bluetooth 데이터 연결 재시도 중…" : "Bluetooth 데이터 연결 중…");
        BluetoothSocket opened;
        try {
            opened = device.createRfcommSocketToServiceRecord(SPP);
        } catch (IOException error) {
            onSppFailure(device, token, retry, error);
            return;
        } catch (SecurityException error) {
            fail("Bluetooth 권한을 확인해주세요.");
            return;
        }
        socket = opened;
        Runnable timeout = () -> {
            if (token == generation && socket == opened && !opened.isConnected()) closePendingSocket(opened);
        };
        main.postDelayed(timeout, SPP_ATTEMPT_TIMEOUT_MS);
        io.execute(() -> {
            if (token != generation) return;
            IcR30Civ pending = null;
            boolean sppConnected = false;
            try {
                opened.connect();
                sppConnected = true;
                main.removeCallbacks(timeout);
                Log.d(TAG, "SPP connected; waiting for IC-R30 CI-V startup");
                main.post(() -> setConnectionProgress(token, "Bluetooth 데이터 연결됨 · CI-V 응답 확인 중…"));
                boolean debug = (getContext().getApplicationInfo().flags & android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0;
                IcR30Civ civ = new IcR30Civ(opened.getInputStream(), opened.getOutputStream(), 3000,
                        message -> { if (debug) Log.d(TAG, message); },
                        error -> main.post(() -> {
                            if (token == generation && connectingCall == null && !test.active()) fail(error.getMessage());
                        }));
                pending = civ;
                Thread.sleep(CIV_STARTUP_DELAY_MS);
                if (token != generation) throw new IOException("CI-V 연결 확인이 취소되었습니다.");
                JSObject reading = readInitialCiv(civ, token);
                int level = -1;
                String volumeWarning = "";
                try {
                    if (token != generation) throw new IOException("CI-V 연결 확인이 취소되었습니다.");
                    civ.setVolume(CONNECTION_VOLUME);
                    level = civ.volume();
                    if (level != CONNECTION_VOLUME) volumeWarning = "R30 볼륨을 20으로 맞추지 못했어요. 확인된 값은 " + level + "이에요.";
                } catch (IOException error) {
                    Log.w(TAG, "Failed to initialize receiver volume", error);
                    volumeWarning = "연결 시 R30 볼륨 20 적용을 확인하지 못했어요.";
                }
                int initialVolume = level;
                String initialNotice = volumeWarning;
                main.post(() -> finishConnection(token, civ, reading, initialVolume, initialNotice));
            } catch (InterruptedException cancelled) {
                Thread.currentThread().interrupt();
                closePendingClient(pending);
                main.post(() -> { if (token == generation) fail("Bluetooth 연결이 취소되었습니다."); });
            } catch (IOException | SecurityException error) {
                closePendingClient(pending);
                boolean connected = sppConnected;
                main.post(() -> {
                    if (token != generation) return;
                    if (error instanceof SecurityException) fail("Bluetooth 권한을 확인해주세요.");
                    else if (connected) fail("Bluetooth 데이터는 연결됐지만 CI-V 초기 확인에 실패했습니다. " + error.getMessage());
                    else onSppFailure(device, token, retry, error);
                });
            } finally {
                main.removeCallbacks(timeout);
            }
        });
    }

    private void onSppFailure(BluetoothDevice device, int token, boolean retry, Exception error) {
        Log.w(TAG, "Bluetooth SPP connection attempt failed", error);
        closePendingSocket(socket);
        socket = null;
        if (retry) {
            fail("Bluetooth 데이터 연결(SPP)에 실패했습니다. IC-R30의 데이터 장치 연결과 다른 앱의 연결을 확인하세요.");
            return;
        }
        setConnectionProgress(token, "Bluetooth 데이터 연결 재시도 대기 중…");
        main.postDelayed(() -> connectSpp(device, token, true), SPP_RETRY_DELAY_MS);
    }

    private static void closePendingSocket(BluetoothSocket socket) {
        if (socket == null) return;
        try { socket.close(); }
        catch (IOException error) { Log.w(TAG, "Pending SPP socket close failed", error); }
    }

    private static void closePendingClient(IcR30Civ civ) {
        if (civ == null) return;
        try { civ.close(); }
        catch (IOException error) { Log.w(TAG, "Pending CI-V reader close failed", error); }
    }

    private JSObject readInitialCiv(IcR30Civ civ, int token) throws IOException {
        try { return read(civ); }
        catch (IcR30Civ.ResponseTimeout timeout) {
            if (token != generation) throw timeout;
            Log.w(TAG, "Initial CI-V response timed out; retrying on SPP", timeout);
            main.post(() -> setConnectionProgress(token, "Bluetooth 데이터 연결됨 · CI-V 응답 재확인 중…"));
            return read(civ);
        }
    }

    private void finishConnection(int token, IcR30Civ civ, JSObject reading, int initialVolume, String initialNotice) {
        if (token != generation || connectingCall == null) {
            closePendingClient(civ);
            return;
        }
        clearConnectionProgress();
        client = civ;
        state = "connected";
        measurement = reading;
        volumeLevel = initialVolume;
        volumeNotice = initialNotice;
        PluginCall call = connectingCall;
        connectingCall = null;
        IcR30Service.keepAwakeForOperation(false);
        publish();
        call.resolve(snapshot());
        schedulePoll(token, civ);
    }

    private void clearConnectionProgress() {
        if (connectionDeadline != null) main.removeCallbacks(connectionDeadline);
        connectionDeadline = null;
        connectionProgress = "";
    }
    private JSObject read(IcR30Civ civ) throws IOException { return read(civ, null, 0); }
    private static long requiredLong(JSObject value, String key) throws IOException {
        try { return value.getLong(key); }
        catch (org.json.JSONException error) { throw new IOException("측정값 필드 오류: " + key, error); }
    }
    private JSObject read(IcR30Civ civ, JSObject previous, long metadataIntervalMs) throws IOException {
        JSObject reading = new JSObject();
        if (previous == null || SystemClock.elapsedRealtime() - metadataAt >= metadataIntervalMs) {
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
        schedulePoll(token, civ, METER_POLL_DELAY_MS);
    }
    private boolean pollingAllowed() { return !stopped || test.active(); }
    private void schedulePoll(int token, IcR30Civ civ, long delayMs) {
        if (poll != null || settingCall != null || !pollingAllowed()) return;
        JSObject previous = measurement;
        boolean recording = test.active();
        poll = io.schedule(() -> {
            if (token != generation) return;
            if (!pollingAllowed()) {
                main.post(() -> finishPoll(token, civ, null));
                return;
            }
            try {
                test.queryStarted(System.currentTimeMillis(),SystemClock.elapsedRealtime());
                JSObject reading = read(civ, previous, recording ? TEST_METADATA_INTERVAL_MS : LIVE_METADATA_INTERVAL_MS);
                if (token != generation) return;
                test.sample(requiredLong(reading, "time"), requiredLong(reading, "elapsedMs"),
                    requiredLong(reading, "frequencyHz"), reading.getString("mode"), reading.getInteger("smeter"),
                    requiredLong(reading, "queryMs"), requiredLong(reading, "metadataAgeMs"));
                main.post(() -> finishPoll(token, civ, reading));
            } catch (IOException error) {
                try { test.error(System.currentTimeMillis(),SystemClock.elapsedRealtime(),error.getMessage()); }
                catch(IOException logError){ Log.w(TAG,"Failed to record Bluetooth poll error",logError); }
                main.post(() -> { if (token == generation) fail(error.getMessage()); });
            }
        }, delayMs, TimeUnit.MILLISECONDS);
    }
    private void finishPoll(int token, IcR30Civ civ, JSObject reading) {
        if (token != generation || settingCall != null) return;
        poll = null;
        if (!pollingAllowed()) return;
        if (reading != null) {
            if (usbAudio != null && measurement != null &&
                    (measurement.optLong("frequencyHz") != reading.optLong("frequencyHz") ||
                    !measurement.optString("mode").equals(reading.optString("mode")))) usbAudio.resetDetection();
            measurement = reading;
            lastError = "";
            publish();
        }
        schedulePoll(token, civ, reading == null ? 0 : METER_POLL_DELAY_MS);
    }
    @PluginMethod public void startTest(PluginCall call) {
        main.post(() -> {
            if (!"connected".equals(state) || settingCall != null || measurement == null) {
                call.reject("수신기 연결과 설정 완료 후 테스트를 시작하세요."); return;
            }
            if (test.active()) { call.reject("이미 로그를 기록 중입니다."); return; }
            if (usbAudio == null || !usbAudio.ready()) {
                call.reject("USB 오디오 입력을 연결한 뒤 수신음을 기록하세요."); return;
            }
            int token=generation;IcR30Civ civ=client;
            JSObject context=new JSObject().put("web_asset_revision",MainActivity.WEB_ASSET_REVISION)
                .put("phone_manufacturer",Build.MANUFACTURER).put("phone_model",Build.MODEL).put("android_sdk",Build.VERSION.SDK_INT)
                .put("receiver_name",deviceName).put("receiver_model","IC-R30").put("transport","bluetooth")
                .put("requested_duration_ms",IcR30TestRecording.LIMIT_MS).put("poll_delay_ms",METER_POLL_DELAY_MS)
                .put("settings_scope","queried once before capture; not continuously monitored")
                .put("clock","unix_ms=phone wall clock; elapsed_ms=Android elapsedRealtime relative to capture start");
            try{
                android.content.pm.PackageInfo info=getContext().getPackageManager().getPackageInfo(getContext().getPackageName(),0);
                context.put("app_version_name",info.versionName).put("app_version_code",info.versionCode);
            }catch(android.content.pm.PackageManager.NameNotFoundException error){context.put("app_version_error",error.getMessage());}
            settingCall=call;preparingTest=true;
            IcR30Service.keepAwakeForOperation(true);
            publish();
            if(poll!=null){poll.cancel(false);poll=null;}
            io.execute(()->{
                if(token!=generation)return;
                context.put("rf_gain_raw",readSetting(civ::rfGain));
                if(token!=generation)return;
                context.put("attenuator_code",readSetting(civ::attenuator));
                if(token!=generation)return;
                context.put("squelch_raw",readSetting(civ::squelch));
                if(token!=generation)return;
                try{
                    JSObject reading=read(civ);
                    context.put("initial_measurement",reading);
                    main.post(()->{
                        if(token!=generation)return;
                        settingCall=null;preparingTest=false;measurement=reading;
                        beginTest(call,context);
                    });
                }catch(IOException error){main.post(()->{if(token==generation){settingCall=null;preparingTest=false;call.reject("기록 전 수신기 확인 실패: "+error.getMessage());fail(error.getMessage());}});}
            });
        });
    }
    private interface SettingRead { int read() throws IOException; }
    private JSObject readSetting(SettingRead read){
        long started=SystemClock.elapsedRealtime();JSObject result=new JSObject();
        try{result.put("value",read.read());}
        catch(IOException error){result.put("value",org.json.JSONObject.NULL).put("error",error.getMessage());}
        return result.put("read_unix_ms",System.currentTimeMillis()).put("query_ms",SystemClock.elapsedRealtime()-started);
    }
    private void beginTest(PluginCall call,JSObject context){
            try {
                if (usbAudio == null || !usbAudio.ready()) throw new IOException("USB 오디오 입력이 끊겼습니다.");
                IcR30TestAudio audio = new IcR30TestAudio();
                recordingFile = logStore().create();
                try { test.start(recordingFile, SystemClock.elapsedRealtime(),System.currentTimeMillis(),context.toString()); }
                catch (IOException error) {
                    if (!recordingFile.delete()) Log.e(TAG, "Failed recording file cleanup: " + recordingFile.getName());
                    File sidecar=new File(recordingFile.getPath()+".jsonl");if(sidecar.exists()&&!sidecar.delete())Log.w(TAG,"Failed recording detail cleanup");
                    throw error;
                }
                testAudioNotice = "";
                lastTestAudioPeaks = new int[0];
                recordingAudio = audio;
                usbAudio.setDiagnosticAudio(audio);
                if (testDeadline != null) main.removeCallbacks(testDeadline);
                testDeadline = () -> {
                    try { stopTestRecording("time_limit"); publish(); }
                    catch (IOException error) { fail("테스트 기록 종료 실패: " + error.getMessage()); }
                };
                main.postDelayed(testDeadline, IcR30TestRecording.LIMIT_MS);
                publish();
                call.resolve(snapshot());
            } catch (IOException error) {
                IcR30Service.keepAwakeForOperation(false);
                publish();
                call.reject("테스트 기록 시작 실패: " + error.getMessage(), error);
            }
            finally { if("connected".equals(state)&&client!=null)schedulePoll(generation,client); }
    }
    private void stopTestRecording(String reason) throws IOException {
        if (testDeadline != null) { main.removeCallbacks(testDeadline); testDeadline = null; }
        IcR30TestAudio audio = recordingAudio;
        recordingAudio = null;
        if (usbAudio != null) usbAudio.setDiagnosticAudio(null);
        try { test.stop(reason,System.currentTimeMillis(),SystemClock.elapsedRealtime()); }
        finally {
            if (audio != null) {
                try {
                    int samples = audio.save(logStore().audioPath(recordingFile));
                    testAudioNotice = samples == 0 ? "수신음 없음 · S-Meter만 저장되었습니다."
                        : String.format(java.util.Locale.ROOT, "수신음 %.2f초 저장", samples / (double) IcR30TestAudio.RATE);
                } catch (IOException error) {
                    Log.e(TAG, "Failed to save diagnostic audio", error);
                    testAudioNotice = "수신음 저장 실패 · S-Meter 기록을 확인하세요.";
                } finally {
                    lastTestAudioPeaks = audio.peaks();
                }
            }
            if (settingCall == null && connectingCall == null) IcR30Service.keepAwakeForOperation(false);
            if (stopped) measurement = null;
        }
    }
    @PluginMethod public void stopTest(PluginCall call) {
        main.post(() -> {
            try { stopTestRecording("manual"); publish(); call.resolve(snapshot()); }
            catch (IOException error) { fail("테스트 기록 종료 실패: " + error.getMessage()); call.reject(lastError, error); }
        });
    }
    @PluginMethod public void shareTest(PluginCall call) {
        main.post(() -> {
            if (test.active()) { call.reject("기록을 종료한 뒤 ZIP을 공유하세요."); return; }
            if (stopped) { call.reject("앱 화면에서 ZIP을 공유하세요."); return; }
            SdrDiagnosticExport.shareSelection(call, getActivity(), logStore()::archive, "IC-R30 수신 진단 ZIP 공유");
        });
    }
    @PluginMethod public void saveTest(PluginCall call) {
        main.post(() -> {
            if (test.active()) { call.reject("기록을 종료한 뒤 ZIP을 저장하세요."); return; }
            try {
                IcR30LogStore store = logStore();
                List<File> sources = SdrDiagnosticExport.selectedFiles(call, store::find);
                String name = sources.size() == 1 ? store.archivePath(sources.get(0)).getName() : "ic-r30-diagnostics.zip";
                startActivityForResult(call, SdrDiagnosticExport.createDocument(name), "saveTestResult");
            } catch (IOException | RuntimeException error) {
                call.reject("ZIP 저장 실패: " + error.getMessage(), error);
            }
        });
    }

    @PluginMethod public void getTestAudio(PluginCall call) {
        main.post(() -> {
            if (test.active()) { call.reject("기록을 종료한 뒤 수신음을 들을 수 있습니다."); return; }
            try {
                IcR30LogStore store = logStore();
                File audio = store.audioPath(store.find(call.getString("id", "")));
                if (!audio.isFile() || audio.length() <= 44) throw new IOException("저장된 수신음이 없습니다.");
                call.resolve(new JSObject().put("uri", Uri.fromFile(audio).toString()));
            } catch (IOException error) { call.reject(error.getMessage(), error); }
        });
    }

    @ActivityCallback private void saveTestResult(PluginCall call, ActivityResult result) {
        Uri destination = SdrDiagnosticExport.destination(call, result);
        if (destination == null) return;
        SdrDiagnosticExport.copy(call, getContext().getContentResolver(), logStore()::archive, destination);
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

    @PluginMethod public void setVolume(PluginCall call) {
        main.post(() -> {
            Integer level = call.getInt("level");
            if (level == null || level < 0 || level > 39) { call.reject("R30 볼륨은 0–39 범위여야 합니다."); return; }
            if (!"connected".equals(state) || client == null) { call.reject("IC-R30을 먼저 연결하세요."); return; }
            if (settingCall != null || test.active()) { call.reject("수신기 설정 또는 진단 기록이 진행 중입니다."); return; }
            int token = generation;
            IcR30Civ civ = client;
            settingCall = call;
            IcR30Service.keepAwakeForOperation(true);
            if (poll != null) { poll.cancel(false); poll = null; }
            io.execute(() -> {
                if (token != generation) return;
                try {
                    civ.setVolume(level);
                    int applied = civ.volume();
                    main.post(() -> finishVolumeChange(token, civ, call, level, applied));
                } catch (IOException error) {
                    Log.w(TAG, "Failed to set receiver volume", error);
                    main.post(() -> finishVolumeChange(token, civ, call, level, -1));
                }
            });
        });
    }

    private void finishVolumeChange(int token, IcR30Civ civ, PluginCall call, int requested, int applied) {
        if (token != generation) return;
        settingCall = null;
        IcR30Service.keepAwakeForOperation(false);
        volumeLevel = applied;
        volumeNotice = applied == requested ? "" : "R30 볼륨 변경을 확인하지 못했어요.";
        publish();
        call.resolve(snapshot());
        schedulePoll(token, civ);
    }

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
            IcR30Service.keepAwakeForOperation(true);
            if (poll != null) { poll.cancel(false); poll = null; }
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
                        IcR30Service.keepAwakeForOperation(false);
                        if (usbAudio != null) usbAudio.resetDetection();
                        measurement = reading;
                        publish();
                        call.resolve(snapshot());
                        schedulePoll(token, civ);
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
        clearConnectionProgress();
        closeUsbAudio();
        IcR30Service.release();
        ++generation;
        if (poll != null) { poll.cancel(false); poll = null; }
        BluetoothSocket old = socket;
        IcR30Civ oldClient = client;
        socket = null;
        client = null;
        state = "idle";
        measurement = null;
        volumeLevel = -1;
        volumeNotice = "";
        deviceId = deviceName = "";
        if (connectingCall != null) { connectingCall.reject(reason); connectingCall = null; }
        if (settingCall != null) { settingCall.reject(reason); settingCall = null; }
        preparingTest=false;
        IOException closeError = null;
        try {
            try { test.connectionClosed(System.currentTimeMillis(),SystemClock.elapsedRealtime(),reason); }
            finally { stopTestRecording("disconnected"); }
        }
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
    @Override protected void handleOnStart() {
        main.post(() -> {
            stopped = false;
            IcR30Service.setBackground(false);
            if (client != null) schedulePoll(generation, client, 0);
        });
    }
    @Override protected void handleOnStop() {
        main.post(() -> {
            stopped = true;
            IcR30Service.setBackground(true);
            if (!test.active() && measurement != null) {
                measurement = null;
                publish();
            }
        });
    }
    @Override protected void handleOnDestroy() {
        main.post(() -> {
            closeSession("앱 종료로 IC-R30 연결을 해제했습니다.");
            io.shutdownNow();
            audioIo.shutdownNow();
        });
    }
}
