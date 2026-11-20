package com.bearpoint.app;

import android.content.Context;
import android.opengl.GLES11Ext;
import android.opengl.GLES20;
import android.opengl.GLSurfaceView;
import android.view.Display;
import com.google.ar.core.Camera;
import com.google.ar.core.Coordinates2d;
import com.google.ar.core.Frame;
import com.google.ar.core.Session;
import com.google.ar.core.TrackingState;
import com.google.ar.core.exceptions.CameraNotAvailableException;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.FloatBuffer;
import javax.microedition.khronos.egl.EGLConfig;
import javax.microedition.khronos.opengles.GL10;

/** Draws the ARCore camera texture underneath the WebView and reports camera yaw. */
final class ArDirectionPreview extends GLSurfaceView implements GLSurfaceView.Renderer {
    interface Listener {
        void pose(Double yaw, String reason);
        void failed();
    }

    private final Session session;
    private final Listener listener;
    private final FloatBuffer positions = buffer().put(new float[]{-1, -1, 1, -1, -1, 1, 1, 1});
    private final FloatBuffer textureCoordinates = buffer();
    private int texture, program, positionAttribute, coordinateAttribute;
    private int width, height, displayRotation = -1;
    private long frameTimestamp, lastPose;
    private boolean failed, geometryChanged = true;

    ArDirectionPreview(Context context, Session session, Listener listener) {
        super(context);
        this.session = session;
        this.listener = listener;
        setEGLContextClientVersion(2);
        setRenderer(this);
    }

    private static FloatBuffer buffer() {
        return ByteBuffer.allocateDirect(8 * Float.BYTES).order(ByteOrder.nativeOrder()).asFloatBuffer();
    }

    @Override public void onSurfaceCreated(GL10 unused, EGLConfig config) {
        try {
            int[] names = new int[1];
            GLES20.glGenTextures(1, names, 0);
            texture = names[0];
            GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, texture);
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MIN_FILTER, GLES20.GL_LINEAR);
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_MAG_FILTER, GLES20.GL_LINEAR);
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_S, GLES20.GL_CLAMP_TO_EDGE);
            GLES20.glTexParameteri(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, GLES20.GL_TEXTURE_WRAP_T, GLES20.GL_CLAMP_TO_EDGE);
            session.setCameraTextureName(texture);
            program = createProgram();
            positionAttribute = GLES20.glGetAttribLocation(program, "aPosition");
            coordinateAttribute = GLES20.glGetAttribLocation(program, "aCoordinate");
            frameTimestamp = lastPose = 0;
            geometryChanged = true;
        } catch (RuntimeException error) { fail(); }
    }

    @Override public void onSurfaceChanged(GL10 unused, int width, int height) {
        this.width = width;
        this.height = height;
        geometryChanged = true;
        GLES20.glViewport(0, 0, width, height);
    }

    @Override public void onDrawFrame(GL10 unused) {
        if (failed || width == 0 || height == 0) return;
        try {
            Display display = getDisplay();
            if (display == null) return;
            int rotation = display.getRotation();
            if (rotation != displayRotation || geometryChanged) {
                session.setDisplayGeometry(rotation, width, height);
                displayRotation = rotation;
                geometryChanged = true;
            }
            Frame frame = session.update();
            long timestamp = frame.getTimestamp();
            if (timestamp == 0) return;
            positions.rewind();
            textureCoordinates.rewind();
            if (geometryChanged || frame.hasDisplayGeometryChanged()) {
                frame.transformCoordinates2d(Coordinates2d.OPENGL_NORMALIZED_DEVICE_COORDINATES, positions,
                        Coordinates2d.TEXTURE_NORMALIZED, textureCoordinates);
                positions.rewind();
                textureCoordinates.rewind();
                geometryChanged = false;
            }
            GLES20.glUseProgram(program);
            GLES20.glActiveTexture(GLES20.GL_TEXTURE0);
            GLES20.glBindTexture(GLES11Ext.GL_TEXTURE_EXTERNAL_OES, texture);
            GLES20.glEnableVertexAttribArray(positionAttribute);
            GLES20.glEnableVertexAttribArray(coordinateAttribute);
            GLES20.glVertexAttribPointer(positionAttribute, 2, GLES20.GL_FLOAT, false, 0, positions);
            GLES20.glVertexAttribPointer(coordinateAttribute, 2, GLES20.GL_FLOAT, false, 0, textureCoordinates);
            GLES20.glDrawArrays(GLES20.GL_TRIANGLE_STRIP, 0, 4);
            if (timestamp != frameTimestamp && timestamp - lastPose >= 65_000_000L) {
                Camera camera = frame.getCamera();
                Double yaw = null;
                String reason;
                if (camera.getTrackingState() == TrackingState.TRACKING) {
                    float[] axis = camera.getPose().getZAxis();
                    if (Math.hypot(axis[0], axis[2]) >= 0.5) yaw = Math.toDegrees(Math.atan2(-axis[0], axis[2]));
                    reason = yaw == null ? "POINT_FORWARD" : "";
                } else {
                    reason = camera.getTrackingFailureReason().name();
                }
                lastPose = timestamp;
                listener.pose(yaw, reason);
            }
            frameTimestamp = timestamp;
        } catch (CameraNotAvailableException | RuntimeException error) { fail(); }
    }

    private void fail() {
        failed = true;
        listener.failed();
    }

    private static int createProgram() {
        int vertex = shader(GLES20.GL_VERTEX_SHADER, "attribute vec2 aPosition; attribute vec2 aCoordinate;"
                + "varying vec2 vCoordinate; void main(){gl_Position=vec4(aPosition,0.0,1.0); vCoordinate=aCoordinate;}");
        int fragment = shader(GLES20.GL_FRAGMENT_SHADER, "#extension GL_OES_EGL_image_external : require\n"
                + "precision mediump float; uniform samplerExternalOES uCamera; varying vec2 vCoordinate;"
                + "void main(){gl_FragColor=texture2D(uCamera,vCoordinate);}");
        int program = GLES20.glCreateProgram();
        GLES20.glAttachShader(program, vertex);
        GLES20.glAttachShader(program, fragment);
        GLES20.glLinkProgram(program);
        GLES20.glDeleteShader(vertex);
        GLES20.glDeleteShader(fragment);
        int[] status = new int[1];
        GLES20.glGetProgramiv(program, GLES20.GL_LINK_STATUS, status, 0);
        if (status[0] == 0) throw new IllegalStateException(GLES20.glGetProgramInfoLog(program));
        return program;
    }

    private static int shader(int type, String source) {
        int shader = GLES20.glCreateShader(type);
        GLES20.glShaderSource(shader, source);
        GLES20.glCompileShader(shader);
        int[] status = new int[1];
        GLES20.glGetShaderiv(shader, GLES20.GL_COMPILE_STATUS, status, 0);
        if (status[0] == 0) throw new IllegalStateException(GLES20.glGetShaderInfoLog(shader));
        return shader;
    }
}
