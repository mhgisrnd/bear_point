package com.bearpoint.app;

import org.junit.Test;
import static org.junit.Assert.*;

public class SdrFixedCwStateTest {
    @Test public void noCandidateListensAtSelectedThenCapturesFirstRepeatedCandidate() {
        SdrFixedCwState state=new SdrFixedCwState();
        state.choose(148241000,false,0,false);
        assertEquals(148241000,state.frequencyHz());
        assertEquals("selected-frequency",state.source());
        state.choose(148241000,true,148240600,false);
        assertEquals(148240600,state.frequencyHz());
        assertEquals("repeated-candidate",state.source());
        state.choose(148241000,true,148240700,false);
        assertEquals(148240600,state.frequencyHz());
        state.choose(148241000,false,0,false);
        assertEquals(148240600,state.frequencyHz());
    }
    @Test public void rememberedCandidateRemainsFixedUntilReset() {
        SdrFixedCwState state=new SdrFixedCwState();
        state.choose(148241000,true,148240600,true);
        assertEquals("remembered",state.source());
        state.choose(148241000,true,148240700,false);
        assertEquals(148240600,state.frequencyHz());
        state.reset();
        state.choose(148242000,false,0,false);
        assertEquals(148242000,state.frequencyHz());
        assertEquals("selected-frequency",state.source());
    }
}
