package com.bearpoint.app;

import android.annotation.SuppressLint;
import android.content.Context;
import android.media.AudioDeviceInfo;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.Handler;
import android.os.Process;
import android.os.SystemClock;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import java.util.Iterator;

/** Foreground-only USB audio capture, independent of the IC-R30 serial connection. */
final class IcR30UsbAudio implements Runnable {
    private static final int RATE = IcR30AudioAnalysis.RATE;
    private static final long ROUTE_TIMEOUT_MS = 1000;
    private static final long READ_TIMEOUT_MS = 2000;
    private static final long PUBLISH_MS = 125;
    private final AudioManager manager;
    private final AudioDeviceInfo input;
    private final Handler main;
    private final SdrAudioOutput speaker;
    private final Runnable changed;
    private boolean speakerClosed;
    private boolean muted;
    private volatile int filterLevel;
    private volatile boolean stopped;
    private volatile int tuningRevision;
    private volatile JSObject status = state("starting", "USB 오디오 입력 확인 중…");

    IcR30UsbAudio(Context context, Handler main, AudioDeviceInfo input, boolean muted, int filterLevel, Runnable changed) {
        this.main = main;
        this.input = input;
        this.muted = muted;
        this.filterLevel = filterLevel;
        this.changed = changed;
        manager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        speaker = new SdrAudioOutput(context, main, changed, new SdrAudioInterruption(
                this::speakerEnabled, reason -> muteInterrupted()), true);
    }

    boolean speakerEnabled() { return speaker.enabled(); }
    private void muteInterrupted() {
        speaker.stop();
        speaker.interruptionNotice("다른 오디오 사용으로 수신음 재생이 중단되었습니다.");
        changed.run();
    }
    private void closeSpeaker() {
        if (speakerClosed) return;
        speakerClosed = true;
        speaker.shutdown();
    }
    private void startSpeaker() {
        if (!speakerClosed && !muted) speaker.startListening(true, 1);
        changed.run();
    }
    void setMuted(boolean value) {
        muted = value;
        if (value) speaker.stop();
        else if ("active".equals(status.getString("state"))) startSpeaker();
    }
    void setFilterLevel(int value) { filterLevel = value; }
    void stop() {
        stopped = true;
        closeSpeaker();
    }
    void resetDetection() { tuningRevision++; }
    boolean failed() { return "error".equals(status.getString("state")); }
    boolean ready() { return "active".equals(status.getString("state")); }
    boolean usesInput(AudioDeviceInfo device) { return input.getId() == device.getId(); }
    JSObject snapshot() {
        JSObject capture = status;
        JSObject result = new JSObject();
        for (Iterator<String> keys = capture.keys(); keys.hasNext();) {
            String key = keys.next();
            result.put(key, capture.opt(key));
        }
        double pulseTime = capture.optDouble("cwPulseTimeMs", Double.NaN);
        if (Double.isFinite(pulseTime)) {
            double age = Math.max(0, SystemClock.elapsedRealtime() - pulseTime);
            result.put("cwDetectionAgeMs", age).put("cwPulseWallTimeMs", System.currentTimeMillis() - age);
        }
        return result.put("speakerEnabled", speaker.enabled()).put("speakerNotice", muted ? "" : speaker.notice())
                .put("playbackOutput", speaker.output()).put("filterLevel", filterLevel);
    }

    static JSObject state(String state, String message) {
        return new JSObject().put("state", state).put("message", message);
    }

    static AudioDeviceInfo findInput(Context context) {
        AudioManager manager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        for (AudioDeviceInfo device : manager.getDevices(AudioManager.GET_DEVICES_INPUTS)) {
            int type = device.getType();
            if (device.isSource() && (type == AudioDeviceInfo.TYPE_USB_DEVICE ||
                    type == AudioDeviceInfo.TYPE_USB_HEADSET || type == AudioDeviceInfo.TYPE_USB_ACCESSORY)) return device;
        }
        return null;
    }

    @SuppressLint("MissingPermission") // IcR30Plugin checks RECORD_AUDIO before starting this worker.
    @Override public void run() {
        if (stopped) return;
        try {
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
        } finally {
            main.post(() -> { closeSpeaker(); changed.run(); });
        }
    }

    private void capture(AudioRecord record, AudioDeviceInfo input) throws InterruptedException {
        Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO);
        record.startRecording();
        if (record.getRecordingState() != AudioRecord.RECORDSTATE_RECORDING)
            throw new IllegalStateException("USB 오디오 녹음을 시작할 수 없습니다.");
        long started = SystemClock.elapsedRealtime(), lastRead = started, updated = 0;
        boolean routed = false;
        long sequence = 0;
        int filled = 0, revision = tuningRevision;
        short[] samples = new short[IcR30AudioAnalysis.BLOCK];
        IcR30AudioAnalysis analysis = new IcR30AudioAnalysis();
        final IcR30AudioFilter filter = new IcR30AudioFilter();
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
                speaker.discontinuity();
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
            ++sequence;
            analysis.observe(samples, now);
            if (speaker.enabled()) {
                double toneHz = analysis.detector.confidence() >= 2
                        ? IcR30AudioAnalysis.CENTER_HZ + analysis.detector.offsetHz() : 0;
                speaker.offer(filter.process(samples, filterLevel, toneHz), sequence, now);
            }
            if (updated == 0 || now - updated >= PUBLISH_MS) {
                status = frame(input.getProductName().toString(), samples, analysis.detector);
                updated = now;
            }
            if (sequence == 1) main.post(this::startSpeaker);
        }
    }

    private static JSObject frame(String device, short[] samples, SdrCwDetector detector) {
        JSArray spectrum = new JSArray();
        for (double dbfs : detector.audioSpectrumDbfs()) spectrum.put((Object) dbfs);
        int peakSample = 0;
        for (short sample : samples) peakSample = Math.max(peakSample, Math.abs(sample));
        JSObject result = state("active", device).put("peakSample", peakSample)
                .put("spectrumDbfs", spectrum).put("spectrumCenterHz", IcR30AudioAnalysis.CENTER_HZ)
                .put("spectrumSpanHz", SdrCwDetector.AUDIO_SPECTRUM_BINS * RATE / (double) SdrCwDetector.SIZE)
                .put("ready", detector.ready()).put("count", detector.pulseCount())
                .put("tracked", detector.tracked()).put("confidence", detector.confidence())
                .put("toneHz", Math.round(IcR30AudioAnalysis.CENTER_HZ + detector.offsetHz()))
                .put("snrDb", detector.snrDb());
        if (detector.pulseCount() > 0 && Double.isFinite(detector.directionDbfs())) {
            result.put("cwDirectionDbfs", detector.directionDbfs());
            result.put("cwPulseTimeMs", detector.pulseTimeMs());
            result.put("cwToneHz", IcR30AudioAnalysis.CENTER_HZ + detector.offsetHz());
        }
        return result;
    }
}
