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
import android.os.SystemClock;
import android.os.Process;
import com.getcapacitor.JSObject;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import java.util.ArrayDeque;

/** Media playback is isolated from USB reads. Main thread owns focus and UI state. */
final class SdrAudioOutput {
    private final AudioManager manager;
    private final Handler main;
    private final Runnable changed;
    private final AudioAttributes attributes = new AudioAttributes.Builder()
        .setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build();
    private volatile Playback playback;
    private volatile float volume = 1f;
    private volatile int gainDb = -1;
    private final AtomicLong offeredSamples = new AtomicLong(), writtenSamples = new AtomicLong(), droppedSamples = new AtomicLong();
    private final AtomicInteger droppedTotal = new AtomicInteger(), underruns = new AtomicInteger(), emptyPolls = new AtomicInteger();
    private final AtomicInteger rebufferings=new AtomicInteger();
    private final AtomicLong flushedSamples=new AtomicLong();
    private static final int PREFILL_SAMPLES=3072;
    int gainDb() { return gainDb; }
    void setGainDb(int value) {
        if (value < -1 || value > 36) throw new IllegalArgumentException("청취 증폭은 자동 또는 0–36dB로 설정하세요.");
        gainDb = value;
    }
    private volatile String output = "Android 미디어 출력", notice = "";
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

