package com.bearpoint.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class SdrCwSpectrumTest {
    private double[] tone(double hz,int count) {
        double[] iq=new double[count*2];
        for(int i=0;i<count;i++) {iq[i*2]=.001*Math.cos(2*Math.PI*hz*i/48000);iq[i*2+1]=.001*Math.sin(2*Math.PI*hz*i/48000);}
        return iq;
    }
    private int peak(double[] bins) {int k=0;for(int i=1;i<bins.length;i++)if(bins[i]>bins[k])k=i;return k;}
    @Test public void zoomMapsCarrierToTargetAndResolvesNearbyWeakTone() {
        double[] centered=new SdrCwSpectrum().observe(tone(0,2048),0);
        assertEquals(128,centered.length);assertEquals(64,peak(centered));
        double[] offset=new SdrCwSpectrum().observe(tone(609.375,2048),0);
        assertEquals(77,peak(offset));
        assertEquals(609.375,(peak(offset)-64)*(6000.0/128),.001);
        assertTrue(offset[77]>-70); // A weak tone stays visible with normalized RF values.
    }
    @Test public void arbitraryChunkBoundariesPreserveTheSpectrum() {
        double[] iq=tone(609.375,4096);
        double[] expected=new SdrCwSpectrum().observe(iq,0),actual=null;
        SdrCwSpectrum stream=new SdrCwSpectrum();
        for(int offset=0;offset<iq.length;offset+=127) {
            double[] bins=stream.observe(java.util.Arrays.copyOfRange(iq,offset,Math.min(offset+127,iq.length)),0);
            if(bins.length>0)actual=bins;
        }
        assertArrayEquals(expected,actual,1e-10);
        assertEquals(0,new SdrCwSpectrum().observe(new double[20],0).length);
    }
}
