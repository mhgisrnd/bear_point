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

/** Main-thread state; processing owns handle cleanup, while the native producer owns USB reads. */
final class SdrReceiver {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final AtomicInteger generation = new AtomicInteger();
    private final Handler main;
    private final Runnable changed;
    String state = "idle", error = "";
    volatile JSObject metrics = new JSObject();
    JSObject scan = new JSObject();
    boolean fixedResultAvailable;
    SdrAudioOutput audio;
    private final SdrDiagnosticCapture diagnostic;
    private final SdrCaptureWriter captureWriter;
    private JSObject diagnosticContext = new JSObject();
    final SdrComparison comparison;
    private volatile SdrComparison.Settings currentSettings;
    private boolean comparisonAudioEnabled;
    private double comparisonVolume;
    private int comparisonAudioGain;
    private File comparisonRoot;
    private UsbDeviceConnection comparisonConnection;
    String mode = "iq";
    private volatile int cwFilterMode = 0;
    int cwFilterMode() { return cwFilterMode; }
    private boolean airspy;
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
    private static void putCwDetector(JSObject result,SdrCwDetector detector,int listenHz,double receivedMs) {
        result.put("cwDetectorRevision",SdrCwDetector.REVISION);
        result.put("cwDetectorReady",detector.ready());result.put("cwPulseCount",detector.pulseCount());
        result.put("cwPulseRecent",detector.recent());result.put("cwCandidateTracked",detector.tracked());
        result.put("cwConfidence",detector.confidence());result.put("cwDirectionLevel",detector.level());
        result.put("cwDirectionBandwidthHz",detector.directionWidthHz());
        result.put("cwSearchHalfWidthHz",SdrCwDetector.SEARCH_HZ);
        result.put("cwFrameStartMs",detector.frameStartMs());result.put("cwFrameEndMs",detector.frameEndMs());
        result.put("cwPowerConvention","mean-complex-power/2; software-filter-compensated; not calibrated dBm");
        if(Double.isFinite(detector.frameBestSnrDb()))result.put("cwFrameBestSnrDb",detector.frameBestSnrDb());
        result.put("cwFrameBestOffsetHz",detector.frameBestOffsetHz());
        result.put("cwBroadbandRiseDb",detector.broadbandRiseDb());
        if(detector.pulseCount()>0) {
            result.put("cwCandidateHz",listenHz+detector.offsetHz());result.put("cwCandidateOffsetHz",detector.offsetHz());
            result.put("cwDetectionBandwidthHz",detector.widthHz());result.put("cwSnrDb",detector.snrDb());
            result.put("cwDetectionSignalDbfs",detector.signalDbfs());result.put("cwDetectionNoiseDbfs",detector.noiseDbfs());
            result.put("cwDetectionBandDbfs",detector.bandDbfs());
            result.put("cwDirectionDbfs",detector.directionDbfs());result.put("cwDirectionNoiseDbfs",detector.directionNoiseDbfs());
            result.put("cwPulseSourceSequence",detector.pulseSequence());result.put("cwPulseTimeMs",detector.pulseTimeMs());
            result.put("cwPulseDurationMs",detector.pulseDurationMs());result.put("cwPulseIntervalMs",detector.intervalMs());
            result.put("cwCadenceAssisted",detector.assisted());
            result.put("cwDetectionAgeMs",Math.max(0,receivedMs-detector.pulseTimeMs()));
        }
    }
    boolean hasScanSession() { return scanSession != null; }
    SdrReceiver(Handler main, Runnable changed) {
        this.main = main; this.changed = changed;
        diagnostic = new SdrDiagnosticCapture(() -> main.post(changed));
        captureWriter=new SdrCaptureWriter(diagnostic);
        comparison=new SdrComparison(new SdrComparison.Host(){
            public String reception(){return state;} public String captureState(){return diagnostic.state();}
            public String error(){return SdrReceiver.this.error+" "+diagnostic.error();}
            public void stop(Runnable done){stopInternal(done);}
            public void start(SdrComparison.Settings s){startConfigured(comparisonConnection,s);}
            public void record(int index,String name){
                JSObject context=new JSObject();
                try{context=new JSObject(diagnosticContext.toString());}catch(org.json.JSONException failure){throw new IllegalStateException(failure);}
                context.put("comparisonStep",index+1);context.put("comparisonName",name);
                startDiagnosticInternal(comparisonRoot,context);
            }
            public File file(){return diagnostic.readyFile();}
            public void bundle(java.util.List<File> files,java.util.List<String> names,String reason){diagnostic.bundle(comparisonRoot,files,names,reason);}
            public void later(Runnable action){main.postDelayed(action,250);}
            public void changed(){changed.run();}
            public void restoreAudio(){audio.setGainDb(comparisonAudioGain);audio.set(comparisonAudioEnabled,comparisonVolume);}
        },SystemClock::elapsedRealtime);
    }
    void diagnosticStorage(File files,File cache) { diagnostic.storage(new File(files,"sdr-diagnostics"),cache); }
    void startDiagnostic(File root,JSObject context) {
        if (!"receiving".equals(state) || !"cw".equals(mode) || !metrics.optBoolean("hasSamples"))
            throw new IllegalStateException("개별 CW 수신 신호를 확인한 뒤 진단 기록을 시작하세요.");
        if(comparison.active)throw new IllegalStateException("비교 진단이 진행 중입니다.");
        comparison.message="";comparison.phase="idle";
        startDiagnosticInternal(root,context);
    }
    private void startDiagnosticInternal(File root,JSObject context) {
        diagnosticContext=context;
        try { captureWriter.request(root); }
        catch (java.io.IOException failure) { throw new IllegalStateException(failure.getMessage(),failure); }
    }
    void startComparison(UsbDeviceConnection connection,File root,JSObject context) {
        if (!"receiving".equals(state) || !"cw".equals(mode) || currentSettings == null || !metrics.optBoolean("hasSamples"))
            throw new IllegalStateException("개별 CW 수신 신호를 확인한 뒤 비교 진단을 시작하세요.");
        if(java.util.Arrays.asList("waiting","recording","packaging").contains(diagnostic.state()))throw new IllegalStateException("진단 기록 완료 후 시작하세요.");
        if(!root.isDirectory()&&!root.mkdirs())throw new IllegalStateException("진단 폴더를 만들지 못했습니다.");
        if(root.getUsableSpace()<600L*1024*1024)throw new IllegalStateException("비교 진단에는 여유 공간 600MB 이상이 필요합니다.");
        comparisonRoot=root;comparisonConnection=connection;diagnosticContext=context;
        JSObject a=audio.snapshot();comparisonAudioEnabled=a.optBoolean("enabled");comparisonVolume=a.optDouble("volume",1);comparisonAudioGain=audio.gainDb();
        comparison.begin(currentSettings);
    }
    void stopComparison(){comparison.cancel();}
    void stopDiagnostic() {
        if (!comparison.active && ("waiting".equals(diagnostic.state()) || "recording".equals(diagnostic.state()))) {
            captureWriter.finish(SystemClock.elapsedRealtime(), "manual");
        }
    }
    File diagnosticFile() { return diagnostic.readyFile(); }
    File diagnosticFile(String id) { return diagnostic.file(id); }
    void deleteDiagnostic(String id) {
        try { diagnostic.delete(id); }
        catch(java.io.IOException failure) { throw new IllegalStateException(failure.getMessage(),failure); }
    }
    JSObject diagnosticSnapshot() {
        JSObject result=new JSObject();result.put("state",diagnostic.state());result.put("error",diagnostic.error());
        result.put("iqBytes",diagnostic.bytes());result.put("omittedIqBytes",diagnostic.omitted());
        result.put("writerDroppedBlocks",diagnostic.writerDroppedBlocks());result.put("pendingFrames",captureWriter.pending());
        SdrDiagnosticCapture.AudioTrace trace = diagnostic.audioTrace();
        JSArray peaks = new JSArray();
        for (int peak : trace.peaks) peaks.put(peak);
        result.put("recordedElapsedMs", trace.elapsedMs).put("recordingDurationMs", trace.durationMs);
        result.put("audioIntervalMs", SdrRecordedAudioPeaks.INTERVAL_MS).put("audioPeaks", peaks);
        JSArray records=new JSArray();
        for(SdrDiagnosticCapture.Saved record:diagnostic.saved()) {
            JSObject item=new JSObject();item.put("id",record.id);item.put("time",record.time);item.put("sizeBytes",record.size);item.put("comparison",record.comparison);
            item.put("hasAudio", record.hasAudio);records.put(item);
        }
        result.put("records",records);
        JSObject cmp=new JSObject();cmp.put("active",comparison.active);cmp.put("phase",comparison.phase);cmp.put("message",comparison.message);
        cmp.put("step",comparison.index+1);cmp.put("total",comparison.steps==null?0:comparison.steps.size());result.put("comparison",cmp);return result;
    }

