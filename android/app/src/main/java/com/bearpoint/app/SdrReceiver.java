package com.bearpoint.app;

import android.hardware.usb.UsbDeviceConnection;
import android.os.Handler;
import android.os.SystemClock;
import com.getcapacitor.JSObject;
import com.getcapacitor.JSArray;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.atomic.AtomicInteger;
import java.io.File;

/** Main-thread state; a single worker owns all native operations and fd cleanup. */
final class SdrReceiver {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicInteger generation = new AtomicInteger();
    private final Handler main;
    private final Runnable changed;
    String state = "idle", error = "";
    JSObject metrics = new JSObject();
    JSObject scan = new JSObject();
    boolean fixedResultAvailable;
    SdrAudioOutput audio;
    private final SdrDiagnosticCapture diagnostic;
    private JSObject diagnosticContext = new JSObject();
    String mode = "iq";
    int tunedFrequencyHz;
    private SdrScanSession scanSession;
    private double[] tunerInfo = new double[0];
    private void putTunerInfo(JSObject result) {
        if (tunerInfo.length != 3) return;
        String[] names = {"Unknown", "E4000", "FC0012", "FC0013", "FC2580", "R820T", "R828D"};
        int tuner = (int)tunerInfo[0];
        result.put("tuner", tuner >= 0 && tuner < names.length ? names[tuner] : "Unknown");
        result.put("gainMinDb", tunerInfo[1]); result.put("gainMaxDb", tunerInfo[2]);
    }
    boolean hasScanSession() { return scanSession != null; }
    SdrReceiver(Handler main, Runnable changed) {
        this.main = main; this.changed = changed;
        diagnostic = new SdrDiagnosticCapture(() -> main.post(changed));
    }
    void diagnosticStorage(File files,File cache) { diagnostic.storage(new File(files,"sdr-diagnostics"),cache); }
    void startDiagnostic(File root,JSObject context) {
        if (!"receiving".equals(state) || !"cw".equals(mode)) throw new IllegalStateException("개별 CW 수신 중에 진단 기록을 시작하세요.");
        diagnosticContext=context;
        try { diagnostic.request(root); }
        catch (java.io.IOException failure) { throw new IllegalStateException(failure.getMessage(),failure); }
    }
    File diagnosticFile() { return diagnostic.readyFile(); }
    File diagnosticFile(String id) { return diagnostic.file(id); }
    JSObject diagnosticSnapshot() {
        JSObject result=new JSObject();result.put("state",diagnostic.state());result.put("error",diagnostic.error());
        result.put("iqBytes",diagnostic.bytes());result.put("omittedIqBytes",diagnostic.omitted());
        JSArray records=new JSArray();
        for(SdrDiagnosticCapture.Saved record:diagnostic.saved()) {
            JSObject item=new JSObject();item.put("id",record.id);item.put("time",record.time);item.put("sizeBytes",record.size);records.put(item);
        }
        result.put("records",records);return result;
    }

    void start(UsbDeviceConnection connection, int hz, int rate, int gain, int ppm, String mode, int listenHz, int deemphasisUs) {
        if (!state.equals("idle") && !state.equals("error")) throw new IllegalStateException("정지 후 다시 시작하세요.");
        int token = generation.incrementAndGet();
        audio.stop(); this.mode = mode;
        tunedFrequencyHz = hz;
        fixedResultAvailable = true;
        state = "starting"; error = ""; metrics = new JSObject();
        if (scanSession == null) scan = new JSObject();
        worker.execute(() -> receive(token, connection, hz, rate, gain, ppm, mode, listenHz, deemphasisUs));
    }

