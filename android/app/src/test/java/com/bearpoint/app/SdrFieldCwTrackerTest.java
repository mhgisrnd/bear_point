package com.bearpoint.app;

import java.util.Random;
import org.junit.Test;
import static org.junit.Assert.*;

public class SdrFieldCwTrackerTest {
    @Test public void followsRepeatedPulseAndReleasesAfterSilence() {
        SdrFieldCwTracker tracker=new SdrFieldCwTracker();Random random=new Random(41);
        int rate=48000,chunk=960;
        for(int start=0;start<rate*7;start+=chunk){
            double[] iq=new double[chunk*2];
            for(int i=0;i<chunk;i++){
                double t=(start+i)/(double)rate, phase=2*Math.PI*(-609.375)*t;
                boolean pulse=t>.4 && (t-.4)%1.5<.055;
                iq[2*i]=random.nextGaussian()*.001+(pulse?.015*Math.cos(phase):0);
                iq[2*i+1]=random.nextGaussian()*.001+(pulse?.015*Math.sin(phase):0);
            }
            tracker.observe(iq);
        }
        assertTrue("three matching bursts lock",tracker.tracked());
        assertEquals(-609.375,tracker.offsetHz(),50);
        for(int i=0;i<6*rate;i+=chunk)tracker.observe(new double[chunk*2]);
        assertTrue("a short shielded gap retains the candidate",tracker.tracked());
        assertTrue("held candidate is distinguished from a recent match",tracker.holding());
        for(int start=13*rate;start<15*rate;start+=chunk){
            double[] iq=new double[chunk*2];
            for(int i=0;i<chunk;i++){
                double t=(start+i)/(double)rate,phase=2*Math.PI*(-609.375)*t;
                boolean pulse=t>=13.9 && (t-13.9)%1.5<.055;
                iq[2*i]=random.nextGaussian()*.001+(pulse?.015*Math.cos(phase):0);
                iq[2*i+1]=random.nextGaussian()*.001+(pulse?.015*Math.sin(phase):0);
            }
            tracker.observe(iq);
        }
        assertTrue("same cadence recovers without reacquiring",tracker.tracked());
        assertFalse("recovered pulse clears held state",tracker.holding());
        for(int i=0;i<11*rate;i+=chunk)tracker.observe(new double[chunk*2]);
        assertFalse("tracking expires without pulses",tracker.tracked());
    }
    @Test public void seededNoiseDoesNotLock() {
        SdrFieldCwTracker tracker=new SdrFieldCwTracker();Random random=new Random(12);
        tracker.seedCandidate(-609,1520);
        for(int b=0;b<500;b++){
            double[] iq=new double[1920];
            for(int i=0;i<iq.length;i++)iq[i]=random.nextGaussian()*.001;
            tracker.observe(iq);assertFalse("noise-only control",tracker.tracked());
        }
    }
    @Test public void rememberedCadenceRequiresTwoNewPulses() {
        SdrFieldCwTracker remembered=new SdrFieldCwTracker(), fresh=new SdrFieldCwTracker();
        remembered.seedCandidate(-609,1520);Random random=new Random(38);
        int rate=48000,chunk=960;
        for(int start=0;start<rate*2.5;start+=chunk){
            double[] iq=new double[chunk*2];
            for(int i=0;i<chunk;i++){
                double t=(start+i)/(double)rate,p=2*Math.PI*(-609.375)*t;
                boolean pulse=(t>=.4&&t<.455)||(t>=1.92&&t<1.975);
                iq[2*i]=random.nextGaussian()*.001+(pulse?.015*Math.cos(p):0);
                iq[2*i+1]=random.nextGaussian()*.001+(pulse?.015*Math.sin(p):0);
            }
            remembered.observe(iq);fresh.observe(iq);
        }
        assertTrue("remembered cadence confirmed by two actual pulses",remembered.tracked());
        assertFalse("fresh tracker still requires a third pulse",fresh.tracked());
        assertEquals(-609.375,remembered.offsetHz(),50);
    }
    @Test public void lockedCandidateSurvivesStrongerNearbyRepeatingSignal() {
        SdrFieldCwTracker tracker=new SdrFieldCwTracker();Random random=new Random(901);
        int rate=48000,chunk=960;
        for(int start=0;start<rate*9;start+=chunk){
            double[] iq=new double[chunk*2];
            for(int i=0;i<chunk;i++){
                double t=(start+i)/(double)rate,phase=2*Math.PI*(-609.375)*t;
                boolean pulse=t>.4 && (t-.4)%1.5<.055;
                double interferer=2*Math.PI*750*t,extra=(pulse && t>5) ? .025 : 0;
                iq[2*i]=random.nextGaussian()*.001+(pulse?.015*Math.cos(phase):0)+extra*Math.cos(interferer);
                iq[2*i+1]=random.nextGaussian()*.001+(pulse?.015*Math.sin(phase):0)+extra*Math.sin(interferer);
            }
            tracker.observe(iq);
        }
        assertTrue(tracker.tracked());assertEquals(-609.375,tracker.offsetHz(),80);
    }
}
