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
        for(double frequency:new double[]{-750,0,600,820}){
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
}
