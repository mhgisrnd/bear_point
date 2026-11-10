package com.bearpoint.app;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;

final class IcR30LogStore {
    private final File directory, legacy;
    IcR30LogStore(File files) {
        directory = new File(files, "ic-r30-logs");
        legacy = new File(files, "ic-r30-test.csv");
    }
    File create() throws IOException {
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("로그 폴더를 만들지 못했습니다.");
        File file = new File(directory, System.currentTimeMillis() + "-" + UUID.randomUUID() + ".csv");
        if (!file.createNewFile()) throw new IOException("로그 파일을 만들지 못했습니다.");
        return file;
    }
    List<File> list() throws IOException {
        List<File> result = new ArrayList<>();
        if (directory.exists()) {
            File[] files = directory.listFiles();
            if (files == null) throw new IOException("저장된 로그 목록을 읽지 못했습니다.");
            for (File file : files) if (valid(file.getName()) && file.isFile()) result.add(file);
        }
        if (legacy.isFile()) result.add(legacy);
        result.sort(Comparator.comparingLong(File::lastModified).reversed().thenComparing(File::getName));
        return result;
    }
    private static boolean valid(String id) {
        return id.matches("[0-9]+-[0-9a-f-]{36}\\.csv");
    }
    File find(String id) throws IOException {
        if ("ic-r30-test.csv".equals(id) && legacy.isFile()) return legacy;
        if (!valid(id)) throw new IOException("올바른 로그를 선택하세요.");
        File file = new File(directory, id);
        if (!file.isFile()) throw new IOException("선택한 로그가 없습니다.");
        return file;
    }
    void delete(String id) throws IOException {
        if (!find(id).delete()) throw new IOException("로그를 삭제하지 못했습니다.");
    }
}
