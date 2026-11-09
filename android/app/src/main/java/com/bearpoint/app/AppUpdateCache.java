package com.bearpoint.app;

import java.io.*;
import java.nio.charset.StandardCharsets;

/** Metadata is published only after the corresponding APK has been completely verified. */
final class AppUpdateCache {
    private final File metadata, temporary;
    AppUpdateCache(File directory) {
        metadata = new File(directory, "pending.json");
        temporary = new File(directory, "pending.json.tmp");
    }
    void save(String value) throws IOException {
        byte[] bytes = value.getBytes(StandardCharsets.UTF_8);
        if (bytes.length == 0 || bytes.length > 65536) throw new IOException("업데이트 저장 정보가 올바르지 않습니다.");
        try {
            try (FileOutputStream output = new FileOutputStream(temporary)) {
                output.write(bytes); output.getFD().sync();
            }
            if (metadata.exists() && !metadata.delete()) throw new IOException("이전 업데이트 정보를 정리하지 못했습니다.");
            if (!temporary.renameTo(metadata)) throw new IOException("업데이트 정보를 저장하지 못했습니다.");
        } finally { if (temporary.exists()) temporary.delete(); }
    }
    String read() throws IOException {
        if (!metadata.isFile()) return null;
        if (metadata.length() == 0 || metadata.length() > 65536) return null;
        try (InputStream input = new FileInputStream(metadata); ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            byte[] block = new byte[4096]; int count;
            while ((count = input.read(block)) != -1) {
                if (output.size() + count > 65536) return null;
                output.write(block, 0, count);
            }
            return new String(output.toByteArray(), StandardCharsets.UTF_8);
        }
    }
    void clear() throws IOException {
        if (metadata.exists() && !metadata.delete()) throw new IOException("이전 업데이트 정보를 정리하지 못했습니다.");
        if (temporary.exists() && !temporary.delete()) throw new IOException("미완성 업데이트 정보를 정리하지 못했습니다.");
    }
}
