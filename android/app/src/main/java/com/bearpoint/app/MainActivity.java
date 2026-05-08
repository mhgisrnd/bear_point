package com.bearpoint.app;

import android.os.Bundle;
import android.util.Log;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
	private static final String TAG = "BearPointMain";

	@Override
	public void onCreate(Bundle savedInstanceState) {
		Log.d(TAG, "onCreate start");
		registerPlugin(NativeTxtSharePlugin.class);
		Log.d(TAG, "registerPlugin NativeTxtSharePlugin called");
		super.onCreate(savedInstanceState);
		Log.d(TAG, "onCreate end");
	}
}