    void start(UsbDeviceConnection connection, int hz, int rate, int gain, int ppm, String mode, int listenHz,
               int deemphasisUs, boolean listenAudio, double volume, boolean airspy) {
        if(comparison.active)throw new IllegalStateException("비교 진단을 먼저 중단하세요.");
        this.mode=mode;
        this.airspy=airspy;
        startConfigured(connection, new SdrComparison.Settings(hz, rate, gain, ppm, listenHz, deemphasisUs, 12000), listenAudio, volume);
    }
    boolean retuneCw(int listenHz) {
        SdrComparison.Settings settings = currentSettings;
        if (!"receiving".equals(state) || !"cw".equals(mode) || settings == null)
            throw new IllegalStateException("개별 CW 수신 중에 주파수를 조정하세요.");
        if (comparison.active || java.util.Arrays.asList("waiting", "recording", "packaging").contains(diagnostic.state()))
            throw new IllegalStateException("진단 기록을 마친 뒤 주파수를 조정하세요.");
        if (listenHz == settings.listen) return true;
        if (!SdrSettings.canFineTuneCw(settings.hz, settings.offset, settings.rate, listenHz)) return false;
        currentSettings = new SdrComparison.Settings(settings.hz, settings.rate, settings.gain, settings.ppm,
            listenHz, settings.deemphasis, settings.offset);
        tunedFrequencyHz = listenHz;
        metrics = new JSObject().put("listenFrequencyHz", listenHz).put("mode", mode);
        changed.run();
        return true;
    }
    private void startConfigured(UsbDeviceConnection connection,SdrComparison.Settings settings) {
        startConfigured(connection, settings, true, 1d);
    }
    private void startConfigured(UsbDeviceConnection connection, SdrComparison.Settings settings, boolean listenAudio, double volume) {
        if (!state.equals("idle") && !state.equals("error")) throw new IllegalStateException("정지 후 다시 시작하세요.");
        currentSettings=settings;
        String mode=this.mode;
        int token = generation.incrementAndGet();
        audio.stop(); this.mode = mode;
        tunedFrequencyHz = settings.hz;
        fixedResultAvailable = true;
        state = "starting"; error = ""; metrics = new JSObject();
        if (scanSession == null) scan = new JSObject();
        worker.execute(() -> receive(token, connection, settings, mode, listenAudio, volume));
    }

