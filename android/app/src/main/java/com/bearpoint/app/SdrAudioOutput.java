package com.bearpoint.app;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioDeviceCallback;
import android.media.AudioDeviceInfo;
import android.media.AudioFocusRequest;
import android.media.AudioFormat;
import android.media.AudioManager;
import android.media.AudioTrack;
import android.os.Build;
import android.os.Handler;
import com.getcapacitor.JSObject;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/** Media playback is isolated from USB reads. Main thread owns focus and UI state. */
final class SdrAudioOutput {
    private final AudioManager manager;
    private final Handler main;
    private final Runnable changed;
    private final AudioAttributes attributes = new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build();
    private volatile Playback playback;
    private volatile float volume = 1f;
    private String output = "Android 미디어 출력", notice = "";
    private AudioFocusRequest focusRequest;
    private final AudioManager.OnAudioFocusChangeListener focusListener = change -> {
        if (change < 0) stopWithNotice("다른 앱의 소리 사용으로 음소거되었습니다. 다시 소리를 켜주세요.");
    };
    private final AudioDeviceCallback devices = new AudioDeviceCallback() {
        @Override public void onAudioDevicesRemoved(AudioDeviceInfo[] removed) {
            Playback active = playback;
            if (active == null) return;
            for (AudioDeviceInfo device : removed) if (device.getId() == active.externalRouteId) {
                stopWithNotice("출력 장치가 분리되어 음소거되었습니다. 출력 장치를 확인하고 다시 켜주세요.");
                break;
            }
        }
    };

    SdrAudioOutput(Context context, Handler main, Runnable changed) {
        this.main = main; this.changed = changed;
        manager = (AudioManager) context.getSystemService(Context.AUDIO_SERVICE);
        manager.registerAudioDeviceCallback(devices, main);
    }

    void set(Boolean enabled, Double requestedVolume) {
        if (requestedVolume != null) {
            if (!Double.isFinite(requestedVolume) || requestedVolume < 0 || requestedVolume > 1)
                throw new IllegalArgumentException("음량은 0–100% 사이로 설정하세요.");
            volume = requestedVolume.floatValue();
        }
        if (Boolean.FALSE.equals(enabled)) stop();
        if (Boolean.TRUE.equals(enabled) && playback == null) {
            int result;
            if (Build.VERSION.SDK_INT >= 26) {
                focusRequest = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN)
                    .setAudioAttributes(attributes).setOnAudioFocusChangeListener(focusListener, main).build();
                result = manager.requestAudioFocus(focusRequest);
            } else {
                result = manager.requestAudioFocus(focusListener, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN);
            }
            if (result != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) {
                abandonFocus();
                throw new IllegalStateException("오디오 출력을 사용할 수 없습니다. 다른 앱의 재생을 확인하세요.");
            }
            notice = "";
            Playback active = new Playback();
            playback = active;
            active.thread.start();
        }
    }

    void startDefault() {
        try { set(true, 1d); }
        catch (IllegalStateException unavailable) { stopWithNotice(unavailable.getMessage()); }
    }

    void offer(short[] samples) {
        Playback active = playback;
        if (active != null && samples != null && samples.length > 0 && !active.queue.offer(samples))
            active.dropped.incrementAndGet();
    }

    private void abandonFocus() {
        if (Build.VERSION.SDK_INT >= 26 && focusRequest != null) manager.abandonAudioFocusRequest(focusRequest);
        else manager.abandonAudioFocus(focusListener);
        focusRequest = null;
    }

    void stop() {
        Playback active = playback;
        playback = null;
        if (active != null) { active.running = false; active.queue.clear(); active.thread.interrupt(); }
        abandonFocus();
    }

    private void stopWithNotice(String reason) {
        stop(); notice = reason; changed.run();
    }

    JSObject snapshot() {
        Playback active = playback;
        JSObject result = new JSObject();
        result.put("enabled", active != null); result.put("volume", volume);
        result.put("output", output); result.put("notice", notice);
        result.put("droppedBlocks", active == null ? 0 : active.dropped.get());
        return result;
    }

    void shutdown() { stop(); manager.unregisterAudioDeviceCallback(devices); }

    private void updateRoute(Playback active, AudioTrack track) {
        if (playback != active) return;
        AudioDeviceInfo device;
        try { device = track.getRoutedDevice(); }
        catch (IllegalStateException released) { return; }
        if (device == null) return;
        // Removal callbacks may arrive after Android has already rerouted to the speaker.
        // Retain the external ID so that this ordering still causes a mute.
        if (device.getType() != AudioDeviceInfo.TYPE_BUILTIN_SPEAKER
            && device.getType() != AudioDeviceInfo.TYPE_BUILTIN_EARPIECE)
            active.externalRouteId = device.getId();
        switch (device.getType()) {
            case AudioDeviceInfo.TYPE_BLUETOOTH_A2DP:
            case AudioDeviceInfo.TYPE_BLE_HEADSET:
            case AudioDeviceInfo.TYPE_BLE_SPEAKER: output = "블루투스 미디어 출력"; break;
            case AudioDeviceInfo.TYPE_WIRED_HEADSET:
            case AudioDeviceInfo.TYPE_WIRED_HEADPHONES: output = "유선 이어폰"; break;
            case AudioDeviceInfo.TYPE_USB_DEVICE:
            case AudioDeviceInfo.TYPE_USB_HEADSET: output = "USB 오디오"; break;
            case AudioDeviceInfo.TYPE_BUILTIN_SPEAKER: output = "기기 스피커"; break;
            default: output = "Android 미디어 출력";
        }
        changed.run();
    }

    private final class Playback implements Runnable {
        final ArrayBlockingQueue<short[]> queue = new ArrayBlockingQueue<>(8);
        final AtomicInteger dropped = new AtomicInteger();
        final Thread thread = new Thread(this, "sdr-audio");
        volatile boolean running = true;
        volatile int externalRouteId = -1;
        @Override public void run() {
            AudioTrack track = null;
            try {
                int minimum = AudioTrack.getMinBufferSize(48000, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
                if (minimum <= 0) throw new IllegalStateException("48 kHz 오디오 출력 미지원");
                track = new AudioTrack.Builder().setAudioAttributes(attributes)
                    .setAudioFormat(new AudioFormat.Builder().setSampleRate(48000)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
                    .setTransferMode(AudioTrack.MODE_STREAM).setBufferSizeInBytes(Math.max(minimum, 19200)).build();
                AudioTrack routedTrack = track;
                track.addOnRoutingChangedListener(ignored -> updateRoute(this, routedTrack), main);
                track.setVolume(volume); track.play();
                main.post(() -> updateRoute(this, routedTrack));
                while (running) {
                    short[] block = queue.poll(100, TimeUnit.MILLISECONDS);
                    if (block == null) continue;
                    track.setVolume(volume);
                    int offset = 0;
                    while (running && offset < block.length) {
                        int written = track.write(block, offset, block.length - offset, AudioTrack.WRITE_NON_BLOCKING);
                        if (written < 0) throw new IllegalStateException("오디오 출력 오류: " + written);
                        if (written == 0) Thread.sleep(2);
                        offset += written;
                    }
                }
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            } catch (RuntimeException failure) {
                main.post(() -> { if (playback == this) stopWithNotice("소리 재생 실패: " + failure.getMessage()); });
            } finally {
                if (track != null) track.release();
            }
        }
    }
}
