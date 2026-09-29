package com.bearpoint.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class SdrViewportTest {
    @Test public void edgeToEdgeWebviewReservesStatusAndNavigationBarsInCssPixels() {
        assertArrayEquals(new double[]{0,24,0,48},SdrViewport.overlap(
            new int[]{0,0,1080,2340},new int[]{0,0,1080,2340},new int[]{0,72,0,144},3),1e-8);
    }
    @Test public void alreadyInsetWebviewDoesNotReserveTheSameBarsTwice() {
        assertArrayEquals(new double[4],SdrViewport.overlap(
            new int[]{0,0,1080,2340},new int[]{0,72,1080,2196},new int[]{0,72,0,144},3),1e-8);
    }
    @Test public void landscapeCutoutAndPartiallyInsetContentReserveOnlyOverlap() {
        assertArrayEquals(new double[]{12,0,0,24},SdrViewport.overlap(
            new int[]{100,40,2440,1120},new int[]{124,64,2440,1120},new int[]{60,24,0,72},3),1e-8);
        assertArrayEquals(new double[4],SdrViewport.overlap(new int[]{0,0,1080,2340},new int[]{0,0,0,0},new int[]{0,72,0,144},3),1e-8);
    }
}
