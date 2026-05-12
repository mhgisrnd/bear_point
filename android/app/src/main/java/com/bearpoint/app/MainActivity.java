package com.bearpoint.app;

import android.os.Bundle;
import android.util.Log;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
	private static final String TAG = "BearPointMain";
	private static final long LAUNCH_SPLASH_MIN_DURATION_MS = 1500L;

	@Override
	public void onCreate(Bundle savedInstanceState) {
		Log.d(TAG, "onCreate start");
		registerPlugin(NativeTxtSharePlugin.class);
		Log.d(TAG, "registerPlugin NativeTxtSharePlugin called");

		try {
			final long keepUntil = System.currentTimeMillis() + LAUNCH_SPLASH_MIN_DURATION_MS;
			SplashScreen splashScreen = SplashScreen.installSplashScreen(this);
			splashScreen.setKeepOnScreenCondition(() -> System.currentTimeMillis() < keepUntil);
		} catch (Throwable splashError) {
			Log.w(TAG, "Splash setup failed, fallback to default launch", splashError);
		}

		super.onCreate(savedInstanceState);
		Log.d(TAG, "onCreate end");
	}
}
