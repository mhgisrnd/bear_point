package com.bearpoint.app;

import java.net.URI;
import org.junit.Test;
import static org.junit.Assert.*;

public class AppUpdatePolicyTest {
    private void rejects(Runnable action) {
        try { action.run(); fail("Expected invalid update to be rejected"); }
        catch (IllegalArgumentException expected) { }
    }
    @Test public void downloadsStayOnHttpsApiOriginAndPath() {
        URI endpoint = AppUpdatePolicy.endpoint("https://example.test/context/api/app-updates/latest");
        assertEquals("https://example.test/context/api/app-updates/download?sha256=a", AppUpdatePolicy.download(endpoint,"/context/api/app-updates/download?sha256=a").toString());
        rejects(() -> AppUpdatePolicy.endpoint("http://example.test/api/app-updates/latest"));
        rejects(() -> AppUpdatePolicy.endpoint("https://user:pass@example.test/api/app-updates/latest"));
        rejects(() -> AppUpdatePolicy.download(endpoint,"https://other.test/context/api/app-updates/download"));
        rejects(() -> AppUpdatePolicy.download(endpoint,"http://example.test/context/api/app-updates/download"));
        rejects(() -> AppUpdatePolicy.download(endpoint,"https://example.test:444/context/api/app-updates/download"));
        rejects(() -> AppUpdatePolicy.download(endpoint,"/private/file.apk"));
    }
    @Test public void onlyNewCompatibleBoundedReleasesAreAccepted() {
        AppUpdatePolicy.release(6,7,1024,23,34);
        rejects(() -> AppUpdatePolicy.release(6,6,1024,23,34));
        rejects(() -> AppUpdatePolicy.release(6,5,1024,23,34));
        rejects(() -> AppUpdatePolicy.release(6,7,0,23,34));
        rejects(() -> AppUpdatePolicy.release(6,7,AppUpdatePolicy.MAX_APK_BYTES+1,23,34));
        rejects(() -> AppUpdatePolicy.release(6,7,1024,35,34));
    }
    @Test public void hashesMustMatchExactlyAndSupportUppercaseMetadata() {
        String hash = "a".repeat(64);
        AppUpdatePolicy.hash(hash.toUpperCase(java.util.Locale.ROOT),hash);
        rejects(() -> AppUpdatePolicy.hash(hash,"b".repeat(64)));
        rejects(() -> AppUpdatePolicy.hash(null,hash));
        rejects(() -> AppUpdatePolicy.hash("invalid",hash));
    }
}
