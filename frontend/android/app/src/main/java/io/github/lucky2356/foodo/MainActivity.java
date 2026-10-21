package io.github.lucky2356.foodo;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import io.github.lucky2356.foodo.files.FoodoFilesPlugin;
import io.github.lucky2356.foodo.update.FoodoUpdaterPlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        // The app's own plugins must be registered before the bridge is created in super.onCreate.
        registerPlugin(FoodoUpdaterPlugin.class);
        registerPlugin(FoodoFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
