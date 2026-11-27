package com.bearpoint.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class SdrWeakStateTest {
    @Test public void rememberedCandidateWidensAndReturnsToSearch() {
        SdrWeakState s=new SdrWeakState();s.seed(148240600,1520,1000);
        assertTrue(s.remembered());assertEquals(-400,s.offset(148241000));
        assertEquals(150,s.width(1000,150));assertEquals(150,s.width(5000,150));
        assertEquals(500,s.width(6000,150));assertEquals(500,s.width(9000,150));
        assertEquals(0,s.width(11000,150));
        s.update(true,148240620,1520,0,12000);
        assertFalse(s.remembered());assertEquals(150,s.width(12000,150));assertEquals(-380,s.offset(148241000));
    }
    @Test public void unconfirmedOrInvalidDataDoesNotCreateCandidate() {
        SdrWeakState s=new SdrWeakState();s.seed(148240600,0,1000);
        s.update(false,148240600,1520,0,1000);assertEquals(0,s.width(1000,150));
        s.seed(148240600,1520,1000);assertEquals(500,s.width(6000,500));
    }
}
