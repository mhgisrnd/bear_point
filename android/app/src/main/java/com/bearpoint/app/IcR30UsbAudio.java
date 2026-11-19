package com.bearpoint.app;

import android.annotation.SuppressLint;
import android.media.AudioDeviceInfo;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Process;
import android.os.SystemClock;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

/** Foreground-only USB audio capture, independent of the IC-R30 serial connection. */
final class IcR30UsbAudio implements Runnable {
    private static final int RATE = IcR30AudioAnalysis.RATE;
    private static final int POINTS = 120;
    private static final long ROUTE_TIMEOUT_MS = 1000;
    private static final long READ_TIMEOUT_MS = 2000;
    private static final long PUBLISH_MS = 125;
    private final AudioManager manager;
    private volatile boolean stopped;
    private volatile int tuningRevision;
    private volatile JSObject status = state("starting", "USB 오디오 입력 확인 중…");

    IcR30UsbAudio(AudioManager manager) { this.manager = manager; }
    void stop() { stopped = true; }
    void resetDetection() { tuningRevision++; }
    JSObject snapshot() { return status; }

    static JSObject state(String state, String message) {
        return new JSObject().put("state", state).put("message", message);
    }

    private static boolean usbInput(AudioDeviceInfo device) {
        if (device == null || !device.isSource()) return false;
        return device.getType() == AudioDeviceInfo.TYPE_USB_DEVICE ||
                device.getType() == AudioDeviceInfo.TYPE_USB_HEADSET ||
                device.getType() == AudioDeviceInfo.TYPE_USB_ACCESSORY;
    }

    @SuppressLint("MissingPermission") // IcR30Plugin checks RECORD_AUDIO before starting this worker.
    @Override public void run() {
        if (stopped) return;
        try {
            AudioDeviceInfo input = null;
            for (AudioDeviceInfo device : manager.getDevices(AudioManager.GET_DEVICES_INPUTS)) {
                if (usbInput(device)) { input = device; break; }
            }
            if (input == null) throw new IllegalStateException("USB 오디오 입력이 없습니다. 사운드카드 연결을 확인하세요.");
            int channel = AudioFormat.CHANNEL_IN_MONO, encoding = AudioFormat.ENCODING_PCM_16BIT;
            int minimum = AudioRecord.getMinBufferSize(RATE, channel, encoding);
            if (minimum <= 0) throw new IllegalStateException("48 kHz 모노 오디오 입력을 열 수 없습니다.");
            int source = Build.VERSION.SDK_INT >= 24 && "true".equals(
                    manager.getProperty(AudioManager.PROPERTY_SUPPORT_AUDIO_SOURCE_UNPROCESSED))
                    ? MediaRecorder.AudioSource.UNPROCESSED : MediaRecorder.AudioSource.VOICE_RECOGNITION;
            AudioRecord record = new AudioRecord.Builder().setAudioSource(source)
                    .setAudioFormat(new AudioFormat.Builder().setSampleRate(RATE)
                            .setEncoding(encoding).setChannelMask(channel).build())
                    .setBufferSizeInBytes(Math.max(minimum, IcR30AudioAnalysis.BLOCK * 8)).build();
            try {
                if (record.getState() != AudioRecord.STATE_INITIALIZED || !record.setPreferredDevice(input))
                    throw new IllegalStateException("USB 오디오 입력을 선택할 수 없습니다.");
                if (!stopped) capture(record, input);
            } finally {
                try {
                    if (record.getRecordingState() == AudioRecord.RECORDSTATE_RECORDING) record.stop();
                } finally { record.release(); }
            }
        } catch (InterruptedException cancelled) {
            Thread.currentThread().interrupt();
        } catch (RuntimeException error) {
            if (!stopped) status = state("error", "오디오 입력 실패 · " + error.getMessage());
        }
    }

    private void capture(AudioRecord record, AudioDeviceInfo input) throws InterruptedException {
        Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO);
        record.startRecording();
        if (record.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING)
            throw new IllegalStateException("USB 오디오 녹음을 시작할 수 없습니다.");
        long started = SystemClock.elapsedRealtime(), lastRead = started, updated = 0;
        boolean routed = false;
        int filled = 0, revision = tuningRevision;
        short[] samples = new short[IcR30AudioAnalysis.BLOCK];
        IcR30AudioAnalysis analysis = new IcR30AudioAnalysis();
        while (!stopped) {
            int count = record.read(samples, filled, samples.length - filled, AudioRecord.READ_NON_BLOCKING);
            if (count < 0) throw new IllegalStateException("USB 오디오 읽기 오류 (" + count + ")");
            long now = SystemClock.elapsedRealtime();
            AudioDeviceInfo actual = record.getRoutedDevice();
            if (actual == null || actual.getId() != input.getId()) {
                if (routed || now - started >= ROUTE_TIMEOUT_MS)
                    throw new IllegalStateException("USB 사운드카드 입력에 연결되지 않았습니다.");
                filled = 0;
                Thread.sleep(4);
                continue;
            }
            routed = true;
            if (revision != tuningRevision) {
                revision = tuningRevision;
                analysis = new IcR30AudioAnalysis();
                filled = 0;
                updated = 0;
                continue;
            }
            if (count == 0) {
                if (now - lastRead >= READ_TIMEOUT_MS) throw new IllegalStateException("USB 오디오 샘플을 받지 못했습니다.");
                Thread.sleep(4);
                continue;
            }
            lastRead = now;
            filled += count;
            if (filled < samples.length) continue;
            filled = 0;
            analysis.observe(samples, now);
            if (updated == 0 || now - updated >= PUBLISH_MS) {
                status = frame(input.getProductName().toString(), samples, analysis.detector);
                updated = now;
            }
        }
    }

    private static JSObject frame(String device, short[] samples, SdrCwDetector detector) {
        JSArray low = new JSArray(), high = new JSArray();
        for (int i = 0; i < POINTS; i++) {
            int min = Short.MAX_VALUE, max = Short.MIN_VALUE;
            for (int j = i * samples.length / POINTS; j < (i + 1) * samples.length / POINTS; j++) {
                min = Math.min(min, samples[j]);
                max = Math.max(max, samples[j]);
            }
            low.put(min);
            high.put(max);
        }
        return state("active", device).put("low", low).put("high", high)
                .put("ready", detector.ready()).put("count", detector.pulseCount())
                .put("tracked", detector.tracked()).put("confidence", detector.confidence())
                .put("toneHz", Math.round(IcR30AudioAnalysis.CENTER_HZ + detector.offsetHz()))
                .put("snrDb", detector.snrDb());
    }
}
