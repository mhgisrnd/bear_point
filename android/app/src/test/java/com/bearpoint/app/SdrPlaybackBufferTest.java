package com.bearpoint.app;
import org.junit.Test;
import static org.junit.Assert.*;

public class SdrPlaybackBufferTest {
    private SdrPlaybackBuffer.Packet packet(long seq){return new SdrPlaybackBuffer.Packet(new short[1536],seq,seq*32);}
    @Test public void overloadKeepsRecentAudioAndAccountsEveryDroppedSample()throws Exception{
        SdrPlaybackBuffer buffer=new SdrPlaybackBuffer();
        buffer.offer(packet(1));buffer.offer(packet(2));buffer.offer(packet(3));
        SdrPlaybackBuffer.Dropped dropped=buffer.offer(packet(4));
        assertEquals(1,dropped.blocks);assertEquals(1536,dropped.samples);assertEquals(4608,buffer.samples());
        assertEquals(2,buffer.poll(0).sequence);assertEquals(3,buffer.poll(0).sequence);assertEquals(4,buffer.poll(0).sequence);
        assertEquals(0,buffer.samples());assertNull(buffer.poll(0));
    }
    @Test public void sequenceAndClockStayAttachedAndGapClearsPendingAudio()throws Exception{
        SdrPlaybackBuffer buffer=new SdrPlaybackBuffer();buffer.offer(packet(25));
        SdrPlaybackBuffer.Packet packet=buffer.poll(0);assertEquals(25,packet.sequence);assertEquals(800,packet.receivedMs,0);
        buffer.offer(packet(26));buffer.offer(packet(27));SdrPlaybackBuffer.Dropped clear=buffer.clear();
        assertEquals(2,clear.blocks);assertEquals(3072,clear.samples);assertEquals(0,buffer.size());
        assertEquals(1,buffer.offer(new SdrPlaybackBuffer.Packet(new short[5000],28,900)).blocks);
    }
}
