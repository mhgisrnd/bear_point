package com.bearpoint.app;

final class StorageFailure {
    static String message(Throwable error) {
        for (Throwable cause = error; cause != null; cause = cause.getCause()) {
            String text = String.valueOf(cause.getMessage());
            if (cause instanceof android.database.sqlite.SQLiteFullException || text.contains("SQLITE_FULL")
                || text.contains("ENOSPC") || text.contains("database or disk is full")) {
                return "기기 저장 공간이 부족합니다. 설정의 저장 공간에서 정리하거나 기기의 여유 공간을 확보한 뒤 다시 시도해주세요.";
            }
        }
        return error.getMessage() == null ? error.toString() : error.getMessage();
    }
}