    private void receive(int token, UsbDeviceConnection connection, SdrComparison.Settings applied, String mode, boolean listenAudio, double volume) {
        long handle = 0, demodulator = 0;
        int[] airspyInfo = new int[0];
        try {
            if (generation.get() != token) return;
            int hz = applied.hz, rate = applied.rate, gain = applied.gain, ppm = applied.ppm;
            int listenHz = applied.listen, deemphasisUs = applied.deemphasis, offsetHz = applied.offset;
            int hardwareHz = airspy ? hz : ("cw".equals(mode) ? hz - offsetHz : hz);
            if (airspy) {
                handle = AirspyNative.open(connection.getFileDescriptor(), hardwareHz);
                tunerInfo = new double[0];
                airspyInfo = AirspyNative.describe(handle);
                AirspyNative.startStreaming(handle);
            } else {
                handle = SdrNative.open(connection.getFileDescriptor(), hardwareHz, rate, gain, ppm);
                tunerInfo = SdrNative.describeTuner(handle);
                SdrNative.startStreaming(handle);
            }
            long total = 0, bytes = 0, started = SystemClock.elapsedRealtime(), updated = started, lastData = started;
            double power = 0, clipped = 0;
            double signalPeak = -1;
            long signalPeakSequence=0;
            double signalPeakReceivedMs=0;
            SdrSpectrum analyzer = new SdrSpectrum();
            boolean pulseSpectrum = "cw".equals(mode);
            SdrCwSpectrum cwSpectrum = new SdrCwSpectrum();
            SdrCwDetector cwDetector = new SdrCwDetector(rate);
            SdrSignalStrength strength = new SdrSignalStrength();
            double[] spectrum = new double[0];
            int spectrumFrames = 0;
            long spectrumUpdated = started - 500;
            String[] tuners = {"Unknown", "E4000", "FC0012", "FC0013", "FC2580", "R820T", "R828D"};
            int appliedAudioGain = Integer.MIN_VALUE;
            int appliedFilterMode = -1;
            int actualRate = rate, actualCenterHz = hardwareHz;
            JSObject registers = new JSObject();
            long previousLoopEnd = SystemClock.elapsedRealtimeNanos();
            long previousLoopBegan = previousLoopEnd;
            while (generation.get() == token) {
                SdrComparison.Settings requested = currentSettings;
                if (requested != applied) {
                    if (generation.get() != token) break;
                    listenHz = requested.listen;
                    long replacement = SdrNative.createDemodulator(mode, actualRate, listenHz - actualCenterHz, deemphasisUs);
                    if (demodulator != 0) SdrNative.closeDemodulator(demodulator);
                    demodulator = replacement;
                    appliedAudioGain = audio.gainDb();
                    SdrNative.setAudioGain(demodulator, appliedAudioGain);
                    appliedFilterMode = -1;
                    audio.discontinuity();
                    cwSpectrum = new SdrCwSpectrum();
                    cwDetector = new SdrCwDetector(actualRate);
                    strength = new SdrSignalStrength();
                    spectrum = new double[0];
                    bytes = 0; power = 0; clipped = 0;
                    signalPeak = -1; signalPeakSequence = 0; signalPeakReceivedMs = 0;
                    updated = SystemClock.elapsedRealtime();
                    applied = requested;
                }
                long loopBegan=SystemClock.elapsedRealtimeNanos();
                double cycleIntervalMs=(loopBegan-previousLoopBegan)/1e6;previousLoopBegan=loopBegan;
                double controlReadMs=0;
                if(!airspy && "waiting".equals(diagnostic.state())) {
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
                SdrBlock received = airspy ? AirspyNative.read(handle, captureSpectrum, demodulator) : SdrNative.read(handle, captureSpectrum, demodulator, pulseSpectrum);
                long readEnded=SystemClock.elapsedRealtimeNanos();
                double[] block = received.values;
                actualRate = (int) block[4]; actualCenterHz = (int) block[6];
                if (airspy && demodulator == 0) cwDetector = new SdrCwDetector(actualRate);
                if (applied != currentSettings) continue;
                if(received.diagnostic[18]>0){cwSpectrum=new SdrCwSpectrum();cwDetector=new SdrCwDetector((int)block[4]);strength=new SdrSignalStrength();signalPeak=-1;audio.discontinuity();}
                // Configure from the actual hardware rate, before decoding subsequent blocks.
                if (demodulator == 0 && ("wfm".equals(mode) || "cw".equals(mode)))
                    demodulator = SdrNative.createDemodulator(mode, (int) block[4], listenHz - (int) block[6], deemphasisUs);
                if (demodulator != 0 && "cw".equals(mode) && appliedAudioGain != audio.gainDb()) {
                    appliedAudioGain = audio.gainDb();
                    SdrNative.setAudioGain(demodulator, appliedAudioGain);
                }
                if (demodulator != 0 && "cw".equals(mode) && appliedFilterMode != cwFilterMode) {
                    appliedFilterMode = cwFilterMode;
                    SdrNative.setCwFilter(demodulator, appliedFilterMode);
                }
                audio.offer(received.audio,(long)received.diagnostic[9],received.diagnostic[11]);
                if(received.signalPower>signalPeak){
                    signalPeak=received.signalPower;signalPeakSequence=(long)received.diagnostic[9];signalPeakReceivedMs=received.diagnostic[11];
                }
                long now = SystemClock.elapsedRealtime();
                if (pulseSpectrum) strength.observe(signalPeak,received.noisePower,now);
                long spectrumBegan=SystemClock.elapsedRealtimeNanos();
                long detectorNanos=0;
                if (pulseSpectrum) {
                    cwDetector.observe(received.channelIq,(long)received.diagnostic[9],received.diagnostic[11]);
                    if (appliedFilterMode >= 3 && demodulator != 0)
                        SdrNative.setWeakCwCenter(demodulator, cwDetector.confidence() >= 2 ? (int)Math.round(Math.abs(700 + cwDetector.offsetHz())) : 0);
                    detectorNanos=SystemClock.elapsedRealtimeNanos()-spectrumBegan;
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
                    details.put("decoderWaitMs",received.diagnostic[0]);details.put("demodAndPcmExportMs",received.diagnostic[1]);
                    details.put("nativeWorkMs",received.diagnostic[2]);details.put("streamReadStatus",(int)received.diagnostic[3]);
                    details.put("iqMin",received.diagnostic[4]);details.put("iqMax",received.diagnostic[5]);
                    details.put("iqMeanI",received.diagnostic[6]);details.put("iqMeanQ",received.diagnostic[7]);details.put("iqRms",received.diagnostic[8]);
                    details.put("jniReadTotalMs",(readEnded-readBegan)/1e6);details.put("spectrumMs",(spectrumEnded-spectrumBegan-detectorNanos)/1e6);
                    details.put("cwDetectorMs",detectorNanos/1e6);
                    details.put("registerReadMs",controlReadMs);details.put("loopBeforeCaptureMs",(spectrumEnded-loopBegan)/1e6);
                    details.put("betweenLoopsMs",(loopBegan-previousLoopEnd)/1e6);
                    details.put("cycleIntervalMs",cycleIntervalMs);
                    details.put("sourceSequence",(long)received.diagnostic[9]);details.put("sourceByteOffset",(long)received.diagnostic[10]);
                    details.put("sourceReceivedMs",received.diagnostic[11]);details.put("receiveQueueAgeMs",received.diagnostic[12]);
                    details.put("receiveQueueDepth",received.diagnostic[13]);details.put("receiveDroppedBlocks",received.diagnostic[14]);
                    details.put("receiveDroppedBytes",received.diagnostic[15]);details.put("usbDeliveredBytes",received.diagnostic[16]);
                    details.put("receiveQueueHighWater",received.diagnostic[17]);details.put("sourceDiscontinuity",received.diagnostic[18]>0);
                    details.put("sourceCallbackIntervalMs",received.diagnostic[19]);
                    if (airspy) {
                        details.put("airspyDriverDroppedSamples", received.diagnostic[20]);
                        if (received.diagnostic.length >= 25) {
                            details.put("airspyPostDspPeakAbs",received.diagnostic[21]);
                            details.put("airspyPostDspComplexSamplesAbove090",(long)received.diagnostic[22]);
                            details.put("airspyPostDspComplexSamplesAbove099",(long)received.diagnostic[23]);
                            details.put("airspyPostDspNonfiniteComplexSamples",(long)received.diagnostic[24]);
                            details.put("airspyPostDspComplexSamples",(long)block[0]/8);
                        }
                    }
                    details.put("captureQueueDepth",captureWriter.pending());details.put("captureQueueHighWater",captureWriter.highWater());
                    details.put("usbBytes",(long)block[0]);details.put("expectedBlockMs",block[4]>0?block[0]*1000.0/(block[4]*(airspy?8:2)):0);
                    details.put("audioSamples",received.audio==null?0:received.audio.length);
                    if (captureActive && received.audio != null && received.audio.length > 0) {
                        long sumSquares=0;int peak=0,nearLimit=0;
                        for (short sample : received.audio) {
                            int magnitude=Math.abs((int)sample);peak=Math.max(peak,magnitude);
                            sumSquares+=(long)sample*sample;if(magnitude>=32000)nearLimit++;
                        }
                        details.put("audioPcmRms",Math.sqrt((double)sumSquares/received.audio.length));
                        details.put("audioPcmPeak",peak);details.put("audioPcmSamplesNearLimit",nearLimit);
                    }
                    details.put("audio",audio.snapshot());details.put("signalPower",received.signalPower);details.put("noisePower",received.noisePower);
                    details.put("meterWindowPeakPower",signalPeak);
                    details.put("meterPeakSourceSequence",signalPeakSequence);details.put("meterPeakSourceReceivedMs",signalPeakReceivedMs);
                    if(pulseSpectrum) putCwDetector(details,cwDetector,listenHz,received.diagnostic[11]);
                    if (pulseSpectrum && appliedFilterMode >= 3) {
                        double tone=Math.abs(700 + cwDetector.offsetHz());
                        boolean active=cwDetector.confidence()>=2 && tone>=100 && tone<=1600;
                        details.put("weakAudioTrackingActive",active);
                        details.put("weakAudioCenterHz",active ? tone : 0);
                        details.put("weakAudioAdditionalGain",active ? 20 : 1);
                    }
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
                    details.put("previousPublishedSourceSequence",metrics.optDouble("sourceSequence",0));
                    details.put("previousDisplayPublishedMs",metrics.optDouble("displayPublishedMs",0));
                    if(captureActive) {
                        JSObject settings=new JSObject();settings.put("pipeline","cw-complex-channel-v1");settings.put("mode",mode);
                        settings.put("sampleRate",(int)block[4]);settings.put("centerFrequencyHz",(int)block[6]);
                        settings.put("cwAudioFilter",appliedFilterMode >= 3 ? "weak-tracked" : appliedFilterMode == 1 ? "narrow" : appliedFilterMode == 2 ? "wide" : "default");
                        settings.put("cwAudioFilterApprox3dBBandwidthHz",appliedFilterMode == 5 ? 150 : appliedFilterMode == 4 ? 500 : appliedFilterMode == 3 ? 200 : appliedFilterMode == 1 ? 1200 : appliedFilterMode == 2 ? 4000 : 2200);
                        settings.put("cwAudioFilterCenterHz",listenHz);
                        if (appliedFilterMode >= 3) {
                            double tone=Math.abs(700 + cwDetector.offsetHz());
                            boolean active=cwDetector.confidence()>=2 && tone>=100 && tone<=1600;
                            settings.put("cwAudioFilterAudioCenterHz",active ? tone : 0);
                            settings.put("cwAudioFilterAdditionalGain",active ? 20 : 1);
                        }
                        settings.put("listenFrequencyHz",listenHz);settings.put("audioGainDb",appliedAudioGain);
                        settings.put("receiverType",airspy?"airspyhf":"rtl");
                        settings.put("iqFormat",airspy?"cf32le":"cu8");
                        if (airspy) {
                            settings.put("driverDsp", "enabled; driver IQ correction, IF shift and fine tuning");
                            settings.put("airspyIqDiagnosticsConvention", "post-driver float IQ; thresholds are not ADC clipping or calibrated power");
                            settings.put("airspyRfGainAndAdcClipping", "not measured by this diagnostic");
                            settings.put("sampleRateSource", airspyInfo[1] != 0 ? "driver fallback after firmware query failure" : "firmware list");
                            JSArray rates = new JSArray();
                            for (int i=2;i<airspyInfo.length;i++) rates.put(airspyInfo[i]);
                            settings.put("supportedSampleRates",rates);
                        }
                        else {
                            settings.put("gainDb",block[5]/10);settings.put("requestedGainDb",gain/10.0);
                            settings.put("ppm",ppm);settings.put("registerReadback",registers);
                            settings.put("rtlAgcRequested",false);settings.put("tunerManualGainRequested",true);
                        }
                        settings.put("meterRevision",SdrSignalStrength.REVISION);
                        if(pulseSpectrum){settings.put("cwDetectorRevision",SdrCwDetector.REVISION);settings.put("cwSearchHalfWidthHz",SdrCwDetector.SEARCH_HZ);}
                        settings.put("receivePipeline","async-usb-v1");settings.put("sourceClock","Android elapsedRealtime / CLOCK_BOOTTIME");
                        settings.put("device",diagnosticContext);putTunerInfo(settings);
                        captureWriter.offer(block,received.audio,received.rawIq,now,settings.toString(),details.toString(),airspy);
                    } else diagnostic.noteTelemetry(now,details.toString());
                }
                previousLoopEnd=SystemClock.elapsedRealtimeNanos();
                total += (long) block[0]; bytes += (long) block[0]; power += block[1]; clipped += block[2];
                if (block[0] > 0) lastData = now;
                if (now - lastData > 3000) throw new IllegalStateException("3초 동안 IQ 데이터가 없습니다. USB 전원과 연결을 확인하세요.");
                if (now - updated < 100) continue;
                JSObject result = new JSObject();
                int tuner = (int) block[3];
                result.put("tuner", airspy ? "Airspy HF+" : (tuner >= 0 && tuner < tuners.length ? tuners[tuner] : "Unknown"));
                result.put("receiverType",airspy?"airspyhf":"rtl");
                result.put("sampleRate", (int) block[4]);
                if (!airspy) { result.put("gainDb", block[5] / 10); result.put("ppm", ppm); }
                result.put("frequencyHz", (int) block[6]);
                putTunerInfo(result);
                result.put("mode", mode); result.put("listenFrequencyHz", listenHz);
                result.put("audioSampleRate", ("wfm".equals(mode) || "cw".equals(mode)) ? 48000 : 0);
                result.put("deemphasisUs", deemphasisUs);
                result.put("totalBytes", total); result.put("bytesPerSecond", bytes * 1000.0 / (now - updated));
                result.put("elapsedSeconds", (now - started) / 1000.0);
                result.put("powerDbfs", bytes > 0 ? 10 * Math.log10(Math.max(1e-12, power / bytes)) : -120);
                if (!airspy) result.put("clippingPercent", bytes > 0 ? clipped * 100 / bytes : 0);
                result.put("hasSamples", bytes > 0);
                result.put("sourceSequence",(long)received.diagnostic[9]);result.put("sourceReceivedMs",received.diagnostic[11]);
                result.put("receiveQueueAgeMs",received.diagnostic[12]);result.put("receiveDroppedBlocks",received.diagnostic[14]);
                int displayDelay=audio.presentationDelayMs();
                if(pulseSpectrum&&!strength.holding()&&strength.displayed()>0&&signalPeakReceivedMs>0)
                    displayDelay=(int)Math.max(0,displayDelay-Math.max(0,received.diagnostic[11]-signalPeakReceivedMs));
                if(pulseSpectrum && cwDetector.recent())
                    displayDelay=(int)Math.max(0,audio.presentationDelayMs()-Math.max(0,received.diagnostic[11]-cwDetector.pulseTimeMs()));
                result.put("displayDelayMs",displayDelay);result.put("signalPeakSourceSequence",signalPeakSequence);
                result.put("signalPeakSourceReceivedMs",signalPeakReceivedMs);
                if (pulseSpectrum) {
                    putCwDetector(result,cwDetector,listenHz,received.diagnostic[11]);
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
                SdrComparison.Settings measured = applied;
                main.postDelayed(() -> {
                    if (generation.get() != token || currentSettings != measured) return;
                    boolean firstReception = "starting".equals(state);
                    result.put("displayPublishedMs",SystemClock.elapsedRealtime());result.put("audioSourceSequenceAtDisplay",audio.playingSequence());
                    state = "receiving"; metrics = result;
                    if (firstReception && ("wfm".equals(mode) || "cw".equals(mode))) {
                        audio.startListening(listenAudio, volume);
                        if(comparison.active){audio.setGainDb(comparisonAudioGain);audio.set(comparisonAudioEnabled,comparisonVolume);}
                    }
                    changed.run();
                },displayDelay);
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
            captureWriter.finish(SystemClock.elapsedRealtime(),"reception-ended");
            if (demodulator != 0) SdrNative.closeDemodulator(demodulator);
            if (handle != 0) { if (airspy) AirspyNative.close(handle); else SdrNative.close(handle); }
        }
    }

    void startScan(UsbDeviceConnection connection, SdrScan plan, int gain, int ppm) {
        if(comparison.active)throw new IllegalStateException("비교 진단을 먼저 중단하세요.");
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
        comparison.interrupt();stopInternal(complete);
    }
    private void stopInternal(Runnable complete) {
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
        closeUsb(connection,null);
    }

    interface CloseCompletion { void finished(RuntimeException failure); }

    void closeUsb(UsbDeviceConnection connection,CloseCompletion complete) {
        comparison.interrupt();
        tunerInfo = new double[0];
        if (audio != null) audio.stop();
        generation.incrementAndGet(); state = "idle"; metrics = new JSObject(); scan = new JSObject(); error = "";
        scanSession = null;
        fixedResultAvailable = false;
        tunedFrequencyHz = 0;
        // FIFO: stop the loop, close librtlsdr, then release the Java-owned descriptor.
        worker.execute(() -> {
            RuntimeException failure=null;
            try {if(connection!=null)connection.close();}
            catch(RuntimeException error){failure=error;}
            RuntimeException result=failure;
            if(complete!=null)main.post(() -> complete.finished(result));
            else if(failure!=null)android.util.Log.w("SdrReceiver","USB close failed",failure);
        });
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
        if(comparison.active)throw new IllegalStateException("비교 진단 중에는 청취 설정을 유지합니다.");
        if (Boolean.TRUE.equals(enabled) && (!"receiving".equals(state) || !("wfm".equals(mode) || "cw".equals(mode))))
            throw new IllegalStateException("CW 또는 WFM 수신을 시작한 뒤 소리를 켜주세요.");
        if (gainDb != null) audio.setGainDb(gainDb);
        audio.set(enabled, volume);
    }

    void setCwFilter(int filter) {
        if (filter < 0 || filter > 5) throw new IllegalArgumentException("Invalid CW filter");
        if (comparison.active || java.util.Arrays.asList("waiting", "recording", "packaging").contains(diagnostic.state()))
            throw new IllegalStateException("진단 기록을 마친 후 필터를 변경하세요.");
        cwFilterMode = filter;
        changed.run();
    }

    void shutdown() {
        comparison.interrupt();
        audio.shutdown();generation.incrementAndGet();
        worker.execute(() -> captureWriter.shutdown(SystemClock.elapsedRealtime()));worker.shutdown();
    }
}
