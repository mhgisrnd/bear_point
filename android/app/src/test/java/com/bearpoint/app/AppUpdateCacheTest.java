package com.bearpoint.app;

import java.io.File;
import java.io.FileOutputStream;
import org.junit.Rule;
import org.junit.Test;
import org.junit.rules.TemporaryFolder;
import static org.junit.Assert.*;

public class AppUpdateCacheTest {
    @Rule public TemporaryFolder temp = new TemporaryFolder();
    @Test public void verifiedMetadataSurvivesARecreatedPlugin() throws Exception {
        File directory = temp.newFolder();
        String value = "{\"versionCode\":8,\"releaseNotes\":\"권한 설정 복귀\"}";
        new AppUpdateCache(directory).save(value);
        assertEquals(value, new AppUpdateCache(directory).read());
        assertFalse(new File(directory,"pending.json.tmp").exists());
    }
    @Test public void incompleteMetadataIsIgnoredAndCleanupDoesNotDeleteTheApk() throws Exception {
        File directory = temp.newFolder();
        File apk = new File(directory,"BearMap.apk"); assertTrue(apk.createNewFile());
        assertTrue(new File(directory,"pending.json.tmp").createNewFile());
        AppUpdateCache cache = new AppUpdateCache(directory);
        assertNull(cache.read());
        cache.save("metadata");cache.clear();
        assertNull(cache.read());assertTrue(apk.isFile());
    }
    @Test public void emptyAndOversizeMetadataCannotBecomePendingUpdates() throws Exception {
        File directory = temp.newFolder();AppUpdateCache cache = new AppUpdateCache(directory);
        try { cache.save("");fail(); } catch(java.io.IOException expected) { }
        try (FileOutputStream output = new FileOutputStream(new File(directory,"pending.json"))) {
            output.write(new byte[65537]);
        }
        assertNull(cache.read());
        cache.clear();assertNull(cache.read());
    }
}
