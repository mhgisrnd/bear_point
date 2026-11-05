package com.bearpoint.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class SdrSignalStrengthTest {
    private double power(double db) {return Math.pow(10,db/10);}
    @Test public void weakRiseIsVisibleButSteadyNoiseHasNoFixedBars() {
        SdrSignalStrength meter=new SdrSignalStrength();
        meter.observe(power(2.5),1,1000);assertEquals(0,meter.displayed());
        meter.observe(power(3.2),1,1100);assertEquals(1,meter.displayed());
        meter.observe(power(3.7),1,1200);assertEquals(2,meter.displayed());
        meter.observe(power(2),1,1300);assertEquals(2,meter.displayed());assertTrue(meter.holding());
        meter.observe(power(2),1,1551);assertEquals(0,meter.displayed());assertFalse(meter.holding());
        meter.observe(power(47),1,1600);assertEquals(10,meter.displayed());
    }
    @Test public void scaleIsMonotonicAndInvalidSamplesClearTheHold() {
        int previous=0;
        for(double db=0;db<60;db+=.1) {int level=SdrSignalStrength.level(db);assertTrue(level>=previous&&level<=10);previous=level;}
        SdrSignalStrength meter=new SdrSignalStrength();meter.observe(100,1,1000);
        meter.observe(-1,-1,1001);assertEquals(0,meter.displayed());
        assertEquals(0,SdrSignalStrength.level(Double.NaN));assertEquals(0,SdrSignalStrength.level(Double.POSITIVE_INFINITY));
        meter.observe(Double.NaN,1,1002);assertEquals(0,meter.displayed());
    }
}
