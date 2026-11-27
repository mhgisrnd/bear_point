package com.bearpoint.app;

import org.junit.Test;
import java.util.Random;
import static org.junit.Assert.*;

public class SdrCwDetectorTest {
    private static class Signal {
        final Random random=new Random(34719);
        final double[] fi=new double[4],fq=new double[4];
        long samples;
        double[] block(int count,double frequency,double amplitude,boolean burstNoise) {
            double[] iq=new double[count*2];double alpha=1-Math.exp(-2*Math.PI*2500/48000);
            for(int i=0;i<count;i++,samples++){
                double t=samples/48000.0,phase=2*Math.PI*frequency*t;
                boolean on=t>=1 && (t-1)%1.13<.035;
                double sigma=burstNoise&&on?.03:.003;
                double re=random.nextGaussian()*sigma+(on?amplitude*Math.cos(phase):0);
                double im=random.nextGaussian()*sigma+(on?amplitude*Math.sin(phase):0);
                for(int j=0;j<4;j++){fi[j]+=alpha*(re-fi[j]);fq[j]+=alpha*(im-fq[j]);re=fi[j];im=fq[j];}
                iq[i*2]=re;iq[i*2+1]=im;
            }
            return iq;
        }
    }
    private SdrCwDetector run(double frequency,double amplitude,int chunk,boolean burstNoise,int seconds) {
        SdrCwDetector d=new SdrCwDetector(1024000);Signal s=new Signal();
        for(int i=0;i<seconds*48000;i+=chunk){int n=Math.min(chunk,seconds*48000-i);d.observe(s.block(n,frequency,amplitude,burstNoise),i,(i+n)/48.0);}
        return d;
    }
    @Test public void detectsOffsetsAndUnknownCadenceAcrossArbitraryBlocks(){
        for(double frequency:new double[]{-1450,-1200,-750,0,600,820,1200,1450}){
            SdrCwDetector d=run(frequency,.003,997,false,10);
            assertTrue("pulses at "+frequency+": "+d.pulseCount(),d.pulseCount()>=7);
            assertEquals(frequency,d.offsetHz(),48);assertEquals(2,d.confidence());
            double sourceSample=d.pulseTimeMs()*48;
            assertTrue(sourceSample>=d.pulseSequence()-1 && sourceSample<=d.pulseSequence()+998);
        }
        SdrCwDetector a=run(600,.003,1536,false,10),b=run(600,.003,997,false,10);
        assertEquals(a.pulseCount(),b.pulseCount());assertEquals(a.signalDbfs(),b.signalDbfs(),1e-8);
    }
    @Test public void rejectsSeededNoiseAndBroadbandBursts(){
        // Seeded controls are regression cases, not a claim of zero field false alarms.
        assertEquals(0,run(600,0,1536,false,60).pulseCount());
        assertEquals(0,run(600,0,1536,true,60).pulseCount());
    }
    @Test public void directionPowerUsesFixedBandwidthAndExpires(){
        SdrCwDetector weak=run(600,.002,1536,false,10),strong=run(600,.004,1536,false,10);
        assertEquals(398.4375,weak.directionWidthHz(),0);
        assertTrue(strong.directionDbfs()>weak.directionDbfs()+4);
        assertTrue(SdrCwDetector.directionLevel(strong.directionDbfs())>=SdrCwDetector.directionLevel(weak.directionDbfs()));
        assertEquals(0,weak.level()); // Last 35 ms pulse ended >350 ms before test finishes.
        assertEquals(0,SdrCwDetector.directionLevel(Double.NaN));
    }
    @Test public void continuousCarrierIsNotReportedAsRepeatedBeacon(){
        SdrCwDetector d=new SdrCwDetector(1024000);
        for(int b=0;b<400;b++){double[] iq=new double[3072];for(int j=0;j<1536;j++){
            double p=2*Math.PI*600*(b*1536+j)/48000.0;
            iq[j*2]=.01*Math.cos(p);iq[j*2+1]=.01*Math.sin(p);
        }d.observe(iq,b,(b+1)*32);}
        assertEquals(0,d.pulseCount());assertEquals(0,d.level());
    }

    private SdrCwDetector irregularPulses(double... starts) {
        SdrCwDetector detector = new SdrCwDetector(1024000);
        Random noise = new Random(9317);
        int chunk = 1536, samples = (int) ((starts[starts.length - 1] + .6) * 48000);
        for (int start = 0; start < samples; start += chunk) {
            int n = Math.min(chunk, samples - start);
            double[] iq = new double[n * 2];
            for (int i = 0; i < n; i++) {
                double t = (start + i) / 48000.0;
                boolean pulse = false;
                for (double s : starts) if (t >= s && t < s + .035) { pulse = true; break; }
                double phase = 2 * Math.PI * 600 * t;
                iq[2 * i] = noise.nextGaussian() * .003 + (pulse ? .008 * Math.cos(phase) : 0);
                iq[2 * i + 1] = noise.nextGaussian() * .003 + (pulse ? .008 * Math.sin(phase) : 0);
            }
            detector.observe(iq, start, (start + n) / 48.0);
        }
        return detector;
    }

    @Test public void correctsMissedPulseMultipleOnlyAfterTwoConsistentIntervals() {
        SdrCwDetector before = irregularPulses(2, 6.56, 8.08);
        assertEquals(3, before.pulseCount());
        assertEquals(4560, before.repeatedPeriodMs(), 60);
        SdrCwDetector after = irregularPulses(2, 6.56, 8.08, 9.6);
        assertEquals(4, after.pulseCount());
        assertEquals(1520, after.repeatedPeriodMs(), 60);
        SdrCwDetector unrelated = irregularPulses(2, 6.56, 8.08, 8.95);
        assertEquals(4, unrelated.pulseCount());
        assertEquals(4560, unrelated.repeatedPeriodMs(), 60);
    }

    @Test public void detectsRealAudioPulsesWithDigitallyMutedGaps() {
        for (int tone : new int[]{700, 1600}) {
            IcR30AudioAnalysis analysis = new IcR30AudioAnalysis();
            short[] audio = new short[IcR30AudioAnalysis.BLOCK];
            for (int block = 0; block < 230; block++) {
                boolean pulse = block >= 50 && (block - 50) % 50 < 3;
                for (int i = 0; i < audio.length; i++) {
                    double seconds = (block * audio.length + i) / (double) IcR30AudioAnalysis.RATE;
                    audio[i] = pulse ? (short) (4000 * Math.cos(2 * Math.PI * tone * seconds)) : 0;
                }
                analysis.observe(audio, (block + 1) * 20L);
            }
            assertTrue(analysis.detector.ready());
            assertEquals(4, analysis.detector.pulseCount());
            assertEquals(tone, IcR30AudioAnalysis.CENTER_HZ + analysis.detector.offsetHz(), 30);
            assertEquals(2, analysis.detector.confidence());
            double[] spectrum = analysis.detector.audioSpectrumDbfs();
            int peak = 0;
            for (int i = 1; i < spectrum.length; i++) if (spectrum[i] > spectrum[peak]) peak = i;
            double peakHz = IcR30AudioAnalysis.CENTER_HZ +
                    (peak - spectrum.length / 2) * SdrCwDetector.RATE / (double) SdrCwDetector.SIZE;
            assertEquals(tone, peakHz, 12);
            assertTrue("short pulse remains visible across the UI refresh", spectrum[peak] > -60);
        }
    }
}
