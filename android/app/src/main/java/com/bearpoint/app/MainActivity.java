package com.bearpoint.app;

import android.os.Bundle;
import android.util.Log;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
	private static final String TAG = "BearPointMain";
	private static final long LAUNCH_SPLASH_MIN_DURATION_MS = 1500L;
	static final String WEB_ASSET_REVISION = "1.0.4-ui55";

	@Override
	protected void load() {
		android.content.SharedPreferences assets = getSharedPreferences("bearpoint_web_assets", MODE_PRIVATE);
		boolean changed = !WEB_ASSET_REVISION.equals(assets.getString("revision", ""));
		if (changed) {
			// Clear only web resources before the first navigation, never local observations or settings.
			android.webkit.WebView webView = findViewById(com.getcapacitor.android.R.id.webview);
			if (webView != null) webView.clearCache(true);
		}
		super.load();
		if (changed) assets.edit().putString("revision", WEB_ASSET_REVISION).apply();
	}

	@Override
	public void onCreate(Bundle savedInstanceState) {
		Log.d(TAG, "onCreate start");
		registerPlugin(NativeTxtSharePlugin.class);
		registerPlugin(RtlSdrPlugin.class);
		registerPlugin(GpsTrackingPlugin.class);
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
