package com.bearpoint.app;

import java.io.File;
import java.io.IOException;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.BufferedOutputStream;
import java.nio.charset.StandardCharsets;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
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
        File source = find(id);
        File archive = archivePath(source);
        if (archive.exists() && !archive.delete()) throw new IOException("공유 ZIP을 삭제하지 못했습니다.");
        File partial = new File(archive.getPath() + ".partial");
        if (partial.exists() && !partial.delete()) throw new IOException("미완성 공유 ZIP을 삭제하지 못했습니다.");
        File details = new File(source.getPath()+".jsonl");
        if(details.exists()&&!details.delete())throw new IOException("상세 로그를 삭제하지 못했습니다.");
        if (!source.delete()) throw new IOException("로그를 삭제하지 못했습니다.");
    }
    private File archivePath(File source) {
        return new File(directory, "ic-r30-diagnostic-" + source.getName().replaceFirst("\\.csv$", "") + ".zip");
    }
    File archive(String id) throws IOException {
        File source = find(id);
        if (!directory.isDirectory() && !directory.mkdirs()) throw new IOException("로그 폴더를 만들지 못했습니다.");
        File archive = archivePath(source), partial = new File(archive.getPath() + ".partial");
        try {
            try (ZipOutputStream zip = new ZipOutputStream(new BufferedOutputStream(new FileOutputStream(partial)))) {
                zip.putNextEntry(new ZipEntry("smeter.csv"));
                try (FileInputStream input = new FileInputStream(source)) {
                    byte[] buffer = new byte[8192]; int count;
                    while ((count = input.read(buffer)) != -1) zip.write(buffer, 0, count);
                }
                zip.closeEntry();
                File details = new File(source.getPath()+".jsonl");
                if(details.isFile()){
                    zip.putNextEntry(new ZipEntry("events.jsonl"));
                    try(FileInputStream input=new FileInputStream(details)){
                        byte[] buffer=new byte[8192];int count;
                        while((count=input.read(buffer))!=-1)zip.write(buffer,0,count);
                    }
                    zip.closeEntry();
                }
                String metadata = "{\"schema_version\":2,\"transport\":\"bluetooth\",\"receiver\":\"Icom IC-R30\","
                    + "\"protocol\":\"CI-V over Bluetooth SPP\",\"source_record\":\"" + source.getName() + "\","
                    + "\"source_modified_unix_ms\":" + source.lastModified() + ",\"csv_file\":\"smeter.csv\","
                    + "\"smeter_unit\":\"raw CI-V value 0..255; not dBm or dBFS\","
                    + "\"recording_details_file\":"+(details.isFile()?"\"events.jsonl\"":"null")+","
                    + "\"contains_audio\":false,\"contains_iq\":false,\"automatic_cw_detection\":false}";
                entry(zip, "metadata.json", metadata + "\n");
                entry(zip, "README.txt", "IC-R30 Bluetooth 수신 진단\n\n"
                    + "smeter.csv: 저장된 원본 CSV입니다. 공유할 때 측정값이나 열 구성을 변경하지 않습니다.\n"
                    + "sample 행: unix_ms는 기기 시각(Unix 밀리초), elapsed_ms는 기록 시작 후 경과 시간, frequency_hz는 Hz입니다.\n"
                    + "smeter는 CI-V 원시값 0~255입니다. USB RTL-SDR의 dBFS·SNR·게이지 칸수와 직접 같은 값으로 비교할 수 없습니다.\n"
                    + "interval_ms는 측정 간격, query_ms는 조회 소요 시간, metadata_age_ms는 주파수·모드 정보의 경과 시간입니다.\n"
                    + "heard는 사용자가 청취 표시를 누른 시점이며 자동 비프 검출 결과가 아닙니다. stop 행에는 기록 종료 사유가 있습니다.\n"
                    + "events.jsonl이 있으면 start의 실제 기록 시각·앱/수신기 정보·시작 설정, sample의 공식 S 대응값, poll_error의 오류, stop의 요약을 확인하세요. 과거 기록에는 없습니다.\n"
                    + "s_label_exact는 공식 대응값만 표시합니다. 사이 값은 unmapped, S9 초과는 above S9이며 dBm으로 환산한 값이 아닙니다. 시작 설정은 기록 중 계속 조회한 값이 아닙니다.\n"
                    + "이 로그에는 오디오나 원본 I/Q가 없습니다. USB ZIP과 비교할 때 시간·주파수·모드·반복 변화와 측정 간격을 함께 확인하세요.\n"
                    + "과거 기록은 일부 열이 다를 수 있으므로 CSV 첫 줄의 실제 헤더를 기준으로 읽으세요.\n");
            }
            if (archive.exists() && !archive.delete()) throw new IOException("이전 공유 ZIP을 교체하지 못했습니다.");
            if (!partial.renameTo(archive)) throw new IOException("공유 ZIP 저장을 마무리하지 못했습니다.");
            return archive;
        } finally { if (partial.exists()) partial.delete(); }
    }
    private static void entry(ZipOutputStream zip, String name, String value) throws IOException {
        zip.putNextEntry(new ZipEntry(name));zip.write(value.getBytes(StandardCharsets.UTF_8));zip.closeEntry();
    }
}
