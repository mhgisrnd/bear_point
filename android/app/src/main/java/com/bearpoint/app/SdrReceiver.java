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
    JSObject scan = new JSObject();
    SdrAudioOutput audio;
    String mode = "iq";
    private SdrScanSession scanSession;
    boolean hasScanSession() { return scanSession != null; }
    SdrReceiver(Handler main, Runnable changed) { this.main = main; this.changed = changed; }

    void start(UsbDeviceConnection connection, int hz, int rate, int gain, int ppm, String mode, int listenHz, int deemphasisUs) {
        if (!state.equals("idle") && !state.equals("error")) throw new IllegalStateException("정지 후 다시 시작하세요.");
        int token = generation.incrementAndGet();
        audio.stop(); this.mode = mode;
        state = "starting"; error = ""; metrics = new JSObject();
        if (scanSession == null) scan = new JSObject();
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

    void startScan(UsbDeviceConnection connection, SdrScan plan, int gain, int ppm) {
        if (!state.equals("idle") && !state.equals("error")) throw new IllegalStateException("정지 후 다시 시작하세요.");
        scanSession = new SdrScanSession(plan, gain, ppm, SystemClock.elapsedRealtime());
        scan = scanSnapshot(scanSession, SystemClock.elapsedRealtime());
        launchScan(connection, scanSession);
    }

    void resumeScan(UsbDeviceConnection connection, SdrScan plan, int gain, int ppm) {
        if (!state.equals("idle") && !state.equals("error")) throw new IllegalStateException("정지 후 다시 시작하세요.");
        if (scanSession == null || !scanSession.matches(plan, gain, ppm))
            throw new IllegalStateException("이어갈 탐색이 없거나 설정이 변경되었습니다. 새 탐색을 시작하세요.");
        launchScan(connection, scanSession);
    }

    private void launchScan(UsbDeviceConnection connection, SdrScanSession session) {
        int token = generation.incrementAndGet();
        audio.stop(); mode = "iq"; state = "starting"; error = ""; metrics = new JSObject();
        worker.execute(() -> scan(token, connection, session));
    }

    private void scan(int token, UsbDeviceConnection connection, SdrScanSession session) {
        SdrScan plan = session.plan;
        long handle = 0;
        try {
            if (generation.get() != token) return;
            handle = SdrNative.open(connection.getFileDescriptor(), session.centerHz(), plan.rate, session.gain, session.ppm);
            SdrSpectrum analyzer = new SdrSpectrum();
            long lastData = SystemClock.elapsedRealtime(), published = 0;
            while (generation.get() == token) {
                int center = session.centerHz();
                SdrNative.tune(handle, center);
                plan.beginSegment();
                long tuned = SystemClock.elapsedRealtime(), analyzed = 0;
                while (generation.get() == token && SystemClock.elapsedRealtime() - tuned < plan.dwellMs + SdrScan.SETTLE_MS) {
                    long now = SystemClock.elapsedRealtime();
                    boolean settled = now - tuned >= SdrScan.SETTLE_MS;
                    boolean capture = settled && now - analyzed >= 100;
                    SdrBlock block = SdrNative.read(handle, capture, 0);
                    now = SystemClock.elapsedRealtime();
                    if (generation.get() != token) break;
                    double[] values = block.values;
                    session.totalBytes += (long) values[0];
                    session.actualRate = (int) values[4]; session.actualGainDb = values[5] / 10;
                    if (values[0] > 0) lastData = now;
                    if (now - lastData > 3000) throw new IllegalStateException("3초 동안 IQ 데이터가 없습니다. USB 전원과 연결을 확인하세요.");
                    if (capture) {
                        plan.observe(analyzer.analyze(values, 7), (int) values[6], (int) values[4], session.elapsedSeconds(now), session.cycle);
                        analyzed = now;
                    }
                    if (now - published < 500 && now - tuned < plan.dwellMs + SdrScan.SETTLE_MS) continue;
                    JSObject result = scanSnapshot(session, now);
                    main.post(() -> {
                        if (generation.get() != token) return;
                        state = "scanning"; scan = result; changed.run();
                    });
                    published = now;
                }
                // Keep an interrupted interval as the resume cursor; completed ones are skipped.
                if (generation.get() == token) session.completeSegment();
            }
        } catch (Exception | LinkageError failure) {
            String reason = failure.getMessage() == null ? failure.toString() : failure.getMessage();
            main.post(() -> {
                if (generation.get() != token) return;
                audio.stop(); state = "error"; error = reason; changed.run();
            });
        } finally {
            if (handle != 0) SdrNative.close(handle);
        }
    }

    private JSObject scanSnapshot(SdrScanSession session, long now) {
        SdrScan plan = session.plan;
        JSObject result = new JSObject();
        result.put("band", plan.band);
        result.put("startHz", plan.startHz); result.put("endHz", plan.endHz);
        result.put("centerHz", session.centerHz()); result.put("sampleRate", session.actualRate);
        result.put("gainDb", session.actualGainDb); result.put("ppm", session.ppm);
        result.put("segment", session.segment + 1); result.put("segments", plan.centers.length); result.put("cycle", session.cycle);
        result.put("cycleSeconds", plan.cycleSeconds()); result.put("dwellMs", plan.dwellMs);
        result.put("thresholdDb", plan.thresholdDb); result.put("totalBytes", session.totalBytes);
        result.put("elapsedSeconds", session.elapsedSeconds(now));
        JSArray found = new JSArray();
        for (SdrScan.Candidate candidate : plan.confirmed()) {
            JSObject item = new JSObject();
            item.put("id", candidate.id);
            item.put("frequencyHz", candidate.frequencyHz); item.put("powerDbfs", candidate.powerDbfs);
            item.put("snrDb", candidate.snrDb); item.put("lastSeenSeconds", candidate.lastSeenSeconds);
            item.put("lastSeenCycle", candidate.lastSeenCycle); item.put("confirmedCycle", candidate.confirmedCycle);
            item.put("observations", candidate.observations); found.put(item);
        }
        result.put("candidates", found);
        return result;
    }

    void stop() { stop(null); }

    void stop(Runnable complete) {
        audio.stop();
        int token = generation.incrementAndGet(); state = "stopping";
        SdrScanSession session = scanSession;
        worker.execute(() -> {
            JSObject pausedScan = session == null ? null : scanSnapshot(session, SystemClock.elapsedRealtime());
            main.post(() -> {
                if (generation.get() == token && session == scanSession && pausedScan != null) scan = pausedScan;
                if (generation.get() == token) { state = "idle"; changed.run(); }
                if (complete != null) complete.run();
            });
        });
    }

    void closeUsb(UsbDeviceConnection connection) {
        if (audio != null) audio.stop();
        generation.incrementAndGet(); state = "idle"; metrics = new JSObject(); scan = new JSObject(); error = "";
        scanSession = null;
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