    void offer(short[] samples,long sequence,double receivedMs) {
        Playback active = playback;
        if (active == null || !active.running || samples == null || samples.length == 0) return;
        offeredSamples.addAndGet(samples.length);
        discard(active,active.queue.offer(new SdrPlaybackBuffer.Packet(samples,sequence,receivedMs)));
    }
    private void discard(Playback active,SdrPlaybackBuffer.Dropped dropped){active.dropped.addAndGet(dropped.blocks);droppedTotal.addAndGet(dropped.blocks);droppedSamples.addAndGet(dropped.samples);}
    void discontinuity(){Playback active=playback;if(active!=null){discard(active,active.queue.clear());active.resetRequested=true;}}
    private double hardwareQueuedNow(Playback active){return Math.max(0,active.hardwareQueuedMs-Math.max(0,SystemClock.elapsedRealtime()-active.hardwareMeasuredAt));}
    int presentationDelayMs(){Playback active=playback;return active==null?0:(int)Math.min(150,Math.max(0,active.queue.samples()/48.0+hardwareQueuedNow(active)));}
    long playingSequence(){Playback active=playback;return active==null?0:active.playingSequence;}

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
        result.put("gainDb", gainDb);
        result.put("output", output); result.put("notice", notice);
        result.put("droppedBlocks", active == null ? 0 : active.dropped.get());
        result.put("offeredSamplesTotal", offeredSamples.get());result.put("writtenSamplesTotal", writtenSamples.get());
        result.put("droppedSamplesTotal", droppedSamples.get());result.put("droppedBlocksTotal", droppedTotal.get());
        result.put("underrunsTotal", underruns.get());result.put("emptyPollsTotal", emptyPolls.get());
        result.put("queueBlocks", active == null ? 0 : active.queue.size());
        result.put("queueSamples",active==null?0:active.queue.samples());
        result.put("hardwareQueuedMs",active==null?0:hardwareQueuedNow(active));
        result.put("presentationDelayMs",presentationDelayMs());
        result.put("presentationDelayClamped",active!=null&&active.queue.samples()/48.0+hardwareQueuedNow(active)>150);
        result.put("lastWrittenSourceSequence",active==null?0:active.lastSequence);
        result.put("playingSourceSequence",playingSequence());
        result.put("sourceToOutputEstimateMs",active==null?0:active.sourceToOutputMs);
        result.put("rebufferingsTotal",rebufferings.get());
        result.put("flushedSamplesTotal",flushedSamples.get());
        result.put("mediaVolume", manager.getStreamVolume(AudioManager.STREAM_MUSIC));
        result.put("mediaVolumeMax", manager.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
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
        final SdrPlaybackBuffer queue = new SdrPlaybackBuffer();
        final AtomicInteger dropped = new AtomicInteger();
        final Thread thread = new Thread(this, "sdr-audio");
        volatile boolean running = true;
        volatile int externalRouteId = -1;
        volatile boolean resetRequested;
        volatile double hardwareQueuedMs,sourceToOutputMs;
        volatile long hardwareMeasuredAt;
        volatile long lastSequence;
        volatile long playingSequence;
        final ArrayDeque<long[]> sourceFrames=new ArrayDeque<>();
        private void updatePlaying(long head){
            while(!sourceFrames.isEmpty()&&sourceFrames.peekFirst()[1]<=head)sourceFrames.removeFirst();
            playingSequence=sourceFrames.isEmpty()?0:sourceFrames.peekFirst()[2];
        }
        int lastUnderruns;
        @Override public void run() {
            AudioTrack track = null;
            try {
                Process.setThreadPriority(Process.THREAD_PRIORITY_AUDIO);
                int minimum = AudioTrack.getMinBufferSize(48000, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT);
                if (minimum <= 0) throw new IllegalStateException("48 kHz 오디오 출력 미지원");
                track = new AudioTrack.Builder().setAudioAttributes(attributes)
                    .setAudioFormat(new AudioFormat.Builder().setSampleRate(48000)
                        .setChannelMask(AudioFormat.CHANNEL_OUT_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
                    .setTransferMode(AudioTrack.MODE_STREAM).setBufferSizeInBytes(Math.max(minimum, 4800)).build();
                AudioTrack routedTrack = track;
                track.addOnRoutingChangedListener(ignored -> updateRoute(this, routedTrack), main);
                track.setVolume(volume);
                main.post(() -> updateRoute(this, routedTrack));
                boolean playing=false;long prefillDeadline=SystemClock.elapsedRealtime()+120,writtenFrames=0,headWrap=0,previousHead=0;
                while (running) {
                    if(resetRequested){
                        track.pause();long head=track.getPlaybackHeadPosition()&0xffffffffL;if(head<previousHead)headWrap+=1L<<32;
                        flushedSamples.addAndGet(Math.max(0,writtenFrames-head-headWrap));track.flush();
                        playing=false;writtenFrames=headWrap=previousHead=0;hardwareQueuedMs=0;hardwareMeasuredAt=SystemClock.elapsedRealtime();
                        sourceFrames.clear();playingSequence=0;
                        resetRequested=false;prefillDeadline=SystemClock.elapsedRealtime()+120;rebufferings.incrementAndGet();
                    }
                    if(!playing&&queue.samples()<PREFILL_SAMPLES&&SystemClock.elapsedRealtime()<prefillDeadline){Thread.sleep(2);continue;}
                    SdrPlaybackBuffer.Packet packet=queue.poll(25);
                    if(packet==null){
                        emptyPolls.incrementAndGet();long head=track.getPlaybackHeadPosition()&0xffffffffL;
                        if(head<previousHead)headWrap+=1L<<32;previousHead=head;
                        hardwareQueuedMs=Math.max(0,(writtenFrames-head-headWrap)/48.0);
                        hardwareMeasuredAt=SystemClock.elapsedRealtime();
                        updatePlaying(head+headWrap);
                        if(playing&&hardwareQueuedMs<=1){track.pause();playing=false;prefillDeadline=SystemClock.elapsedRealtime()+120;rebufferings.incrementAndGet();}
                        continue;
                    }
                    short[] block=packet.samples;
                    track.setVolume(volume);
                    int offset = 0;
                    long sourceStartFrame=writtenFrames;
                    while (running && !resetRequested && offset < block.length) {
                        int written = track.write(block, offset, block.length - offset, AudioTrack.WRITE_NON_BLOCKING);
                        if (written < 0) throw new IllegalStateException("오디오 출력 오류: " + written);
                        if(written>0&&!playing){track.play();playing=true;}
                        if (written == 0) Thread.sleep(2);
                        offset += written;
                        writtenSamples.addAndGet(written);
                        writtenFrames+=written;
                    }
                    if(resetRequested&&offset<block.length){activeDrop(block.length-offset);}
                    if(writtenFrames>sourceStartFrame)sourceFrames.addLast(new long[]{sourceStartFrame,writtenFrames,packet.sequence});
                    long head=track.getPlaybackHeadPosition()&0xffffffffL;if(head<previousHead)headWrap+=1L<<32;previousHead=head;
                    hardwareQueuedMs=Math.max(0,(writtenFrames-head-headWrap)/48.0);
                    hardwareMeasuredAt=SystemClock.elapsedRealtime();
                    updatePlaying(head+headWrap);
                    lastSequence=packet.sequence;
                    sourceToOutputMs=packet.receivedMs>0?Math.max(0,SystemClock.elapsedRealtime()-packet.receivedMs+hardwareQueuedMs):0;
                    if (Build.VERSION.SDK_INT >= 24) {
                        int currentUnderruns = track.getUnderrunCount();
                        underruns.addAndGet(Math.max(0, currentUnderruns - lastUnderruns));lastUnderruns = currentUnderruns;
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
        private void activeDrop(int count){dropped.incrementAndGet();droppedTotal.incrementAndGet();droppedSamples.addAndGet(count);}
    }
}