    private void receive(int token, UsbDeviceConnection connection, int hz, int rate, int gain, int ppm, String mode, int listenHz, int deemphasisUs) {
        long handle = 0, demodulator = 0;
        try {
            if (generation.get() != token) return;
            int hardwareHz = "cw".equals(mode) ? hz - 12000 : hz;
            handle = SdrNative.open(connection.getFileDescriptor(), hardwareHz, rate, gain, ppm);
            tunerInfo = SdrNative.describeTuner(handle);
            long total = 0, bytes = 0, started = SystemClock.elapsedRealtime(), updated = started, lastData = started;
            double power = 0, clipped = 0;
            double signalPeak = -1;
            SdrSpectrum analyzer = new SdrSpectrum();
            boolean pulseSpectrum = "cw".equals(mode);
            SdrCwSpectrum cwSpectrum = new SdrCwSpectrum();
            SdrSignalStrength strength = new SdrSignalStrength();
            double[] spectrum = new double[0];
            int spectrumFrames = 0;
            long spectrumUpdated = started - 500;
            String[] tuners = {"Unknown", "E4000", "FC0012", "FC0013", "FC2580", "R820T", "R828D"};
            int appliedAudioGain = Integer.MIN_VALUE;
            JSObject registers = new JSObject();
            long previousLoopEnd = SystemClock.elapsedRealtimeNanos();
            long previousLoopBegan = previousLoopEnd;
            while (generation.get() == token) {
                long loopBegan=SystemClock.elapsedRealtimeNanos();
                double cycleIntervalMs=(loopBegan-previousLoopBegan)/1e6;previousLoopBegan=loopBegan;
                double controlReadMs=0;
                if("waiting".equals(diagnostic.state())) {
                    long controlBegan=SystemClock.elapsedRealtimeNanos();
                    try {
                        int[] readback=SdrNative.diagnosticRegisters(handle);
                        registers=new JSObject();
                        String[] names={"rtl_agc_0x19","fc0013_mode_0x0d","fc0013_if_0x13","fc0013_lna_0x14","fc0013_vhf_0x1d"};
                        for(int i=0;i<names.length;i++) {
                            JSObject reg=new JSObject();reg.put("value",readback[i*2]);reg.put("transferResult",readback[i*2+1]);
                            reg.put("readOk",readback[i*2+1]==1);registers.put(names[i],reg);
                        }
                    } catch(Exception | LinkageError failure) {registers=new JSObject();registers.put("error",failure.toString());}
                    controlReadMs=(SystemClock.elapsedRealtimeNanos()-controlBegan)/1e6;
                }
                // CW display uses the already-decimated channel. Export full-rate IQ only for diagnostics.
                boolean recordingIq = "waiting".equals(diagnostic.state()) || "recording".equals(diagnostic.state());
                boolean captureSpectrum = pulseSpectrum ? recordingIq : SystemClock.elapsedRealtime() - spectrumUpdated >= 500;
                long readBegan=SystemClock.elapsedRealtimeNanos();
                SdrBlock received = SdrNative.read(handle, captureSpectrum, demodulator, pulseSpectrum);
                long readEnded=SystemClock.elapsedRealtimeNanos();
                double[] block = received.values;
                // Configure from the actual hardware rate, before decoding subsequent blocks.
                if (demodulator == 0 && ("wfm".equals(mode) || "cw".equals(mode)))
                    demodulator = SdrNative.createDemodulator(mode, (int) block[4], listenHz - (int) block[6], deemphasisUs);
                if (demodulator != 0 && "cw".equals(mode) && appliedAudioGain != audio.gainDb()) {
                    appliedAudioGain = audio.gainDb();
                    SdrNative.setAudioGain(demodulator, appliedAudioGain);
                }
                audio.offer(received.audio);
                signalPeak = Math.max(signalPeak, received.signalPower);
                long now = SystemClock.elapsedRealtime();
                if (pulseSpectrum) strength.observe(signalPeak,received.noisePower,now);
                long spectrumBegan=SystemClock.elapsedRealtimeNanos();
                if (pulseSpectrum) {
                    double[] bins = cwSpectrum.observe(received.channelIq, now);
                    if (bins.length > 0) { spectrum = bins; spectrumUpdated = now; }
                } else if (captureSpectrum && block.length > 7) {
                    spectrum = analyzer.analyze(block, 7);
                    spectrumFrames = (block.length - 7) / (SdrSpectrum.SIZE * 2);
                    spectrumUpdated = now;
                }
                long spectrumEnded=SystemClock.elapsedRealtimeNanos();
                boolean captureActive=recordingIq && ("waiting".equals(diagnostic.state()) || "recording".equals(diagnostic.state()));
                if(captureActive || now-updated>=100) {
                    JSObject details=new JSObject();
                    details.put("listenFrequencyHz",listenHz);details.put("centerFrequencyHz",(int)block[6]);details.put("sampleRate",(int)block[4]);
                    details.put("usbReadMs",received.diagnostic[0]);details.put("demodAndPcmExportMs",received.diagnostic[1]);
                    details.put("nativeWorkMs",received.diagnostic[2]);details.put("usbStatus",(int)received.diagnostic[3]);
                    details.put("iqMin",received.diagnostic[4]);details.put("iqMax",received.diagnostic[5]);
                    details.put("iqMeanI",received.diagnostic[6]);details.put("iqMeanQ",received.diagnostic[7]);details.put("iqRms",received.diagnostic[8]);
                    details.put("jniReadTotalMs",(readEnded-readBegan)/1e6);details.put("spectrumMs",(spectrumEnded-spectrumBegan)/1e6);
                    details.put("registerReadMs",controlReadMs);details.put("loopBeforeCaptureMs",(spectrumEnded-loopBegan)/1e6);
                    details.put("betweenLoopsMs",(loopBegan-previousLoopEnd)/1e6);
                    details.put("cycleIntervalMs",cycleIntervalMs);
                    details.put("usbBytes",(long)block[0]);details.put("expectedBlockMs",block[4]>0?block[0]*500.0/block[4]:0);
                    details.put("audioSamples",received.audio==null?0:received.audio.length);
                    details.put("audio",audio.snapshot());details.put("signalPower",received.signalPower);details.put("noisePower",received.noisePower);
                    details.put("meterWindowPeakPower",signalPeak);
                    if(received.noisePower>0 && signalPeak>=0) {
                        double excess=Math.max(0,10*Math.log10(Math.max(1e-12,signalPeak)/Math.max(1e-12,received.noisePower)));
                        details.put("meterWindowExcessDb",excess);details.put("meterWindowLevel",SdrSignalStrength.level(excess));
                        details.put("meterDisplayedLevel",strength.displayed());details.put("meterPeakHeld",strength.holding());
                    }
                    if(pulseSpectrum && spectrum.length==SdrCwSpectrum.BINS) {
                        int peak=0;for(int i=1;i<spectrum.length;i++)if(spectrum[i]>spectrum[peak])peak=i;
                        details.put("spectrumPeakHz",listenHz+(peak-spectrum.length/2)*6000.0/spectrum.length);
                        details.put("spectrumPeakDbfs",spectrum[peak]);details.put("spectrumPeakHold",true);
                    }
                    details.put("previousPublishedExcessDb",metrics.optDouble("signalExcessDb",-1));
                    if(captureActive) {
                        JSObject settings=new JSObject();settings.put("pipeline","cw-complex-channel-v1");settings.put("mode",mode);
                        settings.put("sampleRate",(int)block[4]);settings.put("centerFrequencyHz",(int)block[6]);
                        settings.put("listenFrequencyHz",listenHz);settings.put("gainDb",block[5]/10);settings.put("requestedGainDb",gain/10.0);
                        settings.put("ppm",ppm);settings.put("audioGainDb",appliedAudioGain);settings.put("registerReadback",registers);
                        settings.put("rtlAgcRequested",false);settings.put("tunerManualGainRequested",true);
                        settings.put("meterRevision",SdrSignalStrength.REVISION);
                        settings.put("device",diagnosticContext);putTunerInfo(settings);
                        diagnostic.observe(block,received.audio,now,settings.toString(),details.toString());
                    } else diagnostic.noteTelemetry(now,details.toString());
                }
                previousLoopEnd=SystemClock.elapsedRealtimeNanos();
                total += (long) block[0]; bytes += (long) block[0]; power += block[1]; clipped += block[2];
                if (block[0] > 0) lastData = now;
                if (now - lastData > 3000) throw new IllegalStateException("3초 동안 IQ 데이터가 없습니다. USB 전원과 연결을 확인하세요.");
                if (now - updated < 100) continue;
                JSObject result = new JSObject();
                int tuner = (int) block[3];
                result.put("tuner", tuner >= 0 && tuner < tuners.length ? tuners[tuner] : "Unknown");
                result.put("sampleRate", (int) block[4]); result.put("gainDb", block[5] / 10);
                result.put("frequencyHz", (int) block[6]); result.put("ppm", ppm);
                putTunerInfo(result);
                result.put("mode", mode); result.put("listenFrequencyHz", listenHz);
                result.put("audioSampleRate", ("wfm".equals(mode) || "cw".equals(mode)) ? 48000 : 0);
                result.put("deemphasisUs", deemphasisUs);
                result.put("totalBytes", total); result.put("bytesPerSecond", bytes * 1000.0 / (now - updated));
                result.put("elapsedSeconds", (now - started) / 1000.0);
                result.put("powerDbfs", bytes > 0 ? 10 * Math.log10(Math.max(1e-12, power / bytes)) : -120);
                result.put("clippingPercent", bytes > 0 ? clipped * 100 / bytes : 0);
                result.put("hasSamples", bytes > 0);
                if (pulseSpectrum) {
                    result.put("signalLevel",strength.displayed());result.put("signalLevelHeld",strength.holding());
                    result.put("signalLevelExcessDb",strength.heldExcess());result.put("signalMeterRevision",SdrSignalStrength.REVISION);
                }
                if (bytes > 0 && signalPeak >= 0)
                    result.put("signalDbfs", 10 * Math.log10(Math.max(1e-12, signalPeak)));
                if (bytes > 0 && signalPeak >= 0 && received.noisePower >= 0) {
                    double floor = Math.max(1e-12, received.noisePower);
                    result.put("noiseDbfs", 10 * Math.log10(floor));
                    result.put("signalExcessDb", Math.max(0, 10 * Math.log10(Math.max(1e-12, signalPeak) / floor)));
                }
                if (bytes > 0 && spectrum.length == (pulseSpectrum ? SdrCwSpectrum.BINS : SdrSpectrum.SIZE) && now - spectrumUpdated < 1000) {
                    result.put("spectrumDbfs", JSArray.from(spectrum));
                    result.put("spectrumPeakHold", pulseSpectrum);
                    result.put("fftSize", SdrSpectrum.SIZE);
                    if (pulseSpectrum) {
                        result.put("spectrumCenterHz", listenHz);
                        result.put("spectrumSpanHz", SdrCwSpectrum.SPAN_HZ);
                    }
                    result.put("spectrumFrames", spectrumFrames);
                    result.put("spectrumUpdatedSeconds", (spectrumUpdated - started) / 1000.0);
                }
                main.post(() -> {
                    if (generation.get() != token) return;
                    boolean firstReception = "starting".equals(state);
                    state = "receiving"; metrics = result;
                    if (firstReception && ("wfm".equals(mode) || "cw".equals(mode))) audio.startDefault();
                    changed.run();
                });
                bytes = 0; power = 0; clipped = 0; updated = now;
                signalPeak = -1;
            }
        } catch (Exception | LinkageError failure) {
            String reason = failure.getMessage() == null ? failure.toString() : failure.getMessage();
            main.post(() -> {
                if (generation.get() != token) return;
                audio.stop(); state = "error"; error = reason; changed.run();
            });
        } finally {
            diagnostic.finish(SystemClock.elapsedRealtime(),"reception-ended");
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
        fixedResultAvailable = false;
        audio.stop(); mode = "iq"; state = "starting"; error = ""; metrics = new JSObject();
        tunedFrequencyHz = 0;
        worker.execute(() -> scan(token, connection, session));
    }

    private void scan(int token, UsbDeviceConnection connection, SdrScanSession session) {
        SdrScan plan = session.plan;
        long handle = 0;
        try {
            if (generation.get() != token) return;
            handle = SdrNative.open(connection.getFileDescriptor(), session.centerHz(), plan.rate, session.gain, session.ppm);
            tunerInfo = SdrNative.describeTuner(handle);
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
                    boolean cw = "cw".equals(plan.mode);
                    boolean capture = settled && (cw || now - analyzed >= 100);
                    SdrBlock block = SdrNative.read(handle, capture, 0, cw);
                    now = SystemClock.elapsedRealtime();
                    if (generation.get() != token) break;
                    double[] values = block.values;
                    session.totalBytes += (long) values[0];
                    session.actualRate = (int) values[4]; session.actualGainDb = values[5] / 10;
                    if (values[0] > 0) lastData = now;
                    if (now - lastData > 3000) throw new IllegalStateException("3초 동안 IQ 데이터가 없습니다. USB 전원과 연결을 확인하세요.");
                    if (capture) {
                        plan.observe(cw ? analyzer.analyzePeaks(values, 7) : analyzer.analyze(values, 7),
                            (int) values[6], (int) values[4], session.elapsedSeconds(now), session.cycle);
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
        result.put("mode", plan.mode);
        result.put("startHz", plan.startHz); result.put("endHz", plan.endHz);
        result.put("centerHz", session.centerHz()); result.put("sampleRate", session.actualRate);
        result.put("requestedSampleRate", plan.rate); result.put("requestedGainTenthsDb", session.gain);
        result.put("gainDb", session.actualGainDb); result.put("ppm", session.ppm);
        putTunerInfo(result);
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
        tunerInfo = new double[0];
        if (audio != null) audio.stop();
        generation.incrementAndGet(); state = "idle"; metrics = new JSObject(); scan = new JSObject(); error = "";
        scanSession = null;
        fixedResultAvailable = false;
        tunedFrequencyHz = 0;
        // FIFO: stop the loop, close librtlsdr, then release the Java-owned descriptor.
        if (connection != null) worker.execute(connection::close);
    }

    void clearScanHistory() {
        if (!"idle".equals(state) && !"error".equals(state))
            throw new IllegalStateException("Stop reception before clearing scan history.");
        scanSession = null;
        scan = new JSObject();
        changed.run();
    }

    void clearReceptionResult() {
        if (!"idle".equals(state) && !"error".equals(state))
            throw new IllegalStateException("Stop reception before clearing its result.");
        metrics = new JSObject();
        error = "";
        fixedResultAvailable = false;
        changed.run();
    }

    void setAudio(Boolean enabled, Double volume, Integer gainDb) {
        if (Boolean.TRUE.equals(enabled) && (!"receiving".equals(state) || !("wfm".equals(mode) || "cw".equals(mode))))
            throw new IllegalStateException("CW 또는 WFM 수신을 시작한 뒤 소리를 켜주세요.");
        if (gainDb != null) audio.setGainDb(gainDb);
        audio.set(enabled, volume);
    }

    void shutdown() {
        audio.shutdown();generation.incrementAndGet();
        worker.execute(() -> diagnostic.shutdown(SystemClock.elapsedRealtime()));worker.shutdown();
    }
}
