package com.bearpoint.app;

import static org.junit.Assert.*;
import java.io.File;
import java.io.IOException;
import java.io.FileOutputStream;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.zip.ZipFile;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;

public class IcR30LogStoreTest {
    @Rule public TemporaryFolder folder = new TemporaryFolder();
    @Test public void preservesMultipleRecordsAndLegacyAcrossRecreation() throws Exception {
        File legacy = folder.newFile("ic-r30-test.csv");
        IcR30LogStore store = new IcR30LogStore(folder.getRoot());
        File first = store.create(), second = store.create();
        assertNotEquals(first, second);
        assertEquals(3, store.list().size());
        IcR30LogStore restored = new IcR30LogStore(folder.getRoot());
        assertEquals(first, restored.find(first.getName()));
        assertEquals(legacy, restored.find(legacy.getName()));
        restored.delete(second.getName());
        assertEquals(2, restored.list().size());
        assertTrue(first.isFile());
        assertTrue(legacy.isFile());
    }
    @Test public void rejectsInvalidAndMissingIdsWithoutTouchingOtherFiles() throws Exception {
        File unrelated = folder.newFile("other.csv");
        IcR30LogStore store = new IcR30LogStore(folder.getRoot());
        for (String id : new String[]{"", "../other.csv", "..\\other.csv", unrelated.getAbsolutePath(), "other.csv",
                "0-00000000-0000-0000-0000-000000000000.csv"}) {
            try { store.delete(id); fail("Invalid selection accepted: " + id); }
            catch (IOException expected) { assertTrue(unrelated.isFile()); }
        }
    }
    @Test public void newestRecordsComeFirstAndDeletionPersists() throws Exception {
        IcR30LogStore store = new IcR30LogStore(folder.getRoot());
        File first = store.create(), second = store.create();
        assertTrue(first.setLastModified(1000));
        assertTrue(second.setLastModified(2000));
        assertEquals(second, store.list().get(0));
        store.delete(second.getName());
        assertEquals(first, new IcR30LogStore(folder.getRoot()).list().get(0));
    }
    private static byte[] read(ZipFile zip, String name) throws IOException {
        try (InputStream input = zip.getInputStream(zip.getEntry(name)); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[1024];int count;
            while ((count = input.read(buffer)) != -1) output.write(buffer,0,count);
            return output.toByteArray();
        }
    }
    private static void write(File file, byte[] bytes) throws IOException {
        try (FileOutputStream output = new FileOutputStream(file)) { output.write(bytes); }
    }
    @Test public void zipPreservesCsvExactlyAndIdentifiesBluetoothUnits() throws Exception {
        IcR30LogStore store = new IcR30LogStore(folder.getRoot());File csv = store.create();
        byte[] bytes = "event,unix_ms,elapsed_ms,frequency_hz,mode,smeter,interval_ms,query_ms,metadata_age_ms,note\nsample,1794445200000,143,148241000,CW,68,143,28,300,\nheard,1794445200100,243,,,,,,,manual\nstop,,,,,,,,,time_limit\n".getBytes(StandardCharsets.UTF_8);
        write(csv,bytes);assertTrue(csv.setLastModified(1000));
        File archive = store.archive(csv.getName());assertTrue(archive.getName().endsWith(".zip"));
        try (ZipFile zip = new ZipFile(archive)) {
            assertEquals(3,zip.size());assertArrayEquals(bytes,read(zip,"smeter.csv"));
            String metadata = new String(read(zip,"metadata.json"),StandardCharsets.UTF_8);
            assertTrue(metadata.contains("\"transport\":\"bluetooth\""));assertTrue(metadata.contains("Icom IC-R30"));
            assertTrue(metadata.contains("not dBm or dBFS"));assertTrue(metadata.contains(csv.getName()));
            assertTrue(new String(read(zip,"README.txt"),StandardCharsets.UTF_8).contains("자동 비프 검출 결과가 아닙니다"));
        }
        assertEquals(1000,csv.lastModified());assertEquals(1,store.list().size());
        assertEquals(archive,new IcR30LogStore(folder.getRoot()).archive(csv.getName()));
        assertEquals(1,store.list().size());assertFalse(new File(archive.getPath()+".partial").exists());
    }
    @Test public void legacyCsvCanBeZippedAndDeletingOneRecordRemovesOnlyItsArchive() throws Exception {
        File legacy = folder.newFile("ic-r30-test.csv");write(legacy,"legacy header\n".getBytes(StandardCharsets.UTF_8));
        IcR30LogStore store = new IcR30LogStore(folder.getRoot());File archive = store.archive(legacy.getName());
        File other = store.create();File otherZip = store.archive(other.getName());
        try (ZipFile zip = new ZipFile(archive)) { assertArrayEquals("legacy header\n".getBytes(StandardCharsets.UTF_8),read(zip,"smeter.csv")); }
        store.delete(legacy.getName());assertFalse(legacy.exists());assertFalse(archive.exists());
        assertTrue(other.isFile());assertTrue(otherZip.isFile());assertEquals(1,store.list().size());
    }
    @Test public void packagingFailureRetainsOriginalAndCleansIncompleteZip() throws Exception {
        IcR30LogStore store = new IcR30LogStore(folder.getRoot());File csv = store.create();
        File archive = store.archive(csv.getName());assertTrue(archive.delete());assertTrue(archive.mkdir());
        assertTrue(new File(archive,"blocked").createNewFile());
        try { store.archive(csv.getName());fail("Blocked ZIP replacement accepted"); }
        catch (IOException expected) { assertTrue(csv.isFile());assertFalse(new File(archive.getPath()+".partial").exists()); }
    }
}
