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
        assertFalse("tracking expires without pulses",tracker.tracked());
    }
    @Test public void seededNoiseDoesNotLock() {
        SdrFieldCwTracker tracker=new SdrFieldCwTracker();Random random=new Random(12);
        for(int b=0;b<500;b++){
            double[] iq=new double[1920];
            for(int i=0;i<iq.length;i++)iq[i]=random.nextGaussian()*.001;
            tracker.observe(iq);assertFalse("noise-only control",tracker.tracked());
        }
    }
}
