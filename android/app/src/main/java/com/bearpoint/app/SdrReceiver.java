package com.bearpoint.app;

import android.hardware.usb.UsbDeviceConnection;
import android.os.Handler;
import android.os.SystemClock;
import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;

/** Main-thread state; a single worker owns all native operations and fd cleanup. */
final class SdrReceiver {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicInteger generation = new AtomicInteger();
    private final Handler main;
    private final Runnable changed;
    String state = "idle", error = "";
    JSObject metrics = new JSObject();
    SdrAudioOutput audio;
    String mode = "iq";
    SdrReceiver(Handler main, Runnable changed) { this.main = main; this.changed = changed; }

    void start(UsbDeviceConnection connection, int hz, int rate, int gain, int ppm, String mode, int listenHz, int deemphasisUs) {
        if (!state.equals("idle") && !state.equals("error")) throw new IllegalStateException("정지 후 다시 시작하세요.");
        int token = generation.incrementAndGet();
        audio.stop(); this.mode = mode;
        state = "starting"; error = ""; metrics = new JSObject();
        worker.execute(() -> receive(token, connection, hz, rate, gain, ppm, mode, listenHz, deemphasisUs));
    }

    private void receive(int token, UsbDeviceConnection connection, int hz, int rate, int gain, int ppm, String mode, int listenHz, int deemphasisUs) {
        long handle = 0, demodulator = 0;
        try {
            if (generation.get() != token) return;
            handle = SdrNative.open(connection.getFileDescriptor(), hz, rate, gain, ppm);
            long total = 0, bytes = 0, started = SystemClock.elapsedRealtime(), updated = started, lastData = started;
            double power = 0, clipped = 0;
            SdrSpectrum analyzer = new SdrSpectrum();
            double[] spectrum = new double[0];
            int spectrumFrames = 0;
            long spectrumUpdated = started - 500;
            String[] tuners = {"Unknown", "E4000", "FC0012", "FC0013", "FC2580", "R820T", "R828D"};
            while (generation.get() == token) {
                boolean captureSpectrum = SystemClock.elapsedRealtime() - spectrumUpdated >= 500;
                SdrBlock received = SdrNative.read(handle, captureSpectrum, demodulator);
                double[] block = received.values;
                // Configure from the actual hardware rate, before decoding subsequent blocks.
                if (demodulator == 0 && "wfm".equals(mode))
                    demodulator = SdrNative.createDemodulator(mode, (int) block[4], listenHz - hz, deemphasisUs);
                audio.offer(received.audio);
                long now = SystemClock.elapsedRealtime();
                if (captureSpectrum && block.length > 7) {
                    spectrum = analyzer.analyze(block, 7);
                    spectrumFrames = (block.length - 7) / (SdrSpectrum.SIZE * 2);
                    spectrumUpdated = now;
                }
                total += (long) block[0]; bytes += (long) block[0]; power += block[1]; clipped += block[2];
                if (block[0] > 0) lastData = now;
                if (now - lastData > 3000) throw new IllegalStateException("3초 동안 IQ 데이터가 없습니다. USB 전원과 연결을 확인하세요.");
                if (now - updated < 500) continue;
                JSObject result = new JSObject();
                int tuner = (int) block[3];
                result.put("tuner", tuner >= 0 && tuner < tuners.length ? tuners[tuner] : "Unknown");
                result.put("sampleRate", (int) block[4]); result.put("gainDb", block[5] / 10);
                result.put("frequencyHz", (int) block[6]); result.put("ppm", ppm);
                result.put("mode", mode); result.put("listenFrequencyHz", listenHz);
                result.put("audioSampleRate", "wfm".equals(mode) ? 48000 : 0);
                result.put("deemphasisUs", deemphasisUs);
                result.put("totalBytes", total); result.put("bytesPerSecond", bytes * 1000.0 / (now - updated));
                result.put("elapsedSeconds", (now - started) / 1000.0);
                result.put("powerDbfs", bytes > 0 ? 10 * Math.log10(Math.max(1e-12, power / bytes)) : -120);
                result.put("clippingPercent", bytes > 0 ? clipped * 100 / bytes : 0);
                result.put("hasSamples", bytes > 0);
                if (bytes > 0 && spectrum.length == SdrSpectrum.SIZE && now - spectrumUpdated < 1000) {
                    result.put("spectrumDbfs", JSArray.from(spectrum));
                    result.put("fftSize", SdrSpectrum.SIZE);
                    result.put("spectrumFrames", spectrumFrames);
                    result.put("spectrumUpdatedSeconds", (spectrumUpdated - started) / 1000.0);
                }
                main.post(() -> {
                    if (generation.get() != token) return;
                    boolean firstReception = "starting".equals(state);
                    state = "receiving"; metrics = result;
                    if (firstReception && "wfm".equals(mode)) audio.startDefault();
                    changed.run();
                });
                bytes = 0; power = 0; clipped = 0; updated = now;
            }
        } catch (Exception | LinkageError failure) {
            String reason = failure.getMessage() == null ? failure.toString() : failure.getMessage();
            main.post(() -> {
                if (generation.get() != token) return;
                audio.stop(); state = "error"; error = reason; changed.run();
            });
        } finally {
            if (demodulator != 0) SdrNative.closeDemodulator(demodulator);
            if (handle != 0) SdrNative.close(handle);
        }
    }

    void stop() {
        audio.stop();
        int token = generation.incrementAndGet(); state = "stopping";
        worker.execute(() -> main.post(() -> {
            if (generation.get() != token) return;
            state = "idle"; changed.run();
        }));
    }

    void closeUsb(UsbDeviceConnection connection) {
        if (audio != null) audio.stop();
        generation.incrementAndGet(); state = "idle"; metrics = new JSObject(); error = "";
        // FIFO: stop the loop, close librtlsdr, then release the Java-owned descriptor.
        if (connection != null) worker.execute(connection::close);
    }

    void setAudio(Boolean enabled, Double volume) {
        if (Boolean.TRUE.equals(enabled) && (!"receiving".equals(state) || !"wfm".equals(mode)))
            throw new IllegalStateException("WFM 수신을 시작한 뒤 소리를 켜주세요.");
        audio.set(enabled, volume);
    }

    void shutdown() { audio.shutdown(); worker.shutdown(); }
}
