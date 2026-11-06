package com.bearpoint.app;
import org.junit.Test;
import org.junit.Rule;
import org.junit.rules.TemporaryFolder;
import java.io.*;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.zip.ZipFile;
import static org.junit.Assert.*;

public class SdrCaptureWriterTest {
    @Rule public TemporaryFolder temporary=new TemporaryFolder();
    private double[] values(){return new double[]{4,0,0,3,1024000,197,148229000};}
    private void ready(SdrDiagnosticCapture capture)throws Exception{
        long until=System.currentTimeMillis()+5000;
        while(!"ready".equals(capture.state())&&!"error".equals(capture.state())&&System.currentTimeMillis()<until)Thread.sleep(5);
        assertEquals(capture.error(),"ready",capture.state());
    }
    @Test public void slowDiskDoesNotBlockReceptionAndOverflowIsExplicit()throws Exception{
        SdrDiagnosticCapture capture=new SdrDiagnosticCapture(()->{},10000,1000);
        SdrCaptureWriter writer=new SdrCaptureWriter(capture,2);writer.request(temporary.getRoot());
        CountDownLatch locked=new CountDownLatch(1),release=new CountDownLatch(1);
        Thread disk=new Thread(()->{synchronized(capture){locked.countDown();try{release.await();}catch(InterruptedException e){Thread.currentThread().interrupt();}}});
        disk.start();assertTrue(locked.await(1,TimeUnit.SECONDS));
        try{
            byte[] raw={0,127,-128,-1};
            long began=System.nanoTime();writer.offer(values(),new short[]{1,2},raw,0,"{}","{}");
            Thread.sleep(25); // Writer is blocked on the intentionally locked capture stream.
            writer.offer(values(),null,raw,32,"{}","{}");writer.offer(values(),null,raw,64,"{}","{}");
            writer.offer(values(),null,raw,96,"{}","{}");
            assertTrue("capture submission waited for disk",(System.nanoTime()-began)/1000000<500);
            assertTrue(capture.writerDroppedBlocks()>0);assertTrue(writer.pending()<=2);
        }finally{release.countDown();disk.join(1000);}
        ready(capture);writer.shutdown(100);assertTrue(writer.awaitStopped(5000));
        try(ZipFile zip=new ZipFile(capture.readyFile())){
            String metadata=new String(zip.getInputStream(zip.getEntry("metadata.json")).readAllBytes(),java.nio.charset.StandardCharsets.UTF_8);
            assertTrue(metadata.contains("writer-overflow"));assertTrue(metadata.contains("\"writer_dropped_blocks\":1"));
        }
    }
    @Test public void finishDrainsAcceptedRawBytesAndPreservesPcmOrder()throws Exception{
        SdrDiagnosticCapture capture=new SdrDiagnosticCapture(()->{},10000,1000);
        SdrCaptureWriter writer=new SdrCaptureWriter(capture,8);
        try{
            writer.request(temporary.getRoot());
            writer.offer(values(),new short[]{1,2},new byte[]{0,127,-128,-1},0,"{}","{}");
            writer.offer(values(),new short[]{3,4},new byte[]{5,6,7,8},32,"{}","{}");
            writer.finish(40,"reception-ended");ready(capture);
            try(ZipFile zip=new ZipFile(capture.readyFile())){
                assertArrayEquals(new byte[]{0,127,-128,-1,5,6,7,8},zip.getInputStream(zip.getEntry("samples.cu8")).readAllBytes());
                byte[] wav=zip.getInputStream(zip.getEntry("received-audio.wav")).readAllBytes();assertEquals(52,wav.length);
                assertEquals(1,wav[44]);assertEquals(4,wav[50]);
            }
        }finally{writer.shutdown(41);assertTrue(writer.awaitStopped(5000));}
    }
}
