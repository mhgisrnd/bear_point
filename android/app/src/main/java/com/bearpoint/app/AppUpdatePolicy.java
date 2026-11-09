package com.bearpoint.app;

import java.net.URI;
import java.security.MessageDigest;

/** Rules shared by metadata checks, download verification and the installer handoff. */
final class AppUpdatePolicy {
    static final long MAX_APK_BYTES = 1024L * 1024 * 1024;
    static URI endpoint(String value) {
        URI uri = URI.create(value);
        if (!"https".equalsIgnoreCase(uri.getScheme()) || uri.getHost() == null
                || uri.getUserInfo() != null || uri.getFragment() != null || uri.getQuery() != null
                || !uri.getPath().endsWith("/api/app-updates/latest"))
            throw new IllegalArgumentException("업데이트 서버 주소를 확인해주세요.");
        return uri;
    }
    static URI download(URI endpoint, String value) {
        URI uri = endpoint.resolve(value);
        String path = endpoint.getPath().replaceFirst("/latest$", "/download");
        if (!"https".equalsIgnoreCase(uri.getScheme()) || !endpoint.getHost().equalsIgnoreCase(uri.getHost())
                || endpoint.getPort() != uri.getPort() || uri.getUserInfo() != null
                || uri.getFragment() != null || !path.equals(uri.getPath()))
            throw new IllegalArgumentException("APK 다운로드 주소를 확인해주세요.");
        return uri;
    }
    static void release(long installed, long offered, long size, int minSdk, int deviceSdk) {
        if (offered <= installed) throw new IllegalArgumentException("현재 앱보다 새로운 버전이 아닙니다.");
        if (size <= 0 || size > MAX_APK_BYTES) throw new IllegalArgumentException("APK 파일 크기를 확인해주세요.");
        if (minSdk > deviceSdk) throw new IllegalArgumentException("이 기기의 Android 버전에서는 설치할 수 없습니다.");
    }
    static String hex(byte[] bytes) {
        StringBuilder result = new StringBuilder();
        for (byte b : bytes) result.append(String.format(java.util.Locale.ROOT, "%02x", b & 255));
        return result.toString();
    }
    static void hash(String expected, String actual) {
        if (expected == null || !expected.matches("(?i)[0-9a-f]{64}")
                || !MessageDigest.isEqual(expected.toLowerCase(java.util.Locale.ROOT).getBytes(java.nio.charset.StandardCharsets.US_ASCII),
                    actual.toLowerCase(java.util.Locale.ROOT).getBytes(java.nio.charset.StandardCharsets.US_ASCII)))
            throw new IllegalArgumentException("APK 검증에 실패했습니다. 다시 다운로드해주세요.");
    }
}
