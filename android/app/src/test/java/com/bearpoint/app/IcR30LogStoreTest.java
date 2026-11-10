package com.bearpoint.app;

import static org.junit.Assert.*;
import java.io.File;
import java.io.IOException;
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
}
