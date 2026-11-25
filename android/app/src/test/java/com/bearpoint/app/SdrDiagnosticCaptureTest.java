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
    @Test public void comparisonZipPreservesStageAndSurvivesReload() throws Exception {
        File root=temporary.newFolder("comparison");SdrDiagnosticCapture capture=new SdrDiagnosticCapture(()->{},10,100);
        try {
            capture.storage(root);capture.request(root);capture.observe(frame(2,7,8),null,0,"{}");capture.finish(10,"completed");
            File stage=ready(capture);
            capture.bundle(root,java.util.Collections.singletonList(stage),java.util.Collections.singletonList("기준"),"완료");
            File archive=ready(capture);
            try(ZipFile zip=new ZipFile(archive)){
                assertNotNull(zip.getEntry("comparison.json"));assertNotNull(zip.getEntry("stages/01.zip"));
                assertArrayEquals(java.nio.file.Files.readAllBytes(stage.toPath()),entry(zip,"stages/01.zip"));
            }
            capture.storage(root);assertEquals(2,capture.saved().length);assertTrue(capture.saved()[0].comparison);
            assertTrue(stage.isFile());
        }finally{capture.shutdown(20);}
    }
    @Test public void deletingSelectedArchivePreservesOtherRecordsAndUnrelatedFiles() throws Exception {
        File root=temporary.newFolder("diagnostics");
        File unrelated=new File(root,"observations.db");assertTrue(unrelated.createNewFile());
        SdrDiagnosticCapture capture=new SdrDiagnosticCapture(()->{},10,100);
        try {
            capture.storage(root);capture.request(root);
            capture.observe(frame(2,1,2),null,0,"{}");capture.finish(10,"completed");
            File first=ready(capture);String firstId=first.getParentFile().getName();
            File sibling=new File(first.getParentFile(),"keep.txt");assertTrue(sibling.createNewFile());
            capture.request(root);capture.observe(frame(2,3,4),null,20,"{}");capture.finish(30,"completed");
            File second=ready(capture);String secondId=second.getParentFile().getName();
            capture.delete(firstId);
            assertFalse(first.exists());assertTrue(second.isFile());assertTrue(sibling.isFile());assertTrue(unrelated.isFile());
            assertEquals(1,capture.saved().length);assertEquals(second,capture.readyFile());
            capture.delete(secondId);assertEquals(0,capture.saved().length);assertEquals("idle",capture.state());
            assertTrue(unrelated.isFile());
            try {capture.readyFile();fail("Deleted archive remained shareable");}catch(IllegalStateException expected){}
            SdrDiagnosticCapture restored=new SdrDiagnosticCapture(()->{},10,100);
            try {restored.storage(root);assertEquals(0,restored.saved().length);}finally{restored.shutdown(0);}
        } finally {capture.shutdown(40);}
    }
    @Test public void deletionRejectsUnknownPathsAndActiveCapture() throws Exception {
        File root=temporary.newFolder("diagnostics");
        SdrDiagnosticCapture capture=new SdrDiagnosticCapture(()->{},10,100);
        try {
            capture.storage(root);capture.request(root);capture.observe(frame(2,1,2),null,0,"{}");capture.finish(10,"completed");
            File archive=ready(capture);String id=archive.getParentFile().getName();
            try {capture.delete("../observations.db");fail("Arbitrary path accepted");}catch(IllegalStateException expected){}
            assertTrue(archive.isFile());
            capture.request(root);
            try {capture.delete(id);fail("Deletion accepted during capture");}catch(IllegalStateException expected){}
            assertTrue(archive.isFile());
        }finally{capture.shutdown(11);}
    }
    @Test public void archivePreservesIqAudioSettingsAndExplicitGaps() throws Exception {
        SdrDiagnosticCapture capture=new SdrDiagnosticCapture(()->{},10,100);
        try {
            capture.request(temporary.getRoot());
            capture.noteTelemetry(80,"{\"usbReadMs\":30}");
            capture.observe(frame(6,0,127,128,255),new short[]{-32768,32767},100,"{\"sampleRate\":1024000}","{\"usbReadMs\":32,\"usbStatus\":0}");
            assertEquals("recording",capture.state());
            capture.observe(frame(2,7,8),null,110,"{}");
            File archive = ready(capture);
            try(ZipFile zip=new ZipFile(archive)) {
                assertArrayEquals(new byte[]{0,127,-128,-1,7,8},entry(zip,"samples.cu8"));
                String metadata=new String(entry(zip,"metadata.json"),StandardCharsets.UTF_8);
                assertTrue(metadata.contains("\"omitted_iq_bytes\":2"));
                assertTrue(metadata.contains("\"sampleRate\":1024000"));
                assertTrue(metadata.contains("\"duration_ms\":10"));
                assertTrue(metadata.contains("\"schema_version\":3"));
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
                File preview = SdrDiagnosticExport.extractAudioPreview(temporary.getRoot(), archive);
                assertArrayEquals(wav, java.nio.file.Files.readAllBytes(preview.toPath()));
                File nextPreview = SdrDiagnosticExport.extractAudioPreview(temporary.getRoot(), archive);
                assertFalse(preview.exists());
                assertArrayEquals(wav, java.nio.file.Files.readAllBytes(nextPreview.toPath()));
            }
        } finally { capture.shutdown(111); }
    }
    @Test public void airspyFloatCapturePreservesIqAndReportsCorrectDuration() throws Exception {
        File root=temporary.newFolder("airspy");
        SdrDiagnosticCapture capture=new SdrDiagnosticCapture(()->{},10000,100);
        try {
            capture.storage(root); capture.request(root);
            double[] values=new double[]{16,0,0,0,1000,0,0};
            byte[] original=new byte[]{0,0,(byte)128,63,0,0,0,0,0,0,0,0,0,0,(byte)128,(byte)191};
            capture.observe(values,null,100,"{\"iqFormat\":\"cf32le\"}","{}",original,true);
            capture.finish(110,"completed");
            File archive=ready(capture);
            try(ZipFile zip=new ZipFile(archive)) {
                assertArrayEquals(original,entry(zip,"samples.cf32le"));
                assertNull(zip.getEntry("samples.cu8"));
                String metadata=new String(entry(zip,"metadata.json"),StandardCharsets.UTF_8);
                assertTrue(metadata.contains("\"sample_duration_ms\":2.0"));
                assertTrue(metadata.contains("driver output after libairspyhf DSP"));
            }
            capture.storage(root); assertEquals(1,capture.saved().length);
        } finally {capture.shutdown(111);}
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
    @Test public void audioTraceUsesRecordedPcmPeaksAndElapsedTime() throws Exception {
        SdrDiagnosticCapture capture = new SdrDiagnosticCapture(() -> {}, 10000, 100);
        try {
            capture.request(temporary.getRoot());
            short[] first = new short[2400];
            first[0] = -100;
            short[] second = new short[4801];
            second[500] = 200;
            second[4800] = Short.MIN_VALUE;
            capture.observe(frame(2, 1, 2), first, 1000, "{}");
            capture.observe(frame(2, 1, 2), null, 1100, "{}");
            capture.observe(frame(2, 1, 2), second, 1250, "{}");
            SdrDiagnosticCapture.AudioTrace trace = capture.audioTrace();
            assertEquals(250, trace.elapsedMs);
            assertEquals(10000, trace.durationMs);
            assertArrayEquals(new int[]{200, 32768}, trace.peaks);
            IcR30TestAudio bluetooth = new IcR30TestAudio();
            bluetooth.append(first, 0, first.length);
            bluetooth.append(second, 0, 30);
            bluetooth.append(second, 30, second.length - 30);
            assertArrayEquals(trace.peaks, bluetooth.peaks());
        } finally { capture.shutdown(1300); }
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
    @Test public void bundledExportPreservesDistinctArchivesWithIdenticalNames() throws Exception {
        File first = new File(temporary.newFolder("first"), "sdr-diagnostic.zip");
        File second = new File(temporary.newFolder("second"), "sdr-diagnostic.zip");
        java.nio.file.Files.write(first.toPath(), new byte[]{1, 2});
        java.nio.file.Files.write(second.toPath(), new byte[]{3, 4});
        File export = temporary.newFile("selected.zip");
        try (OutputStream output = new FileOutputStream(export)) {
            SdrDiagnosticExport.writeArchives(java.util.Arrays.asList(first, second), output);
        }
        try (ZipFile zip = new ZipFile(export)) {
            assertEquals(2, zip.size());
            assertArrayEquals(new byte[]{1, 2}, entry(zip, "01-sdr-diagnostic.zip"));
            assertArrayEquals(new byte[]{3, 4}, entry(zip, "02-sdr-diagnostic.zip"));
        }
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
