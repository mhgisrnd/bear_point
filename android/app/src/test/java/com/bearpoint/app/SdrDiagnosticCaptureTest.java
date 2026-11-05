package com.bearpoint.app;

import org.junit.Test;
import org.junit.Rule;
import org.junit.rules.TemporaryFolder;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.zip.ZipFile;
import static org.junit.Assert.*;

public class SdrDiagnosticCaptureTest {
    @Rule public TemporaryFolder temporary = new TemporaryFolder();
    private double[] frame(int received, int... samples) {
        double[] values=new double[7+samples.length];values[0]=received;values[4]=1024000;
        for(int i=0;i<samples.length;i++)values[i+7]=(samples[i]-127.5)/127.5;
        return values;
    }
    private File ready(SdrDiagnosticCapture capture) throws Exception {
        long deadline=System.currentTimeMillis()+5000;
        while("packaging".equals(capture.state()) && System.currentTimeMillis()<deadline)Thread.sleep(10);
        assertEquals(capture.error(),"ready",capture.state());return capture.readyFile();
    }
    private byte[] entry(ZipFile zip,String name) throws Exception {
        try(InputStream input=zip.getInputStream(zip.getEntry(name));ByteArrayOutputStream output=new ByteArrayOutputStream()) {
            byte[] buffer=new byte[1024];int n;while((n=input.read(buffer))!=-1)output.write(buffer,0,n);return output.toByteArray();
        }
    }
    @Test public void archivePreservesIqAudioSettingsAndExplicitGaps() throws Exception {
        SdrDiagnosticCapture capture=new SdrDiagnosticCapture(()->{},10,100);
        try {
            capture.request(temporary.getRoot());
            capture.noteTelemetry(80,"{\"usbReadMs\":30}");
            capture.observe(frame(6,0,127,128,255),new short[]{-32768,32767},100,"{\"sampleRate\":1024000}","{\"usbReadMs\":32,\"usbStatus\":0}");
            assertEquals("recording",capture.state());
            capture.observe(frame(2,7,8),null,110,"{}");
            try(ZipFile zip=new ZipFile(ready(capture))) {
                assertArrayEquals(new byte[]{0,127,-128,-1,7,8},entry(zip,"samples.cu8"));
                String metadata=new String(entry(zip,"metadata.json"),StandardCharsets.UTF_8);
                assertTrue(metadata.contains("\"omitted_iq_bytes\":2"));
                assertTrue(metadata.contains("\"sampleRate\":1024000"));
                assertTrue(metadata.contains("\"duration_ms\":10"));
                assertTrue(metadata.contains("\"schema_version\":2"));
                assertTrue(metadata.contains("\"audio_samples\":2"));
                assertTrue(metadata.contains("\"sample_duration_ms\":0.0029296875"));
                assertTrue(metadata.contains("\"delivered_duration_ms\":0.00390625"));
                String telemetry=new String(entry(zip,"telemetry.jsonl"),StandardCharsets.UTF_8);
                assertTrue(telemetry.contains("\"phase\":\"baseline\",\"elapsed_ms\":-20"));
                assertTrue(telemetry.contains("\"usbReadMs\":32,\"usbStatus\":0"));
                assertEquals(3,telemetry.split("\n").length);
                String index=new String(entry(zip,"blocks.csv"),StandardCharsets.UTF_8);
                assertTrue(index.contains("0,0,6,4,0\n4,6,2,2,10"));
                byte[] wav=entry(zip,"received-audio.wav");assertEquals(48,wav.length);
                assertEquals("RIFF",new String(wav,0,4,StandardCharsets.US_ASCII));
                assertArrayEquals(new byte[]{(byte)0x80,(byte)0xbb,0,0},java.util.Arrays.copyOfRange(wav,24,28));
                assertArrayEquals(new byte[]{0,-128,-1,127},java.util.Arrays.copyOfRange(wav,44,48));
            }
        } finally { capture.shutdown(111); }
    }
    @Test public void byteLimitAndStoppingProduceUsablePartialCapture() throws Exception {
        SdrDiagnosticCapture capture=new SdrDiagnosticCapture(()->{},10000,4);
        try {
            capture.request(temporary.getRoot());capture.observe(frame(8,1,2,3,4,5,6,7,8),null,0,"{}");
            try(ZipFile zip=new ZipFile(ready(capture))) {assertEquals(4,entry(zip,"samples.cu8").length);}
            assertEquals(4,capture.omitted());
            capture.request(temporary.getRoot());capture.observe(frame(2,9,10),null,0,"{}");
            capture.finish(5,"reception-ended");
            try(ZipFile zip=new ZipFile(ready(capture))) {
                assertTrue(new String(entry(zip,"metadata.json"),StandardCharsets.UTF_8).contains("reception-ended"));
                assertEquals(2,entry(zip,"samples.cu8").length);
            }
        } finally { capture.shutdown(6); }
    }
    @Test public void emptyCaptureAndDuplicateRequestAreGuarded() throws Exception {
        SdrDiagnosticCapture capture=new SdrDiagnosticCapture(()->{},10,100);
        try {
            capture.request(temporary.getRoot());
            try { capture.request(temporary.getRoot());fail("Duplicate request accepted"); } catch(IllegalStateException expected) {}
            capture.finish(0,"reception-ended");assertEquals("error",capture.state());
            try { capture.readyFile();fail("Empty archive shared"); } catch(IllegalStateException expected) {}
        } finally { capture.shutdown(1); }
    }
    @Test public void archivesSurviveRestartAndInvalidOrPartialFilesCannotBeShared() throws Exception {
        File root=temporary.newFolder("files"),cache=temporary.newFolder("cache");
        SdrDiagnosticCapture capture=new SdrDiagnosticCapture(()->{},10,100);
        String id;
        try {
            capture.storage(root,cache);capture.request(root);
            capture.observe(frame(2,1,2),null,0,"{}");capture.finish(10,"completed");
            File archive=ready(capture);assertEquals(1,capture.saved().length);
            id=capture.saved()[0].id;assertEquals(archive,capture.file(id));
            capture.request(root);assertEquals(archive,capture.file(id)); // New capture cannot hide the previous file.
        } finally { capture.shutdown(11); }
        File broken=new File(root,"sdr-diagnostic-broken");assertTrue(broken.mkdir());
        try(FileOutputStream stream=new FileOutputStream(new File(broken,"sdr-diagnostic.zip"))){stream.write(1);}
        SdrDiagnosticCapture restored=new SdrDiagnosticCapture(()->{},10,100);
        try {
            restored.storage(root,cache);assertEquals(1,restored.saved().length);assertEquals(id,restored.saved()[0].id);
            assertTrue(restored.file(id).isFile());
            try {restored.file("../files");fail("Arbitrary path accepted");}catch(IllegalStateException expected){}
        }finally{restored.shutdown(0);}
    }
}
